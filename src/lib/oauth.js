// "Sign in with Roblox" (OAuth 2.0 authorization code flow with PKCE).
// Docs: https://create.roblox.com/docs/cloud/auth/oauth2-overview
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';
const STATE_TTL_MS = 10 * 60_000;

// state -> { discordId, guildId, verifier, expiresAt, onDone }
// In memory on purpose: a restart just means clicking Verify again.
const sessions = new Map();

export const redirectUri = () => `${config.oauth.publicUrl}/oauth/callback`;

/** Creates a one-time sign-in link for a Discord member. */
export function createAuthUrl({ discordId, guildId, onDone }) {
  for (const [k, v] of sessions) if (v.expiresAt < Date.now()) sessions.delete(k);
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  sessions.set(state, { discordId, guildId, verifier, onDone, expiresAt: Date.now() + STATE_TTL_MS });

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.oauth.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid profile',
    response_type: 'code',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return url.toString();
}

/** Takes (and removes) a pending session; null if unknown or expired. */
export function consumeSession(state) {
  const s = state && sessions.get(state);
  if (!s) return null;
  sessions.delete(state);
  return s.expiresAt < Date.now() ? null : s;
}

/** Exchanges the callback code for the Roblox user: { robloxId, username, displayName }. */
export async function exchangeCode(code, verifier) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Roblox token exchange failed (${tokenRes.status})`);
  const { access_token: accessToken } = await tokenRes.json();

  const infoRes = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoRes.ok) throw new Error(`Roblox userinfo failed (${infoRes.status})`);
  const info = await infoRes.json();
  return { robloxId: Number(info.sub), username: info.preferred_username, displayName: info.nickname ?? info.name };
}
