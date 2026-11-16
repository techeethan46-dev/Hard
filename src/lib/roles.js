import { config } from '../config.js';
import { getGroupRole, getUser } from './roblox.js';
import { store } from './store.js';

export function formatNickname(user) {
  return config.nicknameFormat
    .replaceAll('{displayName}', user.displayName)
    .replaceAll('{username}', user.name)
    .slice(0, 32);
}

/**
 * Bring a member's roles and nickname in line with their linked Roblox account.
 * Returns a summary of what changed (and what couldn't be changed).
 */
export async function syncMember(member) {
  const link = await store.links.get(member.id);
  const result = { added: [], removed: [], nickname: null, groupRole: null, errors: [] };
  const me = member.guild.members.me;

  const canManage = (roleId) => {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      result.errors.push(`Role ${roleId} not found`);
      return false;
    }
    if (role.position >= me.roles.highest.position) {
      result.errors.push(`Can't manage ${role.name}: move the bot's role above it`);
      return false;
    }
    return true;
  };

  const want = new Set();
  const managed = new Set(config.groupRankBindings.map((b) => b.roleId));
  if (config.roles.verified) managed.add(config.roles.verified);
  if (config.roles.unverified) managed.add(config.roles.unverified);

  if (link) {
    if (config.roles.verified) want.add(config.roles.verified);
    if (config.groupId && config.groupRankBindings.length) {
      const role = await getGroupRole(link.robloxId, config.groupId);
      result.groupRole = role;
      const rank = role?.rank ?? 0;
      for (const b of config.groupRankBindings) {
        if (rank >= b.minRank && rank <= b.maxRank) want.add(b.roleId);
      }
    }
  } else if (config.roles.unverified) {
    want.add(config.roles.unverified);
  }

  for (const roleId of managed) {
    const has = member.roles.cache.has(roleId);
    if (want.has(roleId) && !has && canManage(roleId)) {
      await member.roles.add(roleId, 'Roblox role sync');
      result.added.push(roleId);
    } else if (!want.has(roleId) && has && canManage(roleId)) {
      await member.roles.remove(roleId, 'Roblox role sync');
      result.removed.push(roleId);
    }
  }

  if (link) {
    const user = await getUser(link.robloxId);
    if (user) {
      const nick = formatNickname(user);
      if (member.id === member.guild.ownerId) {
        result.errors.push("Discord doesn't let bots change the server owner's nickname");
      } else if (!member.manageable) {
        result.errors.push("Can't set nickname: member's top role is above the bot's");
      } else if (member.nickname !== nick) {
        await member.setNickname(nick, 'Roblox verification');
        result.nickname = nick;
      }
    }
  }
  return result;
}
