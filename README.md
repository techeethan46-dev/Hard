# Roblox Community Bot

A Discord bot for an official Roblox game community, built with [discord.js](https://discord.js.org) v14.

## Features

| Command | Who | What it does |
|---|---|---|
| `/verify username` | Everyone | Links a Roblox account: the bot gives you a word code to paste into your Roblox profile's **About**, then checks it |
| `/update [member]` | Everyone (staff for others) | Re-syncs roles and nickname from Roblox (e.g. after a group promotion) |
| `/unverify` | Everyone | Unlinks your Roblox account |
| `/whois [member] [username]` | Everyone | Shows a Roblox profile, group rank and linked Discord account |
| `/game` | Everyone | Live game stats: players online, visits, favorites, last update, Play button |
| `/suggest idea` | Everyone | Posts to the suggestions channel with 👍/👎 and a discussion thread |
| `/warn`, `/warnings list/remove/clear` | Moderators | Warning system, stored per member |
| `/timeout`, `/kick`, `/ban add/remove` | Moderators | Moderation, DMs the member and logs to the mod-log channel |
| `/purge amount [from]` | Moderators | Bulk-delete up to 100 recent messages |

Automatic:
- **Group rank → role sync**: set rank ranges in `config.json` (e.g. ranks 200–254 → `Staff` role). Roles are added *and removed* to match.
- **Verified / Unverified roles** and nickname format `DisplayName (@username)`.
- **Welcome message** for new members; returning verified members get their roles back on rejoin.
- **Live status**: the bot shows "Watching 1,234 playing *Your Game*".

Moderation commands are hidden from members without the matching permission. You can fine-tune who sees each command in
**Server Settings → Integrations → your bot**.

## Setup

1. **Create the bot** at <https://discord.com/developers/applications> → *New Application*.
   - *Bot* tab → **Reset Token** and copy it. Turn on **Server Members Intent**.
   - *OAuth2 → URL Generator*: scopes `bot` + `applications.commands`; permissions **Manage Roles, Manage Nicknames,
     Kick Members, Ban Members, Moderate Members, Manage Messages, Send Messages, Embed Links, Add Reactions,
     Create Public Threads, Read Message History**. Open the URL to invite the bot.
2. **In your server**, drag the bot's role **above** every role it should hand out (Verified, rank roles, etc.).
3. **Install and configure** (needs Node.js 18.17+):
   ```bash
   npm install
   cp .env.example .env      # fill in the token, IDs, place ID, group ID
   ```
   Edit `config.json` to map group ranks to role IDs (bindings with an empty `roleId` are ignored).
   Turn on *Developer Mode* in Discord (Settings → Advanced) to right-click → **Copy ID** on channels/roles.
4. **Register commands and start**:
   ```bash
   npm run deploy   # once, and after changing any command
   npm start
   ```

To keep it online 24/7, run it on a VPS with `pm2 start src/index.js --name roblox-bot`, or a host such as Railway or Fly.io.

## Notes

- Uses Roblox's public web APIs — no Roblox API key needed.
- Data (links, warnings) is stored in `data/db.json`. Back it up; swap in SQLite/Postgres if you outgrow it.
- Built for one server (`GUILD_ID`).
- `npm test` runs offline tests with mocked Roblox responses.

## Project layout

```
src/
  index.js              starts the bot
  deploy-commands.js    registers slash commands
  config.js             reads .env + config.json
  commands/             one file per slash command
  events/               ready (status), member join (welcome + sync), interaction router
  lib/roblox.js         Roblox API calls
  lib/roles.js          role + nickname sync
  lib/store.js          JSON storage
```
