import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, time } from 'discord.js';
import { db } from '../lib/store.js';
import { colors, embed, modLog } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription("View or remove a member's warnings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((s) =>
    s.setName('list').setDescription('List warnings')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('remove').setDescription('Remove one warning')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('id').setDescription('Warning ID (from /warnings list)').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('clear').setDescription('Remove all warnings')
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)));

export async function execute(interaction) {
  const user = interaction.options.getUser('member', true);
  const list = db.data.warnings[user.id] ?? [];
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const e = embed().setTitle(`Warnings for ${user.tag}`).setDescription(
      list.length
        ? list.map((w) => `\`${w.id}\` ${time(new Date(w.at), 'd')} by <@${w.moderatorId}> — ${w.reason}`).join('\n').slice(0, 4000)
        : 'No warnings.',
    );
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [e] });
  }

  let msg;
  if (sub === 'remove') {
    const id = interaction.options.getString('id', true);
    const idx = list.findIndex((w) => w.id === id);
    if (idx === -1) return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription('No warning with that ID.')] });
    list.splice(idx, 1);
    msg = `Removed warning \`${id}\` from ${user}.`;
  } else {
    list.length = 0;
    msg = `Cleared all warnings for ${user}.`;
  }
  db.data.warnings[user.id] = list;
  db.save();
  await modLog(interaction.guild, { action: sub === 'remove' ? 'Warning removed' : 'Warnings cleared', target: user,
    moderator: interaction.user, reason: msg, color: colors.ok });
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.ok).setDescription(msg)] });
}
