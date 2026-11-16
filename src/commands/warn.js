import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { store } from '../lib/store.js';
import { checkTarget, notify } from '../lib/moderation.js';
import { modLog, notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a member')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('member').setDescription('Member to warn').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500));

export async function execute(interaction) {
  const target = interaction.options.getMember('member');
  const reason = interaction.options.getString('reason', true);
  if (!(await checkTarget(interaction, target, 'warn'))) return;

  const total = await store.warnings.add(interaction.guildId, target.id, { id: randomUUID().slice(0, 8), reason, moderatorId: interaction.user.id, at: Date.now() });

  await notify(target.user, interaction.guild, { kind: 'warn', title: 'You received a warning', reason, extra: `This is warning **#${total}**.` });
  await modLog(interaction.guild, { action: 'Warn', target: target.user, moderator: interaction.user, reason,
    extra: { name: 'Total warnings', value: String(total) } });
  return interaction.reply(notice('ok', `${target} now has **${total}** warning${total === 1 ? '' : 's'}.\n-# Reason: ${reason}`, { title: 'Warning given' }));
}
