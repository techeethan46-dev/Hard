import 'dotenv/config';
import { readFileSync } from 'node:fs';

const file = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const env = (k) => (process.env[k] ?? '').trim() || null;

export const config = {
  token: env('DISCORD_TOKEN'),
  clientId: env('CLIENT_ID'),
  guildId: env('GUILD_ID'),
  placeId: env('ROBLOX_PLACE_ID'),
  groupId: env('ROBLOX_GROUP_ID'),
  channels: {
    welcome: env('WELCOME_CHANNEL_ID'),
    modLog: env('MOD_LOG_CHANNEL_ID'),
    suggestions: env('SUGGESTIONS_CHANNEL_ID'),
    ticketCategory: env('TICKET_CATEGORY_ID'),
    ticketLog: env('TICKET_LOG_CHANNEL_ID'),
  },
  supportRoleIds: (env('SUPPORT_ROLE_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  oauth: {
    clientId: env('ROBLOX_OAUTH_CLIENT_ID'),
    clientSecret: env('ROBLOX_OAUTH_CLIENT_SECRET'),
    publicUrl: env('PUBLIC_URL')?.replace(/\/+$/, '') ?? null,
    port: Number(env('PORT')) || 3000,
  },
  roles: {
    verified: env('VERIFIED_ROLE_ID'),
    unverified: env('UNVERIFIED_ROLE_ID'),
  },
  nicknameFormat: file.nicknameFormat ?? '{displayName} (@{username})',
  statusUpdateSeconds: Math.max(60, Number(file.statusUpdateSeconds) || 120),
  ticketTypes: file.ticketTypes ?? [],
  // Ignore bindings left with an empty roleId.
  groupRankBindings: (file.groupRankBindings ?? []).filter((b) => b.roleId),
};

export function requireConfig(...keys) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    console.error(`Missing required settings: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

/** "Sign in with Roblox" is used when all three OAuth settings are present. */
export const oauthEnabled = () => Boolean(config.oauth.clientId && config.oauth.clientSecret && config.oauth.publicUrl);
