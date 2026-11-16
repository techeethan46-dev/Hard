import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { RAID_NEW_ACCOUNT_DAYS, endRaid, raidStatus, startRaid } from '../lib/raid.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('raidmode')
  .setDescription('Turn raid protection mode on or off')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('on').setDescription('Kick new accounts that join, for a while')
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long (default 30)').setMinValue(5).setMaxValue(720)))
  .addSubcommand((s) => s.setName('off').setDescription('Turn raid mode off'))
  .addSubcommand((s) => s.setName('status').setDescription('Is raid mode on?'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'on') {
    const minutes = interaction.options.getInteger('minutes') ?? 30;
    await startRaid(interaction.guild, { minutes, reason: 'Turned on by staff', by: interaction.user });
    return interaction.reply(notice('ok', `For the next **${minutes} minutes**, accounts younger than ${RAID_NEW_ACCOUNT_DAYS} days are kicked when they join. Use \`/raidmode off\` to stop early.`, { title: '🚨 Raid mode on' }));
  }
  if (sub === 'off') {
    const was = await endRaid(interaction.guild, { by: interaction.user });
    return interaction.reply(was ? notice('ok', 'New accounts can join again.', { title: 'Raid mode off' }) : notice('warn', 'Raid mode wasn\'t on.'));
  }
  const s = raidStatus(interaction.guildId);
  return interaction.reply(s.active
    ? notice('warn', `On until <t:${Math.floor(s.until / 1000)}:t> · ${s.kicked} account${s.kicked === 1 ? '' : 's'} kicked so far.`, { title: '🚨 Raid mode is on' })
    : notice('ok', 'Raid mode is off. It switches on by itself if lots of people join at once (change this in `/setup`).', { title: 'All calm' }));
}

/** "End raid mode now" button on the alert. */
export async function handleButton(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply(notice('bad', 'You need **Manage Server** to end raid mode.'));
  }
  await interaction.deferUpdate();
  // If the bot restarted since the alert, there's nothing to end: just tidy up the alert.
  if (!(await endRaid(interaction.guild, { by: interaction.user }))) {
    await interaction.editReply(notice('ok', 'Raid mode has already ended.', { ephemeral: false }));
  }
}
