// Registers slash commands with Discord. Run once, and again whenever you add or change a command:
//   npm run deploy
import { REST, Routes } from 'discord.js';
import { config, requireConfig } from './config.js';
import { loadCommands } from './lib/loader.js';

requireConfig('token', 'clientId', 'guildId');
const commands = [...(await loadCommands()).values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);
// Guild commands update instantly (global commands can take up to an hour).
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
console.log(`Registered ${commands.length} commands: ${commands.map((c) => '/' + c.name).join(' ')}`);
