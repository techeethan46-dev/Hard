import { store } from './store.js';
import { syncMember } from './roles.js';

/** Save a Discord <-> Roblox link and apply roles/nickname. */
export async function linkAccount(member, { robloxId, username }) {
  await store.links.set(member.id, { robloxId, username });
  await store.pending.delete(member.id);
  return syncMember(member);
}
