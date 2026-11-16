// Wrapper around Roblox's public web APIs (no API key needed).
const cache = new Map();

async function request(url, { method = 'GET', body, ttl = 0 } = {}) {
  const key = `${method} ${url} ${body ? JSON.stringify(body) : ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Roblox API ${res.status} for ${url}`);
  const value = await res.json();
  if (ttl) cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

/** @returns {Promise<{id:number,name:string,displayName:string}|null>} */
export async function getUserByUsername(username) {
  const json = await request('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    body: { usernames: [username], excludeBannedUsers: false },
  });
  return json?.data?.[0] ?? null;
}

/** Full profile, including `description` (the "About" text). Never cached: verification reads it. */
export async function getUser(userId) {
  return request(`https://users.roblox.com/v1/users/${userId}`);
}

export async function getHeadshotUrl(userId) {
  const json = await request(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
    { ttl: 10 * 60_000 },
  );
  return json?.data?.[0]?.imageUrl ?? null;
}

export async function getUniverseId(placeId) {
  const json = await request(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, {
    ttl: 24 * 60 * 60_000,
  });
  return json?.universeId ?? null;
}

export async function getGame(universeId) {
  const json = await request(`https://games.roblox.com/v1/games?universeIds=${universeId}`, { ttl: 30_000 });
  return json?.data?.[0] ?? null;
}

export async function getGameIconUrl(universeId) {
  const json = await request(
    `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`,
    { ttl: 60 * 60_000 },
  );
  return json?.data?.[0]?.imageUrl ?? null;
}

export const profileUrl = (userId) => `https://www.roblox.com/users/${userId}/profile`;
export const gameUrl = (placeId) => `https://www.roblox.com/games/${placeId}`;
