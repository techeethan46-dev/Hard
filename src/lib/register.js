/**
 * Sends the slash commands to Discord. Never throws: if Discord refuses (a rate limit, an outage), the bot should still
 * start, because the commands Discord already has keep working. Returns { ok: true } or { ok: false, error }.
 */
export async function register(rest, route, commands) {
  try {
    await rest.put(route, { body: commands });
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
