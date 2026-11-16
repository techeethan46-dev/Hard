import { Events } from 'discord.js';
import { memberBanned } from '../lib/serverlog.js';

export const name = Events.GuildBanAdd;
export const execute = (ban) => memberBanned(ban).catch((err) => console.error('Ban log failed:', err));
