import { ActivityType, Events } from 'discord.js';
import { config } from '../config.js';
import { getGame, getUniverseId } from '../lib/roblox.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  console.log(`Logged in as ${client.user.tag}`);
  if (!config.placeId) return;

  // Show the live player count in the bot's status, e.g. "Watching 1,234 playing My Game".
  const update = async () => {
    try {
      const game = await getGame(await getUniverseId(config.placeId));
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
