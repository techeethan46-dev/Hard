// Giveaways: the cards, entering, drawing winners, and ending on time (even after a restart).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { randomInt } from 'node:crypto';
import { assetUrl } from '../config.js';
import { levelInfo } from './levels.js';
import { store } from './store.js';
import { card, divider, footnote, section, text, thumb, v2 } from './ui.js';

export const GOLD = 0xf7c948;
const DONE = 0x8e9297;
const PARTY = 0xff6fb5;

// ---------------------------------------------------------------- durations

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
/** "1h30m", "2d", "45m", "1w" -> milliseconds, or null if it doesn't make sense. */
export function parseDuration(input) {
  const s = String(input ?? '').toLowerCase().replace(/\s+/g, '')
    .replace(/weeks?|wks?/g, 'w').replace(/days?/g, 'd').replace(/hours?|hrs?/g, 'h').replace(/minutes?|mins?/g, 'm').replace(/seconds?|secs?/g, 's');
  if (!/^(\d+[smhdw])+$/.test(s)) return null;
  let ms = 0;
  for (const [, n, u] of s.matchAll(/(\d+)([smhdw])/g)) ms += Number(n) * UNITS[u];
  return ms;
}

// ---------------------------------------------------------------- cards

function requirementLines(g) {
  const r = g.requirements ?? {};
  return [
    r.verified ? '🔗 Linked Roblox account (`/verify`)' : null,
    r.level ? `⭐ Level **${r.level}** or higher` : null,
    r.roleId ? `🎭 Must have <@&${r.roleId}>` : null,
  ].filter(Boolean);
}

/** The live giveaway card. */
export function giveawayCard(g, guild) {
  const reqs = requirementLines(g);
  const ends = Math.floor(g.endsAt / 1000);
  return v2(card(GOLD,
    text('-# 🎉 GIVEAWAY 🎉'),
    section([`## ${g.prize}`, g.description ? g.description : null, `-# Hosted by <@${g.hostId}>`],
      thumb(assetUrl('gift.png') ?? guild?.iconURL?.({ size: 128 }))),
    divider(),
    text(
      `⏰ **Ends** <t:${ends}:R> · <t:${ends}:f>`,
      `🏆 **${g.winners}** winner${g.winners === 1 ? '' : 's'}`,
      `🎟️ **${(g.entryCount ?? 0).toLocaleString('en-US')}** ${g.entryCount === 1 ? 'entry' : 'entries'}`,
    ),
    reqs.length || g.bonusRoleId
      ? [divider(), text(
        reqs.length ? '**To enter**' : null, ...reqs,
        g.bonusRoleId ? `💎 <@&${g.bonusRoleId}> gets **2× entries**` : null,
      )]
      : null,
    divider(),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('giveaway:enter').setLabel('Enter giveaway').setEmoji('🎉').setStyle(ButtonStyle.Success),
    ),
    footnote('Click to enter · click again to leave · winners are picked at random'),
  ));
}

/** What the card turns into when it ends. */
export function endedCard(g, guild) {
  const winners = g.winnerIds ?? [];
  return v2(card(winners.length ? PARTY : DONE,
    text('-# 🎉 GIVEAWAY ENDED'),
    section([`## ${g.prize}`, `-# Hosted by <@${g.hostId}>`], thumb(assetUrl('trophy.png') ?? guild?.iconURL?.({ size: 128 }))),
    divider(),
    text(
      winners.length ? `🏆 **Winner${winners.length === 1 ? '' : 's'}:** ${winners.map((id) => `<@${id}>`).join(' ')}` : '😢 Nobody won: there weren\'t any eligible entries.',
      `🎟️ ${(g.entryCount ?? 0).toLocaleString('en-US')} entries · ended <t:${Math.floor((g.endedAt ?? Date.now()) / 1000)}:R>`,
      g.cancelled ? '⛔ This giveaway was cancelled.' : null,
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('giveaway:over').setLabel('Giveaway ended').setEmoji('🔒').setStyle(ButtonStyle.Secondary).setDisabled(true),
    ),
  ));
}

function winnerAnnouncement(g, winners, { reroll = false, url } = {}) {
  return v2(card(PARTY,
    section([
      reroll ? '## 🔁 New winner!' : '## 🎊 Congratulations!',
      `${winners.map((id) => `<@${id}>`).join(', ')} won **${g.prize}**!`,
      `-# Contact <@${g.hostId}> to claim your prize`,
    ], thumb(assetUrl('trophy.png'))),
    url ? new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('View giveaway').setStyle(ButtonStyle.Link).setURL(url)) : null,
  ), { mentions: { users: winners } });
}

// ---------------------------------------------------------------- entering

/** Why this member can't enter, or null if they can. */
export async function whyNot(g, member) {
  const r = g.requirements ?? {};
  if (r.roleId && !member.roles.cache.has(r.roleId)) return `you need the <@&${r.roleId}> role`;
  if (r.verified && !(await store.links.get(member.id))) return 'you need to link your Roblox account first with `/verify`';
  if (r.level) {
    const { level } = levelInfo((await store.stats.get(member.guild.id, member.id))?.xp ?? 0);
    if (level < r.level) return `you need level **${r.level}**, you're level **${level}**. Keep chatting!`;
  }
  return null;
}

const pendingRefresh = new Map(); // messageId -> timer
/** Updates the entry counter on the card, at most every 5 seconds. */
export function refreshSoon(message, messageId) {
  if (pendingRefresh.has(messageId)) return;
  const t = setTimeout(async () => {
    pendingRefresh.delete(messageId);
    const g = await store.giveaways.get(messageId);
    if (!g || g.ended) return;
    await message.edit(giveawayCard({ ...g, entryCount: g.entries.length }, message.guild)).catch(() => {});
  }, 5000);
  t.unref?.();
  pendingRefresh.set(messageId, t);
}

// ---------------------------------------------------------------- drawing winners

/** Picks up to `count` different people at random. Bonus-role holders count twice. */
export async function draw(guild, g, count, exclude = []) {
  const skip = new Set(exclude);
  const pool = g.entries.filter((id) => !skip.has(id));
  const winners = [];
  // Weighted shuffle: draw one at a time, re-checking each pick is still eligible.
  const weights = new Map();
  while (winners.length < count && pool.length) {
    const tickets = [];
    for (const id of pool) {
      if (!weights.has(id)) {
        const m = await guild.members.fetch(id).catch(() => null);
        const ok = m && !(await whyNot(g, m));
        weights.set(id, ok ? (g.bonusRoleId && m.roles.cache.has(g.bonusRoleId) ? 2 : 1) : 0);
      }
      for (let i = 0; i < weights.get(id); i++) tickets.push(id);
    }
    if (!tickets.length) break;
    const pick = tickets[randomInt(tickets.length)];
    winners.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return winners;
}

/** Ends a giveaway: draws winners, updates the card, announces, DMs winners. */
export async function endGiveaway(client, messageId) {
  const g = await store.giveaways.finish(messageId);
  if (!g) return null; // already ended
  const guild = await client.guilds.fetch(g.guildId).catch(() => null);
  const channel = guild && (await guild.channels.fetch(g.channelId).catch(() => null));
  const winners = guild ? await draw(guild, g, g.winners) : [];
  const done = { ...g, winnerIds: winners, entryCount: g.entries.length };
  await store.giveaways.update(messageId, { winnerIds: winners });

  const message = channel && (await channel.messages.fetch(messageId).catch(() => null));
  await message?.edit(endedCard(done, guild)).catch(() => {});
  if (channel && winners.length) {
    await channel.send({ ...winnerAnnouncement(g, winners, { url: message?.url }), reply: message ? { messageReference: messageId, failIfNotExists: false } : undefined }).catch(() => {});
    for (const id of winners) await dmWinner(client, id, g, guild, message?.url);
  }
  return done;
}

export async function reroll(client, messageId, count = 1) {
  const g = await store.giveaways.get(messageId);
  if (!g?.ended || g.cancelled) return null;
  const guild = await client.guilds.fetch(g.guildId);
  const fresh = await draw(guild, g, count, g.winnerIds);
  if (!fresh.length) return [];
  const all = [...g.winnerIds, ...fresh];
  await store.giveaways.update(messageId, { winnerIds: all });
  const channel = await guild.channels.fetch(g.channelId).catch(() => null);
  const message = channel && (await channel.messages.fetch(messageId).catch(() => null));
  await message?.edit(endedCard({ ...g, winnerIds: all, entryCount: g.entries.length }, guild)).catch(() => {});
  await channel?.send(winnerAnnouncement(g, fresh, { reroll: true, url: message?.url })).catch(() => {});
  for (const id of fresh) await dmWinner(client, id, g, guild, message?.url);
  return fresh;
}

async function dmWinner(client, userId, g, guild, url) {
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send(v2(card(PARTY,
    section([`-# ${guild?.name ?? 'A server'}`, `## 🎉 You won ${g.prize}!`, `Contact <@${g.hostId}> to claim it.`], thumb(assetUrl('trophy.png'))),
    url ? new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('See the giveaway').setStyle(ButtonStyle.Link).setURL(url)) : null,
  ))).catch(() => {});
}

/** Ends every giveaway whose time is up. Runs every 10 seconds from the ready event. */
export async function endDueGiveaways(client) {
  for (const g of await store.giveaways.due(Date.now())) {
    await endGiveaway(client, g.messageId).catch((err) => console.error('Ending giveaway failed:', err.message));
  }
}
