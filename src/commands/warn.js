import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/store.js';
import { checkTarget, notify } from '../lib/moderation.js';
import { colors, embed, modLog } from '../lib/ui.js';

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

  const list = (db.data.warnings[target.id] ??= []);
  list.push({ id: randomUUID().slice(0, 8), reason, moderatorId: interaction.user.id, at: Date.now() });
  db.save();

  await notify(target.user, interaction.guild, `You were warned: **${reason}**`);
  await modLog(interaction.guild, { action: 'Warn', target: target.user, moderator: interaction.user, reason,
    extra: { name: 'Total warnings', value: String(list.length) } });
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [embed(colors.ok).setDescription(`Warned ${target}. They now have **${list.length}** warning(s).`)],
  });
}
