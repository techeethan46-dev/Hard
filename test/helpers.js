// Helpers for reading Components V2 messages in tests.
import { MessageFlags } from 'discord.js';

/** Fully serialised message components (this is also where discord.js validates them). */
export function json(payload) {
  return (payload.components ?? []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node && typeof node === 'object') {
    visit(node);
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit);
  }
}

/** All visible text in a message. */
export function textOf(payload) {
  const out = [];
  walk(json(payload), (n) => { if (n.type === 10 && n.content) out.push(n.content); });
  return out.join('\n');
}

export function customIds(payload) {
  const out = [];
  walk(json(payload), (n) => { if (n.custom_id) out.push(n.custom_id); });
  return out;
}

export function buttonLabels(payload) {
  const out = [];
  walk(json(payload), (n) => { if (n.type === 2) out.push(n.label); });
  return out;
}

export const isV2 = (payload) => Boolean(payload.flags & MessageFlags.IsComponentsV2) && !payload.embeds && !payload.content;
