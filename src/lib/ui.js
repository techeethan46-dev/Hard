// Shared look for every message the bot sends. Most screens use Discord's "Components V2" cards
// (rounded container + colored edge + dividers), so everything feels like one app.
import {
  ButtonBuilder, ContainerBuilder, EmbedBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { getSettings } from './settings.js';

export const colors = {
  brand: 0x6c7bff, // soft indigo: default
  ok: 0x3fcf8e,
  warn: 0xf5a524,
  bad: 0xf2555a,
  info: 0x56b6f7,
  ticket: 0xa66bff,
  roblox: 0x00a2ff,
};
const icons = { ok: '✅', warn: '⚠️', bad: '⛔', info: '💬', brand: '✨' };

/** Classic embed. Still used where files are attached (logs, DMs). */
export const embed = (color = colors.brand) => new EmbedBuilder().setColor(color).setTimestamp();

// ---------------------------------------------------------------- building blocks

/** A block of markdown text. Pass lines; null/false lines are skipped. */
export const text = (...lines) =>
  new TextDisplayBuilder().setContent(lines.flat().filter((l) => l !== null && l !== undefined && l !== false).join('\n') || '​');

/** Horizontal line (or just spacing with line: false). */
export const divider = ({ big = false, line = true } = {}) =>
  new SeparatorBuilder().setDivider(line).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

/** Small grey footer line. */
export const footnote = (s) => text(`-# ${s}`);

export const thumb = (url) => (url ? new ThumbnailBuilder().setURL(url) : null);

export const gallery = (...urls) => {
  const items = urls.flat().filter(Boolean).map((u) => new MediaGalleryItemBuilder().setURL(u));
  return items.length ? new MediaGalleryBuilder().addItems(items) : null;
};

/** Text with a thumbnail or button on the right. Falls back to plain text if there's no accessory. */
export function section(content, accessory) {
  const t = typeof content === 'string' || Array.isArray(content) ? text(content) : content;
  if (!accessory) return t;
  const s = new SectionBuilder().addTextDisplayComponents(t);
  return accessory instanceof ButtonBuilder ? s.setButtonAccessory(accessory) : s.setThumbnailAccessory(accessory);
}

/** A rounded card with a colored left edge. Parts: strings, text/section/divider/gallery/action rows. */
export function card(accent, ...parts) {
  const c = new ContainerBuilder().setAccentColor(accent);
  for (const p of parts.flat(Infinity)) {
    if (p === null || p === undefined || p === false) continue;
    if (typeof p === 'string') c.addTextDisplayComponents(text(p));
    else if (p instanceof TextDisplayBuilder) c.addTextDisplayComponents(p);
    else if (p instanceof SeparatorBuilder) c.addSeparatorComponents(p);
    else if (p instanceof SectionBuilder) c.addSectionComponents(p);
    else if (p instanceof MediaGalleryBuilder) c.addMediaGalleryComponents(p);
    else c.addActionRowComponents(p);
  }
  return c;
}

/** Message payload for cards. Mentions don't ping unless you pass `mentions`. */
export function v2(parts, { ephemeral = false, mentions = { parse: [] } } = {}) {
  return {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [parts].flat(Infinity).filter(Boolean),
    allowedMentions: mentions,
  };
}

/**
 * Short status message: notice('ok', 'Saved!') or notice('bad', 'Nope', { title: 'Not allowed' }).
 * Use { ephemeral: false } when editing a reply that's already ephemeral.
 */
export function notice(kind, message, { title, ephemeral = true } = {}) {
  const body = title ? [`### ${icons[kind] ?? ''} ${title}`, message] : [`${icons[kind] ?? ''}  ${message}`];
  return v2(card(colors[kind] ?? colors.brand, text(body)), { ephemeral });
}

/** Slim progress bar, e.g. ▰▰▰▱▱▱ */
export const progress = (done, total) => `\`${'▰'.repeat(done)}${'▱'.repeat(Math.max(0, total - done))}\``;

// ---------------------------------------------------------------- mod log

const actionStyle = {
  Warn: ['⚠️', colors.warn], Kick: ['👢', colors.bad], Ban: ['🔨', colors.bad], Unban: ['🕊️', colors.ok],
  'Warning removed': ['🧽', colors.ok], 'Warnings cleared': ['🧹', colors.ok], 'Timeout removed': ['🔊', colors.ok],
};

export async function modLog(guild, { action, target, moderator, reason, color, extra }) {
  const { modLogChannel } = await getSettings(guild.id);
  if (!modLogChannel) return;
  const channel = await guild.channels.fetch(modLogChannel).catch(() => null);
  if (!channel?.isTextBased()) return;

  const [icon, accent] = actionStyle[action] ?? (action.startsWith('Timeout') ? ['🔇', colors.warn] : ['🛡️', color ?? colors.warn]);
  const lines = [
    `### ${icon} ${action}`,
    `**Member** ${target} \`${target.tag ?? target.username}\``,
    `**By** ${moderator}`,
    `**Reason** ${reason || 'No reason given'}`,
    ...(extra ? [`**${extra.name}** ${extra.value}`] : []),
  ];
  const msg = v2(card(color ?? accent,
    section(lines, thumb(target.displayAvatarURL?.({ size: 128 }))),
    divider(),
    footnote(`User ID ${target.id} · <t:${Math.floor(Date.now() / 1000)}:f>`),
  ));
  await channel.send(msg).catch((err) => console.error('Mod log failed:', err.message));
}
