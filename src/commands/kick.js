import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkTarget, notify } from '../lib/moderation.js';
import { modLog, notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a member')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500));

export async function execute(interaction) {
  const target = interaction.options.getMember('member');
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  if (!(await checkTarget(interaction, target, 'kick'))) return;

  await notify(target.user, interaction.guild, { kind: 'bad', title: 'You were kicked', reason });
  await target.kick(`${interaction.user.tag}: ${reason}`);
  await modLog(interaction.guild, { action: 'Kick', target: target.user, moderator: interaction.user, reason });
  return interaction.reply(notice('ok', `**${target.user.tag}** was removed from the server.\n-# Reason: ${reason}`, { title: 'Kicked' }));
}
