// Server logs: message deletes/edits, joins/leaves, nickname/role/timeout changes, bans.
// Everything goes to the "Server log channel" chosen in /setup.
import { ActionRowBuilder, AttachmentBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle, FileBuilder } from 'discord.js';
import { deletedByAutomod } from './automod.js';
import { stripAfk, stripBadge } from './nickname.js';
import { getSettings } from './settings.js';
import { card, colors, divider, footnote, section, text, thumb, v2, wasLoggedByCommand } from './ui.js';

const DAY = 86_400_000;
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const quote = (s, max = 900) => {
  const t = (s ?? '').trim();
  if (!t) return '-# *no text*';
  return (t.length > max ? `${t.slice(0, max)}…` : t).split('\n').map((l) => `> ${l}`).join('\n');
};
const avatar = (u) => u?.displayAvatarURL?.({ size: 128 }) ?? null;

/**
 * Where each kind of log goes (set in /setup). A channel that isn't set falls back to the server log.
 *   server: deleted/edited messages, role and nickname changes, timeouts
 *   mod:    kicks, bans, unbans
 *   join / leave: people joining / leaving
 */
const CHANNEL_SETTING = { server: 'serverLogChannel', mod: 'modLogChannel', join: 'joinLogChannel', leave: 'leaveLogChannel' };

async function send(guild, payload, kind = 'server') {
  const settings = await getSettings(guild.id);
  const channelId = settings[CHANNEL_SETTING[kind]] ?? settings.serverLogChannel;
  if (!channelId) return null;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  return ch?.isTextBased() ? ch.send(payload).catch((err) => console.error('Server log failed:', err.message)) : null;
}

/** "**Display name** · `username`". Plain text on purpose: mentions show as @unknown-user for people the viewer's app doesn't know. */
const who = (user) => `**${user.globalName ?? user.username ?? 'unknown'}** · \`${user.tag ?? user.username ?? user.id}\``;
const nameOf = (user) => `**${user?.globalName ?? user?.username ?? user?.id ?? 'someone'}**`;
/** A role as a colored mention, or its name if the role no longer exists. */
const roleText = (guild, role) => (guild.roles.cache.has(role.id) ? `<@&${role.id}>` : `**${role.name}**`);

/** Small log card: colored edge, title + lines with the person's avatar, footnote with IDs and time. */
const entry = (accent, { title, lines, user, extra = [], foot }) => v2(card(accent,
  section([`### ${title}`, ...lines], thumb(avatar(user))),
  extra,
  footnote(`${foot ?? (user ? `User ID ${user.id}` : '')} · ${ts(Date.now(), 'f')}`),
));

const isLogChannel = async (message) => (await getSettings(message.guildId)).serverLogChannel === message.channelId;

// ---------------------------------------------------------------- messages

export async function messageDeleted(message) {
  if (!message.guild || message.author?.bot || deletedByAutomod.has(message.id)) return;
  if (await isLogChannel(message)) return;
  const files = [...(message.attachments?.values() ?? [])].map((a) => `📎 ${a.name}`);
  await send(message.guild, entry(colors.bad, {
    title: '🗑️ Message deleted',
    user: message.author,
    lines: [
      message.author ? `**By** ${who(message.author)}` : '**By** unknown (sent before the bot started)',
      `**In** ${message.channel}${message.createdTimestamp ? ` · sent ${ts(message.createdTimestamp)}` : ''}`,
    ],
    extra: [divider(), text(message.partial && !message.content ? '-# The text isn\'t known (the message was sent before the bot started).' : quote(message.content), files)],
    foot: message.author ? `User ID ${message.author.id} · Message ID ${message.id}` : `Message ID ${message.id}`,
  }));
}

export async function messageEdited(before, after) {
  if (!after.guild || after.author?.bot || after.webhookId) return;
  if (before.content === after.content || after.content == null) return; // only embeds/link previews changed
  if (await isLogChannel(after)) return;
  await send(after.guild, entry(colors.info, {
    title: '✏️ Message edited',
    user: after.author,
    lines: [`**By** ${who(after.author)}`, `**In** ${after.channel}`],
    extra: [
      divider(),
      text('**Before**', before.partial && !before.content ? '-# *not known (sent before the bot started)*' : quote(before.content, 700)),
      text('**After**', quote(after.content, 700)),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Jump to message').setStyle(ButtonStyle.Link).setURL(after.url)),
    ],
    foot: `User ID ${after.author.id} · Message ID ${after.id}`,
  }));
}

export async function messagesBulkDeleted(messages, channel) {
  if (!channel.guild) return;
  if ([...messages.keys()].every((id) => deletedByAutomod.has(id))) return;
  const list = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = list.map((m) => `[${m.createdAt?.toISOString().replace('T', ' ').slice(0, 19) ?? '?'}] ${m.author?.tag ?? 'unknown'}: ${m.content ?? ''}`);
  const name = `deleted-${channel.name}.txt`;
  const file = new AttachmentBuilder(Buffer.from(`${messages.size} messages deleted in #${channel.name}\n${'='.repeat(50)}\n${lines.join('\n')}\n`), { name });
  const { serverLogChannel } = await getSettings(channel.guild.id);
  if (!serverLogChannel || serverLogChannel === channel.id) return;
  const ch = await channel.guild.channels.fetch(serverLogChannel).catch(() => null);
  if (!ch?.isTextBased()) return;
  await ch.send({
    ...v2(card(colors.bad,
      text('### 🧹 Messages bulk-deleted', `**${messages.size}** messages removed from ${channel}`),
      divider(),
      new FileBuilder().setURL(`attachment://${name}`),
      footnote(`Channel ID ${channel.id} · ${ts(Date.now(), 'f')}`),
    )),
    files: [file],
  }).catch((err) => console.error('Server log failed:', err.message));
}

// ---------------------------------------------------------------- members

/** Discord needs a moment before the audit log shows a kick or ban. */
export const AUDIT_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Newest audit log entry of this kind about this user from the last 20 seconds, or null (also when the bot can't view the audit log). */
async function auditEntry(guild, type, userId, since = Date.now() - 20_000) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 10 });
    return logs.entries.find((e) => e.target?.id === userId && e.createdTimestamp >= since) ?? null;
  } catch {
    return null;
  }
}

export async function memberJoined(member) {
  const age = Date.now() - member.user.createdTimestamp;
  await send(member.guild, entry(colors.ok, {
    title: member.user.bot ? '🤖 Bot added' : '📥 Member joined',
    user: member.user,
    lines: [
      who(member.user),
      `**Account made** ${ts(member.user.createdTimestamp)}${age < 7 * DAY && !member.user.bot ? ' · ⚠️ **new account**' : ''}`,
      `-# Member #${member.guild.memberCount.toLocaleString('en-US')}`,
    ],
  }), 'join');
}

// A ban makes the member leave AND fires a ban event. Whichever notices first logs it; the other stays quiet.
const bansLogged = new Map();
function claimBan(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (Date.now() - (bansLogged.get(key) ?? 0) < 60_000) return false;
  bansLogged.set(key, Date.now());
  if (bansLogged.size > 1000) bansLogged.clear();
  return true;
}

/** Did this bot do it itself? Its own bans and kicks are logged by the command (or, for raid protection, by the raid alert). */
const byThisBot = (guild, executor) => Boolean(executor?.id) && executor.id === guild.members?.me?.id;

async function reportBan(guild, user, reason) {
  if (!claimBan(guild.id, user.id)) return;
  const audit = await auditEntry(guild, AuditLogEvent.MemberBanAdd, user.id);
  if (wasLoggedByCommand(guild.id, user.id)) return; // /ban already posted it in the mod log
  await send(guild, entry(colors.bad, {
    title: user.bot ? '🔨 Bot banned' : '🔨 Member banned', user,
    lines: [
      who(user),
      audit?.executor ? `**Banned by** ${nameOf(audit.executor)}` : null,
      `**Reason** ${reason ?? audit?.reason ?? '*none given*'}`,
    ].filter(Boolean),
  }), 'mod');
}

export async function memberBanned(ban) {
  await sleep(AUDIT_DELAY_MS);
  const full = ban.partial ? await ban.fetch().catch(() => ban) : ban;
  await reportBan(ban.guild, ban.user, full.reason);
}

export async function memberUnbanned(ban) {
  await send(ban.guild, entry(colors.ok, { title: '🕊️ Member unbanned', user: ban.user, lines: [who(ban.user)] }), 'mod');
}

/** Someone is gone: tell apart banned, kicked, and left (or a bot being removed). */
export async function memberLeft(member) {
  const { guild, user } = member;
  await sleep(AUDIT_DELAY_MS);

  const key = `${guild.id}:${user.id}`;
  if (Date.now() - (bansLogged.get(key) ?? 0) < 60_000) return; // the ban log covers it
  const ban = await guild.bans?.fetch?.(user.id).catch(() => null);
  if (ban) return reportBan(guild, user, ban.reason);

  const kick = await auditEntry(guild, AuditLogEvent.MemberKick, user.id);
  if (kick && wasLoggedByCommand(guild.id, user.id)) return; // /kick already posted it in the mod log
  if (kick && byThisBot(guild, kick.executor) && String(kick.reason ?? '').startsWith('Raid protection')) return; // the raid alert covers these
  const roles = member.roles?.cache?.filter((r) => r.id !== guild.id).map((r) => roleText(guild, r)) ?? [];
  const title = kick ? (user.bot ? '👢 Bot kicked' : '👢 Member kicked') : (user.bot ? '🤖 Bot removed' : '📤 Member left');
  await send(guild, entry(kick ? colors.bad : colors.warn, {
    title, user,
    lines: [
      who(user),
      kick?.executor ? `**Kicked by** ${nameOf(kick.executor)}` : null,
      kick ? `**Reason** ${kick.reason ?? '*none given*'}` : null,
      member.joinedTimestamp ? `**Joined** ${ts(member.joinedTimestamp)}` : null,
      roles.length ? `**Roles** ${roles.slice(0, 15).join(' ')}${roles.length > 15 ? ` +${roles.length - 15}` : ''}` : null,
    ].filter(Boolean),
  }), kick ? 'mod' : 'leave');
}

// ---------------------------------------------------------------- role changes (merged per person)

// Role changes for one person arrive one at a time. They're collected for a few seconds and posted as ONE message.
export const ROLE_BATCH_MS = 4000;
const ROLE_BATCH_MAX_MS = 15_000;
const roleBatches = new Map(); // "guild:user" -> { added: Map, removed: Map, firstAt, timer, guild, user }

function noteRoleChanges(member, added, removed) {
  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  let b = roleBatches.get(key);
  if (!b) {
    b = { added: new Map(), removed: new Map(), firstAt: now, timer: null, guild: member.guild, user: member.user };
    roleBatches.set(key, b);
  }
  // A role that was added and then removed again within the batch cancels out.
  for (const r of added) (b.removed.has(r.id) ? b.removed.delete(r.id) : b.added.set(r.id, r));
  for (const r of removed) (b.added.has(r.id) ? b.added.delete(r.id) : b.removed.set(r.id, r));
  clearTimeout(b.timer);
  b.timer = setTimeout(() => flushRoleChanges(key).catch((err) => console.error('Role log failed:', err.message)),
    Math.max(0, Math.min(ROLE_BATCH_MS, b.firstAt + ROLE_BATCH_MAX_MS - now)));
  b.timer.unref?.();
}

async function flushRoleChanges(key) {
  const b = roleBatches.get(key);
  roleBatches.delete(key);
  if (!b || (!b.added.size && !b.removed.size)) return;

  // Who made the change (best effort: needs the "View Audit Log" permission).
  let by = [];
  try {
    const logs = await b.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 });
    by = [...new Set(logs.entries.filter((e) => e.target?.id === b.user.id && e.createdTimestamp >= b.firstAt - 5000)
      .map((e) => nameOf(e.executor)))];
  } catch { /* no audit log access */ }

  const list = (map) => [...map.values()].map((r) => roleText(b.guild, r)).join(' ');
  await send(b.guild, entry(colors.info, {
    title: '🎭 Roles changed', user: b.user,
    lines: [
      who(b.user),
      b.added.size ? `**Roles added** ${list(b.added)}` : null,
      b.removed.size ? `**Roles removed** ${list(b.removed)}` : null,
      by.length ? `**Changed by** ${by.join(', ')}` : null,
    ].filter(Boolean),
  }));
}

export async function memberUpdated(before, after) {
  if (before.partial) return; // we don't know what changed
  const log = (title, lines) => send(after.guild, entry(colors.info, { title, user: after.user, lines: [who(after.user), ...lines] }));

  // Nicknames (ignore the bot's own 🔥 streak badge and [AFK] tag)
  const plain = (n) => stripAfk(stripBadge(n ?? ''));
  if (before.nickname !== after.nickname && plain(before.nickname) !== plain(after.nickname)) {
    await log('🏷️ Nickname changed', [`**Before** ${before.nickname ?? '*none*'}`, `**After** ${after.nickname ?? '*none*'}`]);
  }

  const added = [...after.roles.cache.filter((r) => !before.roles.cache.has(r.id)).values()];
  const removed = [...before.roles.cache.filter((r) => !after.roles.cache.has(r.id)).values()];
  if (added.length || removed.length) noteRoleChanges(after, added, removed);

  const wasOut = before.communicationDisabledUntilTimestamp > Date.now();
  const isOut = after.communicationDisabledUntilTimestamp > Date.now();
  if (!wasOut && isOut) await log('🔇 Timed out', [`**Until** ${ts(after.communicationDisabledUntilTimestamp, 'f')}`]);
  if (wasOut && !isOut) await log('🔊 Timeout removed', []);
}
