// Same checks against every storage backend. The MongoDB run only happens when you point it at a database:
//   MONGODB_TEST_URI="mongodb+srv://..." npm test
// It uses a throwaway database named "roblox-bot-test" and deletes it afterwards.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { initStore, closeStore } from '../src/lib/store.js';

const backends = [['memory', () => initStore({ mongoUri: '', jsonPath: null })]];
if (process.env.MONGODB_TEST_URI) {
  backends.push(['mongodb', async () => {
    const { MongoClient } = await import('mongodb');
    const drop = async () => {
      const c = new MongoClient(process.env.MONGODB_TEST_URI);
      await c.db('roblox-bot-test').dropDatabase();
      await c.close();
    };
    await drop();
    after(async () => { await closeStore(); await drop(); });
    return initStore({ mongoUri: process.env.MONGODB_TEST_URI, dbName: 'roblox-bot-test' });
  }]);
}

for (const [name, init] of backends) {
  describe(`store (${name})`, async () => {
    const store = await init();

    test('links', async () => {
      await store.links.set('d1', { robloxId: '55', username: 'abc' });
      assert.equal((await store.links.get('d1')).robloxId, 55);
      assert.equal(await store.links.findDiscordId(55), 'd1');
      assert.equal(await store.links.delete('d1'), true);
      assert.equal(await store.links.get('d1'), null);
      assert.equal(await store.links.findDiscordId(55), null);
    });

    test('pending codes expire', async () => {
      await store.pending.set('d1', { robloxId: 1, username: 'a', code: 'x y', expiresAt: Date.now() + 60_000 });
      assert.equal((await store.pending.get('d1')).code, 'x y');
      assert.equal(typeof (await store.pending.get('d1')).expiresAt, 'number');
      await store.pending.delete('d1');
      assert.equal(await store.pending.get('d1'), null);
    });

    test('settings: partial updates and clearing', async () => {
      assert.deepEqual(await store.settings.get('g1'), {});
      await store.settings.update('g1', { verifiedRole: 'r1', supportRoles: ['a', 'b'] });
      await store.settings.update('g1', { welcomeChannel: 'c1' });
      await store.settings.update('g1', { verifiedRole: null });
      assert.deepEqual(await store.settings.get('g1'), { supportRoles: ['a', 'b'], welcomeChannel: 'c1' });
      assert.deepEqual(await store.settings.get('g2'), {});
    });

    test('warnings are per server', async () => {
      assert.equal(await store.warnings.add('g1', 'd2', { id: 'w1', reason: 'a', moderatorId: 'm', at: 1 }), 1);
      assert.equal(await store.warnings.add('g1', 'd2', { id: 'w2', reason: 'b', moderatorId: 'm', at: 2 }), 2);
      assert.equal(await store.warnings.add('g2', 'd2', { id: 'w3', reason: 'c', moderatorId: 'm', at: 3 }), 1);
      assert.deepEqual((await store.warnings.list('g1', 'd2')).map((w) => w.id), ['w1', 'w2']);
      assert.equal(await store.warnings.remove('g1', 'd2', 'w1'), true);
      assert.equal(await store.warnings.remove('g1', 'd2', 'w3'), false);
      assert.equal(await store.warnings.clear('g1', 'd2'), 1);
      assert.deepEqual(await store.warnings.list('g1', 'd2'), []);
      assert.equal((await store.warnings.list('g2', 'd2')).length, 1);
    });

    test('composed messages: create, update, list newest first, delete', async () => {
      await store.composed.create({ messageId: 'c1', guildId: 'g1', channelId: 'ch', blocks: [{ type: 'card', text: 'one' }], createdAt: 1 });
      await store.composed.create({ messageId: 'c2', guildId: 'g1', channelId: 'ch', blocks: [{ type: 'card', text: 'two' }], createdAt: 2 });
      await store.composed.create({ messageId: 'c3', guildId: 'g2', channelId: 'ch', blocks: [], createdAt: 3 });
      assert.equal((await store.composed.get('c1')).blocks[0].text, 'one');
      assert.equal((await store.composed.get('c1')).messageId, 'c1');
      assert.deepEqual((await store.composed.list('g1')).map((m) => m.messageId), ['c2', 'c1']);
      await store.composed.update('c1', { blocks: [{ type: 'card', text: 'changed' }] });
      assert.equal((await store.composed.get('c1')).blocks[0].text, 'changed');
      await store.composed.delete('c1');
      assert.equal(await store.composed.get('c1'), null);
    });

    test('tickets: numbering, claim once, close once', async () => {
      const n1 = await store.tickets.nextNumber('g1');
      const n2 = await store.tickets.nextNumber('g1');
      assert.equal(n2, n1 + 1);
      assert.equal(await store.tickets.nextNumber('g2'), 1); // each server counts from 1
      await store.tickets.create('c1', { guildId: 'g1', number: n1, ownerId: 'p', type: 'bug', claimedBy: null, openedAt: 1 });
      assert.equal((await store.tickets.findByOwner('g1', 'p')).channelId, 'c1');
      assert.equal(await store.tickets.findByOwner('g2', 'p'), null);
      assert.equal(await store.tickets.claim('c1', 's1'), true);
      assert.equal(await store.tickets.claim('c1', 's2'), false);
      assert.equal((await store.tickets.get('c1')).claimedBy, 's1');
      const [a, b] = await Promise.all([store.tickets.startClosing('c1'), store.tickets.startClosing('c1')]);
      assert.equal([a, b].filter(Boolean).length, 1);
      await store.tickets.delete('c1');
      assert.equal(await store.tickets.findByOwner('g1', 'p'), null);
    });
  });
}
