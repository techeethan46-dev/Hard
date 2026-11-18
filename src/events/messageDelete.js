import { Events } from 'discord.js';
import { forgetPanel } from '../lib/reactionroles.js';
import { messageDeleted } from '../lib/serverlog.js';

export const name = Events.MessageDelete;
export function execute(message) {
  if (message.guildId) forgetPanel(message.guildId, message.id).catch(() => {});
  return messageDeleted(message).catch((err) => console.error('Delete log failed:', err));
}
