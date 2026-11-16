import { AttachmentBuilder } from 'discord.js';

/** Plain-text transcript of a channel (oldest first), up to `max` messages. */
export async function buildTranscript(channel, header, max = 2000) {
  const all = [];
  let before;
  while (all.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.lastKey();
  }
  const lines = all.reverse().map((m) => {
    const parts = [m.content];
    for (const e of m.embeds) parts.push([e.title, e.description, ...e.fields.map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join(' | '));
    for (const a of m.attachments.values()) parts.push(`[attachment] ${a.url}`);
    return `[${m.createdAt.toISOString().replace('T', ' ').slice(0, 19)}] ${m.author.tag}: ${parts.filter(Boolean).join('\n    ')}`;
  });
  const text = `${header}\n${'='.repeat(60)}\n${lines.join('\n')}\n`;
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${channel.name}.txt` });
}
