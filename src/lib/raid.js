// Raid protection: spots a burst of joins, then kicks brand-new accounts for a while.
// Also enforces an optional minimum account age.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getSettings } from './settings.js';
import { card, colors, divider, footnote, text, v2 } from './ui.js';

export const RAID_LEVELS = [
  ['off', 'Off', 'Never switch on by itself'],
  ['normal', 'Normal', '10 people joining within 30 seconds starts raid mode'],
  ['strict', 'Strict', '5 people joining within 30 seconds starts raid mode'],
];
const THRESHOLDS = { normal: 10, strict: 5 };
const WINDOW_MS = 30_000;
const RAID_MS = 10 * 60_000;
const DAY = 86_400_000;
/** During raid mode, accounts younger than this are kicked. */
export const RAID_NEW_ACCOUNT_DAYS = 30;

export const AGE_OPTIONS = [
  ['0', 'Off', 'Anyone can join'], ['1', '1 day', 'Kick accounts made in the last 24 hours'],
  ['3', '3 days', ''], ['7', '7 days', ''], ['14', '14 days', ''], ['30', '30 days', 'Strict'],
];

const state = new Map(); // guildId -> { joins: [{ member, at }], until, kicked, alert }
const get = (id) => state.get(id) ?? state.set(id, { joins: [], until: 0, kicked: 0, alert: null }).get(id);

export const raidActive = (guildId, now = Date.now()) => get(guildId).until > now;
const accountAgeDays = (user, now) => (now - user.createdTimestamp) / DAY;

/** Pure: should this join start raid mode? */
export function burstDetected(joins, level, now) {
  const limit = THRESHOLDS[level];
  return Boolean(limit) && joins.filter((j) => now - j.at < WINDOW_MS).length >= limit;
}

async function kick(member, reason, dm) {
  await member.send(v2(card(colors.warn, text(`### 👋 ${member.guild.name}`, dm), footnote('This was automatic. You\'re welcome to come back later.'))))
    .catch(() => {});
  return member.kick(reason).then(() => true).catch(() => false);
}

async function alertChannel(guild, settings) {
  const id = settings.modLogChannel ?? settings.serverLogChannel;
  const ch = id && (await guild.channels.fetch(id).catch(() => null));
  return ch?.isTextBased() ? ch : null;
}

/** Called for every new member before anything else. Returns true if they were kicked. */
export async function screenJoin(member, now = Date.now()) {
  if (member.user.bot) return false;
  const settings = await getSettings(member.guild.id);
  const age = accountAgeDays(member.user, now);

  const minAge = Number(settings.minAccountAge ?? 0);
  if (minAge > 0 && age < minAge) {
    return kick(member, `Account younger than ${minAge} days`,
      `Your account is too new to join right now. Accounts must be at least **${minAge} day${minAge === 1 ? '' : 's'}** old.`);
  }

  const s = get(member.guild.id);
  if (raidActive(member.guild.id, now)) {
    s.until = Math.max(s.until, now + 5 * 60_000); // keep going while joins continue
    if (age < RAID_NEW_ACCOUNT_DAYS) {
      if (await kick(member, 'Raid protection', 'The server is in **raid protection mode** and isn\'t accepting new accounts for a few minutes.')) s.kicked += 1;
      return true;
    }
    return false;
  }

  const level = settings.raidProtection ?? 'normal';
  s.joins = [...s.joins.filter((j) => now - j.at < WINDOW_MS), { member, at: now }];
  if (!burstDetected(s.joins, level, now)) return false;

  // Raid! Kick the new accounts from the burst and lock out new accounts for 10 minutes.
  const burst = s.joins;
  s.joins = [];
  await startRaid(member.guild, { now, reason: `${burst.length} joins in ${WINDOW_MS / 1000} seconds` });
  let selfKicked = false;
  for (const j of burst) {
    if (accountAgeDays(j.member.user, now) < RAID_NEW_ACCOUNT_DAYS) {
      if (await kick(j.member, 'Raid protection', 'The server is in **raid protection mode** and isn\'t accepting new accounts for a few minutes.')) {
        s.kicked += 1;
        if (j.member.id === member.id) selfKicked = true;
      }
    }
  }
  return selfKicked;
}

export async function startRaid(guild, { now = Date.now(), minutes = RAID_MS / 60_000, reason = 'Started by staff', by } = {}) {
  const s = get(guild.id);
  s.until = now + minutes * 60_000;
  s.kicked = 0;
  const ch = await alertChannel(guild, await getSettings(guild.id));
  s.alert = ch && (await ch.send(raidCard(guild, { reason, by })).catch(() => null));
  scheduleEnd(guild);
}

function scheduleEnd(guild) {
  const s = get(guild.id);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    if (s.until > Date.now()) return scheduleEnd(guild); // was extended
    endRaid(guild, { automatic: true }).catch(() => {});
  }, Math.max(1000, s.until - Date.now()));
  s.timer.unref?.();
}

export async function endRaid(guild, { by, automatic = false } = {}) {
  const s = get(guild.id);
  const wasActive = s.until > 0;
  clearTimeout(s.timer);
  s.until = 0;
  if (!wasActive) return false;
  const summary = v2(card(colors.ok,
    text('### ✅ Raid mode ended', `${automatic ? 'Things calmed down, so it switched off by itself.' : `Ended by ${by}.`}`,
      `🚪 **${s.kicked}** new account${s.kicked === 1 ? '' : 's'} kicked while it was on.`),
  ));
  await (s.alert?.edit(summary) ?? Promise.resolve()).catch(() => {});
  s.alert = null;
  return true;
}

export function raidCard(guild, { reason, by }) {
  return v2(card(colors.bad,
    text('## 🚨 Raid mode is ON', `**Why** ${reason}${by ? ` (by ${by})` : ''}`),
    divider(),
    text(
      `🚪 Accounts younger than **${RAID_NEW_ACCOUNT_DAYS} days** are kicked when they join.`,
      '⏱️ It switches off by itself after 10 quiet minutes.',
      '🛡️ Older accounts and existing members aren\'t affected.',
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('raidmode:end').setLabel('End raid mode now').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
    footnote(`${guild.name} · raid protection`),
  ));
}

export const raidStatus = (guildId) => {
  const s = get(guildId);
  return { active: raidActive(guildId), until: s.until, kicked: s.kicked };
};
