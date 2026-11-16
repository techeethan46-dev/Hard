import { Events } from 'discord.js';
import { onMessage } from '../lib/activity.js';

export const name = Events.MessageCreate;
export const execute = (message) => onMessage(message).catch((err) => console.error('Message handler failed:', err));
