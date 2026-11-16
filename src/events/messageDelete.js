import { Events } from 'discord.js';
import { messageDeleted } from '../lib/serverlog.js';

export const name = Events.MessageDelete;
export const execute = (message) => messageDeleted(message).catch((err) => console.error('Delete log failed:', err));
