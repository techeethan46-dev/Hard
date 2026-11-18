// Rich messages made with /message: a message is a list of blocks, each shown as a card.
//   banner: { type: 'banner', image, color }
//   card:   { type: 'card', text, color, thumb, image, buttons: [{ label, url }] }
// The same blocks are used for posted messages, edits, and the custom welcome message ({user}, {server}, ...).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { card, colors, gallery, section, text, thumb, v2 } from './ui.js';

/** Discord allows 4000 characters of text and 40 components in one message. We stay a little under both. */
export const MAX_TEXT = 3800;
export const MAX_COMPONENTS = 38;
export const MAX_BLOCKS = 8;

// ---------------------------------------------------------------- reading what people type

const NAMED = {
  blue: 0x5865f2, red: 0xf2555a, green: 0x3fcf8e, gold: 0xf7c948, yellow: 0xf5d547, orange: 0xf5a524,
  purple: 0xa66bff, pink: 0xff6fb5, cyan: 0x56b6f7, white: 0xf2f3f5, grey: 0x8e9297, gray: 0x8e9297, black: 0x1e1f22,
};

/** "#ff8800", "ff8800", "f80" or a color name -> { value }. Empty -> { value: null }. Anything else -> { error }. */
export function parseColor(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/^#/, '');
  if (!s) return { value: null };
  if (NAMED[s] !== undefined) return { value: NAMED[s] };
  if (/^[0-9a-f]{6}$/.test(s)) return { value: parseInt(s, 16) };
  if (/^[0-9a-f]{3}$/.test(s)) return { value: parseInt([...s].map((c) => c + c).join(''), 16) };
  return { error: `"${input}" isn't a color. Use a hex code like #5865F2, or a name like blue, red, gold or purple.` };
}

/** Image links must be https. "{avatar}" and "{servericon}" are filled in when the message is shown. */
export function parseImage(input, label = 'image') {
  const s = String(input ?? '').trim();
  if (!s) return { value: null };
  if (/^\{(avatar|servericon)\}$/.test(s)) return { value: s };
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') throw new Error('not https');
    return { value: u.toString() };
  } catch {
    return { error: `The ${label} must be a link starting with https:// (a direct link to the picture).` };
  }
}

/** One "Label | https://link" per line, up to 5 -> { value: [{ label, url }] }. */
export function parseButtons(input) {
  const lines = String(input ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 5) return { error: 'A card can have up to 5 buttons.' };
  const buttons = [];
  for (const line of lines) {
    const [label, ...rest] = line.split('|');
    const url = parseImage(rest.join('|'), 'button link');
    if (!label.trim() || !rest.length || url.error || !url.value || url.value.startsWith('{')) {
      return { error: `Button "${line.slice(0, 40)}" must look like: Join the game | https://www.roblox.com/games/123` };
    }
    buttons.push({ label: label.trim().slice(0, 80), url: url.value });
  }
  return { value: buttons };
}

// ---------------------------------------------------------------- limits

export const textLength = (blocks) => blocks.reduce((n, b) => n + (b.text?.length ?? 0), 0);

/** How many of Discord's 40 components the message uses (rounded up a bit to be safe). */
export function componentCount(blocks) {
  return blocks.reduce((n, b) => {
    if (b.type === 'banner') return n + 1 + 2; // container + gallery
    return n + 1 + (b.thumb ? 3 : 1) + (b.image ? 2 : 0) + (b.buttons?.length ? 1 + b.buttons.length : 0);
  }, 0);
}

/** A problem that would stop this message from being sent, or null. */
export function problem(blocks) {
  if (!blocks.length) return 'Add at least one card or banner first.';
  if (blocks.length > MAX_BLOCKS) return `A message can have up to ${MAX_BLOCKS} blocks.`;
  const chars = textLength(blocks);
  if (chars > MAX_TEXT) return `Too long: one message holds ${MAX_TEXT.toLocaleString('en-US')} characters of text and you're at ${chars.toLocaleString('en-US')}. Put the rest in a second message.`;
  if (componentCount(blocks) > MAX_COMPONENTS) return 'This message has too many parts (pictures, buttons). Remove a few or split it into two messages.';
  return null;
}

// ---------------------------------------------------------------- showing it

const SAMPLE = {};
const fill = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

/** The Discord message for a list of blocks. `vars` fills {placeholders}. Mentions don't ping unless allowed. */
export function renderBlocks(blocks, vars = SAMPLE, { mentions } = {}) {
  const url = (u) => {
    const v = fill(u, vars);
    return v.startsWith('https://') ? v : null;
  };
  const containers = blocks.map((b) => {
    if (b.type === 'banner') return card(b.color ?? colors.brand, gallery(url(b.image)));
    const body = fill(b.text, vars);
    const thumbUrl = b.thumb ? url(b.thumb) : null;
    return card(b.color ?? colors.brand,
      thumbUrl ? section(body, thumb(thumbUrl)) : text(body),
      b.image ? gallery(url(b.image)) : null,
      b.buttons?.length
        ? new ActionRowBuilder().addComponents(b.buttons.map((x) => new ButtonBuilder().setLabel(x.label).setStyle(ButtonStyle.Link).setURL(x.url)))
        : null,
    );
  });
  return v2(containers, mentions ? { mentions } : undefined);
}

/** Placeholders for the welcome message. */
export const welcomeVars = (member, gameName) => ({
  user: `<@${member.id}>`,
  username: member.displayName ?? member.user?.username ?? 'friend',
  server: member.guild.name,
  count: Number(member.guild.memberCount ?? 0).toLocaleString('en-US'),
  game: gameName ?? 'the game',
  avatar: member.user?.displayAvatarURL?.({ size: 256 }) ?? '',
  servericon: member.guild.iconURL?.({ size: 256 }) ?? '',
});

/** The welcome message you start from when you open /message welcome for the first time. */
export const defaultWelcome = () => [{
  type: 'card', color: colors.brand, thumb: '{avatar}', image: null, buttons: [],
  text: [
    '### 👋 Welcome, {username}!',
    '{user} just joined **{server}**.',
    '',
    '**Get started**',
    '🔗 Run `/verify` to link your Roblox account and unlock the server',
    '🎮 Check `/game` to see who\'s playing',
    '🎫 Need help? Open a ticket any time',
    '',
    '-# You\'re member #{count}',
  ].join('\n'),
}];

// ---------------------------------------------------------------- #channel and @Role while typing

// Names are compared ignoring case, spaces and symbols, so "#rules" finds a channel called "┃📜・rules".
const simple = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const TOKEN = (sign) => new RegExp(`(^|[\\s(\\[])${sign}([\\p{L}\\p{N}][\\p{L}\\p{N}_-]*)`, 'gu');
const asList = (cache) => [...(cache?.values?.() ?? [])];
const only = (items, name) => {
  const found = items.filter((x) => simple(x.name) && simple(x.name) === simple(name));
  return found.length === 1 ? found[0] : null; // two with the same name: better to leave it than link the wrong one
};

/** Turns typed `#rules` into a real channel link and `@VIP` into a role link, when exactly one channel/role has that name. */
export function resolveMentions(input, guild) {
  const channels = asList(guild.channels?.cache);
  const roles = asList(guild.roles?.cache).filter((r) => r.id !== guild.id);
  return String(input ?? '')
    .replace(TOKEN('#'), (m, pre, name) => { const c = only(channels, name); return c ? `${pre}<#${c.id}>` : m; })
    .replace(TOKEN('@'), (m, pre, name) => {
      if (/^(everyone|here)$/i.test(name)) return m;
      const r = only(roles, name);
      return r ? `${pre}<@&${r.id}>` : m;
    });
}

/** The reverse, for editing: `<#123>` becomes `#rules` again (only when typing that back would find the same channel). */
export function readableMentions(input, guild) {
  const channels = asList(guild.channels?.cache);
  const roles = asList(guild.roles?.cache).filter((r) => r.id !== guild.id);
  const token = (name) => String(name ?? '').replace(/[^\p{L}\p{N}_-]+/gu, '');
  const back = (sign, id, items) => {
    const item = items.find((x) => x.id === id);
    const t = item && token(item.name);
    return t && /^[\p{L}\p{N}]/u.test(t) && only(items, t)?.id === id ? `${sign}${t}` : null;
  };
  return String(input ?? '')
    .replace(/<#(\w+)>/g, (m, id) => back('#', id, channels) ?? m)
    .replace(/<@&(\w+)>/g, (m, id) => back('@', id, roles) ?? m);
}
