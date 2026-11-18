import { Events } from 'discord.js';
import { handleReaction } from '../lib/reactionroles.js';

export const name = Events.MessageReactionRemove;
export const execute = (reaction, user) => handleReaction(reaction, user, false).catch((err) => console.error('Reaction role failed:', err.message));
