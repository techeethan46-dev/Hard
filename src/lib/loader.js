import { readdirSync } from 'node:fs';

export async function loadCommands() {
  const dir = new URL('../commands/', import.meta.url);
  const commands = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(new URL(file, dir));
    commands.set(mod.data.name, mod);
  }
  return commands;
}
