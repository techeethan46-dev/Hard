import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
globalThis.fetch = async (url) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  url = String(url);
  if (url.includes('/universes/v1/places/920587237/universe')) return ok({ universeId: 994732206 });
  if (url.includes('games.roblox.com/v1/games?universeIds=994732206')) return ok({ data: [{ name: 'Cool Game', playing: 5 }] });
  return { ok: false, status: 404 };
};

const { initStore } = await import('../src/lib/store.js');
await initStore({ jsonPath: null });
const { getSettings } = await import('../src/lib/settings.js');
const setup = await import('../src/commands/setup.js');
const { STEPS, render, checks } = setup;

const ALL = new PermissionsBitField(PermissionsBitField.All);
const role = (id, position) => ({ id, name: id, position });
const guild = {
  id: 'g1', name: 'Test Server', iconURL: () => 'https://cdn.example/icon.png',
  roles: { cache: new Map([['verified', role('verified', 1)], ['staff', role('staff', 2)], ['owner', role('owner', 50)]]) },
  channels: { cache: new Map([['welcome', { id: 'welcome', permissionsFor: () => ALL }], ['cat', { id: 'cat', permissionsFor: () => ALL }]]) },
  members: { me: { roles: { highest: { position: 10 } }, permissions: ALL } },
};

function i(customId, extra = {}) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  return {
    calls, customId, guild, guildId: 'g1',
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    update: rec('update'), reply: rec('reply'), showModal: rec('showModal'), deferUpdate: rec('deferUpdate'), editReply: rec('editReply'),
    ...extra,
  };
}
const desc = (call) => textOf(call.p);

test('every step and the overview render valid Discord components with unique IDs', async () => {
  for (let step = 0; step <= STEPS.length; step++) {
    const msg = await render(guild, step);
    assert.ok(isV2(msg));
    json(msg); // throws if Discord would reject a component
    const ids = customIds(msg);
    assert.equal(new Set(ids).size, ids.length, `duplicate button ID on step ${step}`);
  }
});

test('/setup starts at step 1 on a fresh server', async () => {
  const x = i(undefined);
  await setup.execute(x);
  assert.match(desc(x.calls[0]), /Verified role/);
  assert.match(desc(x.calls[0]), /STEP 1 OF/);
  assert.ok(x.calls[0].p.flags & 64, 'ephemeral');
});

test('steps have Back / Next / Clear only (no Overview button)', async () => {
  for (let step = 0; step < STEPS.length; step++) {
    const msg = await render(guild, step);
    const labels = buttonLabels(msg).filter((l) => ['Back', 'Next', 'Clear', 'Overview'].includes(l));
    assert.deepEqual(labels, ['Back', 'Next', 'Clear']);
  }
  assert.ok(!STEPS.some((s) => /group/i.test(s.title)));
});

test('picking a role saves it and moves to the next step', async () => {
  const x = i('setup:set:0', { values: ['verified'] });
  await setup.handleSelect(x);
  assert.equal((await getSettings('g1')).verifiedRole, 'verified');
  assert.match(desc(x.calls[0]), /STEP 2 OF/);
});

test('game link is checked with Roblox and saved with its name', async () => {
  const step = STEPS.findIndex((s) => s.key === 'placeId');
  const bad = i(`setup:link:${step}`, { fields: { getTextInputValue: () => 'not a link' } });
  await setup.handleModal(bad);
  assert.match(desc(bad.calls.at(-1)), /Couldn't find that game/);

  const good = i(`setup:link:${step}`, { fields: { getTextInputValue: () => 'https://www.roblox.com/games/920587237/Cool-Game' } });
  await setup.handleModal(good);
  const s = await getSettings('g1');
  assert.equal(s.placeId, '920587237');
  assert.equal(s.gameName, 'Cool Game');
});



test('clear removes a setting', async () => {
  await setup.handleButton(i('setup:clear:0'));
  assert.equal((await getSettings('g1')).verifiedRole, undefined);
});

test('checks catch a role above the bot and a deleted channel', async () => {
  const problems = checks(guild, { verifiedRole: 'owner', modLogChannel: 'gone' }).join('\n');
  assert.match(problems, /Drag the bot's role \*\*above\*\* <@&owner>/);
  assert.match(problems, /Mod log channel\*\* was deleted/);
  assert.deepEqual(checks(guild, { verifiedRole: 'verified', welcomeChannel: 'welcome' }), []);
});

test('only Manage Server members can use the menus', async () => {
  const x = i('setup:clear:0', { memberPermissions: new PermissionsBitField(0n) });
  await setup.handleButton(x);
  assert.equal(x.calls[0].kind, 'reply');
  assert.match(textOf(x.calls[0].p), /Manage Server/);
});

test('level rewards: add with a level, validate, remove', async () => {
  const step = STEPS.findIndex((s) => s.key === 'levelRewards');
  const pick = i(`setup:rewardrole:${step}`, { values: ['staff'] });
  await setup.handleSelect(pick);
  assert.equal(pick.calls[0].kind, 'showModal');

  const lvl = (v) => ({ fields: { getTextInputValue: () => v } });
  const bad = i(`setup:reward:${step}:staff`, lvl('abc'));
  await setup.handleModal(bad);
  assert.match(desc(bad.calls[0]), /whole number from 1 to 500/);

  await setup.handleModal(i(`setup:reward:${step}:staff`, lvl('20')));
  await setup.handleModal(i(`setup:reward:${step}:verified`, lvl('5')));
  assert.deepEqual((await getSettings('g1')).levelRewards, [{ roleId: 'verified', level: 5 }, { roleId: 'staff', level: 20 }]);
  const shown = await render(guild, step);
  json(shown);
  assert.match(textOf(shown), /Level \*\*5\*\* → <@&verified>, Level \*\*20\*\* → <@&staff>/);

  await setup.handleSelect(i(`setup:unreward:${step}`, { values: ['verified'] }));
  assert.deepEqual((await getSettings('g1')).levelRewards, [{ roleId: 'staff', level: 20 }]);
});

test('streak timezone is picked from a list', async () => {
  const step = STEPS.findIndex((s) => s.key === 'streakTimezone');
  assert.match(textOf(await render(guild, step)), /Not set · using UTC/);
  await setup.handleSelect(i(`setup:set:${step}`, { values: ['America/New_York'] }));
  assert.equal((await getSettings('g1')).streakTimezone, 'America/New_York');
  assert.match(textOf(await render(guild, step)), /US Eastern \(New York\)/);
});

test('streak roles: add with days, validate, remove; and the keep/remove choice', async () => {
  const step = STEPS.findIndex((x) => x.key === 'streakRewards');
  const pick = i(`setup:rewardrole:${step}`, { values: ['staff'] });
  await setup.handleSelect(pick);
  assert.equal(pick.calls[0].kind, 'showModal');
  assert.match(JSON.stringify(pick.calls[0].p.toJSON()), /Days of streak needed \(1-3650\)/);

  const val = (v) => ({ fields: { getTextInputValue: () => v } });
  const bad = i(`setup:reward:${step}:staff`, val('abc'));
  await setup.handleModal(bad);
  assert.match(desc(bad.calls[0]), /number of days must be a whole number from 1 to 3650/);
  const tooBig = i(`setup:reward:${step}:staff`, val('3651'));
  await setup.handleModal(tooBig);
  assert.match(desc(tooBig.calls[0]), /from 1 to 3650/);

  await setup.handleModal(i(`setup:reward:${step}:staff`, val('30')));
  await setup.handleModal(i(`setup:reward:${step}:verified`, val('7')));
  assert.deepEqual((await getSettings('g1')).streakRewards, [{ roleId: 'verified', days: 7 }, { roleId: 'staff', days: 30 }]);
  const shown = await render(guild, step);
  json(shown);
  assert.match(textOf(shown), /\*\*7\*\* days → <@&verified>, \*\*30\*\* days → <@&staff>/);
  assert.match(JSON.stringify(json(shown)), /7 days → @verified/);

  await setup.handleSelect(i(`setup:unreward:${step}`, { values: ['verified'] }));
  assert.deepEqual((await getSettings('g1')).streakRewards, [{ roleId: 'staff', days: 30 }]);
  // level rewards are separate and unaffected
  assert.notDeepEqual((await getSettings('g1')).levelRewards, (await getSettings('g1')).streakRewards);

  const keep = STEPS.findIndex((x) => x.key === 'streakRolesKeep');
  assert.match(textOf(await render(guild, keep)), /using the default: Take the streak roles away/);
  await setup.handleSelect(i(`setup:set:${keep}`, { values: ['keep'] }));
  assert.equal((await getSettings('g1')).streakRolesKeep, 'keep');
  assert.match(textOf(await render(guild, keep)), /✅ Let them keep the roles/);
});
