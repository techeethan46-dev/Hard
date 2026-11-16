// AFK: "r!afk Too tired" marks you away. Pinging you gets a reply; talking again brings you back.
import { setAfkTag } from './nickname.js';
import { store } from './store.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from './ui.js';

const COMMAND = /^r!afk(?:\s+([\s\S]*))?$/i;
const REPLY_COOLDOWN_MS = 60_000;
const cache = new Map(); // "guild:user" -> afk record or null
const lastReply = new Map(); // "channel:user" -> time

const key = (g, u) => `${g}:${u}`;
export async function getAfk(guildId, userId) {
  const k = key(guildId, userId);
  if (!cache.has(k)) cache.set(k, (await store.stats.get(guildId, userId))?.afk ?? null);
  return cache.get(k);
}
async function saveAfk(guildId, userId, afk) {
  cache.set(key(guildId, userId), afk);
  await store.stats.set(guildId, userId, { afk });
}

const ago = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const temp = (msg, ms) => msg && setTimeout(() => msg.delete().catch(() => {}), ms);

/** Handles AFK for one message. Returns true if it was the r!afk command. */
export async function handleAfk(message) {
  if (!message.inGuild() || message.author.bot) return false;
  const g = message.guildId;

  // 1. "r!afk reason"
  const cmd = message.content.trim().match(COMMAND);
  if (cmd) {
    const reason = (cmd[1] ?? '').trim().replace(/@(everyone|here)/g, '@​$1').slice(0, 200) || 'AFK';
    await saveAfk(g, message.author.id, { reason, since: Date.now(), pings: [] });
    await setAfkTag(message.member, true).catch(() => {});
    const reply = await message.reply(v2(card(colors.info,
      section([`### 💤 ${message.member?.displayName ?? message.author.username} is now AFK`, `> ${reason}`],
        thumb(message.author.displayAvatarURL({ size: 128 }))),
      footnote('Send any message to come back'),
    ), { mentions: { repliedUser: false } })).catch(() => null);
    temp(reply, 15_000);
    return true;
  }

  // 2. An AFK person talks again: welcome them back.
  const mine = await getAfk(g, message.author.id);
  if (mine) {
    await saveAfk(g, message.author.id, null);
    await setAfkTag(message.member, false).catch(() => {});
    const pings = mine.pings ?? [];
    const reply = await message.reply(v2(card(colors.ok,
      text(`### 👋 Welcome back, ${message.member?.displayName ?? message.author.username}!`,
        `You went AFK ${ago(mine.since)} · ${pings.length ? `**${pings.length}** ping${pings.length === 1 ? '' : 's'} while you were away` : 'nobody pinged you'}`),
      pings.length ? [divider(), text(pings.slice(-5).map((p) => `• <@${p.by}> in <#${p.channel}> · [jump](${p.url})`))] : null,
    ), { mentions: { repliedUser: false } })).catch(() => null);
    temp(reply, 30_000);
  }

  // 3. Someone pinged (or replied to) an AFK person.
  const targets = new Set(message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id).map((u) => u.id));
  const repliedTo = message.mentions.repliedUser;
  if (repliedTo && !repliedTo.bot && repliedTo.id !== message.author.id) targets.add(repliedTo.id);

  const notes = [];
  for (const id of targets) {
    const afk = await getAfk(g, id);
    if (!afk) continue;
    await saveAfk(g, id, { ...afk, pings: [...(afk.pings ?? []), { by: message.author.id, channel: message.channelId, url: message.url, at: Date.now() }].slice(-10) });
    const rk = `${message.channelId}:${id}`;
    if ((lastReply.get(rk) ?? 0) + REPLY_COOLDOWN_MS > Date.now()) continue;
    lastReply.set(rk, Date.now());
    const name = message.guild.members.cache.get(id)?.displayName?.replace(/^\[AFK\]\s*/i, '') ?? 'They';
    notes.push(`💤 **${name}** is AFK: ${afk.reason} · ${ago(afk.since)}`);
  }
  if (notes.length) {
    const reply = await message.reply(v2(card(colors.info, text(notes)), { mentions: { repliedUser: false } })).catch(() => null);
    temp(reply, 20_000);
  }
  return false;
}
