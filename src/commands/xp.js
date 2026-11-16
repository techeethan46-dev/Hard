import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { grantRewards } from '../lib/activity.js';
import { levelInfo, totalXpFor } from '../lib/levels.js';
import { setStreakBadge } from '../lib/nickname.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Change someone\'s level or streak (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('set-level').setDescription('Set a member\'s level')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(0).setMaxValue(500)))
  .addSubcommand((s) => s.setName('give').setDescription('Give (or take with a negative number) XP')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(-1_000_000).setMaxValue(1_000_000)))
  .addSubcommand((s) => s.setName('reset').setDescription('Reset a member\'s XP and streak')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)));

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  if (user.bot) return interaction.reply(notice('warn', 'Bots don\'t have levels.'));
  const member = interaction.options.getMember('member');
  const sub = interaction.options.getSubcommand();
  const doc = (await store.stats.get(interaction.guildId, user.id)) ?? { xp: 0 };

  if (sub === 'reset') {
    await store.stats.set(interaction.guildId, user.id, { xp: 0, streak: null });
    await setStreakBadge(member, 0).catch(() => {});
    return interaction.reply(notice('ok', `${user} is back to level 0 with no streak.`, { title: 'Reset' }));
  }

  const xp = sub === 'set-level'
    ? totalXpFor(interaction.options.getInteger('level', true))
    : Math.max(0, (doc.xp ?? 0) + interaction.options.getInteger('amount', true));
  await store.stats.set(interaction.guildId, user.id, { xp });
  const { level } = levelInfo(xp);
  await grantRewards(member, await getSettings(interaction.guildId), level);
  return interaction.reply(notice('ok', `${user} is now **level ${level}** (${xp.toLocaleString('en-US')} XP).`, { title: 'XP updated' }));
}
