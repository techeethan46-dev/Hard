// Small web server that receives the "Sign in with Roblox" redirect.
import { createServer } from 'node:http';
import { config, oauthEnabled } from '../config.js';
import { consumeSession, exchangeCode } from '../lib/oauth.js';
import { linkAccount } from '../lib/verification.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title, body, ok = true) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#1e1f22;color:#f2f3f5;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#2b2d31;border-radius:12px;padding:32px;max-width:420px;text-align:center}
h1{font-size:22px;margin:0 0 8px;color:${ok ? '#43b581' : '#f04747'}}p{color:#b5bac1;line-height:1.5}</style></head>
<body><main><h1>${esc(title)}</h1><p>${body}</p></main></body></html>`;

export async function handleCallback(client, params) {
  if (params.get('error')) {
    return [400, page('Sign-in cancelled', 'No changes were made. You can close this tab and try <b>Verify</b> again.', false)];
  }
  const session = consumeSession(params.get('state'));
  if (!session) {
    return [400, page('Link expired', 'This sign-in link expired or was already used. Click <b>Verify</b> in Discord again.', false)];
  }
  const roblox = await exchangeCode(params.get('code'), session.verifier);
  const guild = await client.guilds.fetch(session.guildId);
  const member = await guild.members.fetch(session.discordId);
  const result = await linkAccount(member, roblox);
  await session.onDone?.(roblox, result).catch(() => {});
  return [200, page("You're verified!", `Linked to <b>${esc(roblox.displayName)} (@${esc(roblox.username)})</b>.<br>You can close this tab and go back to Discord.`)];
}

export function startWebServer(client) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let status = 404;
    let html = page('Not found', '', false);
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
      [status, html] = [500, page('Something went wrong', 'Please go back to Discord and try again.', false)];
    }
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  server.listen(config.oauth.port, () => console.log(`Web server listening on port ${config.oauth.port}`));
  return server;
}
