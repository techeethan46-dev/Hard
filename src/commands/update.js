import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { store } from '../lib/store.js';
import { syncMember } from '../lib/roles.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Refresh roles and nickname from your Roblox account')
  .addUserOption((o) => o.setName('member').setDescription('(Staff) member to update'));

export async function execute(interaction) {
  const target = interaction.options.getMember('member') ?? interaction.member;
  if (target.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription('Only staff can update other members.')] });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const linked = await store.links.get(target.id);
  const r = await syncMember(target);

  const fmt = (ids) => ids.map((id) => `<@&${id}>`).join(', ') || 'none';
  const e = embed(r.errors.length ? colors.warn : colors.ok)
    .setTitle(`Updated ${target.displayName}`)
    .addFields(
      { name: 'Roblox', value: linked ? linked.username : 'Not verified — use `/verify`', inline: true },
      { name: 'Roles added', value: fmt(r.added) },
      { name: 'Roles removed', value: fmt(r.removed) },
    );
  if (r.nickname) e.addFields({ name: 'Nickname', value: r.nickname });
  if (r.errors.length) e.addFields({ name: 'Notes', value: r.errors.join('\n') });
  return interaction.editReply({ embeds: [e] });
}
