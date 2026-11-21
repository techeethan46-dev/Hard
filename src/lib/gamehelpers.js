// Pieces the coin games share: reading the bet, taking the coins, and the "not enough coins" message.
import { isOverdue, payWin } from './bank.js';
import { fmt, parseBet } from './economy.js';
import { store } from './store.js';
import { notice } from './ui.js';

/**
 * Reads the bet the person typed and takes the coins right away, in one step.
 * Returns { amount, left } (left = their record after paying), or { reply } with the message to send.
 */
export async function takeBet(interaction, input) {
  const me = await store.stats.get(interaction.guildId, interaction.user.id);
  if (isOverdue(me)) return { reply: overdueNotice(me) };
  const have = me?.coins ?? 0;
  const bet = parseBet(input, have);
  if (bet.error) return { reply: notice('bad', bet.error, { title: 'Invalid bet' }) };
  const left = await store.stats.spend(interaction.guildId, interaction.user.id, bet.amount);
  if (!left) return { reply: notice('bad', `You only have **${fmt(have)}**. Earn more by chatting or with \`/daily\`.`, { title: 'Not enough coins' }) };
  return { amount: bet.amount, left };
}

/** Shown instead of a game or purchase while a loan is past its deadline. */
export const overdueNotice = (doc) => notice('bad', `Your loan is overdue: you owe **${fmt(doc.loan.owed)}**. Pay it back with \`/bank repay\` first.`, { title: 'Loan overdue' });

/** Pays a game result: profit is taxed. Returns { doc, tax }. */
export const pay = (interaction, bet, winnings, fallback) =>
  payWin(interaction.guildId, interaction.user.id, bet, winnings, fallback);
