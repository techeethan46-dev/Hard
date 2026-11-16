import { Events } from 'discord.js';
import { messagesBulkDeleted } from '../lib/serverlog.js';

export const name = Events.MessageBulkDelete;
export const execute = (messages, channel) => messagesBulkDeleted(messages, channel).catch((err) => console.error('Bulk delete log failed:', err));
