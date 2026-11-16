import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { customIds, isV2, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';

const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
await (await import('../src/lib/settings.js')).updateSettings('g1', { ticketCategory: 'cat', ticketLogChannel: 'log', supportRoles: ['support'] });
const ticket = await import('../src/commands/ticket.js');
const panel = await import('../src/commands/panel.js');

const logSent = [];
const dms = [];
const channels = new Map();
const guild = {
  id: 'g1', name: 'Test Server', iconURL: () => 'https://cdn.example/icon.png',
  roles: { everyone: { id: 'g1' } },
  members: { me: { id: 'bot' } },
  channels: {
    cache: channels,
    fetch: async (id) => (id === 'log' ? { isTextBased: () => true, send: async (m) => logSent.push(m) } : channels.get(id)),
    create: async (opts) => {
      const ch = {
        id: 'c' + (channels.size + 1), name: opts.name, opts, sent: [], deleted: false,
        send: async (m) => { ch.sent.push(m); },
        delete: async () => { ch.deleted = true; channels.delete(ch.id); },
        messages: {
          fetch: async ({ before }) => before ? new Collection() : new Collection([['m1', {
            content: 'my game is broken', embeds: [], attachments: new Collection(),
            createdAt: new Date('2026-01-01T00:00:00Z'), author: { tag: 'player#0' },
          }]]),
        },
      };
      channels.set(ch.id, ch);
      return ch;
    },
  },
};

function member(id, { staff = false } = {}) {
  return {
    id, guild,
    permissions: { has: () => false },
    roles: { cache: { has: (r) => staff && r === 'support' } },
  };
}

function interaction(user, extra = {}) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  return {
    calls, guild, guildId: 'g1', memberPermissions: { has: () => false },
    user: { id: user.id, tag: `${user.id}#0`, toString: () => `<@${user.id}>`, displayAvatarURL: () => 'https://cdn.example/a.png' },
    member: user,
    client: { users: { fetch: async (id) => ({ send: async (m) => dms.push({ id, m }), displayAvatarURL: () => 'https://cdn.example/a.png' }) } },
    isButton: () => Boolean(extra.button), deferred: false, replied: false,
    reply: rec('reply'), deferReply: async (p) => { calls.push({ kind: 'deferReply', p }); }, editReply: rec('editReply'),
    followUp: rec('followUp'), update: rec('update'), showModal: rec('showModal'), deleteReply: rec('deleteReply'),
    ...extra,
  };
}

test('ticket panel has one button per configured type', async () => {
  const posted = [];
  const i = interaction(member('admin'), {
    options: { getChannel: () => null, getSubcommand: () => 'tickets' },
    channel: { send: async (m) => posted.push(m), toString: () => '#help' },
  });
  await panel.execute(i);
  assert.ok(isV2(posted[0]));
  const ids = customIds(posted[0]);
  assert.deepEqual(ids, ['ticket:open:support', 'ticket:open:report', 'ticket:open:bug', 'ticket:open:purchase']);
});

test('open -> form -> private channel -> claim -> close with transcript', async () => {
  const player = member('p1');
  // 1. Click "Report a Player": shows the form
  const click = interaction(player, { customId: 'ticket:open:report', button: true });
  await ticket.handleButton(click);
  const form = click.calls[0].p.toJSON();
  assert.equal(click.calls[0].kind, 'showModal');
  assert.equal(form.components.length, 3);

  // 2. Submit the form: creates a private channel
  const answers = { q0: 'BadGuy123', q1: 'He was exploiting', q2: '' };
  const submit = interaction(player, { customId: 'ticket:form:report', fields: { getTextInputValue: (k) => answers[k] } });
  await ticket.handleModal(submit);
  const ch = [...channels.values()][0];
  assert.equal(ch.name, 'report-0001');
  assert.equal(ch.opts.parent, 'cat');
  const everyone = ch.opts.permissionOverwrites.find((o) => o.id === 'g1');
  assert.deepEqual(everyone.deny, [PermissionFlagsBits.ViewChannel]);
  assert.ok(ch.opts.permissionOverwrites.some((o) => o.id === 'p1'));
  assert.ok(ch.opts.permissionOverwrites.some((o) => o.id === 'support'));
  const card = textOf(ch.sent[0]);
  assert.match(card, /<@p1>/); // pings the member
  assert.match(card, /> BadGuy123/);
  assert.match(card, /No answer/); // optional evidence left blank
  assert.deepEqual(ch.sent[0].allowedMentions, { users: ['p1'], roles: ['support'] });
  assert.equal((await store.tickets.get(ch.id)).ownerId, 'p1');

  // 3. A second ticket from the same member is refused
  const again = interaction(player, { customId: 'ticket:open:bug', button: true });
  await ticket.handleButton(again);
  assert.match(JSON.stringify(again.calls[0].p), /already have an open ticket/);

  // 4. Player can't claim; staff can
  const notStaff = interaction(player, { customId: 'ticket:claim', button: true, channelId: ch.id, channel: ch });
  await ticket.handleButton(notStaff);
  assert.match(JSON.stringify(notStaff.calls[0].p), /Only staff/);
  const staff = interaction(member('s1', { staff: true }), { customId: 'ticket:claim', button: true, channelId: ch.id, channel: ch });
  await ticket.handleButton(staff);
  assert.equal((await store.tickets.get(ch.id)).claimedBy, 's1');
  const claimedCard = staff.calls[0].p;
  assert.match(textOf(claimedCard), /<@s1> is helping you/);
  assert.ok(isV2(claimedCard));

  // 5. Owner closes: transcript to log channel + DM, channel deleted
  const close = interaction(player, { customId: 'ticket:confirmclose', button: true, channelId: ch.id, channel: ch });
  await ticket.handleButton(close);
  assert.equal(logSent.length, 1);
  assert.ok(isV2(logSent[0]), 'log uses the card layout');
  const logJson = JSON.stringify(logSent[0].components.map((c) => c.toJSON()));
  assert.match(logJson, /"type":13/); // file component
  assert.match(logJson, /attachment:\/\/report-0001\.txt/);
  assert.match(textOf(logSent[0]), /Ticket #0001 closed/);
  assert.match(textOf(logSent[0]), /Claimed by\*\* <@s1>/);
  assert.match(textOf(dms[0].m), /Thanks for reaching out/);
  const transcript = logSent[0].files[0].attachment.toString();
  assert.match(transcript, /player#0: my game is broken/);
  assert.equal(dms[0].id, 'p1');
  assert.ok(!(await store.tickets.get(ch.id)));
  await new Promise((r) => setTimeout(r, 5100));
  assert.ok(ch.deleted);
});
