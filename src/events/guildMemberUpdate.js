import { Events } from 'discord.js';
import { memberUpdated } from '../lib/serverlog.js';

export const name = Events.GuildMemberUpdate;
export const execute = (before, after) => memberUpdated(before, after).catch((err) => console.error('Member update log failed:', err));
