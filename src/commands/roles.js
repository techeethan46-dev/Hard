import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder,
  SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import {
  MAX_REACTION_ROLES, assignEmojis, blockReason, parseEmoji, savePanel,
} from '../lib/reactionroles.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

export { blockReason };

// Self-assignable roles. /roles create opens a builder, then posts a panel in one of three styles:
//   reactions (default) - members react with an emoji; the panel is saved in settings (see lib/reactionroles.js)
//   buttons             - "roles:t:<mode>:<roleId>"
//   menu                - dropdown "roles:s:<mode>" with role IDs as values
// mode: "m" = pick as many as you like, "o" = only one at a time.

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Self-assignable role panels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('create').setDescription('Build a role panel and post it in this channel'));

// ---------------------------------------------------------------- builder

const DEFAULT_TEXT = {
  reactions: 'React to this message to get a role. Remove your reaction to take it off.',
  buttons: 'Click a button to get a role. Click it again to remove it.',
  menu: 'Pick your roles from the menu below.',
};
const drafts = new Map(); // userId -> draft
const draftFor = (id) => drafts.get(id) ?? drafts.set(id, {
  title: 'Pick your roles', description: DEFAULT_TEXT.reactions, customText: false, roles: [], emojis: {}, mode: 'm', style: 'reactions',
}).get(id);

export async function execute(interaction) {
  drafts.delete(interaction.user.id);
  const msg = builder(interaction.guild, draftFor(interaction.user.id));
  msg.flags |= MessageFlags.Ephemeral;
  return interaction.reply(msg);
}

const usableRoles = (guild, d) => d.roles.filter((id) => !blockReason(guild, guild.roles.cache.get(id)));

function builder(guild, d, error) {
  const usable = usableRoles(guild, d);
  const blocked = d.roles.filter((id) => !usable.includes(id))
    .map((id) => `⚠️ <@&${id}> can't be used: it ${blockReason(guild, guild.roles.cache.get(id))}`);
  const reactions = d.style === 'reactions';
  if (reactions) d.emojis = assignEmojis(guild, usable.slice(0, MAX_REACTION_ROLES), d.emojis);
  const shown = usable.slice(0, reactions ? MAX_REACTION_ROLES : 25);

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
        { label: 'Reactions', description: 'Members react with an emoji (up to 20 roles)', value: 'reactions', emoji: '😀', default: reactions },
        { label: 'Buttons', description: 'One button per role (best for a few roles)', value: 'buttons', emoji: '🔘', default: d.style === 'buttons' },
        { label: 'Dropdown menu', description: 'A tidy list (best for many roles)', value: 'menu', emoji: '📋', default: d.style === 'menu' },
      )),
      reactions && shown.length
        ? [
          divider(),
          text('### 😀 Emojis', shown.map((id) => `${d.emojis[id]}  ·  <@&${id}>`),
            usable.length > MAX_REACTION_ROLES ? `⚠️ A reaction panel holds ${MAX_REACTION_ROLES} roles, so the rest are left out.` : null),
          new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('roles:b:emojipick')
            .setPlaceholder('✏️ Change an emoji…').addOptions(shown.map((id) => ({
              label: (guild.roles.cache.get(id)?.name ?? 'role').slice(0, 100), value: id, description: `Now: ${d.emojis[id]}`,
            })))),
        ]
        : null,
      error ? text(`❌ ${error}`) : null,
      divider(),
      text('### 3 · Title and text', `**${d.title}**`, d.description || '-# no description'),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roles:b:text').setLabel('Edit title & text').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('roles:b:post').setLabel(`Post here${shown.length ? ` (${shown.length} role${shown.length === 1 ? '' : 's'})` : ''}`)
          .setEmoji('📨').setStyle(ButtonStyle.Success).setDisabled(!shown.length),
      ),
      footnote('Only you can see this builder · admin and moderator roles are blocked automatically'),
    ),
  ]);
}

// ---------------------------------------------------------------- the public panels

/** Reaction panel: a list of "emoji · @role"; the bot adds the reactions underneath. */
export function reactionPanel(d, entries) {
  return v2(card(colors.brand,
    text(`## ${d.title}`, d.description || null),
    divider(),
    text(entries.map((e) => `${e.emoji}  ·  <@&${e.roleId}>`)),
    footnote(d.mode === 'o'
      ? 'You can have one of these at a time · reacting to another swaps it'
      : 'React to get a role · remove your reaction to take it off'),
  ));
}

/** Button or dropdown panel. */
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
  if (action === 'style') {
    d.style = interaction.values[0];
    if (!d.customText) d.description = DEFAULT_TEXT[d.style];
  }
  if (action === 'emojipick') {
    const roleId = interaction.values[0];
    return interaction.showModal(new ModalBuilder().setCustomId(`roles:b:emoji:${roleId}`)
      .setTitle(`Emoji for @${interaction.guild.roles.cache.get(roleId)?.name ?? 'role'}`.slice(0, 45)).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('One emoji')
          .setStyle(TextInputStyle.Short).setMaxLength(60).setValue(d.emojis[roleId] ?? '')
          .setPlaceholder('🎮  (or a server emoji like <:name:123456789012345678>)')),
      ));
  }
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
  if (a === 'post') return post(interaction, d);
}

export async function handleModal(interaction) {
  const [, , action, roleId] = interaction.customId.split(':');
  const d = draftFor(interaction.user.id);

  if (action === 'emoji') {
    const parsed = parseEmoji(interaction.fields.getTextInputValue('emoji'));
    if (!parsed) return interaction.update(builder(interaction.guild, d, 'That isn\'t an emoji. Type one emoji, like 🎮.'));
    const clash = Object.entries(d.emojis).find(([id, e]) => id !== roleId && parseEmoji(e)?.key === parsed.key);
    if (clash) return interaction.update(builder(interaction.guild, d, `${parsed.display} is already used for <@&${clash[0]}>. Every role needs its own emoji.`));
    d.emojis[roleId] = parsed.display;
    return interaction.update(builder(interaction.guild, d));
  }

  const title = interaction.fields.getTextInputValue('title').trim() || 'Pick your roles';
  const description = interaction.fields.getTextInputValue('description').trim();
  d.customText = d.customText || description !== d.description;
  d.title = title;
  d.description = description;
  return interaction.update(builder(interaction.guild, d));
}

async function post(interaction, d) {
  const { guild, channel } = interaction;
  if (d.style !== 'reactions') {
    const sent = await channel.send(panel(guild, d)).catch(() => null);
    if (!sent) return interaction.reply(notice('bad', 'I can\'t post in this channel. Give me **Send Messages** here.'));
    drafts.delete(interaction.user.id);
    return interaction.update(notice('ok', `Your role panel is live in ${channel}. Run \`/roles create\` again to make another.`, { title: 'Posted!', ephemeral: false }));
  }

  await interaction.deferUpdate();
  const entries = usableRoles(guild, d).slice(0, MAX_REACTION_ROLES).map((roleId) => ({ roleId, emoji: d.emojis[roleId] }));
  const sent = await channel.send(reactionPanel(d, entries)).catch(() => null);
  if (!sent) return interaction.editReply(notice('bad', 'I can\'t post in this channel. Give me **Send Messages** here.', { ephemeral: false }));

  // Add the reactions members will click. An emoji Discord won't accept (e.g. from another server) is dropped.
  const working = [];
  const failed = [];
  for (const e of entries) {
    try {
      await sent.react(e.emoji);
      working.push(e);
    } catch {
      failed.push(e);
    }
  }
  if (failed.length) await sent.edit(reactionPanel(d, working)).catch(() => {});
  await savePanel(guild.id, sent.id, { mode: d.mode, roles: working });
  drafts.delete(interaction.user.id);

  return interaction.editReply(failed.length
    ? notice('warn', `Posted in ${channel}, but I couldn't use ${failed.map((e) => `${e.emoji} (<@&${e.roleId}>)`).join(', ')}. The bot can only use emojis from this server, so those roles were left out. Make sure I have **Add Reactions** here.`, { title: 'Posted with a problem', ephemeral: false })
    : notice('ok', `Your role panel is live in ${channel}. Members react to get a role. Run \`/roles create\` again to make another.`, { title: 'Posted!', ephemeral: false }));
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
