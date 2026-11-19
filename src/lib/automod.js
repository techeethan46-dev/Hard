// AutoMod: decides whether a message breaks a rule, then deletes it, warns, and times out repeat offenders.
import { PermissionFlagsBits } from 'discord.js';
import { getSettings } from './settings.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from './ui.js';

// [id, name, description] — shown in /setup.
export const FILTERS = [
  ['spam', 'Spam & flooding', 'Lots of messages fast, or the same message again and again'],
  ['invites', 'Discord invites', 'Links to other Discord servers'],
  ['scams', 'Scam & phishing links', 'Free Nitro/Robux bait, fake Discord/Roblox/Steam sites'],
  ['mentions', 'Mass mentions', 'Pinging 5 or more people or roles in one message'],
  ['words', 'Blocked words', 'Anything on your blocked words list'],
  ['links', 'All links', 'Any link at all (strict)'],
  ['caps', 'Excessive caps', 'Long messages that are mostly CAPITALS'],
];
export const DEFAULT_FILTERS = ['spam', 'invites', 'scams', 'mentions', 'words'];
export const filtersFor = (settings) => settings.automodFilters ?? DEFAULT_FILTERS;

const MAX_MENTIONS = 5;
const STRIKES_FOR_TIMEOUT = 3;
const STRIKE_WINDOW_MS = 10 * 60_000;

// ---------------------------------------------------------------- detection (pure, easy to test)

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.(?:gg|io|me|li)|dsc\.gg|invite\.gg)\/[\w-]+/i;
const URL_WITH_SCHEME = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/i;
const DOMAIN = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/:?#\s]|$)/gi;
const SCAM_PHRASE = /\b(?:free|gift(?:ed)?|claim)\s+(?:discord\s+)?nitro\b|\bfree\s+robux\b|\brobux\s+(?:generator|giveaway)\b|\bsteam\s+gift\b|\bclaim\s+your\s+(?:gift|robux|reward)\b/i;

// Real sites that contain a brand name.
const OFFICIAL = [
  'roblox.com', 'rbxcdn.com', 'robloxlabs.com', 'roblox.qq.com',
  'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.gift', 'discord.new',
  'discordstatus.com', 'discord.dev', 'discord.js.org', 'discordjs.dev',
  'steamcommunity.com', 'steampowered.com', 'steamstatic.com',
];
const BRANDS = ['discord', 'discordapp', 'roblox', 'steamcommunity', 'steampowered'];
const BAIT = /gift|free|nitro|robux|promo|claim|login|verify|reward|bonus|airdrop/;
const SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'edu']);

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export const domainsIn = (content) => [...content.matchAll(DOMAIN)].map((m) => m[1].toLowerCase().replace(/^www\./, ''));

/** True for look-alike or bait domains like dlscord.gift, roblox.com.ge, free-robux-roblox.xyz */
export function isScamDomain(domain) {
  if (OFFICIAL.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  const labels = domain.split('.');
  // "roblox.com.ge" -> registrable name "roblox"; "roblox.fandom.com" -> "fandom"
  const name = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2)) ? labels.at(-3) : labels.at(-2);
  if (!name) return false;
  return BRANDS.some((brand) => {
    if (name === brand) return true; // brand name on a fake TLD
    const close = levenshtein(name, brand) <= (brand.length >= 7 ? 2 : 1);
    return close || (name.includes(brand) && BAIT.test(name));
  });
}

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const normalizeWords = (s) => s.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]).replace(/(.)\1{2,}/g, '$1$1');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Checks one message. Returns { rule, reason } for the first rule it breaks, or null.
 * `mentions` is how many users + roles it pings.
 */
export function detect(content, { filters = DEFAULT_FILTERS, words = [], mentions = 0 } = {}) {
  const on = new Set(filters);
  const c = content ?? '';

  if (on.has('scams')) {
    const domains = domainsIn(c);
    if (domains.some(isScamDomain)) return { rule: 'scams', reason: 'Scam or fake link' };
    if (domains.length && SCAM_PHRASE.test(c)) return { rule: 'scams', reason: 'Scam message' };
  }
  if (on.has('invites') && INVITE.test(c)) return { rule: 'invites', reason: 'Discord invite links aren\'t allowed' };
  if (on.has('words') && words.length) {
    // Check the text as written and with disguises undone ("b4dw0rd", "sh!t"), but only as whole words.
    const versions = [c.toLowerCase(), normalizeWords(c)];
    const hit = words.find((w) => {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(normalizeWords(w))}(?:$|[^a-z0-9])`, 'i');
      return versions.some((v) => re.test(v));
    });
    if (hit) return { rule: 'words', reason: 'Blocked word' };
  }
  if (on.has('mentions') && mentions >= MAX_MENTIONS) return { rule: 'mentions', reason: `Too many mentions (${mentions})` };
  if (on.has('links') && URL_WITH_SCHEME.test(c)) return { rule: 'links', reason: 'Links aren\'t allowed' };
  if (on.has('caps')) {
    const letters = c.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 15 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) {
      return { rule: 'caps', reason: 'Too many capital letters' };
    }
  }
  return null;
}

/** Remembers recent messages per member and spots flooding or repeats. */
export class SpamTracker {
  constructor({ burst = 6, burstMs = 6000, repeats = 3, repeatMs = 30_000 } = {}) {
    Object.assign(this, { burst, burstMs, repeats, repeatMs, recent: new Map() });
  }

  /** Returns { reason, ids } if this message makes it spam, else null. */
  add(key, { id, text, at = Date.now() }) {
    const list = (this.recent.get(key) ?? []).filter((m) => at - m.at < this.repeatMs);
    list.push({ id, text: (text ?? '').trim().toLowerCase(), at });
    this.recent.set(key, list);
    if (this.recent.size > 20_000) this.recent.clear();

    const fast = list.filter((m) => at - m.at < this.burstMs).length >= this.burst;
    const t = list.at(-1).text;
    const same = t && list.filter((m) => m.text === t).length >= this.repeats;
    if (!fast && !same) return null;
    this.recent.delete(key);
    return { reason: fast ? 'Sending messages too fast' : 'Repeating the same message', ids: list.map((m) => m.id) };
  }
}

// ---------------------------------------------------------------- acting on messages

const spam = new SpamTracker();
const strikes = new Map(); // "guild:user" -> [times]
const lastWarn = new Map(); // "guild:user" -> time
/** Message IDs AutoMod deleted, so the delete log doesn't report them twice. */
export const deletedByAutomod = new Set();

export function isExempt(member, settings) {
  if (!member) return false;
  if (member.user?.bot) return true;
  const p = member.permissions;
  if (p?.has(PermissionFlagsBits.ManageMessages) || p?.has(PermissionFlagsBits.ManageGuild)) return true;
  return (settings.automodExemptRoles ?? []).some((id) => member.roles?.cache?.has(id));
}

/**
 * Runs AutoMod on a message. Returns true if the message was removed (so XP etc. should skip it).
 * `edited` skips the spam rule (editing isn't sending).
 */
export async function moderate(message, { edited = false } = {}) {
  if (!message.inGuild() || message.author?.bot || message.webhookId) return false;
  const settings = await getSettings(message.guildId);
  const filters = filtersFor(settings);
  if (!filters.length) return false;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (isExempt(member, settings)) return false;

  const key = `${message.guildId}:${message.author.id}`;
  let hit = detect(message.content, {
    filters, words: settings.bannedWords ?? [], mentions: message.mentions.users.size + message.mentions.roles.size,
  });
  let spamIds = [];
  if (!hit && !edited && filters.includes('spam')) {
    const s = spam.add(key, { id: message.id, text: message.content });
    if (s) {
      hit = { rule: 'spam', reason: s.reason };
      spamIds = s.ids;
    }
  }
  if (!hit) return false;

  // Trial mode: only report what AutoMod would have done, and change nothing.
  if (settings.automodMode === 'log') {
    await logHit(message, settings, hit, '🧪 Trial mode: nothing was deleted');
    return false;
  }

  // Remove the message (and the rest of a spam burst).
  for (const id of [message.id, ...spamIds]) deletedByAutomod.add(id);
  if (deletedByAutomod.size > 5000) deletedByAutomod.clear();
  if (spamIds.length > 1) await message.channel.bulkDelete(spamIds, true).catch(() => {});
  else await message.delete().catch(() => {});

  // Spam = straight to a timeout. Other rules: timeout on the 3rd hit within 10 minutes.
  const now = Date.now();
  const recent = [...(strikes.get(key) ?? []).filter((t) => now - t < STRIKE_WINDOW_MS), now];
  strikes.set(key, recent);
  let action = 'Message deleted';
  const timeoutMins = hit.rule === 'spam' ? 5 : recent.length >= STRIKES_FOR_TIMEOUT ? 10 : 0;
  if (timeoutMins && member?.moderatable) {
    await member.timeout(timeoutMins * 60_000, `AutoMod: ${hit.reason}`).catch(() => {});
    action = `Message deleted · timed out for ${timeoutMins} minutes`;
    strikes.delete(key);
  }

  // Short public heads-up (at most one every 10 seconds per person), removed after a few seconds.
  if ((lastWarn.get(key) ?? 0) + 10_000 < now) {
    lastWarn.set(key, now);
    const warning = await message.channel.send(v2(card(colors.warn,
      text(`🤖 ${message.author}, ${hit.reason.charAt(0).toLowerCase()}${hit.reason.slice(1)}.${timeoutMins ? ` You're timed out for ${timeoutMins} minutes.` : ''}`),
    ), { mentions: { users: [message.author.id] } })).catch(() => null);
    if (warning) setTimeout(() => warning.delete().catch(() => {}), 6000);
  }

  await logHit(message, settings, hit, action);
  return true;
}

async function logHit(message, settings, hit, action) {
  const channelId = settings.modLogChannel ?? settings.serverLogChannel;
  if (!channelId) return;
  const log = await message.guild.channels.fetch(channelId).catch(() => null);
  if (!log?.isTextBased()) return;
  const name = FILTERS.find(([id]) => id === hit.rule)?.[1] ?? hit.rule;
  const content = (message.content || '*no text*').replace(/```/g, '`​``').slice(0, 900);
  await log.send(v2(card(colors.warn,
    section([`### 🤖 AutoMod · ${name}`, `**Member** ${message.author} \`${message.author.tag}\``, `**Channel** ${message.channel}`, `**Action** ${action}`],
      thumb(message.author.displayAvatarURL({ size: 128 }))),
    divider(),
    text(`\`\`\`\n${content}\n\`\`\``),
    footnote(`User ID ${message.author.id} · ${hit.reason}`),
  ))).catch(() => {});
}
