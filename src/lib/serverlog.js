// Server logs: message deletes/edits, joins/leaves, nickname/role/timeout changes, bans.
// Everything goes to the "Server log channel" chosen in /setup.
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, FileBuilder } from 'discord.js';
import { deletedByAutomod } from './automod.js';
import { stripBadge } from './nickname.js';
import { getSettings } from './settings.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from './ui.js';

const DAY = 86_400_000;
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const quote = (s, max = 900) => {
  const t = (s ?? '').trim();
  if (!t) return '-# *no text*';
  return (t.length > max ? `${t.slice(0, max)}…` : t).split('\n').map((l) => `> ${l}`).join('\n');
};
const avatar = (u) => u?.displayAvatarURL?.({ size: 128 }) ?? null;

async function send(guild, payload) {
  const { serverLogChannel } = await getSettings(guild.id);
  if (!serverLogChannel) return;
  const ch = await guild.channels.fetch(serverLogChannel).catch(() => null);
  if (ch?.isTextBased()) await ch.send(payload).catch((err) => console.error('Server log failed:', err.message));
}

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
      message.author ? `**By** ${message.author} \`${message.author.tag}\`` : '**By** unknown (sent before the bot started)',
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
    lines: [`**By** ${after.author} \`${after.author.tag}\``, `**In** ${after.channel}`],
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

export async function memberJoined(member) {
  const age = Date.now() - member.user.createdTimestamp;
  await send(member.guild, entry(colors.ok, {
    title: '📥 Member joined',
    user: member.user,
    lines: [
      `${member} \`${member.user.tag}\``,
      `**Account made** ${ts(member.user.createdTimestamp)}${age < 7 * DAY ? ' · ⚠️ **new account**' : ''}`,
      `-# Member #${member.guild.memberCount.toLocaleString('en-US')}`,
    ],
  }));
}

export async function memberLeft(member) {
  const roles = member.roles?.cache?.filter((r) => r.id !== member.guild.id).map((r) => `${r}`) ?? [];
  await send(member.guild, entry(colors.warn, {
    title: '📤 Member left',
    user: member.user,
    lines: [
      `${member.user} \`${member.user.tag}\``,
      member.joinedTimestamp ? `**Joined** ${ts(member.joinedTimestamp)}` : '**Joined** unknown',
      roles.length ? `**Roles** ${roles.slice(0, 15).join(' ')}${roles.length > 15 ? ` +${roles.length - 15}` : ''}` : null,
    ].filter(Boolean),
  }));
}

export async function memberUpdated(before, after) {
  if (before.partial) return; // we don't know what changed
  const changes = [];

  // Nicknames (ignore the bot's own 🔥 streak badge updates)
  if (before.nickname !== after.nickname && stripBadge(before.nickname ?? '') !== stripBadge(after.nickname ?? '')) {
    changes.push(['🏷️ Nickname changed', [`**Before** ${before.nickname ?? '*none*'}`, `**After** ${after.nickname ?? '*none*'}`]]);
  }

  const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
  const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
  if (added.size || removed.size) {
    changes.push(['🎭 Roles changed', [
      ...added.map((r) => `➕ ${r}`),
      ...removed.map((r) => `➖ ${r}`),
    ]]);
  }

  const wasOut = before.communicationDisabledUntilTimestamp > Date.now();
  const isOut = after.communicationDisabledUntilTimestamp > Date.now();
  if (!wasOut && isOut) changes.push(['🔇 Timed out', [`**Until** ${ts(after.communicationDisabledUntilTimestamp, 'f')}`]]);
  if (wasOut && !isOut) changes.push(['🔊 Timeout removed', []]);

  for (const [title, lines] of changes) {
    await send(after.guild, entry(colors.info, { title, user: after.user, lines: [`${after} \`${after.user.tag}\``, ...lines] }));
  }
}

export async function memberBanned(ban) {
  const full = ban.partial ? await ban.fetch().catch(() => ban) : ban;
  await send(ban.guild, entry(colors.bad, {
    title: '🔨 Member banned', user: ban.user,
    lines: [`${ban.user} \`${ban.user.tag}\``, `**Reason** ${full.reason ?? '*none given*'}`],
  }));
}

export async function memberUnbanned(ban) {
  await send(ban.guild, entry(colors.ok, { title: '🕊️ Member unbanned', user: ban.user, lines: [`${ban.user} \`${ban.user.tag}\``] }));
}
