import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { store } from '../lib/store.js';
import { bloxlinkEnabled, lookupRoblox } from '../lib/bloxlink.js';
import { getUser } from '../lib/roblox.js';
import { syncMember } from '../lib/roles.js';
import { getHeadshotUrl } from '../lib/roblox.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Refresh roles and nickname from your Roblox account')
  .addUserOption((o) => o.setName('member').setDescription('(Staff) member to update'));

export async function execute(interaction) {
  const target = interaction.options.getMember('member') ?? interaction.member;
  if (target.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply(notice('bad', 'Only staff can update other members.'));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // With Bloxlink, pick up a changed Roblox account for linked members first (best effort: if Bloxlink is down we keep the saved link).
  if (bloxlinkEnabled()) {
    const id = await lookupRoblox(interaction.guildId, target.id).catch(() => null);
    const saved = await store.links.get(target.id);
    const user = saved && id && id !== saved.robloxId ? await getUser(id) : null;
    if (user) await store.links.set(target.id, { robloxId: id, username: user.name });
  }
  const linked = await store.links.get(target.id);
  const r = await syncMember(target);

  if (!linked) {
    return interaction.editReply(notice('warn', `${target.id === interaction.user.id ? "You haven't" : `${target} hasn't`} linked a Roblox account yet. Use \`/verify\` first.`, { title: 'Not verified', ephemeral: false }));
  }

  const changes = [
    ...r.added.map((id) => `➕ <@&${id}>`),
    ...r.removed.map((id) => `➖ <@&${id}>`),
    ...(r.nickname ? [`🏷️ Nickname → **${r.nickname}**`] : []),
  ];
  return interaction.editReply(v2(card(r.errors.length ? colors.warn : colors.ok,
    section([`### 🔄 ${target.displayName} is up to date`, `Linked to **${linked.username}**`], thumb(await getHeadshotUrl(linked.robloxId).catch(() => null))),
    divider(),
    text(changes.length ? changes.join('\n') : '✨ Nothing needed changing.'),
    r.errors.length ? [divider(), text(r.errors.map((e) => `⚠️ ${e}`))] : null,
    footnote('Run this again after changing your Roblox name.'),
  )));
}
