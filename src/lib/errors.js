// Error alerts: when something unexpected breaks, post a short note in the "Error alert channel" (set in /setup), so you
// don't have to read Render's logs. Secrets are scrubbed first, repeats are muted, and reporting can never break the bot.
import { getSettings } from './settings.js';
import { card, colors, divider, footnote, text, v2 } from './ui.js';

const SAME_ERROR_MS = 10 * 60_000; // the same error is reported once per 10 minutes
const MAX_PER_MINUTE = 5; // and never more than 5 alerts a minute, whatever happens

const seen = new Map();
let recent = [];
export const resetErrorReports = () => { seen.clear(); recent = []; };

/** Removes anything that looks like a secret: the bot token, the database link, the Roblox secret. */
export function redact(input) {
  let s = String(input ?? '');
  for (const secret of [process.env.DISCORD_TOKEN, process.env.MONGODB_URI, process.env.ROBLOX_OAUTH_CLIENT_SECRET]) {
    if (secret && secret.length > 6) s = s.split(secret).join('[hidden]');
  }
  return s
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[hidden]')
    .replace(/[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}/g, '[hidden]'); // Discord tokens look like three chunks joined by dots
}

/**
 * @param client  the Discord client
 * @param where   what was happening, e.g. "/giveaway" or "Background task"
 * @param guildId alert only this server's channel; leave out to alert every server that has one
 */
export async function reportError(client, { where, error, guildId = null, user = null }) {
  try {
    const message = redact(error?.message ?? error).slice(0, 400);
    const key = `${where}|${message}`;
    const now = Date.now();
    if (now - (seen.get(key) ?? 0) < SAME_ERROR_MS) return;
    recent = recent.filter((t) => now - t < 60_000);
    if (recent.length >= MAX_PER_MINUTE) return;
    seen.set(key, now);
    recent.push(now);
    if (seen.size > 200) seen.clear();

    const stack = redact(String(error?.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join('\n')).slice(0, 600);
    const payload = v2(card(colors.bad,
      text('### ⚠️ Something broke', `**Where** ${where}`, `**Error** ${message || 'unknown'}`, user ? `**Who** ${user}` : null),
      stack ? [divider(), text(`\`\`\`\n${stack.replace(/```/g, "'''")}\n\`\`\``)] : null,
      footnote('Same error is muted for 10 minutes · the full details are in the Render logs'),
    ));

    for (const id of guildId ? [guildId] : [...client.guilds.cache.keys()]) {
      const { errorLogChannel } = await getSettings(id);
      if (!errorLogChannel) continue;
      const channel = await client.guilds.cache.get(id)?.channels.fetch(errorLogChannel).catch(() => null);
      await channel?.send(payload).catch(() => {});
    }
  } catch {
    // an alert must never cause another error
  }
}
