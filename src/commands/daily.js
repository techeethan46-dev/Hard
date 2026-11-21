import { SlashCommandBuilder } from 'discord.js';
import { todayFor } from '../lib/activity.js';
import { fundDaily, garnish } from '../lib/bank.js';
import { dailyBoostPercent, dailyReward, fmt } from '../lib/economy.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { card, colors, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('daily').setDescription('Claim your free daily coins');

export async function execute(interaction) {
  // "Today" follows the server's streak timezone, so it resets at the same midnight as streaks.
  const settings = await getSettings(interaction.guildId);
  const day = todayFor(settings);
  const boost = dailyBoostPercent(interaction.member, settings.dailyBoosts);
  const reward = dailyReward(boost);
  const doc = await store.stats.claimDaily(interaction.guildId, interaction.user.id, day, reward);
  if (!doc) return interaction.reply(notice('warn', 'You already claimed your daily reward today. Come back tomorrow!', { title: 'Already claimed' }));
  // The bank pays it first; if the bank is short, the rest is created new so nobody is ever refused.
  const fromBank = await fundDaily(interaction.guildId, reward);
  const toDebt = await garnish(interaction.guildId, interaction.user.id, reward); // an overdue loan takes half
  return interaction.reply(v2(card(colors.ok,
    text('### 🎁 Daily reward', `You got **${fmt(reward)}**!`, ...(boost ? [`⚡ Includes your **+${boost}%** role boost`] : []),
      ...(toDebt ? [`💳 **${fmt(toDebt)}** went to your overdue loan`] : []),
      `-# Your balance: ${fmt(doc.coins - toDebt)}`, ...(fromBank > 0 ? [`-# 🏛️ ${fmt(fromBank)} of it came from the bank`] : [])),
    footnote('Come back tomorrow for more'),
  )));
}
