import { SlashCommandBuilder } from 'discord.js';
import { COINFLIP_PAYOUT, MAX_BET, MIN_BET, flip, fmt, payout } from '../lib/economy.js';
import { pay, takeBet } from '../lib/gamehelpers.js';
import { card, colors, divider, footnote, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Bet coins on heads or tails: double or nothing')
  .addStringOption((o) => o.setName('bet').setDescription(`How many coins (${MIN_BET}-${MAX_BET.toLocaleString('en-US')}, or all / half)`).setRequired(true))
  .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true)
    .addChoices({ name: '🪙 Heads', value: 'heads' }, { name: '🌑 Tails', value: 'tails' }));

export async function execute(interaction) {
  const taken = await takeBet(interaction, interaction.options.getString('bet', true));
  if (taken.reply) return interaction.reply(taken.reply);

  const side = interaction.options.getString('side', true);
  const result = flip();
  const won = result === side;
  const winnings = won ? payout(taken.amount, COINFLIP_PAYOUT) : 0;
  const doc = await pay(interaction, winnings, taken.left);

  return interaction.reply(v2(card(won ? colors.ok : colors.bad,
    text('### 🪙 Coinflip', `You picked **${side}** and it landed on **${result}**.`),
    divider(),
    text(won ? `🎉 You won **${fmt(winnings - taken.amount)}**!` : `💸 You lost **${fmt(taken.amount)}**.`, `-# Balance: ${fmt(doc.coins)}`),
    footnote('Double or nothing'),
  )));
}
