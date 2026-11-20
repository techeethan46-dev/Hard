import { SlashCommandBuilder } from 'discord.js';
import { todayFor } from '../lib/activity.js';
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
  return interaction.reply(v2(card(colors.ok,
    text('### 🎁 Daily reward', `You got **${fmt(reward)}**!`, ...(boost ? [`⚡ Includes your **+${boost}%** role boost`] : []), `-# Your balance: ${fmt(doc.coins)}`),
    footnote('Come back tomorrow for more'),
  )));
}
