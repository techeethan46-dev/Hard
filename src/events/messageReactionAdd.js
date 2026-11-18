import { Events } from 'discord.js';
import { handleReaction } from '../lib/reactionroles.js';

export const name = Events.MessageReactionAdd;
export const execute = (reaction, user) => handleReaction(reaction, user, true).catch((err) => console.error('Reaction role failed:', err.message));
