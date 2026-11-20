import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.DISCORD_TOKEN = 'x';
process.env.ROBLOX_OAUTH_CLIENT_ID = 'cid';
process.env.ROBLOX_OAUTH_CLIENT_SECRET = 'secret';
process.env.PUBLIC_URL = 'https://bot.example.com/';

const sent = [];
globalThis.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), opts });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).endsWith('/oauth/v1/token')) {
    const payload = Buffer.from(JSON.stringify({ sub: '1001' })).toString('base64url');
    return ok({ access_token: 'tok', id_token: `x.${payload}.sig` });
  }
  if (String(url).endsWith('/oauth/v1/userinfo')) return ok({ sub: '1001', preferred_username: 'builderman', nickname: 'Builder' });
  if (String(url).includes('users.roblox.com/v1/users/1001')) return ok({ id: 1001, name: 'builderman', displayName: 'Builder' });
  throw new Error('unexpected ' + url);
};

const { oauthEnabled } = await import('../src/config.js');
const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
await (await import('../src/lib/settings.js')).updateSettings('g1', { verifiedRole: 'r-verified' });
const { createAuthUrl } = await import('../src/lib/oauth.js');
const { handleCallback, POLICY } = await import('../src/web/server.js');

function fakeClient() {
  const held = new Set();
  const member = {
    id: 'd1', nickname: null, manageable: true,
    guild: { id: 'g1', ownerId: 'o', roles: { cache: new Map([['r-verified', { id: 'r-verified', position: 1 }]]) }, members: { me: { roles: { highest: { position: 5 } } } } },
    roles: { cache: { has: (r) => held.has(r) }, add: async (r) => held.add(r), remove: async (r) => held.delete(r) },
    setNickname: async (n) => { member.nickname = n; },
  };
  return { member, held, client: { guilds: { fetch: async () => ({ members: { fetch: async () => member } }) } } };
}

test('OAuth is enabled and builds a PKCE sign-in URL', () => {
  assert.ok(oauthEnabled());
  const url = new URL(createAuthUrl({ discordId: 'd1', guildId: 'g1' }));
  assert.equal(url.origin + url.pathname, 'https://apis.roblox.com/oauth/v1/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://bot.example.com/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid');
});

test('callback links the account, gives roles, and the link only works once', async () => {
  const { client, member, held } = fakeClient();
  let done;
  const url = new URL(createAuthUrl({ discordId: 'd1', guildId: 'g1', onDone: async (r) => { done = r; } }));
  const state = url.searchParams.get('state');

  const [status, html] = await handleCallback(client, new URLSearchParams({ state, code: 'abc' }));
  assert.equal(status, 200);
  assert.match(html, /verified/);
  assert.equal((await store.links.get('d1')).robloxId, 1001);
  assert.ok(held.has('r-verified'));
  assert.equal(member.nickname, 'Builder (@builderman)');
  assert.equal(done.username, 'builderman');

  // PKCE verifier sent matches the challenge in the URL
  const body = new URLSearchParams(sent.find((s) => s.url.endsWith('/token')).opts.body);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));

  const [again] = await handleCallback(client, new URLSearchParams({ state, code: 'abc' }));
  assert.equal(again, 400);
});

test('forged state or cancelled sign-in does nothing', async () => {
  const { client } = fakeClient();
  await store.links.delete('d1');
  assert.equal((await handleCallback(client, new URLSearchParams({ state: 'fake', code: 'x' })))[0], 400);
  assert.equal((await handleCallback(client, new URLSearchParams({ error: 'access_denied' })))[0], 400);
  assert.ok(!(await store.links.get('d1')));
});

// Roblox's review asks for terms of use that say these things.
test('the terms page says what Roblox requires: between you and us only, Roblox not affiliated, responsible or supporting it, claims waived', () => {
  const [title, html] = POLICY['/terms'];
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.equal(title, 'Terms of use');
  assert.match(t, /between you .* and the staff of this community only/);
  assert.match(t, /not a contract with Roblox/);
  assert.match(t, /Roblox Corporation is not affiliated with this service, does not endorse or sponsor it, is not responsible for it, and provides no support for it/);
  assert.match(t, /you waive any claims against Roblox Corporation/);
  assert.match(t, /only receive your Roblox user ID/, 'matches what the app really reads (openid only)');
  assert.doesNotMatch(t, /public Roblox profile/);
  assert.match(t, /trademark of Roblox Corporation/);
});
