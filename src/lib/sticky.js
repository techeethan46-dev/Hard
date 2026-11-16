// Sticky messages: keeps one message at the bottom of a channel by reposting it after people chat.
import { getSettings, updateSettings } from './settings.js';
import { card, colors, footnote, text, v2 } from './ui.js';

export const QUIET_MS = 4000; // wait for chat to pause...
export const MAX_WAIT_MS = 15_000; // ...but never longer than this in a busy channel
const pending = new Map(); // channelId -> { timer, since }

export const stickyCard = ({ title, text: body }) => v2(card(colors.info,
  text(title ? `### 📌 ${title}` : null, body),
  footnote('📌 Sticky message'),
));

/** Called for every message (including the bot's own). */
export async function onMessageForSticky(message) {
  if (!message.inGuild()) return;
  const sticky = (await getSettings(message.guildId)).stickies?.[message.channelId];
  if (!sticky || message.id === sticky.messageId) return;

  const p = pending.get(message.channelId) ?? { since: Date.now() };
  clearTimeout(p.timer);
  const wait = Math.max(0, Math.min(QUIET_MS, p.since + MAX_WAIT_MS - Date.now()));
  p.timer = setTimeout(() => {
    pending.delete(message.channelId);
    repost(message.channel).catch((err) => console.error('Sticky repost failed:', err.message));
  }, wait);
  pending.set(message.channelId, p);
}

/** Deletes the old copy and posts the sticky again at the bottom (unless it's already the last message). */
export async function repost(channel) {
  const sticky = (await getSettings(channel.guildId)).stickies?.[channel.id];
  if (!sticky) return;
  if (sticky.messageId && channel.lastMessageId === sticky.messageId) return; // already at the bottom
  if (sticky.messageId) await channel.messages.delete(sticky.messageId).catch(() => {});
  const sent = await channel.send(stickyCard(sticky));
  await updateSettings(channel.guildId, { [`stickies.${channel.id}`]: { ...sticky, messageId: sent.id } });
}

export async function setSticky(channel, { title, text: body }) {
  const old = (await getSettings(channel.guildId)).stickies?.[channel.id];
  if (old?.messageId) await channel.messages.delete(old.messageId).catch(() => {});
  const sent = await channel.send(stickyCard({ title, text: body }));
  await updateSettings(channel.guildId, { [`stickies.${channel.id}`]: { title: title || null, text: body, messageId: sent.id } });
}

export async function removeSticky(guild, channelId) {
  const old = (await getSettings(guild.id)).stickies?.[channelId];
  if (!old) return false;
  clearTimeout(pending.get(channelId)?.timer);
  pending.delete(channelId);
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (old.messageId) await ch?.messages.delete(old.messageId).catch(() => {});
  await updateSettings(guild.id, { [`stickies.${channelId}`]: null });
  return true;
}
