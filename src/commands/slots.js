import { SlashCommandBuilder } from 'discord.js';
import { MIN_BET, fmt, payout, spinSlots } from '../lib/economy.js';
import { offerTax } from '../lib/bank.js';
import { pay, takeBet } from '../lib/gamehelpers.js';
import { card, colors, divider, footnote, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Spin the slot machine')
  .addStringOption((o) => o.setName('bet').setDescription(`How many coins (at least ${MIN_BET}, or all / half)`).setRequired(true));

export async function execute(interaction) {
  const taken = await takeBet(interaction, interaction.options.getString('bet', true));
  if (taken.reply) return interaction.reply(taken.reply);

  const spin = spinSlots();
  const winnings = payout(taken.amount, spin.multiplier);
  const { doc, tax } = await pay(interaction, taken.amount, winnings, taken.left);

  const line = spin.kind === 'triple'
    ? `${spin.multiplier >= 200 ? '💎 **JACKPOT!** ' : '🎉 '}Three ${spin.symbol} · **${spin.multiplier}×**, you won **${fmt(winnings - taken.amount)}**!`
    : spin.kind === 'pair' ? `😐 Two matching · you get your **${fmt(taken.amount)}** back.`
      : `💸 No match · you lost **${fmt(taken.amount)}**.`;
  await interaction.reply(v2(card(spin.kind === 'triple' ? colors.ok : spin.kind === 'pair' ? colors.warn : colors.bad,
    text('### 🎰 Slots', `# ${spin.reels.join('  ┃  ')}`),
    divider(),
    text(line, ...(tax ? [`🏛️ Tax: **${fmt(tax)}** went to the bank`] : []), `-# Balance: ${fmt(doc.coins)}`),
    footnote('Three of a kind pays 4× to 500× · two matching returns your bet'),
  )));
  return offerTax(interaction, tax);
}
