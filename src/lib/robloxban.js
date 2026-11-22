// Bans players from the Roblox game with Roblox Open Cloud "user restrictions".
// Docs: https://create.roblox.com/docs/cloud/reference/UserRestriction
// The API key needs the "universe.user-restriction" read and write permissions, and must belong to the game's owner.
import { config } from '../config.js';

const BASE = 'https://apis.roblox.com/cloud/v2/universes';
const MAX_PRIVATE = 1000;
const MAX_DISPLAY = 400;

export const banEnabled = () => Boolean(config.robloxApiKey);

async function call(universeId, robloxId, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/${universeId}/user-restrictions/${robloxId}`, {
    method,
    headers: { 'x-api-key': config.robloxApiKey, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Roblox rejected the API key. It must be made by the game owner for this game, with the user-restrictions read and write permissions.');
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Roblox says too many requests. Wait a moment and try again.');
  if (!res.ok) throw new Error(`Roblox returned an error (${res.status}).`);
  return res.json();
}

/** { active, reason, expiresAt (ms or null for permanent) } for this player, or null when they have no restriction. */
export async function getBan(universeId, robloxId) {
  const json = await call(universeId, robloxId);
  const r = json?.gameJoinRestriction;
  if (!r) return null;
  const seconds = r.duration ? Number(String(r.duration).replace('s', '')) : null;
  const started = r.startTime ? Date.parse(r.startTime) : null;
  return {
    active: Boolean(r.active),
    reason: r.privateReason ?? r.displayReason ?? '',
    expiresAt: seconds && started ? started + seconds * 1000 : null,
  };
}

/** Bans a player from the game (`days` empty = permanent). Checks afterwards that Roblox really applied it. */
export async function banPlayer(universeId, robloxId, { days, reason }) {
  const restriction = {
    active: true,
    privateReason: reason.slice(0, MAX_PRIVATE),
    displayReason: reason.slice(0, MAX_DISPLAY),
    excludeAltAccounts: false,
    ...(days ? { duration: `${Math.round(days * 86_400)}s` } : {}),
  };
  await call(universeId, robloxId, { method: 'PATCH', body: { gameJoinRestriction: restriction } });
  // Roblox can answer "OK" without applying a change when the key lacks the write permission, so read it back.
  const now = await getBan(universeId, robloxId);
  if (!now?.active) throw new Error('Roblox accepted the request but the ban was not applied. Check that the API key has the user-restrictions WRITE permission.');
  return now;
}

/** Lifts a ban. Returns false if they weren't banned. */
export async function unbanPlayer(universeId, robloxId) {
  const before = await getBan(universeId, robloxId);
  if (!before?.active) return false;
  await call(universeId, robloxId, { method: 'PATCH', body: { gameJoinRestriction: { active: false } } });
  const now = await getBan(universeId, robloxId);
  if (now?.active) throw new Error('Roblox accepted the request but the ban is still active. Check that the API key has the user-restrictions WRITE permission.');
  return true;
}
