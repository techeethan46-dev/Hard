import { Events } from 'discord.js';
import { onMessage } from '../lib/activity.js';
import { moderate } from '../lib/automod.js';

export const name = Events.MessageCreate;
export async function execute(message) {
  try {
    if (await moderate(message)) return; // removed by AutoMod: no XP for that
    await onMessage(message);
  } catch (err) {
    console.error('Message handler failed:', err);
  }
}
