import { ActivityType, Events } from 'discord.js';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { sweepStreaks } from '../lib/activity.js';
import { endDueGiveaways } from '../lib/giveaways.js';
import { getGame, getUniverseId } from '../lib/roblox.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  console.log(`Logged in as ${client.user.tag}`);

  // End streaks of people who skipped a day (and remove their 🔥 badge) every 10 minutes.
  const sweep = () => sweepStreaks(client).catch((err) => console.error('Streak sweep failed:', err.message));
  sweep();
  setInterval(sweep, 10 * 60_000);

  // End giveaways on time (also catches ones that ended while the bot was offline).
  const giveaways = () => endDueGiveaways(client).catch((err) => console.error('Giveaway check failed:', err.message));
  giveaways();
  setInterval(giveaways, 10_000);
  // Show the live player count in the bot's status, e.g. "Watching 1,234 playing My Game".
  const update = async () => {
    try {
      // The status is shared across servers, so use the first server that has a game set in /setup.
      let placeId;
      for (const guildId of client.guilds.cache.keys()) {
        placeId = (await getSettings(guildId)).placeId;
        if (placeId) break;
      }
      if (!placeId) return;
      const game = await getGame(await getUniverseId(placeId));
      if (game) {
        client.user.setActivity(`${game.playing.toLocaleString('en-US')} playing ${game.name}`, { type: ActivityType.Watching });
      }
    } catch (err) {
      console.error('Status update failed:', err.message);
    }
  };
  await update();
  setInterval(update, config.statusUpdateSeconds * 1000);
}
