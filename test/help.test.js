import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
const { loadCommands } = await import('../src/lib/loader.js');
const help = await import('../src/commands/help.js');
const commands = await loadCommands();

const ALL = new PermissionsBitField(PermissionsBitField.All);
const NOBODY = new PermissionsBitField(0n);
const MOD = new PermissionsBitField(PermissionFlagsBits.ModerateMembers);

const pages = (perms) => ['home', ...help.visibleCategories(commands, perms).map((c) => c.id)]
  .map((id) => help.helpMessage(commands, perms, 'Rocart League Helper', id));
const everything = (perms) => pages(perms).map(textOf).join('\n');

test('every command the bot has is in /help for an admin, so none can be forgotten', () => {
  const t = everything(ALL);
  for (const name of commands.keys()) {
    if (name === 'help') continue;
    assert.ok(t.includes(`**/${name}**`), `/${name} is missing from /help`);
  }
  assert.ok(t.includes('**r!afk <reason>**'));
});

test('every page is a valid private card with the category menu', () => {
  for (const msg of pages(ALL)) {
    assert.ok(isV2(msg) && msg.flags & 64);
    json(msg);
    assert.deepEqual(customIds(msg), ['help:pick']);
  }
  const home = textOf(help.helpMessage(commands, ALL, 'Rocart League Helper'));
  assert.match(home, /## 📖 Rocart League Helper · Help/);
  assert.match(home, /🙋 \*\*Getting started\*\* · 6 commands/); // 5 slash commands + r!afk
  assert.match(home, /🛡️ \*\*Moderation\*\* · 8 commands/);
});

test('sub-commands are listed under their command', () => {
  const t = textOf(help.helpMessage(commands, ALL, 'Bot', 'community'));
  assert.match(t, /\*\*\/giveaway\*\* · Run giveaways\n-# start · end · reroll · cancel · list/);
  assert.match(t, /\*\*\/message\*\*[\s\S]*-# create · edit · welcome/);
});

test('members only see commands they can use', () => {
  const t = everything(NOBODY);
  for (const shown of ['/verify', '/rank', '/leaderboard', '/streak', '/game', '/suggest', '/whois', '/ticket']) assert.ok(t.includes(`**${shown}**`), shown);
  for (const shown of ['/balance', '/daily', '/pay', '/shop', '/coinflip', '/slots', '/blackjack', '/roulette']) assert.ok(t.includes(`**${shown}**`), shown);
  for (const hidden of ['/economy', '/ban', '/kick', '/warn', '/setup', '/panel', '/giveaway', '/xp', '/streak-admin', '/message', '/raidmode', '/purge']) {
    assert.ok(!t.includes(`**${hidden}**`), `${hidden} should be hidden from members`);
  }
  assert.ok(t.includes('r!afk'));
  assert.ok(t.includes('Support tickets'));

  // the menu has no empty categories
  const menu = JSON.stringify(json(help.helpMessage(commands, NOBODY, 'Bot')));
  assert.doesNotMatch(menu, /"value":"mod"/);
  assert.doesNotMatch(menu, /"value":"setup"/);
});

test('a moderator sees the moderation commands they can use but not admin ones', () => {
  const t = everything(MOD);
  assert.ok(t.includes('**/warn**') && t.includes('**/timeout**'));
  assert.ok(!t.includes('**/ban**'), 'ban needs a different permission');
  assert.ok(!t.includes('**/setup**'));
});

test('a command nobody categorised still shows up under Other', () => {
  const fake = new Map([...commands, ['zzz', { data: new SlashCommandBuilder().setName('zzz').setDescription('A brand new command') }]]);
  const t = textOf(help.helpMessage(fake, ALL, 'Bot', 'other'));
  assert.match(t, /## 📦 Other/);
  assert.match(t, /\*\*\/zzz\*\* · A brand new command/);
});

test('/help replies privately, and the menu switches pages', async () => {
  const calls = [];
  const base = { memberPermissions: NOBODY, client: { user: { username: 'Rocart League Helper' } }, reply: async (p) => calls.push(['reply', p]), update: async (p) => calls.push(['update', p]) };
  await help.execute({ ...base });
  assert.equal(calls[0][0], 'reply');
  assert.ok(calls[0][1].flags & 64);

  await help.handleSelect({ ...base, values: ['levels'] });
  const [kind, page] = calls[1];
  assert.equal(kind, 'update');
  assert.ok(!(page.flags & 64), 'the message is already private; the update doesn\'t resend that flag');
  assert.match(textOf(page), /## ⭐ Levels & streaks[\s\S]*\*\*\/rank\*\*/);
  assert.doesNotMatch(textOf(page), /\/streak-admin/); // admin only

  await help.handleSelect({ ...base, values: ['home'] });
  assert.match(textOf(calls[2][1]), /Pick a category below/);
});
