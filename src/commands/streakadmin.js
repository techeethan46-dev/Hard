import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { syncStreakRoles, todayFor } from '../lib/activity.js';
import { setStreakBadge } from '../lib/nickname.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { RESTORES_PER_MONTH, addDays, normalize, restoresLeft } from '../lib/streaks.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('streak-admin')
  .setDescription('Change someone\'s chat streak (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('set').setDescription('Set a member\'s streak to a number of days')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('days').setDescription('Days (0 removes the streak)').setRequired(true).setMinValue(0).setMaxValue(3650)))
  .addSubcommand((s) => s.setName('reset').setDescription('Remove a member\'s streak completely (their XP is not touched)')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
  .addSubcommand((s) => s.setName('restores').setDescription(`Give a member all ${RESTORES_PER_MONTH} of this month's streak restores back`)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)));

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  if (user.bot) return interaction.reply(notice('warn', 'Bots don\'t have streaks.'));
  const member = interaction.options.getMember('member');
  const sub = interaction.options.getSubcommand();
  const settings = await getSettings(interaction.guildId);
  const today = todayFor(settings);
  const doc = await store.stats.get(interaction.guildId, user.id);

  if (sub === 'restores') {
    const s = normalize(doc?.streak);
    await store.stats.set(interaction.guildId, user.id, { streak: { ...s, restores: { month: today.slice(0, 7), used: 0 } } });
    return interaction.reply(notice('ok', `${user} has **${RESTORES_PER_MONTH}/${RESTORES_PER_MONTH}** restores for this month.`, { title: 'Restores refilled' }));
  }

  const days = sub === 'reset' ? 0 : interaction.options.getInteger('days', true);
  if (days === 0) {
    await store.stats.set(interaction.guildId, user.id, { streak: null });
  } else {
    const old = normalize(doc?.streak);
    await store.stats.set(interaction.guildId, user.id, {
      streak: { ...old, current: days, best: Math.max(old.best, days), lastDay: today, startDay: addDays(today, -(days - 1)), lost: 0, lostLastDay: null, lostNotified: true },
    });
  }
  await setStreakBadge(member, days).catch(() => {});
  await syncStreakRoles(member, settings, days);

  return interaction.reply(days
    ? notice('ok', `${user} is now on a **${days}-day** streak 🔥`, { title: 'Streak set' })
    : notice('ok', `${user} has no streak now.\n-# Their XP and level weren't touched. Use \`/xp\` for that.`, { title: 'Streak removed' }));
}
