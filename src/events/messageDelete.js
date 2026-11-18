import { Events } from 'discord.js';
import { forgetPanel } from '../lib/reactionroles.js';
import { store } from '../lib/store.js';
import { messageDeleted } from '../lib/serverlog.js';

export const name = Events.MessageDelete;
export function execute(message) {
  if (message.guildId) {
    forgetPanel(message.guildId, message.id).catch(() => {});
    store.composed.delete(message.id).catch(() => {}); // a /message post that was deleted can't be edited anymore
  }
  return messageDeleted(message).catch((err) => console.error('Delete log failed:', err));
}
