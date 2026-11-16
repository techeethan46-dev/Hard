import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

export const colors = { brand: 0x00a2ff, ok: 0x43b581, warn: 0xfaa61a, bad: 0xf04747 };

export const embed = (color = colors.brand) => new EmbedBuilder().setColor(color).setTimestamp();

export async function modLog(guild, { action, target, moderator, reason, color = colors.warn, extra }) {
  if (!config.channels.modLog) return;
  const channel = await guild.channels.fetch(config.channels.modLog).catch(() => null);
  if (!channel?.isTextBased()) return;
  const e = embed(color)
    .setTitle(action)
    .addFields(
      { name: 'User', value: `${target} (${target.id})`, inline: true },
      { name: 'Moderator', value: `${moderator}`, inline: true },
      { name: 'Reason', value: reason || 'No reason given' },
    );
  if (extra) e.addFields(extra);
  await channel.send({ embeds: [e] }).catch((err) => console.error('Mod log failed:', err.message));
}
