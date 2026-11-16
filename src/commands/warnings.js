import { PermissionFlagsBits, SlashCommandBuilder, time } from 'discord.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, modLog, notice, section, text, thumb, v2 } from '../lib/ui.js';

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
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const list = await store.warnings.list(interaction.guildId, user.id);
    const entries = list.slice(-15).reverse().map((w) =>
      `**${w.reason}**\n-# \`${w.id}\` · ${time(new Date(w.at), 'R')} · by <@${w.moderatorId}>`);
    return interaction.reply(v2(card(list.length ? colors.warn : colors.ok,
      section([`### ⚠️ Warnings`, `${user} has **${list.length}** warning${list.length === 1 ? '' : 's'}`], thumb(user.displayAvatarURL({ size: 128 }))),
      divider(),
      text(entries.length ? entries.join('\n\n') : '✨ Clean record, nothing here.'),
      list.length > 15 ? footnote(`Showing the newest 15 of ${list.length}.`) : null,
      list.length ? footnote('Remove one with /warnings remove and its ID.') : null,
    ), { ephemeral: true }));
  }

  let msg;
  if (sub === 'remove') {
    const id = interaction.options.getString('id', true);
    if (!(await store.warnings.remove(interaction.guildId, user.id, id))) return interaction.reply(notice('bad', `${user} has no warning with ID \`${id}\`.`));
    msg = `Removed warning \`${id}\` from ${user}.`;
  } else {
    const n = await store.warnings.clear(interaction.guildId, user.id);
    msg = `Cleared ${n} warning(s) for ${user}.`;
  }
  await modLog(interaction.guild, { action: sub === 'remove' ? 'Warning removed' : 'Warnings cleared', target: user,
    moderator: interaction.user, reason: msg });
  return interaction.reply(notice('ok', msg, { title: sub === 'remove' ? 'Warning removed' : 'Warnings cleared' }));
}
