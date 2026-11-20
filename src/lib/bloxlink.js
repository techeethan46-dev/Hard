// Reads a member's linked Roblox account from Bloxlink, so members verify once with Bloxlink and we reuse it.
// Server API: GET https://api.blox.link/v4/public/guilds/:serverID/discord-to-roblox/:userID
// The Bloxlink bot must be in the server; the key is made on blox.link under Developer API (BLOXLINK_API_KEY).
import { config } from '../config.js';

const BASE = 'https://api.blox.link/v4/public/guilds';

export const bloxlinkEnabled = () => Boolean(config.bloxlinkKey);

/** Returns the Roblox user ID (number) Bloxlink has for this member, or null when they haven't linked one. Throws on real errors. */
export async function lookupRoblox(guildId, discordId) {
  const res = await fetch(`${BASE}/${guildId}/discord-to-roblox/${discordId}`, {
    headers: { authorization: config.bloxlinkKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null; // not linked
  if (res.status === 429) throw new Error('Bloxlink is busy right now (rate limit)');
  if (res.status === 401 || res.status === 403) throw new Error('Bloxlink rejected the API key (check BLOXLINK_API_KEY and that the key is for this server)');
  if (!res.ok) throw new Error(`Bloxlink lookup failed (${res.status})`);
  const body = await res.json().catch(() => null);
  const id = Number(body?.robloxID ?? body?.robloxId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
