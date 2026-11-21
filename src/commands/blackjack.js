import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { MIN_BET, dealerPlay, fmt, handValue, isNatural, newDeck, settle, showHand } from '../lib/economy.js';
import { offerTax, payWin } from '../lib/bank.js';
import { takeBet } from '../lib/gamehelpers.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Play blackjack against the dealer')
  .addStringOption((o) => o.setName('bet').setDescription(`How many coins (at least ${MIN_BET}, or all / half)`).setRequired(true));

// A hand stays open while you choose Hit / Stand / Double. It lives in memory, one per person.
// If the bot restarts in the middle of a hand, that bet is lost (rare). A hand left alone stands by itself after 2 minutes.
export const games = new Map(); // "guild:user" -> { guildId, userId, bet, deck, player, dealer, interaction, timer }
export const timing = { idleMs: 120_000 };
const keyOf = (guildId, userId) => `${guildId}:${userId}`;

function view(g, result) {
  const pv = handValue(g.player);
  const dealerLine = result ? `${showHand(g.dealer)} · **${handValue(g.dealer)}**` : `${showHand([g.dealer[0]])} \`??\``;
  const body = [
    text('### 🃏 Blackjack', `Bet: **${fmt(g.bet)}**${g.bet > g.firstBet ? ' (doubled)' : ''}`),
    divider(),
    text(`**Dealer** ${dealerLine}`, `**You** ${showHand(g.player)} · **${pv}**`),
  ];
  if (result) {
    const net = result.won - g.bet;
    const line = {
      blackjack: `🃏 **Blackjack!** You win **${fmt(net)}**!`,
      win: `🎉 You win **${fmt(net)}**!`,
      push: `🤝 Push. Your **${fmt(g.bet)}** is returned.`,
      lose: pv > 21 ? `💥 Bust! You lost **${fmt(g.bet)}**.` : `💸 The dealer wins. You lost **${fmt(g.bet)}**.`,
    }[result.outcome];
    body.push(divider(), text(line, ...(result.tax ? [`🏛️ Tax: **${fmt(result.tax)}** went to the bank`] : []), `-# Balance: ${fmt(result.balance)}`));
    return v2(card({ blackjack: colors.ok, win: colors.ok, push: colors.warn, lose: colors.bad }[result.outcome], body, footnote('Play again with /blackjack')));
  }
  return v2(card(colors.brand, body,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('blackjack:hit').setLabel('Hit').setEmoji('🃏').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('blackjack:stand').setLabel('Stand').setEmoji('✋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('blackjack:double').setLabel('Double').setEmoji('✖️').setStyle(ButtonStyle.Secondary).setDisabled(g.player.length !== 2),
    ),
    footnote('Closest to 21 wins · blackjack pays 3 to 2 · the dealer stands on 17'),
  ));
}

/** Dealer plays, the hand is settled and paid. Returns the final message; `g.tax` is the tax taken from a win. */
async function conclude(g) {
  clearTimeout(g.timer);
  games.delete(keyOf(g.guildId, g.userId));
  if (handValue(g.player) <= 21 && !isNatural(g.player)) dealerPlay(g.deck, g.dealer);
  const { outcome, payout: won } = settle(g.player, g.dealer, g.bet);
  const { doc, tax } = await payWin(g.guildId, g.userId, g.bet, won, await store.stats.get(g.guildId, g.userId));
  g.tax = tax;
  return view(g, { outcome, won, balance: doc?.coins ?? 0, tax });
}

function arm(g) {
  clearTimeout(g.timer);
  g.timer = setTimeout(async () => {
    if (games.get(keyOf(g.guildId, g.userId)) !== g) return;
    const final = await conclude(g);
    await g.interaction.editReply(final).catch(() => {});
    await offerTax(g.interaction, g.tax).catch(() => {});
  }, timing.idleMs);
  g.timer.unref?.();
}

export async function execute(interaction) {
  const key = keyOf(interaction.guildId, interaction.user.id);
  if (games.has(key)) return interaction.reply(notice('warn', 'You already have a hand in progress. Finish it first (or wait 2 minutes).'));
  const taken = await takeBet(interaction, interaction.options.getString('bet', true));
  if (taken.reply) return interaction.reply(taken.reply);

  const deck = newDeck();
  const g = {
    guildId: interaction.guildId, userId: interaction.user.id, bet: taken.amount, firstBet: taken.amount,
    deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], interaction,
  };
  if (isNatural(g.player) || isNatural(g.dealer)) { // decided right away
    await interaction.reply(await conclude(g));
    return offerTax(interaction, g.tax);
  }
  games.set(key, g);
  arm(g);
  return interaction.reply(view(g));
}

export async function handleButton(interaction) {
  const g = games.get(keyOf(interaction.guildId, interaction.user.id));
  if (!g) return interaction.reply(notice('warn', 'This isn\'t your hand, or it already ended. Start one with `/blackjack`.'));
  const action = interaction.customId.split(':')[1];

  if (action === 'hit') {
    g.player.push(g.deck.pop());
    if (handValue(g.player) < 21) {
      arm(g);
      return interaction.update(view(g));
    }
    await interaction.update(await conclude(g)); // bust, or exactly 21: nothing more to do
    return offerTax(interaction, g.tax);
  }
  if (action === 'double') {
    if (g.player.length !== 2) return interaction.reply(notice('warn', 'You can only double on your first move.'));
    const left = await store.stats.spend(g.guildId, g.userId, g.firstBet);
    if (!left) return interaction.reply(notice('bad', `You need **${fmt(g.firstBet)}** more to double.`, { title: 'Not enough coins' }));
    g.bet += g.firstBet;
    g.player.push(g.deck.pop());
    await interaction.update(await conclude(g));
    return offerTax(interaction, g.tax);
  }
  await interaction.update(await conclude(g)); // stand
  return offerTax(interaction, g.tax);
}
