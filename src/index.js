import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'node:fs';
import { config, requireConfig } from './config.js';
import { reportError } from './lib/errors.js';
import { closeStore, initStore } from './lib/store.js';
import { startWebServer } from './web/server.js';
import { loadCommands } from './lib/loader.js';

requireConfig('token');

const client = new Client({
  // GuildMembers is a privileged intent: enable "Server Members Intent" in the Developer Portal (Bot tab).
  // GuildMembers and MessageContent are "privileged": turn both on in the Developer Portal (Bot tab).
  // MessageContent is needed for AutoMod and message logs; GuildModeration for ban logs.
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessageReactions,
  ],
  // Lets delete/edit logs fire for messages sent before the bot started.
  // Reaction is needed so reaction roles work on panels posted before the bot last restarted.
  partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.User, Partials.Reaction],
});

await initStore();
const commands = await loadCommands();
const eventsDir = new URL('./events/', import.meta.url);
for (const file of readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = await import(new URL(file, eventsDir));
  const handler = (...args) => event.execute(...args, commands);
  event.once ? client.once(event.name, handler) : client.on(event.name, handler);
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  reportError(client, { where: 'Background task', error: err });
});
// Always on: Render needs an open port, and it serves the health check + Roblox sign-in callback.
const server = startWebServer(client);
await client.login(config.token);

// Render sends SIGTERM before replacing the bot on each deploy.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await client.destroy();
    await closeStore();
    process.exit(0);
  });
}
