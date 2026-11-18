import { Events } from 'discord.js';
import { restoreNickname } from '../lib/activity.js';
import { memberUpdated } from '../lib/serverlog.js';

export const name = Events.GuildMemberUpdate;
export async function execute(before, after) {
  await restoreNickname(before, after).catch((err) => console.error('Nickname restore failed:', err.message));
  await memberUpdated(before, after).catch((err) => console.error('Member update log failed:', err));
}
