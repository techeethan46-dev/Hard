import { Events } from 'discord.js';
import { messageEdited } from '../lib/serverlog.js';

export const name = Events.MessageUpdate;
export async function execute(before, after) {
  try {
    if (after.partial) after = await after.fetch().catch(() => null);
    if (!after?.guild) return;
    if (before.content === after.content) return;
    await messageEdited(before, after);
  } catch (err) {
    console.error('Edit handler failed:', err);
  }
}
