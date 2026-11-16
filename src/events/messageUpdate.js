import { Events } from 'discord.js';
import { moderate } from '../lib/automod.js';
import { messageEdited } from '../lib/serverlog.js';

export const name = Events.MessageUpdate;
export async function execute(before, after) {
  try {
    if (after.partial) after = await after.fetch().catch(() => null);
    if (!after?.guild) return;
    if (before.content === after.content) return;
    if (await moderate(after, { edited: true })) return; // edited into something against the rules
    await messageEdited(before, after);
  } catch (err) {
    console.error('Edit handler failed:', err);
  }
}
