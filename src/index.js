import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'node:fs';
import { config, requireConfig } from './config.js';
import { loadCommands } from './lib/loader.js';

requireConfig('token');

const client = new Client({
  // GuildMembers is a privileged intent: enable "Server Members Intent" in the Developer Portal (Bot tab).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

const commands = await loadCommands();
const eventsDir = new URL('./events/', import.meta.url);
for (const file of readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = await import(new URL(file, eventsDir));
  const handler = (...args) => event.execute(...args, commands);
  event.once ? client.once(event.name, handler) : client.on(event.name, handler);
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
await client.login(config.token);
