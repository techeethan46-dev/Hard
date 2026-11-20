import { SlashCommandBuilder } from 'discord.js';
import { MAX_BET, MIN_BET, fmt, payout, spinSlots } from '../lib/economy.js';
import { pay, takeBet } from '../lib/gamehelpers.js';
import { card, colors, divider, footnote, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Spin the slot machine')
  .addStringOption((o) => o.setName('bet').setDescription(`How many coins (${MIN_BET}-${MAX_BET.toLocaleString('en-US')}, or all / half)`).setRequired(true));

export async function execute(interaction) {
  const taken = await takeBet(interaction, interaction.options.getString('bet', true));
  if (taken.reply) return interaction.reply(taken.reply);

  const spin = spinSlots();
  const winnings = payout(taken.amount, spin.multiplier);
  const doc = await pay(interaction, winnings, taken.left);

  const line = spin.kind === 'triple'
    ? `${spin.multiplier >= 200 ? '💎 **JACKPOT!** ' : '🎉 '}Three ${spin.symbol} · **${spin.multiplier}×**, you won **${fmt(winnings - taken.amount)}**!`
    : spin.kind === 'pair' ? `😐 Two matching · you get your **${fmt(taken.amount)}** back.`
      : `💸 No match · you lost **${fmt(taken.amount)}**.`;
  return interaction.reply(v2(card(spin.kind === 'triple' ? colors.ok : spin.kind === 'pair' ? colors.warn : colors.bad,
    text('### 🎰 Slots', `# ${spin.reels.join('  ┃  ')}`),
    divider(),
    text(line, `-# Balance: ${fmt(doc.coins)}`),
    footnote('Three of a kind pays 4× to 500× · two matching returns your bet'),
  )));
}
