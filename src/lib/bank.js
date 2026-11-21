// Money moving in and out of the server bank: tax, loans, the "don't pay tax" gamble.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { randomBytes } from 'node:crypto';
import {
  EVADE_CATCH_PERCENT, EVADE_CONFIRM_ABOVE, EVADE_PENALTY, TAX_CHOICE_MS, TAX_RATE, fmt, rng, taxOn,
} from './economy.js';
import { store } from './store.js';
import { card, colors, footnote, text, v2 } from './ui.js';

export const timing = { choiceMs: TAX_CHOICE_MS, confirmMs: 20_000 }; // tests shorten these

// ---------------------------------------------------------------- loans and receiving coins

/** True when they owe money and the deadline has passed. */
export const isOverdue = (doc, now = Date.now()) => (doc?.loan?.owed ?? 0) > 0 && doc.loan.dueAt <= now;

/** Half of money that arrives goes to an overdue loan. Returns how many coins it took. */
export async function garnish(guildId, userId, amount, now = Date.now()) {
  if (amount < 2) return 0;
  const doc = await store.stats.get(guildId, userId);
  if (!isOverdue(doc, now)) return 0;
  const pay = Math.min(Math.floor(amount / 2), doc.loan.owed);
  if (pay <= 0 || !(await store.stats.spend(guildId, userId, pay))) return 0;
  if (!(await store.stats.payDebt(guildId, userId, pay))) {
    await store.stats.addCoins(guildId, userId, pay); // the debt changed under us: give it back
    return 0;
  }
  await store.bank.add(guildId, pay);
  return pay;
}

/** Gives coins to a member (an overdue loan takes its half). Returns their record, with `garnished`. */
export async function credit(guildId, userId, amount) {
  const doc = await store.stats.addCoins(guildId, userId, amount);
  const taken = await garnish(guildId, userId, amount);
  return { ...doc, coins: doc.coins - taken, garnished: taken };
}

/** Income that is taxed (chat coins): the tax goes to the bank, the rest to the member. */
export async function creditTaxed(guildId, userId, gross) {
  const tax = taxOn(gross);
  if (tax > 0) await store.bank.add(guildId, tax);
  const doc = await credit(guildId, userId, gross - tax);
  return { doc, tax };
}

/** Pays a game result. Profit (winnings above the bet) is taxed; the bet coming back is not. Returns { doc, tax }. */
export async function payWin(guildId, userId, bet, winnings, fallback) {
  if (winnings <= 0) return { doc: fallback, tax: 0 };
  const tax = winnings > bet ? taxOn(winnings - bet) : 0;
  if (tax > 0) await store.bank.add(guildId, tax);
  return { doc: await credit(guildId, userId, winnings - tax), tax };
}

/** The /daily reward comes out of the bank first; if the bank is short, the rest is created new. */
export const fundDaily = (guildId, reward) => store.bank.take(guildId, reward);

// ---------------------------------------------------------------- "pay tax / don't pay tax" after a win

const offers = new Map(); // id -> { id, guildId, userId, tax, state, timer, interaction, message }

export const getOffer = (id) => offers.get(id);

const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const btn = (id, label, emoji, style) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const finished = (offer, ...lines) => v2(card(colors.warn, text('### 🏛️ Tax on your win', ...lines)));

function close(offer) {
  clearTimeout(offer.timer);
  offers.delete(offer.id);
}

function arm(offer, ms, lines) {
  clearTimeout(offer.timer);
  offer.timer = setTimeout(async () => {
    if (offer.state === 'done') return;
    offer.state = 'done';
    offers.delete(offer.id);
    await offer.interaction.editReply({ ...finished(offer, ...lines), message: offer.message }).catch(() => {});
  }, ms);
  offer.timer.unref?.();
}

const paidLines = (tax) => [`You paid **${fmt(tax)}** tax. It went to the bank.`];

/** After a win: a private message with Pay / Don't pay buttons for a few seconds. No answer means you pay. */
export async function offerTax(interaction, tax) {
  if (!(tax > 0)) return;
  const id = randomBytes(6).toString('hex');
  const offer = { id, guildId: interaction.guildId, userId: interaction.user.id, tax, state: 'open', interaction };
  offers.set(id, offer);
  try {
    const sent = await interaction.followUp(v2(card(colors.warn,
      text('### 🏛️ Tax on your win',
        `**${Math.round(TAX_RATE * 100)}%** of your profit, **${fmt(tax)}**, already went to the bank.`,
        `Don't want to pay it? There's a **${EVADE_CATCH_PERCENT}%** chance you get caught, and then the bank takes **${Math.round(EVADE_PENALTY * 100)}%** of all your coins.`),
      row(btn(`bank:pay:${id}`, 'Pay tax', '🏛️', ButtonStyle.Success), btn(`bank:skip:${id}`, 'Don\'t pay tax', '🕵️', ButtonStyle.Danger)),
      footnote(`${Math.round(timing.choiceMs / 1000)} seconds to choose · no answer means you pay`),
    ), { ephemeral: true }));
    offer.message = sent?.id ?? sent;
    arm(offer, timing.choiceMs, paidLines(tax));
  } catch {
    close(offer); // couldn't send it (token expired): the tax simply stays paid
  }
}

/** The member pressed "Pay tax". */
export function acceptTax(offer) {
  offer.state = 'done';
  close(offer);
  return finished(offer, ...paidLines(offer.tax), 'Thanks for keeping the bank healthy!');
}

/** The member pressed "Don't pay tax": over 100k coins they are asked to confirm first. */
export async function startSkip(offer) {
  const wallet = (await store.stats.get(offer.guildId, offer.userId))?.coins ?? 0;
  if (wallet <= EVADE_CONFIRM_ABOVE) return rollSkip(offer);
  arm(offer, timing.confirmMs, paidLines(offer.tax));
  return v2(card(colors.bad,
    text('### ⚠️ Are you sure?',
      `You have **${fmt(wallet)}**. There is a **${EVADE_CATCH_PERCENT}%** chance you get caught, and if you do, **${Math.round(EVADE_PENALTY * 100)}%** of your coins (**${fmt(Math.floor(wallet * EVADE_PENALTY))}**) are gone.`),
    row(btn(`bank:risk:${offer.id}`, 'Yes, risk it', '🎲', ButtonStyle.Danger), btn(`bank:pay:${offer.id}`, 'Cancel, pay the tax', '🏛️', ButtonStyle.Secondary)),
    footnote(`${Math.round(timing.confirmMs / 1000)} seconds · no answer means you pay`),
  ));
}

/** The roll: caught (the bank takes most of their coins) or not (the tax is given back). */
export async function rollSkip(offer) {
  offer.state = 'done';
  close(offer);
  const { guildId, userId, tax } = offer;
  if (rng.int(100) < EVADE_CATCH_PERCENT) {
    const wallet = (await store.stats.get(guildId, userId))?.coins ?? 0;
    const penalty = Math.floor(wallet * EVADE_PENALTY);
    const taken = penalty > 0 && (await store.stats.spend(guildId, userId, penalty)) ? penalty : 0;
    if (taken) await store.bank.add(guildId, taken);
    return v2(card(colors.bad, text('### 🚨 Caught!',
      `You tried to dodge the tax and got caught. The bank took **${fmt(taken)}** of your coins.`)));
  }
  const back = await store.bank.take(guildId, tax);
  if (back > 0) await store.stats.addCoins(guildId, userId, back);
  return v2(card(colors.ok, text('### 🕵️ Not caught!', `You got away with it and kept your **${fmt(back)}** tax.`)));
}
