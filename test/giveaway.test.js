import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
process.env.PUBLIC_URL = 'https://bot.example.com';
mock.timers.enable({ apis: ['setTimeout'] });

const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
const G = await import('../src/lib/giveaways.js');
const cmd = await import('../src/commands/giveaway.js');
const { totalXpFor } = await import('../src/lib/levels.js');

test('durations', () => {
  assert.equal(G.parseDuration('30m'), 30 * 60_000);
  assert.equal(G.parseDuration('1d12h'), 36 * 3_600_000);
  assert.equal(G.parseDuration('2 days'), 2 * 86_400_000);
  assert.equal(G.parseDuration('1w'), 7 * 86_400_000);
  assert.equal(G.parseDuration('soon'), null);
  assert.equal(G.parseDuration('10'), null);
});

// ---------------------------------------------------------------- fakes
const roleSets = { amy: ['booster'], bob: [], cat: ['vip'], dan: [], eve: [] };
const members = Object.fromEntries(Object.keys(roleSets).map((id) => [id, {
  id, guild: { id: 'g1' }, roles: { cache: { has: (r) => roleSets[id].includes(r) } },
}]));
const messages = new Map();
const sentIn = [];
const channel = {
  id: 'gw', toString: () => '<#gw>',
  send: async (m) => {
    const id = `m${messages.size + 1}`;
    const msg = { id, content: m, url: `https://discord.com/channels/g1/gw/${id}`, guild: null, edits: [], edit: async (e) => { msg.content = e; msg.edits.push(e); } };
    messages.set(id, msg);
    sentIn.push(m);
    return msg;
  },
  messages: { fetch: async (id) => messages.get(id) },
};
const dms = [];
const guild = {
  id: 'g1', name: 'Wobble League', iconURL: () => null,
  channels: { fetch: async () => channel },
  members: { fetch: async (id) => members[id] ?? Promise.reject(new Error('left')) },
};
const client = { guilds: { fetch: async () => guild }, users: { fetch: async (id) => ({ send: async (m) => dms.push({ id, m }) }) } };

const ix = (opts = {}) => {
  const calls = [];
  const rec = async (p) => { calls.push(p); };
  const o = opts.options ?? {};
  return {
    calls, guild, guildId: 'g1', client, channel, user: { id: opts.user ?? 'host' }, member: members[opts.user] ?? { roles: { cache: { has: () => false } } },
    options: {
      getSubcommand: () => opts.sub, getString: (k) => o[k] ?? null, getInteger: (k) => o[k] ?? null, getBoolean: (k) => o[k] ?? null,
      getRole: (k) => (o[k] ? { id: o[k] } : null), getChannel: () => null, getFocused: () => o.focused ?? '',
    },
    reply: rec, update: rec, editReply: rec, deferReply: async () => {}, respond: rec,
    customId: opts.customId, message: opts.message,
  };
};

let gid;
test('start: a gold card with prize, timer, requirements and an Enter button', async () => {
  const i = ix({ sub: 'start', options: { prize: '1,000 Robux', duration: '1d', winners: 2, min_level: 3, bonus_role: 'booster', description: 'Thanks for 10k members!' } });
  await cmd.execute(i);
  const posted = sentIn[0];
  assert.ok(isV2(posted));
  json(posted);
  const t = textOf(posted);
  assert.match(t, /🎉 GIVEAWAY 🎉/);
  assert.match(t, /## 1,000 Robux\nThanks for 10k members!/);
  assert.match(t, /\*\*2\*\* winners/);
  assert.match(t, /Level \*\*3\*\* or higher/);
  assert.match(t, /<@&booster> gets \*\*2× entries\*\*/);
  assert.match(JSON.stringify(json(posted)), /https:\/\/bot\.example\.com\/assets\/gift\.png/);
  assert.deepEqual(customIds(posted), ['giveaway:enter']);
  assert.match(textOf(i.calls[0]), /is live in <#gw>/);
  gid = 'm1';
  assert.equal((await store.giveaways.get(gid)).prize, '1,000 Robux');

  const bad = ix({ sub: 'start', options: { prize: 'x', duration: '5s' } });
  await cmd.execute(bad);
  assert.match(textOf(bad.calls[0]), /Invalid duration/);
});

test('entering: requirements, already in, leaving', async () => {
  for (const id of ['amy', 'bob', 'cat', 'dan']) await store.stats.set('g1', id, { xp: totalXpFor(5) });
  const message = messages.get(gid);

  const eve = ix({ user: 'eve', customId: 'giveaway:enter', message });
  await cmd.handleButton(eve);
  assert.match(textOf(eve.calls[0]), /you need level \*\*3\*\*, you're level \*\*0\*\*/);

  const amy = ix({ user: 'amy', customId: 'giveaway:enter', message });
  await cmd.handleButton(amy);
  json(amy.calls[0]);
  assert.match(textOf(amy.calls[0]), /You're in!/);
  assert.match(textOf(amy.calls[0]), /2× entries/);
  assert.deepEqual(buttonLabels(amy.calls[0]), ['Leave giveaway']);

  const again = ix({ user: 'amy', customId: 'giveaway:enter', message });
  await cmd.handleButton(again);
  assert.match(textOf(again.calls[0]), /already in/);

  for (const u of ['bob', 'cat', 'dan']) await cmd.handleButton(ix({ user: u, customId: 'giveaway:enter', message }));
  await cmd.handleButton(ix({ user: 'dan', customId: `giveaway:leave:${gid}` }));
  assert.deepEqual((await store.giveaways.get(gid)).entries, ['amy', 'bob', 'cat']);

  // the counter on the card updates (batched)
  mock.timers.tick(5000);
  for (let k = 0; k < 20; k++) await Promise.resolve();
  assert.match(textOf(message.content), /\*\*3\*\* entries/);
});

test('autocomplete finds giveaways by prize', async () => {
  const i = ix({ sub: 'end', options: { focused: 'robux' } });
  await cmd.autocomplete(i);
  assert.equal(i.calls[0][0].value, gid);
  assert.match(i.calls[0][0].name, /^1,000 Robux · ends/);
});

test('ending: winners drawn, card updated, winners pinged and DMed', async () => {
  delete members.cat; // cat left the server: can't win
  await store.giveaways.update(gid, { endsAt: Date.now() - 1 });
  await G.endDueGiveaways(client);
  const g = await store.giveaways.get(gid);
  assert.equal(g.ended, true);
  assert.deepEqual([...g.winnerIds].sort(), ['amy', 'bob']);

  const card = messages.get(gid).content;
  json(card);
  assert.match(textOf(card), /GIVEAWAY ENDED/);
  assert.match(textOf(card), /Winners:\*\* <@(amy|bob)> <@(amy|bob)>/);
  assert.deepEqual(buttonLabels(card), ['Giveaway ended']);

  const announce = sentIn.at(-1);
  json(announce);
  assert.match(textOf(announce), /Congratulations!/);
  assert.match(textOf(announce), /won \*\*1,000 Robux\*\*/);
  assert.deepEqual([...announce.allowedMentions.users].sort(), ['amy', 'bob']);
  assert.deepEqual(dms.map((d) => d.id).sort(), ['amy', 'bob']);
  assert.match(textOf(dms[0].m), /You won 1,000 Robux!/);

  // running it again does nothing
  assert.equal(await G.endGiveaway(client, gid), null);
});

test('reroll picks someone who hasn\'t won; nobody left -> says so', async () => {
  members.cat = { id: 'cat', guild: { id: 'g1' }, roles: { cache: { has: () => false } } };
  const r = ix({ sub: 'reroll', options: { giveaway: gid } });
  await cmd.execute(r);
  assert.match(textOf(r.calls[0]), /New winner: <@cat>/);
  const again = ix({ sub: 'reroll', options: { giveaway: gid } });
  await cmd.execute(again);
  assert.match(textOf(again.calls[0]), /nobody left/);
});

test('bonus role really doubles the odds', async () => {
  const g = { guildId: 'g1', entries: ['amy', 'bob'], bonusRoleId: 'booster', requirements: {} };
  let amyWins = 0;
  for (let k = 0; k < 600; k++) if ((await G.draw(guild, g, 1))[0] === 'amy') amyWins++;
  assert.ok(amyWins > 330 && amyWins < 470, `amy won ${amyWins}/600, expected about 400`);
});

test('cancel and list', async () => {
  await cmd.execute(ix({ sub: 'start', options: { prize: 'Cool Hat', duration: '2h' } }));
  const id = [...messages.keys()].at(-1);
  const l = ix({ sub: 'list' });
  await cmd.execute(l);
  assert.match(textOf(l.calls[0]), /Cool Hat\*\* · ends/);
  const c = ix({ sub: 'cancel', options: { giveaway: id } });
  await cmd.execute(c);
  assert.match(textOf(c.calls[0]), /was cancelled/);
  assert.match(textOf(messages.get(id).content), /cancelled/);
  assert.equal((await store.giveaways.get(id)).ended, true);
});
