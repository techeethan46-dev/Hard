// Reaction roles: members react to a panel message to get a role, and remove the reaction to lose it.
import { PermissionFlagsBits } from 'discord.js';
import { getSettings, updateSettings } from './settings.js';

/** Discord allows 20 different reactions on one message. */
export const MAX_REACTION_ROLES = 20;

/** Emojis given to roles that don't have one of their own. */
export const PALETTE = ['🔔', '🎮', '📢', '🎉', '🎁', '📰', '💬', '🎬', '📊', '🌍', '⭐', '🔥', '💎', '🎯', '🎨', '🎵', '📸', '⚡', '🍀', '🧩'];

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

// ---------------------------------------------------------------- emojis

const strip = (s) => (s ?? '').replace(/️/g, '');
// One emoji: a symbol (optionally with a skin tone or variation selector), several joined by ZWJ (👨‍👩‍👧), a flag, or a keycap (1️⃣).
const PICTO = String.raw`\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*`;
const UNICODE_EMOJI = new RegExp(`^(?:${PICTO}(?:\\u200D${PICTO})*|\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F?\\u20E3)$`, 'u');

/** A typed emoji (👍 or a custom <:name:123>) -> { key, display }, or null if it isn't one. */
export function parseEmoji(input) {
  const s = String(input ?? '').trim();
  const custom = s.match(/^<a?:\w{2,32}:(\d{15,25})>$/);
  if (custom) return { key: custom[1], display: s };
  return UNICODE_EMOJI.test(s) ? { key: strip(s), display: s } : null;
}

/** The key of a reaction's emoji, comparable with parseEmoji().key */
export const reactionKey = (emoji) => emoji.id ?? strip(emoji.name);

/** Gives every role an emoji: keeps the ones already chosen, then the role's own emoji, then the palette. */
export function assignEmojis(guild, roleIds, existing = {}) {
  const out = {};
  const used = new Set();
  const take = (roleId, candidate) => {
    const p = parseEmoji(candidate);
    if (!p || used.has(p.key)) return false;
    used.add(p.key);
    out[roleId] = p.display;
    return true;
  };
  for (const id of roleIds) if (existing[id]) take(id, existing[id]);
  for (const id of roleIds) {
    if (out[id]) continue;
    if (take(id, guild.roles.cache.get(id)?.unicodeEmoji)) continue;
    for (const e of PALETTE) if (take(id, e)) break;
  }
  return out;
}

// ---------------------------------------------------------------- saved panels

export const savePanel = (guildId, messageId, panel) => updateSettings(guildId, { [`reactionPanels.${messageId}`]: panel });

export async function forgetPanel(guildId, messageId) {
  if (!(await getSettings(guildId)).reactionPanels?.[messageId]) return;
  await updateSettings(guildId, { [`reactionPanels.${messageId}`]: null });
}

// ---------------------------------------------------------------- reacting

/** A member added (or removed) a reaction. Gives or takes the role if the message is a role panel. */
export async function handleReaction(reaction, user, added) {
  if (user.partial) user = await user.fetch().catch(() => user);
  if (user.bot) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
  const message = reaction?.message;
  const guild = message?.guild;
  if (!guild) return;

  const panel = (await getSettings(guild.id)).reactionPanels?.[message.id];
  if (!panel) return;
  const key = reactionKey(reaction.emoji);
  const entry = panel.roles.find((r) => parseEmoji(r.emoji)?.key === key);
  if (!entry) {
    // Keep the panel clean: only the panel's own emojis do anything.
    if (added) await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (!added) {
    if (member.roles.cache.has(entry.roleId)) await member.roles.remove(entry.roleId, 'Reaction role').catch(() => {});
    return;
  }

  if (blockReason(guild, guild.roles.cache.get(entry.roleId))) {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }
  if (panel.mode === 'o') {
    // Only one at a time: take the other roles and the other reactions away.
    const others = panel.roles.filter((r) => r.roleId !== entry.roleId && member.roles.cache.has(r.roleId)).map((r) => r.roleId);
    if (others.length) await member.roles.remove(others, 'Reaction role (only one allowed)').catch(() => {});
    for (const r of message.reactions.cache.values()) {
      if (reactionKey(r.emoji) !== key) await r.users.remove(user.id).catch(() => {});
    }
  }
  if (!member.roles.cache.has(entry.roleId)) await member.roles.add(entry.roleId, 'Reaction role').catch(() => {});
}
