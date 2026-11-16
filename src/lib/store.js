// Tiny JSON-file store. Good for a single-server bot; swap for a real
// database (SQLite/Postgres) if you outgrow it.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(path, defaults = {}) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    try {
      this.data = { ...defaults, ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = structuredClone(defaults);
    }
  }

  save() {
    // Write to a temp file then rename, so a crash never leaves a half-written file.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }
}

const dataDir = new URL('../../data/', import.meta.url).pathname;

// links:   discordId -> { robloxId, username, linkedAt }
// pending: discordId -> { robloxId, username, code, expiresAt }
export const db = new JsonStore(`${dataDir}db.json`, {
  links: {},
  pending: {},
  warnings: {}, // discordId -> [{ id, reason, moderatorId, at }]
  tickets: {}, // channelId -> { number, ownerId, type, claimedBy, openedAt }
  ticketCounter: 0,
});
