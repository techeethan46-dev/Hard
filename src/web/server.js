// Small web server that receives the "Sign in with Roblox" redirect.
import { createServer } from 'node:http';
import { config, oauthEnabled } from '../config.js';
import { consumeSession, exchangeCode } from '../lib/oauth.js';
import { getHeadshotUrl } from '../lib/roblox.js';
import { linkAccount } from '../lib/verification.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * The page members see after "Sign in with Roblox". Matches Discord's dark look.
 * kind: 'ok' | 'bad' · extras: { avatar, guildName, guildId }
 */
const page = (title, body, kind = 'ok', { avatar, guildName, guildId } = {}) => {
  const accent = kind === 'ok' ? '#3fcf8e' : '#f2555a';
  const icon = kind === 'ok'
    ? '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
  const badge = avatar
    ? `<div class="avatar"><img src="${esc(avatar)}" alt=""><span class="tick"><svg viewBox="0 0 24 24">${icon}</svg></span></div>`
    : `<div class="badge"><svg viewBox="0 0 24 24">${icon}</svg></div>`;
  const back = guildId
    ? `<a class="btn" href="https://discord.com/channels/${esc(guildId)}">Back to ${esc(guildName ?? 'Discord')}</a>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#111214;--card:#1e1f22;--line:#2e3035;--text:#f2f3f5;--muted:#a3a6aa;--accent:${accent};--brand:#6c7bff}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:16px/1.55 "gg sans","Segoe UI",system-ui,-apple-system,sans-serif;color:var(--text);
background:radial-gradient(900px 500px at 50% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),var(--bg)}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:36px 28px 28px;text-align:center;
box-shadow:0 24px 60px rgba(0,0,0,.45);animation:pop .45s cubic-bezier(.2,.9,.3,1.2) both}
.badge,.avatar{width:84px;height:84px;margin:0 auto 18px;position:relative}
.badge{border-radius:50%;display:grid;place-items:center;color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent);
box-shadow:0 0 0 8px color-mix(in srgb,var(--accent) 7%,transparent)}
.badge svg{width:42px;height:42px}
.avatar img{width:84px;height:84px;border-radius:50%;background:#2b2d31;border:3px solid var(--accent)}
.tick{position:absolute;right:-2px;bottom:-2px;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#0b2a1c;display:grid;place-items:center;border:3px solid var(--card)}
.tick svg{width:16px;height:16px}
h1{font-size:24px;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0;color:var(--muted)}
b{color:var(--text)}
.btn{display:block;margin-top:24px;padding:12px 16px;border-radius:10px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600;transition:filter .15s}
.btn:hover{filter:brightness(1.1)}
small{display:block;margin-top:16px;color:#6d6f78;font-size:13px}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){main{animation:none}}
</style></head>
<body><main>${badge}<h1>${esc(title)}</h1><p>${body}</p>${back}<small>You can close this tab.</small></main></body></html>`;
};

export async function handleCallback(client, params) {
  if (params.get('error')) {
    return [400, page('Sign-in cancelled', 'No changes were made. Press <b>Verify</b> in Discord whenever you\'re ready.', 'bad')];
  }
  const session = consumeSession(params.get('state'));
  if (!session) {
    return [400, page('Link expired', 'This sign-in link expired or was already used. Press <b>Verify</b> in Discord to get a new one.', 'bad')];
  }
  const roblox = await exchangeCode(params.get('code'), session.verifier);
  const guild = await client.guilds.fetch(session.guildId);
  const member = await guild.members.fetch(session.discordId);
  const result = await linkAccount(member, roblox);
  await session.onDone?.(roblox, result).catch(() => {});
  const avatar = await getHeadshotUrl(roblox.robloxId).catch(() => null);
  return [200, page("You're verified!", `Your Discord is now linked to <b>${esc(roblox.displayName)}</b> (@${esc(roblox.username)}). Your roles are ready.`,
    'ok', { avatar, guildName: guild.name, guildId: guild.id })];
}

export function startWebServer(client) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let status = 404;
    let html = page('Page not found', 'There\'s nothing here.', 'bad');
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        // Health check for Render: only healthy once logged in to Discord.
        status = client.isReady?.() ? 200 : 503;
        html = status === 200 ? 'ok' : 'starting';
      } else if (url.pathname === '/oauth/callback' && oauthEnabled()) {
        [status, html] = await handleCallback(client, url.searchParams);
      }
    } catch (err) {
      console.error('OAuth callback failed:', err);
      [status, html] = [500, page('Something went wrong', 'Please go back to Discord and press <b>Verify</b> again.', 'bad')];
    }
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  server.listen(config.oauth.port, () => console.log(`Web server listening on port ${config.oauth.port}`));
  return server;
}
