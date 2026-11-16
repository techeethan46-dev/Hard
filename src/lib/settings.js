// Per-server settings chosen with /setup, cached in memory so commands don't hit the database every time.
import { store } from './store.js';

/**
 * @typedef {object} GuildSettings
 * @property {string} [verifiedRole]      given to everyone who links a Roblox account
 * @property {string} [unverifiedRole]    given until they verify
 * @property {string} [placeId]           Roblox game place ID
 * @property {string} [gameName]
 * @property {string} [welcomeChannel]
 * @property {string} [modLogChannel]
 * @property {string[]} [supportRoles]
 * @property {string} [ticketCategory]
 * @property {string} [ticketLogChannel]
 * @property {string} [suggestionsChannel]
 */

const cache = new Map();

/** @returns {Promise<GuildSettings>} */
export async function getSettings(guildId) {
  if (!cache.has(guildId)) cache.set(guildId, await store.settings.get(guildId));
  return cache.get(guildId);
}

export async function updateSettings(guildId, patch) {
  await store.settings.update(guildId, patch);
  cache.delete(guildId);
  return getSettings(guildId);
}

export const clearSettingsCache = () => cache.clear();
