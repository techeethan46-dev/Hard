// Pieces the coin games share: reading the bet, taking the coins, and the "not enough coins" message.
import { fmt, parseBet } from './economy.js';
import { store } from './store.js';
import { notice } from './ui.js';

/**
 * Reads the bet the person typed and takes the coins right away, in one step.
 * Returns { amount, left } (left = their record after paying), or { reply } with the message to send.
 */
export async function takeBet(interaction, input) {
  const have = (await store.stats.get(interaction.guildId, interaction.user.id))?.coins ?? 0;
  const bet = parseBet(input, have);
  if (bet.error) return { reply: notice('bad', bet.error, { title: 'Invalid bet' }) };
  const left = await store.stats.spend(interaction.guildId, interaction.user.id, bet.amount);
  if (!left) return { reply: notice('bad', `You only have **${fmt(have)}**. Earn more by chatting or with \`/daily\`.`, { title: 'Not enough coins' }) };
  return { amount: bet.amount, left };
}

/** Pays winnings (0 pays nothing) and returns the record. */
export const pay = (interaction, amount, fallback) => (amount > 0
  ? store.stats.addCoins(interaction.guildId, interaction.user.id, amount)
  : Promise.resolve(fallback));
