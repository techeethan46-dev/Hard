import { Events } from 'discord.js';
import { onMessage } from '../lib/activity.js';
import { handleAfk } from '../lib/afk.js';
import { onMessageForSticky } from '../lib/sticky.js';

export const name = Events.MessageCreate;
export async function execute(message) {
  try {
    // Every message (even the bot's own) may push a sticky message down.
    onMessageForSticky(message).catch((err) => console.error('Sticky check failed:', err.message));
    await handleAfk(message);
    await onMessage(message);
  } catch (err) {
    console.error('Message handler failed:', err);
  }
}
