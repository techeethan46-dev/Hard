import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

process.env.DISCORD_TOKEN = 'x';
globalThis.fetch = async (url) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  url = String(url);
  if (url.includes('/universes/v1/places/920587237/universe')) return ok({ universeId: 994732206 });
  if (url.includes('games.roblox.com/v1/games?universeIds=994732206')) return ok({ data: [{ name: 'Cool Game', playing: 5 }] });
  if (url.includes('groups.roblox.com/v1/groups/4199740')) return ok({ id: 4199740, name: 'Cool Group' });
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
  id: 'g1',
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
const desc = (call) => call.p.embeds[0].toJSON().description;
const customIds = (msg) => msg.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id).filter(Boolean));

test('every step and the overview render valid Discord components with unique IDs', async () => {
  for (let step = 0; step <= STEPS.length; step++) {
    const msg = await render(guild, step);
    msg.components.forEach((r) => r.toJSON());
    const ids = customIds(msg);
    assert.equal(new Set(ids).size, ids.length, `duplicate button ID on step ${step}`);
  }
});

test('/setup starts at step 1 on a fresh server', async () => {
  const x = i(undefined);
  await setup.execute(x);
  assert.match(desc(x.calls[0]), /Verified role/);
  assert.match(x.calls[0].p.embeds[0].toJSON().title, /Step 1 of/);
});

test('picking a role saves it and moves to the next step', async () => {
  const x = i('setup:set:0', { values: ['verified'] });
  await setup.handleSelect(x);
  assert.equal((await getSettings('g1')).verifiedRole, 'verified');
  assert.match(x.calls[0].p.embeds[0].toJSON().title, /Step 2 of/);
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

test('group link works with the new "communities" URLs', async () => {
  const step = STEPS.findIndex((s) => s.key === 'groupId');
  await setup.handleModal(i(`setup:link:${step}`, { fields: { getTextInputValue: () => 'https://www.roblox.com/communities/4199740/Cool-Group#!/about' } }));
  assert.equal((await getSettings('g1')).groupName, 'Cool Group');
});

test('rank roles: add, validate, replace, remove', async () => {
  const step = STEPS.findIndex((s) => s.key === 'rankBindings');
  const ranks = (min, max) => ({ fields: { getTextInputValue: (k) => (k === 'min' ? min : max) } });

  const pick = i(`setup:bindrole:${step}`, { values: ['staff'] });
  await setup.handleSelect(pick);
  assert.equal(pick.calls[0].kind, 'showModal');

  const wrong = i(`setup:bind:${step}:staff`, ranks('250', '10'));
  await setup.handleModal(wrong);
  assert.match(desc(wrong.calls[0]), /lowest first/);

  await setup.handleModal(i(`setup:bind:${step}:staff`, ranks('200', '254')));
  await setup.handleModal(i(`setup:bind:${step}:verified`, ranks('1', '255')));
  await setup.handleModal(i(`setup:bind:${step}:staff`, ranks('100', '254'))); // replaces the first staff one
  assert.deepEqual((await getSettings('g1')).rankBindings, [
    { roleId: 'verified', minRank: 1, maxRank: 255 },
    { roleId: 'staff', minRank: 100, maxRank: 254 },
  ]);

  await setup.handleSelect(i(`setup:unbind:${step}`, { values: ['0'] }));
  assert.deepEqual((await getSettings('g1')).rankBindings.map((b) => b.roleId), ['staff']);
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
  assert.match(x.calls[0].p.content, /Manage Server/);
});
