// Data storage. Uses MongoDB when MONGODB_URI is set (use this in production — Render's disk is wiped on
// every deploy). Without it, falls back to a local JSON file for development.
//
// Everything goes through `store`, so commands never care which backend is active:
//   store.links     discordId -> { robloxId, username, linkedAt }
//   store.pending   discordId -> { robloxId, username, code, expiresAt }   (profile-code verification)
//   store.settings  guildId -> everything chosen in /setup (roles, channels, game)
//   store.warnings  per server + member: list of { id, reason, moderatorId, at }
//   store.tickets   channelId -> { guildId, number, ownerId, type, claimedBy, openedAt, closing }
//   store.stats     per server + member: { xp, streak: { current, best, lastDay, ... } } for levels and streaks
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** @type {ReturnType<typeof memoryBackend>} */
export let store;
let closeFn = async () => {};

export async function initStore({ mongoUri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB, jsonPath } = {}) {
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    await client.connect();
    store = await mongoBackend(client.db(dbName || 'roblox-bot'));
    closeFn = () => client.close();
    console.log('Connected to MongoDB');
  } else {
    if (jsonPath === undefined) {
      jsonPath = new URL('../../data/db.json', import.meta.url).pathname;
      console.warn('MONGODB_URI not set: storing data in data/db.json (fine for local testing, NOT for Render).');
    }
    store = memoryBackend(jsonPath);
  }
  return store;
}

export const closeStore = () => closeFn();

// ---------------------------------------------------------------- MongoDB

async function mongoBackend(db) {
  const links = db.collection('links');
  const pending = db.collection('pendingVerifications');
  const warnings = db.collection('warnings');
  const tickets = db.collection('tickets');
  const counters = db.collection('counters');
  const settings = db.collection('guildSettings');
  const stats = db.collection('memberStats');

  await Promise.all([
    links.createIndex({ robloxId: 1 }),
    pending.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // MongoDB deletes expired codes itself
    warnings.createIndex({ guildId: 1, discordId: 1, at: 1 }),
    tickets.createIndex({ guildId: 1, ownerId: 1 }),
    stats.createIndex({ guildId: 1, xp: -1 }),
    stats.createIndex({ guildId: 1, 'streak.current': -1 }),
    stats.createIndex({ guildId: 1, 'streak.lastDay': 1 }),
  ]);

  // Stored with _id = Discord/channel ID; hand back plain objects without Mongo's fields.
  const clean = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    if (rest.expiresAt instanceof Date) rest.expiresAt = rest.expiresAt.getTime();
    return rest;
  };

  const sid = (g, u) => `${g}:${u}`;
  return {
    stats: {
      get: async (g, u) => clean(await stats.findOne({ _id: sid(g, u) })),
      /** Adds XP atomically and returns the updated record. */
      addXp: async (g, u, amount) => clean(await stats.findOneAndUpdate(
        { _id: sid(g, u) },
        { $inc: { xp: amount }, $setOnInsert: { guildId: g, userId: u } },
        { upsert: true, returnDocument: 'after' },
      )),
      set: async (g, u, patch) => {
        await stats.updateOne({ _id: sid(g, u) }, { $set: { ...patch, guildId: g, userId: u } }, { upsert: true });
      },
      /** Top members by a field ('xp' or 'streak.current'). */
      top: async (g, field, limit = 10) =>
        (await stats.find({ guildId: g, [field]: { $gt: 0 } }).sort({ [field]: -1 }).limit(limit).toArray()).map(clean),
      position: async (g, field, value) => 1 + (await stats.countDocuments({ guildId: g, [field]: { $gt: value } })),
      /** Running streaks whose last chat day is before `day` (YYYY-MM-DD). */
      staleStreaks: async (g, day) =>
        (await stats.find({ guildId: g, 'streak.current': { $gt: 0 }, 'streak.lastDay': { $lt: day } }).toArray()).map(clean),
    },
    settings: {
      get: async (guildId) => clean(await settings.findOne({ _id: guildId })) ?? {},
      update: async (guildId, patch) => {
        const $set = {};
        const $unset = {};
        for (const [k, v] of Object.entries(patch)) (v === null || v === undefined ? ($unset[k] = '') : ($set[k] = v));
        const update = { ...(Object.keys($set).length && { $set }), ...(Object.keys($unset).length && { $unset }) };
        if (Object.keys(update).length) await settings.updateOne({ _id: guildId }, update, { upsert: true });
      },
    },
    links: {
      get: async (discordId) => clean(await links.findOne({ _id: discordId })),
      set: async (discordId, { robloxId, username }) => {
        await links.replaceOne({ _id: discordId }, { robloxId: Number(robloxId), username, linkedAt: Date.now() }, { upsert: true });
      },
      delete: async (discordId) => (await links.deleteOne({ _id: discordId })).deletedCount > 0,
      findDiscordId: async (robloxId) => (await links.findOne({ robloxId: Number(robloxId) }))?._id ?? null,
    },
    pending: {
      get: async (discordId) => clean(await pending.findOne({ _id: discordId })),
      set: async (discordId, p) => {
        await pending.replaceOne({ _id: discordId }, { ...p, expiresAt: new Date(p.expiresAt) }, { upsert: true });
      },
      delete: async (discordId) => { await pending.deleteOne({ _id: discordId }); },
    },
    warnings: {
      list: async (guildId, discordId) =>
        (await warnings.find({ guildId, discordId }).sort({ at: 1 }).toArray()).map(({ _id, guildId: _g, discordId: _d, ...w }) => w),
      add: async (guildId, discordId, w) => {
        await warnings.insertOne({ guildId, discordId, ...w });
        return warnings.countDocuments({ guildId, discordId });
      },
      remove: async (guildId, discordId, id) => (await warnings.deleteOne({ guildId, discordId, id })).deletedCount > 0,
      clear: async (guildId, discordId) => (await warnings.deleteMany({ guildId, discordId })).deletedCount,
    },
    tickets: {
      get: async (channelId) => clean(await tickets.findOne({ _id: channelId })),
      findByOwner: async (guildId, ownerId) => {
        const doc = await tickets.findOne({ guildId, ownerId });
        return doc ? { channelId: doc._id, ...clean(doc) } : null;
      },
      create: async (channelId, t) => { await tickets.insertOne({ _id: channelId, ...t }); },
      delete: async (channelId) => { await tickets.deleteOne({ _id: channelId }); },
      /** Atomically claim; returns false if someone else already claimed it. */
      claim: async (channelId, staffId) =>
        (await tickets.updateOne({ _id: channelId, claimedBy: null }, { $set: { claimedBy: staffId } })).modifiedCount > 0,
      /** Atomically mark as closing; returns the ticket, or null if it's gone or already closing. */
      startClosing: async (channelId) =>
        clean(await tickets.findOneAndUpdate({ _id: channelId, closing: { $ne: true } }, { $set: { closing: true } })),
      nextNumber: async (guildId) =>
        (await counters.findOneAndUpdate({ _id: `ticket:${guildId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })).seq,
    },
  };
}

// ---------------------------------------------------------------- In-memory / JSON file (dev & tests)

export function memoryBackend(path = null) {
  let data = { settings: {}, links: {}, pending: {}, warnings: {}, tickets: {}, ticketCounters: {}, stats: {} };
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      data = { ...data, ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  const save = () => {
    if (!path) return;
    writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2));
    renameSync(`${path}.tmp`, path); // atomic: a crash never leaves a half-written file
  };
  const copy = (x) => (x ? structuredClone(x) : null);

  const wkey = (g, d) => `${g}:${d}`;
  const field = (doc, path) => path.split('.').reduce((o, k) => o?.[k], doc) ?? 0;
  const inGuild = (g) => Object.values(data.stats).filter((d) => d.guildId === g);
  return {
    _data: data,
    stats: {
      get: async (g, u) => copy(data.stats[wkey(g, u)]),
      addXp: async (g, u, amount) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u, xp: 0 });
        d.xp = (d.xp ?? 0) + amount; save();
        return copy(d);
      },
      set: async (g, u, patch) => {
        Object.assign((data.stats[wkey(g, u)] ??= { guildId: g, userId: u }), structuredClone(patch)); save();
      },
      top: async (g, path, limit = 10) =>
        inGuild(g).filter((d) => field(d, path) > 0).sort((a, b) => field(b, path) - field(a, path)).slice(0, limit).map(copy),
      position: async (g, path, value) => 1 + inGuild(g).filter((d) => field(d, path) > value).length,
      staleStreaks: async (g, day) =>
        inGuild(g).filter((d) => d.streak?.current > 0 && d.streak.lastDay < day).map(copy),
    },
    settings: {
      get: async (g) => copy(data.settings[g]) ?? {},
      update: async (g, patch) => {
        const s = (data.settings[g] ??= {});
        for (const [k, v] of Object.entries(patch)) {
          // "stickies.123" updates one nested key, like MongoDB does.
          const path = k.split('.');
          const parent = path.slice(0, -1).reduce((o, p) => (o[p] ??= {}), s);
          const last = path.at(-1);
          if (v === null || v === undefined) delete parent[last];
          else parent[last] = structuredClone(v);
        }
        save();
      },
    },
    links: {
      get: async (id) => copy(data.links[id]),
      set: async (id, { robloxId, username }) => { data.links[id] = { robloxId: Number(robloxId), username, linkedAt: Date.now() }; save(); },
      delete: async (id) => { const had = id in data.links; delete data.links[id]; save(); return had; },
      findDiscordId: async (robloxId) => Object.keys(data.links).find((k) => data.links[k].robloxId === Number(robloxId)) ?? null,
    },
    pending: {
      get: async (id) => {
        const p = data.pending[id];
        return p && p.expiresAt > Date.now() ? copy(p) : null;
      },
      set: async (id, p) => { data.pending[id] = { ...p }; save(); },
      delete: async (id) => { delete data.pending[id]; save(); },
    },
    warnings: {
      list: async (g, id) => copy(data.warnings[wkey(g, id)] ?? []),
      add: async (g, id, w) => { const l = (data.warnings[wkey(g, id)] ??= []); l.push({ ...w }); save(); return l.length; },
      remove: async (g, id, wid) => {
        const list = data.warnings[wkey(g, id)] ?? [];
        const i = list.findIndex((w) => w.id === wid);
        if (i !== -1) { list.splice(i, 1); save(); }
        return i !== -1;
      },
      clear: async (g, id) => { const n = data.warnings[wkey(g, id)]?.length ?? 0; delete data.warnings[wkey(g, id)]; save(); return n; },
    },
    tickets: {
      get: async (ch) => copy(data.tickets[ch]),
      findByOwner: async (g, owner) => {
        const ch = Object.keys(data.tickets).find((k) => data.tickets[k].guildId === g && data.tickets[k].ownerId === owner);
        return ch ? { channelId: ch, ...copy(data.tickets[ch]) } : null;
      },
      create: async (ch, t) => { data.tickets[ch] = { ...t }; save(); },
      delete: async (ch) => { delete data.tickets[ch]; save(); },
      claim: async (ch, staffId) => {
        const t = data.tickets[ch];
        if (!t || t.claimedBy) return false;
        t.claimedBy = staffId; save();
        return true;
      },
      startClosing: async (ch) => {
        const t = data.tickets[ch];
        if (!t || t.closing) return null;
        t.closing = true; save();
        return copy(t);
      },
      nextNumber: async (g) => { data.ticketCounters[g] = (data.ticketCounters[g] ?? 0) + 1; save(); return data.ticketCounters[g]; },
    },
  };
}
