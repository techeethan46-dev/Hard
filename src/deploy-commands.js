// Registers slash commands with Discord. Run once, and again whenever you add or change a command:
//   npm run deploy
import { REST, Routes } from 'discord.js';
import { config, requireConfig } from './config.js';
import { loadCommands } from './lib/loader.js';

requireConfig('token', 'clientId');
const commands = [...(await loadCommands()).values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId) // one server, updates instantly
  : Routes.applicationCommands(config.clientId); // every server the bot is in
await rest.put(route, { body: commands });
console.log(`Registered ${commands.length} commands ${config.guildId ? `on server ${config.guildId}` : 'globally'}: ${commands.map((c) => '/' + c.name).join(' ')}`);
