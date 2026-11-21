import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { COLORS, MIN_BET, ROULETTE_PAYOUT, fmt, parseBet, payout, spinRoulette } from '../lib/economy.js';
import { offerTax, isOverdue } from '../lib/bank.js';
import { overdueNotice, pay } from '../lib/gamehelpers.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Bet coins on a color: red, blue or green')
  .addStringOption((o) => o.setName('bet').setDescription(`How many coins (at least ${MIN_BET}, or all / half)`).setRequired(true));

export const timing = { spinMs: 1200 }; // tests set this to 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = new Set(); // messages already played, so a double tap can't play twice

export async function execute(interaction) {
  const me = await store.stats.get(interaction.guildId, interaction.user.id);
  if (isOverdue(me)) return interaction.reply(overdueNotice(me));
  const have = me?.coins ?? 0;
  const bet = parseBet(interaction.options.getString('bet', true), have);
  if (bet.error) return interaction.reply(notice('bad', bet.error, { title: 'Invalid bet' }));
  if (bet.amount > have) return interaction.reply(notice('bad', `You only have **${fmt(have)}**.`, { title: 'Not enough coins' }));

  // The coins are taken when you pick a color, not now.
  return interaction.reply(v2(card(colors.brand,
    text('### 🎡 Roulette', `Bet: **${fmt(bet.amount)}**`, 'Pick a color. If the wheel lands on it, you win **' + ROULETTE_PAYOUT + '×**.'),
    new ActionRowBuilder().addComponents(COLORS.map((c) => new ButtonBuilder()
      .setCustomId(`roulette:${c.id}:${bet.amount}:${interaction.user.id}`).setLabel(c.label).setEmoji(c.emoji).setStyle(ButtonStyle.Secondary))),
    footnote('Only you can pick · each color has a 1 in 3 chance'),
  )));
}

export async function handleButton(interaction) {
  const [, colorId, amount, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) return interaction.reply(notice('warn', 'That\'s someone else\'s game. Start your own with `/roulette`.'));
  const key = interaction.message?.id ?? interaction.customId;
  if (started.has(key)) return interaction.reply(notice('warn', 'This round already started.'));
  started.add(key);
  if (started.size > 2000) started.clear();

  const bet = Number(amount);
  const me = await store.stats.get(interaction.guildId, interaction.user.id);
  if (isOverdue(me)) { started.delete(key); return interaction.reply(overdueNotice(me)); }
  const left = await store.stats.spend(interaction.guildId, interaction.user.id, bet);
  if (!left) {
    return interaction.update(notice('bad', `You don't have **${fmt(bet)}** anymore. Start again with \`/roulette\`.`, { title: 'Not enough coins', ephemeral: false }));
  }
  const pick = COLORS.find((c) => c.id === colorId);

  await interaction.update(v2(card(colors.brand, text('### 🎡 Roulette', `You bet **${fmt(bet)}** on ${pick.emoji} **${pick.label}**`, '🎡 The wheel is spinning…'))));
  await sleep(timing.spinMs);

  const landed = spinRoulette();
  const won = landed.id === pick.id;
  const winnings = won ? payout(bet, ROULETTE_PAYOUT) : 0;
  const { doc, tax } = await pay(interaction, bet, winnings, left);
  await interaction.editReply(v2(card(won ? colors.ok : colors.bad,
    text('### 🎡 Roulette', `You bet on ${pick.emoji} **${pick.label}** · it landed on ${landed.emoji} **${landed.label}**`),
    divider(),
    text(won ? `🎉 You won **${fmt(winnings - bet)}**!` : `💸 You lost **${fmt(bet)}**.`, ...(tax ? [`🏛️ Tax: **${fmt(tax)}** went to the bank`] : []), `-# Balance: ${fmt(doc.coins)}`),
    footnote('Play again with /roulette'),
  )));
  return offerTax(interaction, tax);
}
