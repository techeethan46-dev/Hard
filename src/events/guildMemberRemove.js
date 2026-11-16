import { Events } from 'discord.js';
import { memberLeft } from '../lib/serverlog.js';

export const name = Events.GuildMemberRemove;
export const execute = (member) => memberLeft(member).catch((err) => console.error('Leave log failed:', err));
