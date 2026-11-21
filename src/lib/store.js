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
//   store.bank      per server: { coins } the shared fund (tax in, daily/loans/heists out)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BANK_START } from './economy.js';

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
  const giveaways = db.collection('giveaways');
  const composed = db.collection('composedMessages');
  const bank = db.collection('bank');

  await Promise.all([
    links.createIndex({ robloxId: 1 }),
    pending.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // MongoDB deletes expired codes itself
    warnings.createIndex({ guildId: 1, discordId: 1, at: 1 }),
    tickets.createIndex({ guildId: 1, ownerId: 1 }),
    stats.createIndex({ guildId: 1, xp: -1 }),
    stats.createIndex({ guildId: 1, 'streak.current': -1 }),
    stats.createIndex({ guildId: 1, 'streak.lastDay': 1 }),
    stats.createIndex({ guildId: 1, coins: -1 }),
    giveaways.createIndex({ ended: 1, endsAt: 1 }),
    giveaways.createIndex({ guildId: 1, endsAt: -1 }),
    composed.createIndex({ guildId: 1, createdAt: -1 }),
  ]);

  // The bank starts with a gift the first time a server uses it.
  const ensureBank = async (g) => {
    try {
      await bank.updateOne({ _id: g }, { $setOnInsert: { coins: BANK_START } }, { upsert: true });
    } catch (err) {
      if (err.code !== 11000) throw err; // two at once: the other one created it
    }
  };

  // Stored with _id = Discord/channel ID; hand back plain objects without Mongo's fields.
  const clean = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    if (rest.expiresAt instanceof Date) rest.expiresAt = rest.expiresAt.getTime();
    return rest;
  };

  const sid = (g, u) => `${g}:${u}`;
  const gw = (doc) => (doc ? { ...clean(doc), messageId: doc._id } : null);
  return {
    // Messages made with /message, so they can be edited later: { messageId, guildId, channelId, blocks, authorId, createdAt }
    composed: {
      create: async (m) => { await composed.insertOne({ _id: m.messageId, ...m }); },
      get: async (id) => gw(await composed.findOne({ _id: id })),
      update: async (id, patch) => { await composed.updateOne({ _id: id }, { $set: patch }); },
      delete: async (id) => { await composed.deleteOne({ _id: id }); },
      list: async (guildId, limit = 25) => (await composed.find({ guildId }).sort({ createdAt: -1 }).limit(limit).toArray()).map(gw),
    },
    giveaways: {
      create: async (g) => { await giveaways.insertOne({ _id: g.messageId, ...g, entries: [], ended: false, winnerIds: [] }); },
      get: async (id) => gw(await giveaways.findOne({ _id: id })),
      /** Adds an entry; returns the new entry count, or null if they were already in. */
      enter: async (id, userId) => {
        const r = await giveaways.findOneAndUpdate({ _id: id, ended: false, entries: { $ne: userId } }, { $push: { entries: userId } }, { returnDocument: 'after', projection: { entries: 1 } });
        return r ? r.entries.length : null;
      },
      leave: async (id, userId) => {
        const r = await giveaways.findOneAndUpdate({ _id: id, ended: false }, { $pull: { entries: userId } }, { returnDocument: 'after', projection: { entries: 1 } });
        return r ? r.entries.length : null;
      },
      /** Marks it ended (only once, even if two things try at the same time). Returns it, or null. */
      finish: async (id) => gw(await giveaways.findOneAndUpdate({ _id: id, ended: false }, { $set: { ended: true, endedAt: Date.now() } }, { returnDocument: 'after' })),
      update: async (id, patch) => { await giveaways.updateOne({ _id: id }, { $set: patch }); },
      delete: async (id) => { await giveaways.deleteOne({ _id: id }); },
      due: async (now) => (await giveaways.find({ ended: false, endsAt: { $lte: now } }).project({ entries: 0 }).toArray()).map(gw),
      list: async (guildId, { ended } = {}) =>
        (await giveaways.find({ guildId, ...(ended === undefined ? {} : { ended }) }).project({ entries: 0 }).sort({ endsAt: -1 }).limit(25).toArray()).map(gw),
    },
    bank: {
      get: async (g) => { await ensureBank(g); return clean(await bank.findOne({ _id: g })); },
      /** Puts coins in (or takes them out with a negative number). */
      add: async (g, n) => {
        await ensureBank(g);
        return clean(await bank.findOneAndUpdate({ _id: g }, { $inc: { coins: n } }, { returnDocument: 'after' }));
      },
      /** Takes up to `n` coins (never below zero) and returns how many it really took. */
      take: async (g, n) => {
        await ensureBank(g);
        const before = await bank.findOneAndUpdate({ _id: g }, [{ $set: { coins: { $max: [0, { $subtract: ['$coins', n] }] } } }], { returnDocument: 'before' });
        return Math.min(n, before?.coins ?? 0);
      },
      set: async (g, patch) => { await ensureBank(g); await bank.updateOne({ _id: g }, { $set: patch }); },
    },
    stats: {
      get: async (g, u) => clean(await stats.findOne({ _id: sid(g, u) })),
      /** Adds XP atomically and returns the updated record. */
      addXp: async (g, u, amount) => clean(await stats.findOneAndUpdate(
        { _id: sid(g, u) },
        { $inc: { xp: amount }, $setOnInsert: { guildId: g, userId: u } },
        { upsert: true, returnDocument: 'after' },
      )),
      /** Adds coins (a negative amount takes them) and returns the record. */
      addCoins: async (g, u, amount) => clean(await stats.findOneAndUpdate(
        { _id: sid(g, u) },
        { $inc: { coins: amount }, $setOnInsert: { guildId: g, userId: u } },
        { upsert: true, returnDocument: 'after' },
      )),
      /** Takes coins ONLY if they have enough, in one step (so two quick bets can't spend the same coins). Returns the record, or null. */
      spend: async (g, u, amount) => clean(await stats.findOneAndUpdate(
        { _id: sid(g, u), coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { returnDocument: 'after' },
      )),
      /** Gives the daily reward once per day. Returns the record, or null if they already took it today. */
      claimDaily: async (g, u, day, amount) => {
        try {
          return clean(await stats.findOneAndUpdate(
            { _id: sid(g, u), dailyDay: { $ne: day } },
            { $set: { dailyDay: day }, $inc: { coins: amount }, $setOnInsert: { guildId: g, userId: u } },
            { upsert: true, returnDocument: 'after' },
          ));
        } catch (err) {
          if (err.code === 11000) return null; // the record exists and already has today's date
          throw err;
        }
      },
      /** Starts a heist attempt once per cooldown. Returns the record, or null if they tried within `cooldownMs`. */
      claimRob: async (g, u, now, cooldownMs) => {
        try {
          return clean(await stats.findOneAndUpdate(
            { _id: sid(g, u), $or: [{ robAt: { $exists: false } }, { robAt: { $lte: now - cooldownMs } }] },
            { $set: { robAt: now }, $setOnInsert: { guildId: g, userId: u } },
            { upsert: true, returnDocument: 'after' },
          ));
        } catch (err) {
          if (err.code === 11000) return null;
          throw err;
        }
      },
      /** Opens a loan and pays out `principal`, only if they have no open loan. Returns the record, or null. */
      openLoan: async (g, u, loan, principal) => {
        try {
          return clean(await stats.findOneAndUpdate(
            { _id: sid(g, u), $or: [{ 'loan.owed': { $exists: false } }, { 'loan.owed': { $lte: 0 } }] },
            { $set: { loan }, $inc: { coins: principal }, $setOnInsert: { guildId: g, userId: u } },
            { upsert: true, returnDocument: 'after' },
          ));
        } catch (err) {
          if (err.code === 11000) return null;
          throw err;
        }
      },
      /** Lowers what they owe by `amount`, only if they owe at least that much. Returns the record, or null. */
      payDebt: async (g, u, amount) => clean(await stats.findOneAndUpdate(
        { _id: sid(g, u), 'loan.owed': { $gte: amount } },
        { $inc: { 'loan.owed': -amount } },
        { returnDocument: 'after' },
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
  let data = { settings: {}, links: {}, pending: {}, warnings: {}, tickets: {}, ticketCounters: {}, stats: {}, giveaways: {}, composed: {}, bank: {} };
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
  const ensureBank = (g) => (data.bank[g] ??= { coins: BANK_START });
  const field = (doc, path) => path.split('.').reduce((o, k) => o?.[k], doc) ?? 0;
  const inGuild = (g) => Object.values(data.stats).filter((d) => d.guildId === g);
  const noEntries = (g) => { const { entries, ...rest } = g; return copy(rest); };
  return {
    _data: data,
    composed: {
      create: async (m) => { data.composed[m.messageId] = structuredClone(m); save(); },
      get: async (id) => copy(data.composed[id]),
      update: async (id, patch) => { if (data.composed[id]) Object.assign(data.composed[id], structuredClone(patch)); save(); },
      delete: async (id) => { delete data.composed[id]; save(); },
      list: async (guildId, limit = 25) => Object.values(data.composed)
        .filter((m) => m.guildId === guildId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((m) => copy(m)),
    },
    giveaways: {
      create: async (g) => { data.giveaways[g.messageId] = { ...structuredClone(g), entries: [], ended: false, winnerIds: [] }; save(); },
      get: async (id) => copy(data.giveaways[id]),
      enter: async (id, u) => {
        const g = data.giveaways[id];
        if (!g || g.ended || g.entries.includes(u)) return null;
        g.entries.push(u); save();
        return g.entries.length;
      },
      leave: async (id, u) => {
        const g = data.giveaways[id];
        if (!g || g.ended) return null;
        g.entries = g.entries.filter((x) => x !== u); save();
        return g.entries.length;
      },
      finish: async (id) => {
        const g = data.giveaways[id];
        if (!g || g.ended) return null;
        Object.assign(g, { ended: true, endedAt: Date.now() }); save();
        return copy(g);
      },
      update: async (id, patch) => { if (data.giveaways[id]) Object.assign(data.giveaways[id], structuredClone(patch)); save(); },
      delete: async (id) => { delete data.giveaways[id]; save(); },
      due: async (now) => Object.values(data.giveaways).filter((g) => !g.ended && g.endsAt <= now).map(noEntries),
      list: async (guildId, { ended } = {}) => Object.values(data.giveaways)
        .filter((g) => g.guildId === guildId && (ended === undefined || g.ended === ended))
        .sort((a, b) => b.endsAt - a.endsAt).slice(0, 25).map(noEntries),
    },
    bank: {
      get: async (g) => copy(ensureBank(g)),
      add: async (g, n) => { const b = ensureBank(g); b.coins += n; save(); return copy(b); },
      take: async (g, n) => { const b = ensureBank(g); const took = Math.min(n, b.coins); b.coins -= took; save(); return took; },
      set: async (g, patch) => { Object.assign(ensureBank(g), structuredClone(patch)); save(); },
    },
    stats: {
      get: async (g, u) => copy(data.stats[wkey(g, u)]),
      addXp: async (g, u, amount) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u, xp: 0 });
        d.xp = (d.xp ?? 0) + amount; save();
        return copy(d);
      },
      addCoins: async (g, u, amount) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u });
        d.coins = (d.coins ?? 0) + amount; save();
        return copy(d);
      },
      spend: async (g, u, amount) => {
        const d = data.stats[wkey(g, u)];
        if (!d || (d.coins ?? 0) < amount) return null;
        d.coins -= amount; save();
        return copy(d);
      },
      claimDaily: async (g, u, day, amount) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u });
        if (d.dailyDay === day) return null;
        d.dailyDay = day; d.coins = (d.coins ?? 0) + amount; save();
        return copy(d);
      },
      claimRob: async (g, u, now, cooldownMs) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u });
        if (d.robAt !== undefined && d.robAt > now - cooldownMs) return null;
        d.robAt = now; save();
        return copy(d);
      },
      openLoan: async (g, u, loan, principal) => {
        const d = (data.stats[wkey(g, u)] ??= { guildId: g, userId: u });
        if ((d.loan?.owed ?? 0) > 0) return null;
        d.loan = structuredClone(loan); d.coins = (d.coins ?? 0) + principal; save();
        return copy(d);
      },
      payDebt: async (g, u, amount) => {
        const d = data.stats[wkey(g, u)];
        if (!d || (d.loan?.owed ?? 0) < amount) return null;
        d.loan.owed -= amount; save();
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
