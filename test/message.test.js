import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
const C = await import('../src/lib/compose.js');
const cmd = await import('../src/commands/message.js');
const { getSettings } = await import('../src/lib/settings.js');

// ---------------------------------------------------------------- what people type

test('colors', () => {
  assert.equal(C.parseColor('#5865F2').value, 0x5865f2);
  assert.equal(C.parseColor('ff8800').value, 0xff8800);
  assert.equal(C.parseColor('f80').value, 0xff8800);
  assert.equal(C.parseColor('Gold').value, 0xf7c948);
  assert.equal(C.parseColor('').value, null);
  assert.match(C.parseColor('banana').error, /isn't a color/);
});

test('picture links must be https; {avatar} is allowed', () => {
  assert.equal(C.parseImage('https://i.imgur.com/a.png').value, 'https://i.imgur.com/a.png');
  assert.equal(C.parseImage('{avatar}').value, '{avatar}');
  assert.equal(C.parseImage('').value, null);
  for (const bad of ['http://example.com/a.png', 'ftp://x/a.png', 'not a link', 'javascript:alert(1)', 'imgur.com/a.png']) {
    assert.match(C.parseImage(bad).error, /https:\/\//, bad);
  }
});

test('buttons: "Label | link" per line, up to 5', () => {
  const ok = C.parseButtons('Play now | https://www.roblox.com/games/123\nJoin the group | https://www.roblox.com/communities/9');
  assert.deepEqual(ok.value, [
    { label: 'Play now', url: 'https://www.roblox.com/games/123' },
    { label: 'Join the group', url: 'https://www.roblox.com/communities/9' },
  ]);
  assert.deepEqual(C.parseButtons('').value, []);
  for (const bad of ['Play', 'Play | http://insecure.com', '| https://x.com', 'Play | {avatar}']) assert.match(C.parseButtons(bad).error, /must look like/, bad);
  assert.match(C.parseButtons(Array(6).fill('A | https://x.com').join('\n')).error, /up to 5 buttons/);
});

// ---------------------------------------------------------------- showing it

const card = (extra = {}) => ({ type: 'card', text: '## Rules\n• Be kind', color: 0x5865f2, thumb: null, image: null, buttons: [], ...extra });
const banner = (extra = {}) => ({ type: 'banner', image: 'https://i.imgur.com/banner.png', color: 0xf7c948, ...extra });

test('blocks render as valid cards, with placeholders filled in', () => {
  const blocks = [
    banner(),
    card({ text: '### 👋 Welcome, {username}!\n{user} joined **{server}** (#{count})', thumb: '{avatar}', image: 'https://i.imgur.com/big.png',
      buttons: [{ label: 'Play', url: 'https://www.roblox.com/games/1' }] }),
  ];
  const msg = C.renderBlocks(blocks, { user: '<@7>', username: 'Seven', server: 'Wobble League', count: '1,234', avatar: 'https://cdn.discordapp.com/a.png' });
  assert.ok(isV2(msg));
  const out = json(msg);
  assert.equal(out.length, 2);
  assert.equal(out[0].accent_color, 0xf7c948);
  assert.match(textOf(msg), /### 👋 Welcome, Seven!\n<@7> joined \*\*Wobble League\*\* \(#1,234\)/);
  const raw = JSON.stringify(out);
  assert.match(raw, /banner\.png/);
  assert.match(raw, /big\.png/);
  assert.match(raw, /cdn\.discordapp\.com\/a\.png/);
  assert.deepEqual(buttonLabels(msg), ['Play']);
  assert.deepEqual(msg.allowedMentions, { parse: [] }, 'nobody gets pinged by default');
  assert.deepEqual(C.renderBlocks([card()], {}, { mentions: { users: ['7'] } }).allowedMentions, { users: ['7'] });
});

test('a picture whose placeholder has no value is simply left out', () => {
  const msg = C.renderBlocks([card({ thumb: '{servericon}' })], { servericon: '' });
  assert.doesNotMatch(JSON.stringify(json(msg)), /"type":11/);
  json(msg);
});

test('limits: characters, parts, blocks, empty', () => {
  assert.match(C.problem([]), /at least one/);
  assert.equal(C.problem([banner(), card()]), null);
  assert.match(C.problem([card({ text: 'x'.repeat(3801) })]), /Too long.*3,801/);
  assert.match(C.problem(Array(9).fill(card())), /up to 8 blocks/);
  const heavy = card({ thumb: '{avatar}', image: 'https://i.imgur.com/a.png', buttons: Array(5).fill({ label: 'x', url: 'https://x.com' }) });
  assert.match(C.problem([heavy, heavy, heavy, heavy]), /too many parts/);
});

// ---------------------------------------------------------------- the builder

const ADMIN = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
const M1 = '100000000000000001'; // the first message the fake channel sends
const sent = [];
const messages = new Map();
const channel = {
  id: 'rules', name: 'rules', isTextBased: () => true, toString: () => '<#rules>',
  send: async (m) => { const id = String(100000000000000000n + BigInt(messages.size + 1)); const msg = { id, url: `https://discord.com/channels/g1/rules/${id}`, edits: [], edit: async (e) => { msg.edits.push(e); } }; messages.set(id, msg); sent.push(m); return msg; },
  messages: { fetch: async (id) => { const m = messages.get(id); if (!m) throw new Error('Unknown Message'); return m; } },
};
const guild = {
  id: 'g1', name: 'Wobble League', memberCount: 150, iconURL: () => 'https://cdn.discordapp.com/i.png',
  channels: { fetch: async () => channel, cache: new Map([['rules', channel]]) },
};
const me = { id: 'admin', displayName: 'Admin', guild, user: { username: 'admin', displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' } };

function ix(opts = {}) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  const o = opts.options ?? {};
  return {
    calls, guild, guildId: 'g1', user: { id: opts.user ?? 'admin' }, member: me, memberPermissions: opts.perms ?? ADMIN, channel,
    options: { getSubcommand: () => opts.sub, getChannel: () => o.channel ?? null, getString: (k) => o[k] ?? null, getFocused: () => o.focused ?? '' },
    customId: opts.customId, values: opts.values, fields: { getTextInputValue: (k) => (opts.fields ?? {})[k] ?? '' },
    reply: rec('reply'), update: rec('update'), showModal: rec('showModal'), respond: rec('respond'),
  };
}
const last = (i) => i.calls.at(-1);
const shown = (i) => textOf(last(i).p);
const btn = async (id, opts = {}) => { const i = ix({ customId: `message:b:${id}`, ...opts }); await cmd.handleButton(i); return i; };
const modal = async (id, fields, opts = {}) => { const i = ix({ customId: `message:m:${id}`, fields, ...opts }); await cmd.handleModal(i); return i; };

test('create: an empty builder, private to you', async () => {
  const i = ix({ sub: 'create' });
  await cmd.execute(i);
  const p = last(i).p;
  assert.ok(isV2(p) && p.flags & 64, 'private card');
  json(p);
  assert.match(textOf(p), /MESSAGE BUILDER · will be posted in <#rules>/);
  assert.match(textOf(p), /Nothing yet/);
  assert.deepEqual(buttonLabels(p), ['Add card', 'Add banner', 'Preview', 'Post message', 'Cancel']);
  assert.ok(!customIds(p).includes('message:b:pick'), 'no block list yet');
});

test('adding a banner and cards, with helpful errors for bad input', async () => {
  const add = await btn('addcard');
  assert.equal(last(add).kind, 'showModal');
  assert.equal(last(add).p.toJSON().components.length, 5);
  assert.equal((await btn('addbanner')).calls[0].kind, 'showModal');

  const ok = await modal('banner:new', { image: 'https://i.imgur.com/banner.png', color: 'gold' });
  assert.match(shown(ok), /▶️ \*\*1\.\*\* 🖼️ Banner image/);
  assert.match(shown(ok), /0 \/ 3,800 characters/);
  json(last(ok).p);

  const errs = [
    [{ image: 'http://x.com/a.png' }, /https:\/\//],
    [{ image: '' }, /Paste a link/],
    [{ image: 'https://i.imgur.com/a.png', color: 'nope' }, /isn't a color/],
  ];
  for (const [fields, re] of errs) assert.match(shown(await modal('banner:new', fields)), re);

  const rules = '## 📜 WOBBLE LEAGUE · CONDUCT\n◈ **RESPECT**\n• Treat everyone with respect.';
  const c = await modal('card:new', { text: rules, color: '#5865F2', buttons: 'Play | https://www.roblox.com/games/1' });
  assert.match(shown(c), /▫️ \*\*1\.\*\* 🖼️ Banner image\n▶️ \*\*2\.\*\* 📄 📜 WOBBLE LEAGUE · CONDUCT · 74 chars/);

  for (const [fields, re] of [
    [{ text: '' }, /needs some text/],
    [{ text: 'hi', thumb: 'ftp://x' }, /small picture/],
    [{ text: 'hi', image: 'nope' }, /big picture/],
    [{ text: 'hi', buttons: 'Play' }, /must look like/],
    [{ text: 'x'.repeat(3801) }, /Too long/],
  ]) assert.match(shown(await modal('card:new', fields)), re);
  // none of the failed ones were added: still just the banner and one card
  const check = ix({ customId: 'message:b:pick', values: ['1'] });
  await cmd.handleSelect(check);
  assert.match(shown(check), /\*\*2\./);
  assert.doesNotMatch(shown(check), /\*\*3\./);
});

test('reorder, edit and delete blocks', async () => {
  const pick = ix({ customId: 'message:b:pick', values: ['0'] });
  await cmd.handleSelect(pick);
  assert.match(shown(pick), /▶️ \*\*1\.\*\* 🖼️/);
  assert.deepEqual(buttonLabels(last(pick).p).slice(0, 4), ['Edit', 'Up', 'Down', 'Delete']);
  const up = last(pick).p.components[0].toJSON().components.find((c) => c.type === 1 && c.components?.some((b) => b.label === 'Up'));
  assert.ok(up.components.find((b) => b.label === 'Up').disabled, 'the first block can\'t go up');

  assert.match(shown(await btn('down')), /▫️ \*\*1\.\*\* 📄 📜 WOBBLE[\s\S]*▶️ \*\*2\.\*\* 🖼️ Banner/);
  assert.match(shown(await btn('up')), /▶️ \*\*1\.\*\* 🖼️ Banner/);

  const edit = await btn('edit');
  assert.match(JSON.stringify(last(edit).p.toJSON()), /Edit banner/);
  const changed = await modal('banner:0', { image: 'https://i.imgur.com/new.png', color: '' });
  assert.match(shown(changed), /Banner image/);

  const extra = await modal('card:new', { text: '## Second card' });
  assert.match(shown(extra), /3\./);
  const del = await btn('del');
  assert.doesNotMatch(shown(del), /Second card/);
  assert.match(shown(del), /▶️ \*\*2\.\*\*/);
});

test('preview shows the real thing, privately', async () => {
  const i = await btn('preview');
  const p = last(i).p;
  assert.ok(isV2(p) && p.flags & 64);
  json(p);
  assert.match(textOf(p), /CONDUCT/);
  assert.match(JSON.stringify(json(p)), /new\.png/);
});

test('posting sends the message and remembers it so it can be edited', async () => {
  const i = await btn('finish');
  assert.equal(sent.length, 1);
  assert.ok(isV2(sent[0]));
  json(sent[0]);
  assert.match(textOf(sent[0]), /CONDUCT/);
  assert.match(shown(i), /Posted!/);
  assert.match(shown(i), /\/message edit/);
  const rec = await store.composed.get(M1);
  assert.equal(rec.channelId, 'rules');
  assert.equal(rec.blocks.length, 2);
  assert.equal(rec.authorId, 'admin');

  // the draft is gone
  const again = await btn('preview');
  assert.match(shown(again), /expired/);
});

test('/message edit: pick from the list, change, save', async () => {
  const ac = ix({ sub: 'edit', options: { focused: 'cond' } });
  await cmd.autocomplete(ac);
  assert.deepEqual(last(ac).p, [{ name: '#rules · 📜 WOBBLE LEAGUE · CONDUCT', value: M1 }]);
  const none = ix({ sub: 'edit', options: { focused: 'zzz' } });
  await cmd.autocomplete(none);
  assert.deepEqual(last(none).p, []);

  const e = ix({ sub: 'edit', options: { message: M1 } });
  await cmd.execute(e);
  assert.match(textOf(last(e).p), /EDITING A MESSAGE/);
  assert.deepEqual(buttonLabels(last(e).p).filter((l) => /Save|Post/.test(l)), ['Save changes']);

  await btn('pick', {}).catch(() => {});
  await cmd.handleSelect(ix({ customId: 'message:b:pick', values: ['1'] }));
  await modal('card:1', { text: '## 📜 UPDATED RULES\n• New rule', color: 'red' });
  const saved = await btn('finish');
  assert.match(shown(saved), /Saved/);
  const msg = messages.get(M1);
  assert.equal(msg.edits.length, 1);
  assert.match(textOf(msg.edits[0]), /UPDATED RULES/);
  assert.match((await store.composed.get(M1)).blocks[1].text, /UPDATED RULES/);
});

test('edit: a message from /message only, and a deleted one is forgotten', async () => {
  const unknown = ix({ sub: 'edit', options: { message: '123456789012345678' } });
  await cmd.execute(unknown);
  assert.match(textOf(last(unknown).p), /only edit messages made with `\/message create`/);

  await store.composed.create({ messageId: '999999999999999999', guildId: 'g1', channelId: 'rules', blocks: [card()], createdAt: 1 });
  const missing = ix({ sub: 'edit', options: { message: '999999999999999999' } });
  await cmd.execute(missing);
  assert.match(textOf(last(missing).p), /was deleted/);
  assert.equal(await store.composed.get('999999999999999999'), null);

  await store.composed.create({ messageId: '888888888888888888', guildId: 'other', channelId: 'rules', blocks: [card()], createdAt: 1 });
  const wrongServer = ix({ sub: 'edit', options: { message: '888888888888888888' } });
  await cmd.execute(wrongServer);
  assert.match(textOf(last(wrongServer).p), /only edit messages made with/);
});

test('posting problems are explained, and the draft is kept', async () => {
  await cmd.execute(ix({ sub: 'create' }));
  await modal('card:new', { text: 'hello' });
  const original = channel.send;
  channel.send = async () => { throw new Error('Missing Permissions'); };
  const i = await btn('finish');
  channel.send = original;
  assert.match(shown(i), /couldn't post in <#rules>: Missing Permissions/);
  assert.ok(buttonLabels(last(i).p).includes('Post message'), 'still in the builder');
  await btn('cancel');
});

test('only people with Manage Server can use the builder', async () => {
  await cmd.execute(ix({ sub: 'create' }));
  const nobody = new PermissionsBitField(0n);
  for (const i of [ix({ customId: 'message:b:finish', perms: nobody }), ix({ customId: 'message:m:card:new', perms: nobody, fields: { text: 'x' } })]) {
    await (i.customId.includes(':m:') ? cmd.handleModal(i) : cmd.handleButton(i));
    assert.match(shown(i), /Manage Server/);
  }
  await btn('cancel');
});

test('another person has their own builder', async () => {
  await cmd.execute(ix({ sub: 'create' }));
  await modal('card:new', { text: 'mine' });
  const other = ix({ customId: 'message:b:preview', user: 'someone-else' });
  await cmd.handleButton(other);
  assert.match(shown(other), /expired/);
  await btn('cancel');
});

// ---------------------------------------------------------------- the welcome message

test('/message welcome: starts from the standard welcome, saves your own, and can go back', async () => {
  const w = ix({ sub: 'welcome' });
  await cmd.execute(w);
  json(last(w).p);
  assert.match(textOf(last(w).p), /WELCOME MESSAGE/);
  assert.match(textOf(last(w).p), /Welcome, \{username\}!/);
  assert.match(textOf(last(w).p), /Placeholders: \{user\} \{username\} \{server\} \{count\} \{game\}/);
  assert.ok(buttonLabels(last(w).p).includes('Back to the default'));

  await modal('card:0', { text: 'Hey {username}, welcome to **{server}**! You are member #{count}.', color: 'green', thumb: '{avatar}' });
  const prev = await btn('preview');
  assert.match(textOf(last(prev).p), /Hey Admin, welcome to \*\*Wobble League\*\*! You are member #150\./);
  json(last(prev).p);

  const saved = await btn('finish');
  assert.match(shown(saved), /Welcome message saved/);
  assert.match(shown(saved), /Welcome channel/); // none picked yet
  const settings = await getSettings('g1');
  assert.equal(settings.welcomeMessage.length, 1);
  assert.match(settings.welcomeMessage[0].text, /Hey \{username\}/);

  // opening it again shows what you saved
  const again = ix({ sub: 'welcome' });
  await cmd.execute(again);
  assert.match(textOf(last(again).p), /Hey \{username\}/);

  const reset = await btn('reset');
  assert.match(shown(reset), /standard welcome card again/);
  assert.equal((await getSettings('g1')).welcomeMessage, undefined);
});
