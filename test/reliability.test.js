import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';
import { isV2, json, textOf } from './helpers.js';

// Fake secrets, built from pieces on purpose: written out whole they look real and GitHub's secret scanning blocks the push.
process.env.DISCORD_TOKEN = ['NzkyMDE5MjgzMzI5Mzk5NDI0', 'GabcDE', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');
process.env.MONGODB_URI = ['mongodb+srv:', '', 'botuser:SuperSecretPass@cluster0.abcde.mongodb.net/?retryWrites=true'].join('/');
const { initStore } = await import('../src/lib/store.js');
await initStore({ mongoUri: '', jsonPath: null }); // in memory, whatever the environment says
const { updateSettings } = await import('../src/lib/settings.js');
const E = await import('../src/lib/errors.js');
const { register } = await import('../src/lib/register.js');

// ---------------------------------------------------------------- safer startup

test('registering commands never throws: a refusal from Discord is reported, not fatal', async () => {
  const ok = await register({ put: async (route, o) => { assert.equal(route, '/cmds'); assert.deepEqual(o.body, [{ name: 'x' }]); } }, '/cmds', [{ name: 'x' }]);
  assert.deepEqual(ok, { ok: true });
  const refused = await register({ put: async () => { throw new Error('You are being rate limited'); } }, '/cmds', []);
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /rate limited/);
});

// ---------------------------------------------------------------- error alerts

test('secrets are scrubbed from alerts', () => {
  const dirty = `Failed with token ${process.env.DISCORD_TOKEN} and ${process.env.MONGODB_URI} and ${['mongodb:', '', 'a:b@host/db'].join('/')} end`;
  const clean = E.redact(dirty);
  for (const secret of ['NzkyMDE5', 'SuperSecretPass', 'cluster0.abcde', 'mongodb://a:b']) assert.ok(!clean.includes(secret), secret);
  assert.match(clean, /Failed with token \[hidden\] and \[hidden\] and \[hidden\] end/);
  // a token-shaped string is scrubbed even if it isn't ours; ordinary text is left alone
  assert.equal(E.redact('abcdefghijklmnopqrst.abcdef.abcdefghijklmnopqrst'), '[hidden]');
  assert.equal(E.redact('at async Object.run (file:///opt/render/project/src/index.js:12:3)'), 'at async Object.run (file:///opt/render/project/src/index.js:12:3)');
});

const posts = { a: [], b: [] };
const chan = (name, fail = false) => ({ send: async (m) => { if (fail) throw new Error('Missing Access'); posts[name].push(m); } });
const client = {
  guilds: { cache: new Map([
    ['g1', { channels: { fetch: async () => chan('a') } }],
    ['g2', { channels: { fetch: async () => chan('b') } }],
    ['g3', { channels: { fetch: async () => chan('a') } }], // no alert channel set
  ]) },
};
await updateSettings('g1', { errorLogChannel: 'alerts' });
await updateSettings('g2', { errorLogChannel: 'alerts' });

test('an error is posted to the alert channel as a valid card, without secrets', async () => {
  E.resetErrorReports();
  const err = new Error(`Mongo said no: ${process.env.MONGODB_URI}`);
  await E.reportError(client, { where: '/giveaway', error: err, guildId: 'g1', user: 'kenji' });
  assert.equal(posts.a.length, 1);
  assert.equal(posts.b.length, 0, 'only the server it happened in');
  const card = posts.a[0];
  assert.ok(isV2(card));
  json(card);
  const t = textOf(card);
  assert.match(t, /⚠️ Something broke\n\*\*Where\*\* \/giveaway\n\*\*Error\*\* Mongo said no: \[hidden\]\n\*\*Who\*\* kenji/);
  assert.doesNotMatch(t, /SuperSecretPass/);
  assert.match(t, /```\n/); // a few lines of where it happened
});

test('the same error is muted, different ones are not, and the rate is capped', async () => {
  E.resetErrorReports();
  const before = posts.a.length;
  const same = new Error('Boom');
  for (let i = 0; i < 4; i++) await E.reportError(client, { where: '/rank', error: same, guildId: 'g1' });
  assert.equal(posts.a.length, before + 1);
  await E.reportError(client, { where: '/rank', error: new Error('Different'), guildId: 'g1' });
  assert.equal(posts.a.length, before + 2);

  // a flood of distinct errors: at most 5 a minute
  for (let i = 0; i < 20; i++) await E.reportError(client, { where: '/x', error: new Error(`flood ${i}`), guildId: 'g1' });
  assert.equal(posts.a.length, before + 5);
});

test('an error with no server goes to every server that has an alert channel', async () => {
  E.resetErrorReports();
  const a = posts.a.length;
  const b = posts.b.length;
  await E.reportError(client, { where: 'Background task', error: new Error('Unhandled thing') });
  assert.equal(posts.a.length, a + 1); // g1 (g3 has no channel set, so nothing more)
  assert.equal(posts.b.length, b + 1);
});

test('reporting can never throw, even when the channel refuses', async () => {
  E.resetErrorReports();
  const broken = { guilds: { cache: new Map([['g1', { channels: { fetch: async () => chan('a', true) } }]]) } };
  await E.reportError(broken, { where: '/x', error: new Error('e1'), guildId: 'g1' });
  await E.reportError({ guilds: null }, { where: '/x', error: new Error('e2') });
  await E.reportError(client, { where: '/x', error: null });
});

test('a command that crashes: the member gets a friendly message and the staff get an alert', async () => {
  E.resetErrorReports();
  const { execute } = await import('../src/events/interactionCreate.js');
  const replies = [];
  const interaction = {
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false, isAnySelectMenu: () => false,
    commandName: 'rank', guildId: 'g1', user: { username: 'amy' }, client, deferred: false, replied: false,
    reply: async (p) => replies.push(p),
  };
  const commands = new Map([['rank', { execute: async () => { throw new Error('Database is down'); } }]]);
  const before = posts.a.length;
  const originalError = console.error;
  console.error = () => {};
  await execute(interaction, commands);
  console.error = originalError;
  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.match(textOf(replies[0]), /Something went wrong/);
  assert.equal(posts.a.length, before + 1);
  assert.match(textOf(posts.a.at(-1)), /\*\*Where\*\* \/rank\n\*\*Error\*\* Database is down\n\*\*Who\*\* amy/);
});

// ---------------------------------------------------------------- setup

test('/setup has the two new Safety steps and they render', async () => {
  const setup = await import('../src/commands/setup.js');
  const guild = {
    id: 'g1', name: 'T', iconURL: () => null, roles: { cache: new Map() }, channels: { cache: new Map() },
    members: { me: { roles: { highest: { position: 10 } }, permissions: new PermissionsBitField(PermissionsBitField.All) } },
  };
  for (const key of ['automodMode', 'errorLogChannel']) {
    const step = setup.STEPS.findIndex((s) => s.key === key);
    assert.ok(step >= 0, key);
    json(await setup.render(guild, step));
  }
  const mode = textOf(await setup.render(guild, setup.STEPS.findIndex((s) => s.key === 'automodMode')));
  assert.match(mode, /using the default: Delete and punish/);
  assert.match(mode, /Trial/);
});
