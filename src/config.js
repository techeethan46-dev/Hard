import 'dotenv/config';
import { readFileSync } from 'node:fs';

const file = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const env = (k) => (process.env[k] ?? '').trim() || null;

export const config = {
  token: env('DISCORD_TOKEN'),
  clientId: env('CLIENT_ID'),
  // Optional. Set it to register commands on one server only (instant updates while developing).
  // Leave it blank to register them everywhere the bot is invited.
  guildId: env('GUILD_ID'),
  // Roles, channels and the game are NOT set here: run /setup in Discord.
  // Optional. A Roblox Open Cloud key (user-restrictions read + write) so /gameban can ban players in the game.
  robloxApiKey: env('ROBLOX_API_KEY'),
  // Discord user IDs allowed to use /gameban. Edit "ownerIds" in config.json.
  ownerIds: (Array.isArray(file.ownerIds) ? file.ownerIds : []).map((id) => String(id).trim()).filter(Boolean),
  // Optional. Lets members verify with Bloxlink instead (see /verify). Make the key on blox.link > Developer API.
  bloxlinkKey: env('BLOXLINK_API_KEY'),
  oauth: {
    clientId: env('ROBLOX_OAUTH_CLIENT_ID'),
    clientSecret: env('ROBLOX_OAUTH_CLIENT_SECRET'),
    // Render sets RENDER_EXTERNAL_URL automatically (e.g. https://my-bot.onrender.com).
    publicUrl: (env('PUBLIC_URL') ?? env('RENDER_EXTERNAL_URL'))?.replace(/\/+$/, '') ?? null,
    port: Number(env('PORT')) || 3000,
  },
  nicknameFormat: file.nicknameFormat ?? '{displayName} (@{username})',
  statusUpdateSeconds: Math.max(60, Number(file.statusUpdateSeconds) || 120),
  ticketTypes: file.ticketTypes ?? [],
};

export function requireConfig(...keys) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    console.error(`Missing required settings: ${missing.join(', ')}. Add them in Render's Environment tab (or .env locally).`);
    process.exit(1);
  }
}

/** Public link to an image in /assets (served by the bot's web server), or null when the address isn't known. */
export const assetUrl = (file) => (config.oauth.publicUrl ? `${config.oauth.publicUrl}/assets/${file}` : null);

/** "Sign in with Roblox" is used when all three OAuth settings are present. */
export const oauthEnabled = () => Boolean(config.oauth.clientId && config.oauth.clientSecret && config.oauth.publicUrl);
