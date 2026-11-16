import { Events } from 'discord.js';
import { memberUnbanned } from '../lib/serverlog.js';

export const name = Events.GuildBanRemove;
export const execute = (ban) => memberUnbanned(ban).catch((err) => console.error('Unban log failed:', err));
