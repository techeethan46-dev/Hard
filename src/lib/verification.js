import { db } from './store.js';
import { syncMember } from './roles.js';

/** Save a Discord <-> Roblox link and apply roles/nickname. */
export async function linkAccount(member, { robloxId, username }) {
  db.data.links[member.id] = { robloxId: Number(robloxId), username, linkedAt: Date.now() };
  delete db.data.pending[member.id];
  db.save();
  return syncMember(member);
}
