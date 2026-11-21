import { SlashCommandBuilder } from 'discord.js';
import { acceptTax, credit, getOffer, isOverdue, rollSkip, startSkip } from '../lib/bank.js';
import {
  LOAN_BANK_SHARE, LOAN_DAYS, LOAN_INTEREST, LOAN_MAX, LOAN_MIN, LOAN_MIN_LEVEL, ROB_CHANCE_PERCENT,
  ROB_COOLDOWN_MS, ROB_FEE_RATE, ROB_LOOT, ROB_MAX_LOOT, ROB_MIN_BANK, ROB_MIN_FEE, TAX_RATE, fmt, rng,
} from '../lib/economy.js';
import { levelInfo } from '../lib/levels.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('bank')
  .setDescription('The server bank: see its fund, rob it, or take a loan')
  .addSubcommand((s) => s.setName('view').setDescription('See how much is in the bank'))
  .addSubcommand((s) => s.setName('rob').setDescription(`Try to rob the bank (${ROB_CHANCE_PERCENT}% chance, once a day)`))
  .addSubcommand((s) => s.setName('loan').setDescription('Borrow coins from the bank')
    .addIntegerOption((o) => o.setName('amount').setDescription(`How many coins (${LOAN_MIN}-${LOAN_MAX.toLocaleString('en-US')})`).setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('repay').setDescription('Pay back your loan')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many coins (leave empty to pay it all)').setMinValue(1)));

const when = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'rob') return rob(interaction);
  if (sub === 'loan') return loan(interaction);
  if (sub === 'repay') return repay(interaction);
  return view(interaction);
}

// ---------------------------------------------------------------- view

async function view(interaction) {
  const { guildId } = interaction;
  const bank = await store.bank.get(guildId);
  const me = await store.stats.get(guildId, interaction.user.id);
  const lines = [];
  if ((me?.loan?.owed ?? 0) > 0) {
    lines.push(`💳 **Your loan:** you owe **${fmt(me.loan.owed)}**, due ${when(me.loan.dueAt)}${isOverdue(me) ? ' ⚠️ **overdue**' : ''}`);
  }
  const readyAt = (me?.robAt ?? 0) + ROB_COOLDOWN_MS;
  lines.push(readyAt > Date.now() ? `🕵️ **Your next robbery:** ${when(readyAt)}` : '🕵️ **Your next robbery:** ready now');
  return interaction.reply(v2(card(colors.warn,
    text('## 🏛️ The Server Bank', `# ${fmt(bank.coins)}`,
      bank.lastHeist ? `-# Last robbery: <@${bank.lastHeist.userId}> got away with ${fmt(bank.lastHeist.amount)} ${when(bank.lastHeist.at)}` : '-# Nobody has robbed it yet'),
    divider(),
    text(
      `**Where the money comes from:** a ${Math.round(TAX_RATE * 100)}% tax on chat coins, \`/pay\` and game winnings, plus loan repayments and robbery fees.`,
      '**Where it goes:** every `/daily` is paid from here first, loans, and robbers.',
    ),
    divider(),
    text(...lines),
    footnote('/bank rob · /bank loan · /bank repay'),
  )));
}

// ---------------------------------------------------------------- robbing

async function rob(interaction) {
  const { guildId } = interaction;
  const userId = interaction.user.id;
  const bank = await store.bank.get(guildId);
  if (bank.coins < ROB_MIN_BANK) return interaction.reply(notice('warn', `The bank only has **${fmt(bank.coins)}**, not worth the risk. Come back when it has at least ${fmt(ROB_MIN_BANK)}.`, { title: 'Almost empty' }));

  const me = await store.stats.get(guildId, userId);
  const wallet = me?.coins ?? 0;
  const readyAt = (me?.robAt ?? 0) + ROB_COOLDOWN_MS;
  if (readyAt > Date.now()) return interaction.reply(notice('warn', `You already tried today. You can try again ${when(readyAt)}.`, { title: 'Lying low' }));

  const fee = Math.max(ROB_MIN_FEE, Math.floor(wallet * ROB_FEE_RATE));
  if (!(await store.stats.spend(guildId, userId, fee))) {
    return interaction.reply(notice('bad', `Trying costs **${fmt(fee)}** (${Math.round(ROB_FEE_RATE * 100)}% of your coins, at least ${fmt(ROB_MIN_FEE)}) and you have **${fmt(wallet)}**.`, { title: 'Not enough coins' }));
  }
  if (!(await store.stats.claimRob(guildId, userId, Date.now(), ROB_COOLDOWN_MS))) {
    await store.stats.addCoins(guildId, userId, fee); // two tries at once: the second one is refunded
    return interaction.reply(notice('warn', 'You already tried today. Come back tomorrow.', { title: 'Lying low' }));
  }
  const after = await store.bank.add(guildId, fee);

  if (rng.int(100) >= ROB_CHANCE_PERCENT) {
    return interaction.reply(v2(card(colors.bad,
      text('### 🚔 Busted!', `${interaction.user} tried to rob the bank and was caught. The **${fmt(fee)}** fee went into the bank.`, `-# The bank now holds ${fmt(after.coins)}`),
      footnote(`${ROB_CHANCE_PERCENT}% of attempts work · a win takes ${Math.round(ROB_LOOT * 100)}% of the bank, up to ${fmt(ROB_MAX_LOOT)} · next try in 24 hours`),
    )));
  }
  const loot = await store.bank.take(guildId, Math.min(ROB_MAX_LOOT, Math.floor(after.coins * ROB_LOOT)));
  await credit(guildId, userId, loot);
  await store.bank.set(guildId, { lastHeist: { userId, amount: loot, at: Date.now() } });
  return interaction.reply(v2(card(colors.ok,
    text('### 💰 THE BANK WAS ROBBED!', `${interaction.user} got away with **${fmt(loot)}**!`, `-# The bank now holds ${fmt(after.coins - loot)}`),
    footnote(`Fee paid: ${fmt(fee)}`),
  )));
}

// ---------------------------------------------------------------- loans

async function loan(interaction) {
  const { guildId } = interaction;
  const userId = interaction.user.id;
  const amount = interaction.options.getInteger('amount', true);
  const fail = (message) => interaction.reply(notice('bad', message, { title: 'No loan' }));

  const me = await store.stats.get(guildId, userId);
  if ((me?.loan?.owed ?? 0) > 0) return fail(`You still owe **${fmt(me.loan.owed)}**. Pay it back with \`/bank repay\` first.`);
  if (!(await store.links.get(userId))) return fail('Link your Roblox account first (`/verify`). Loans are only for verified members.');
  const level = levelInfo(me?.xp ?? 0).level;
  if (level < LOAN_MIN_LEVEL) return fail(`You need **level ${LOAN_MIN_LEVEL}** to borrow. You are level ${level}. Keep chatting!`);

  const bank = await store.bank.get(guildId);
  const limit = Math.min(LOAN_MAX, Math.floor(bank.coins * LOAN_BANK_SHARE));
  if (amount < LOAN_MIN) return fail(`The smallest loan is **${fmt(LOAN_MIN)}**.`);
  if (amount > limit) return fail(`You can borrow up to **${fmt(limit)}** right now (at most ${fmt(LOAN_MAX)}, and ${Math.round(LOAN_BANK_SHARE * 100)}% of the bank).`);

  if ((await store.bank.take(guildId, amount)) < amount) return fail('The bank doesn\'t have enough right now.');
  const owed = Math.ceil(amount * (1 + LOAN_INTEREST));
  const dueAt = Date.now() + LOAN_DAYS * 86_400_000;
  if (!(await store.stats.openLoan(guildId, userId, { owed, dueAt, principal: amount }, amount))) {
    await store.bank.add(guildId, amount); // two at once: put it back
    return fail('You already have a loan.');
  }
  return interaction.reply(v2(card(colors.ok,
    text('### 💳 Loan approved', `You borrowed **${fmt(amount)}**.`, `Pay back **${fmt(owed)}** (${Math.round(LOAN_INTEREST * 100)}% extra) by ${when(dueAt)} with \`/bank repay\`.`),
    footnote('If you miss the deadline, half of every coin you earn goes to the debt and you can\'t gamble or shop until it\'s paid'),
  )));
}

async function repay(interaction) {
  const { guildId } = interaction;
  const userId = interaction.user.id;
  const me = await store.stats.get(guildId, userId);
  const owed = me?.loan?.owed ?? 0;
  if (owed <= 0) return interaction.reply(notice('warn', 'You don\'t have a loan.', { title: 'Nothing to pay' }));

  const pay = Math.min(interaction.options.getInteger('amount') ?? owed, owed, me.coins ?? 0);
  if (pay <= 0) return interaction.reply(notice('bad', `You owe **${fmt(owed)}** and have no coins to pay with.`, { title: 'Not enough coins' }));
  if (!(await store.stats.spend(guildId, userId, pay))) return interaction.reply(notice('bad', 'You don\'t have that many coins.', { title: 'Not enough coins' }));
  if (!(await store.stats.payDebt(guildId, userId, pay))) {
    await store.stats.addCoins(guildId, userId, pay); // the debt changed under us
    return interaction.reply(notice('warn', 'Your loan changed just now. Try again.'));
  }
  await store.bank.add(guildId, pay);
  const left = owed - pay;
  return interaction.reply(notice('ok', left > 0 ? `You paid **${fmt(pay)}**. You still owe **${fmt(left)}**.` : `You paid **${fmt(pay)}**. Your loan is paid off!`, { title: 'Loan payment' }));
}

// ---------------------------------------------------------------- the tax buttons after a win

export async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const offer = getOffer(id);
  if (!offer || offer.state !== 'open') {
    return interaction.update(v2(card(colors.warn, text('### 🏛️ Tax on your win', 'This choice has ended, so the tax stays paid.'))));
  }
  if (interaction.user.id !== offer.userId) return interaction.reply(notice('warn', 'That choice belongs to someone else.'));
  if (action === 'pay') return interaction.update(acceptTax(offer));
  if (action === 'skip') return interaction.update(await startSkip(offer));
  if (action === 'risk') return interaction.update(await rollSkip(offer));
}
