// Data storage. Uses MongoDB when MONGODB_URI is set (use this in production — Render's disk is wiped on
// every deploy). Without it, falls back to a local JSON file for development.
//
// Everything goes through `store`, so commands never care which backend is active:
//   store.links     discordId -> { robloxId, username, linkedAt }
//   store.pending   discordId -> { robloxId, username, code, expiresAt }   (profile-code verification)
//   store.warnings  per-member list of { id, reason, moderatorId, at }
//   store.tickets   channelId -> { number, ownerId, type, claimedBy, openedAt, closing }
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

  await Promise.all([
    links.createIndex({ robloxId: 1 }),
    pending.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // MongoDB deletes expired codes itself
    warnings.createIndex({ discordId: 1, at: 1 }),
    tickets.createIndex({ ownerId: 1 }),
  ]);

  // Stored with _id = Discord/channel ID; hand back plain objects without Mongo's fields.
  const clean = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    if (rest.expiresAt instanceof Date) rest.expiresAt = rest.expiresAt.getTime();
    return rest;
  };

  return {
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
      list: async (discordId) => (await warnings.find({ discordId }).sort({ at: 1 }).toArray()).map(({ _id, discordId: _, ...w }) => w),
      add: async (discordId, w) => {
        await warnings.insertOne({ discordId, ...w });
        return warnings.countDocuments({ discordId });
      },
      remove: async (discordId, id) => (await warnings.deleteOne({ discordId, id })).deletedCount > 0,
      clear: async (discordId) => (await warnings.deleteMany({ discordId })).deletedCount,
    },
    tickets: {
      get: async (channelId) => clean(await tickets.findOne({ _id: channelId })),
      findByOwner: async (ownerId) => {
        const doc = await tickets.findOne({ ownerId });
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
      nextNumber: async () =>
        (await counters.findOneAndUpdate({ _id: 'ticket' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })).seq,
    },
  };
}

// ---------------------------------------------------------------- In-memory / JSON file (dev & tests)

export function memoryBackend(path = null) {
  let data = { links: {}, pending: {}, warnings: {}, tickets: {}, ticketCounter: 0 };
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

  return {
    _data: data,
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
      list: async (id) => copy(data.warnings[id] ?? []),
      add: async (id, w) => { (data.warnings[id] ??= []).push({ ...w }); save(); return data.warnings[id].length; },
      remove: async (id, wid) => {
        const list = data.warnings[id] ?? [];
        const i = list.findIndex((w) => w.id === wid);
        if (i !== -1) { list.splice(i, 1); save(); }
        return i !== -1;
      },
      clear: async (id) => { const n = data.warnings[id]?.length ?? 0; delete data.warnings[id]; save(); return n; },
    },
    tickets: {
      get: async (ch) => copy(data.tickets[ch]),
      findByOwner: async (owner) => {
        const ch = Object.keys(data.tickets).find((k) => data.tickets[k].ownerId === owner);
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
      nextNumber: async () => { data.ticketCounter += 1; save(); return data.ticketCounter; },
    },
  };
}
