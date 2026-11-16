import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder,
  SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

// Self-assignable roles. /roles create opens a builder; the posted panel works on its own:
// buttons are "roles:t:<mode>:<roleId>", the dropdown is "roles:s:<mode>" with role IDs as values.
// mode: "m" = pick as many as you like, "o" = only one at a time.

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Self-assignable role panels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('create').setDescription('Build a role panel and post it in this channel'));

// Roles with these permissions can never be self-assigned.
const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ManageWebhooks',
  'BanMembers', 'KickMembers', 'ModerateMembers', 'MentionEveryone', 'ManageNicknames', 'ManageEvents'];

/** Why a role can't be self-assigned, or null if it's fine. */
export function blockReason(guild, role) {
  if (!role) return 'was deleted';
  if (role.id === guild.id) return 'is @everyone';
  if (role.managed) return 'belongs to a bot or integration';
  if (role.position >= guild.members.me.roles.highest.position) return 'is above the bot\'s role';
  const bad = DANGEROUS.find((p) => role.permissions?.has(PermissionFlagsBits[p]));
  return bad ? `has the ${bad.replace(/([A-Z])/g, ' $1').trim()} permission` : null;
}

// ---------------------------------------------------------------- builder

const drafts = new Map(); // userId -> draft
const draftFor = (id) => drafts.get(id) ?? drafts.set(id, {
  title: 'Pick your roles', description: 'Click a button to get a role. Click it again to remove it.', roles: [], mode: 'm', style: 'buttons',
}).get(id);

export async function execute(interaction) {
  drafts.delete(interaction.user.id);
  const msg = builder(interaction.guild, draftFor(interaction.user.id));
  msg.flags |= MessageFlags.Ephemeral;
  return interaction.reply(msg);
}

function builder(guild, d) {
  const usable = d.roles.filter((id) => !blockReason(guild, guild.roles.cache.get(id)));
  const blocked = d.roles.filter((id) => !usable.includes(id))
    .map((id) => `⚠️ <@&${id}> can't be used: it ${blockReason(guild, guild.roles.cache.get(id))}`);
  return v2([
    card(colors.brand,
      text('-# 🎭 ROLE PANEL BUILDER', '### 1 · Pick the roles'),
      new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('roles:b:roles')
        .setPlaceholder('Select up to 25 roles…').setMinValues(0).setMaxValues(25)
        .setDefaultRoles(d.roles.filter((id) => guild.roles.cache.has(id)))),
      blocked.length ? text(blocked) : null,
      divider(),
      text('### 2 · Choose how it works'),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('roles:b:mode').addOptions(
        { label: 'Pick as many as they like', value: 'm', emoji: '✅', default: d.mode === 'm' },
        { label: 'Only one at a time', description: 'Picking one removes the others (e.g. regions, colors)', value: 'o', emoji: '☝️', default: d.mode === 'o' },
      )),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('roles:b:style').addOptions(
        { label: 'Buttons', description: 'One button per role (best for a few roles)', value: 'buttons', emoji: '🔘', default: d.style === 'buttons' },
        { label: 'Dropdown menu', description: 'A tidy list (best for many roles)', value: 'menu', emoji: '📋', default: d.style === 'menu' },
      )),
      divider(),
      text('### 3 · Title and text', `**${d.title}**`, d.description || '-# no description'),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roles:b:text').setLabel('Edit title & text').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('roles:b:post').setLabel(`Post here${usable.length ? ` (${usable.length} role${usable.length === 1 ? '' : 's'})` : ''}`)
          .setEmoji('📨').setStyle(ButtonStyle.Success).setDisabled(!usable.length),
      ),
      footnote('Only you can see this builder · admin and moderator roles are blocked automatically'),
    ),
  ]);
}

/** The public panel members click. */
export function panel(guild, d) {
  const roles = d.roles.map((id) => guild.roles.cache.get(id)).filter((r) => r && !blockReason(guild, r));
  let picker;
  if (d.style === 'menu') {
    picker = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`roles:s:${d.mode}`)
      .setPlaceholder(d.mode === 'o' ? 'Pick one…' : 'Pick your roles…').setMinValues(0).setMaxValues(d.mode === 'o' ? 1 : roles.length)
      .addOptions(roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id, ...(r.unicodeEmoji ? { emoji: r.unicodeEmoji } : {}) }))));
  } else {
    picker = [];
    for (let i = 0; i < roles.length; i += 5) {
      picker.push(new ActionRowBuilder().addComponents(roles.slice(i, i + 5).map((r) => {
        const b = new ButtonBuilder().setCustomId(`roles:t:${d.mode}:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary);
        return r.unicodeEmoji ? b.setEmoji(r.unicodeEmoji) : b;
      })));
    }
  }
  return v2(card(colors.brand,
    text(`## ${d.title}`, d.description || null),
    divider(),
    picker,
    footnote(d.mode === 'o'
      ? 'You can have one of these at a time'
      : d.style === 'menu' ? 'Your picks replace your roles from this list' : 'Click again to remove a role'),
  ));
}

// ---------------------------------------------------------------- interactions

export async function handleSelect(interaction) {
  const [, kind, action] = interaction.customId.split(':');
  if (kind === 's') return pickFromMenu(interaction, action);

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return interaction.reply(notice('bad', 'You need **Manage Roles**.'));
  const d = draftFor(interaction.user.id);
  if (action === 'roles') d.roles = interaction.values;
  if (action === 'mode') d.mode = interaction.values[0];
  if (action === 'style') d.style = interaction.values[0];
  return interaction.update(builder(interaction.guild, d));
}

export async function handleButton(interaction) {
  const [, kind, a, b] = interaction.customId.split(':');
  if (kind === 't') return toggle(interaction, a, b);

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return interaction.reply(notice('bad', 'You need **Manage Roles**.'));
  const d = draftFor(interaction.user.id);
  if (a === 'text') {
    return interaction.showModal(new ModalBuilder().setCustomId('roles:b:textsave').setTitle('Panel title & text').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title')
        .setStyle(TextInputStyle.Short).setMaxLength(100).setValue(d.title)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Text (optional)')
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(d.description)),
    ));
  }
  if (a === 'post') {
    const sent = await interaction.channel.send(panel(interaction.guild, d)).catch(() => null);
    if (!sent) return interaction.reply(notice('bad', 'I can\'t post in this channel. Give me **Send Messages** here.'));
    drafts.delete(interaction.user.id);
    return interaction.update(notice('ok', `Your role panel is live in ${interaction.channel}. Run \`/roles create\` again to make another.`, { title: 'Posted!', ephemeral: false }));
  }
}

export async function handleModal(interaction) {
  const d = draftFor(interaction.user.id);
  d.title = interaction.fields.getTextInputValue('title').trim() || 'Pick your roles';
  d.description = interaction.fields.getTextInputValue('description').trim();
  return interaction.update(builder(interaction.guild, d));
}

/** Role IDs of every button on this panel. */
function panelButtonRoles(message) {
  const ids = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      const id = n.custom_id ?? n.customId;
      if (typeof id === 'string' && id.startsWith('roles:t:')) ids.push(id.split(':')[3]);
      Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
    }
  };
  walk(message.components.map((c) => (c.toJSON ? c.toJSON() : c)));
  return [...new Set(ids)];
}

async function toggle(interaction, mode, roleId) {
  const { guild, member } = interaction;
  const role = guild.roles.cache.get(roleId);
  const why = blockReason(guild, role);
  if (why) return interaction.reply(notice('bad', `That role can't be given out: it ${why}. Ask staff to fix the panel.`));

  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId, 'Role panel');
    return interaction.reply(notice('ok', `Removed ${role}.`));
  }
  const removed = mode === 'o' ? panelButtonRoles(interaction.message).filter((id) => id !== roleId && member.roles.cache.has(id)) : [];
  if (removed.length) await member.roles.remove(removed, 'Role panel (only one allowed)');
  await member.roles.add(roleId, 'Role panel');
  return interaction.reply(notice('ok', `You got ${role}!${removed.length ? `\n-# Removed ${removed.map((id) => `<@&${id}>`).join(' ')}` : ''}`));
}

async function pickFromMenu(interaction) {
  const { guild, member } = interaction;
  const options = (interaction.component?.options ?? []).map((o) => o.value ?? o.data?.value);
  const chosen = interaction.values;
  const add = chosen.filter((id) => !member.roles.cache.has(id) && !blockReason(guild, guild.roles.cache.get(id)));
  const remove = options.filter((id) => !chosen.includes(id) && member.roles.cache.has(id) && !blockReason(guild, guild.roles.cache.get(id)));
  if (add.length) await member.roles.add(add, 'Role panel');
  if (remove.length) await member.roles.remove(remove, 'Role panel');
  const lines = [...add.map((id) => `➕ <@&${id}>`), ...remove.map((id) => `➖ <@&${id}>`)];
  return interaction.reply(notice('ok', lines.length ? lines.join('\n') : 'No changes.', { title: 'Roles updated' }));
}
