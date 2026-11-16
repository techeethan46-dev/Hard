# Roblox Community Bot

A Discord bot for a Roblox game community: Roblox verification, tickets, game stats, suggestions and moderation. Built with [discord.js](https://discord.js.org) v14 and MongoDB, ready for Render.

Everything server-specific (roles, channels, the game) is set **inside Discord with `/setup`**.
No IDs to copy.

## Getting it running

You only need **3 values**: the bot token, the Application ID, and the MongoDB link.

1. **Create the bot** at <https://discord.com/developers/applications> → *New Application*.
   - *Bot* tab: **Reset Token** and copy it. Turn on **Server Members Intent** and **Message Content Intent**.
   - *General Information*: copy the **Application ID**.
   - *OAuth2 → URL Generator*: tick `bot` and `applications.commands`, then the permissions **Manage Roles,
     Manage Channels, Manage Nicknames, Kick Members, Ban Members, Moderate Members, Manage Messages, View Channels,
     Send Messages, Embed Links, Attach Files, Add Reactions, Create Public Threads, Read Message History**.
     Open the link and add the bot to the server. Someone with *Manage Server* on that server has to do this.
2. **MongoDB Atlas**: copy the connection string (*Database → Connect → Drivers*). Under *Network Access*, allow
   `0.0.0.0/0` (or Render's outbound IPs).
3. **Render**: *New → Blueprint* → pick this repo. Paste `DISCORD_TOKEN`, `CLIENT_ID` and `MONGODB_URI` when
   asked; leave the Roblox OAuth ones empty for now. Use the **Starter** plan: the free plan sleeps after 15 minutes
   and takes the bot offline.
4. When the logs say `Logged in as ...`, go to Discord and run **`/setup`**.

Slash commands are registered automatically on each deploy. New global commands can take a few minutes to
appear the first time.

## `/setup`

An admin (needs *Manage Server*) runs `/setup` and goes through the steps with **Back / Next / Clear**.
Every pick saves instantly. After the last step, a summary page shows everything with a **Finish** button.

| Step | What it does |
|---|---|
| ✅ Verified role | Given to everyone who links their Roblox account |
| 🔒 Unverified role | Optional: given until they verify |
| 🛟 Support staff roles | Can see and answer tickets |
| 🎮 Roblox game | Paste the game link: powers `/game` and the live player count |
| 👋 Welcome channel | New members are greeted here |
| 🛡️ Mod log channel | Every warn/timeout/kick/ban is logged |
| 💡 Suggestions channel | Where `/suggest` posts |
| 🎫 Ticket category | Where ticket channels are created |
| 📜 Ticket log channel | Transcripts of closed tickets |

The summary page also runs checks and tells you what to fix in plain words, like "drag the bot's role above
@Verified" or "the bot can't post in #mod-log".

After setup: run `/panel verify` in your verify channel and `/panel tickets` in your support channel.
Skip any step you don't need; that feature just stays off.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/verify` or the **Verify** button | Everyone | Links a Roblox account (see below) |
| `/update [member]` | Everyone (staff for others) | Re-syncs roles and nickname, e.g. after a promotion |
| `/unverify` | Everyone | Unlinks your Roblox account |
| `/whois [member] [username]` | Everyone | Roblox profile and linked Discord account |
| `/game` | Everyone | Players online, visits, favorites, last update, Play button |
| `/suggest idea` | Everyone | Posts an idea with 👍/👎 and a discussion thread |
| Ticket buttons, `/ticket close` | Everyone | Opens a private support channel |
| `/ticket add/remove member` | Support staff | Brings someone into a ticket |
| `/warn`, `/warnings list/remove/clear` | Moderators | Warnings, per server |
| `/timeout`, `/kick`, `/ban add/remove`, `/purge` | Moderators | Moderation, logged and DMed to the member |
| `/setup`, `/panel verify`, `/panel tickets` | Admins | Setup and button panels |

Moderation commands are hidden from members without the matching permission.

## Verification

- **Profile code** (default): the member types their username, pastes a 6-word code into their Roblox
  profile's *About*, and clicks **Done**. Works with no extra setup.
- **Sign in with Roblox** (optional, easier for members): one click and approve on roblox.com. To turn it on:
  1. <https://create.roblox.com/dashboard/credentials> → **OAuth 2.0 Apps** → create an app. Members see its name,
     so call it something like "*Game name* Discord Verification".
  2. Scopes **openid** and **profile**; redirect URL `https://<your-service>.onrender.com/oauth/callback`.
  3. Put the client ID and secret in Render (`ROBLOX_OAUTH_CLIENT_ID`, `ROBLOX_OAUTH_CLIENT_SECRET`).
  4. Roblox may limit a new app's users until it's reviewed. Check the app page and leave time for that.

## Tickets

Member clicks a category → fills a short form → a private channel such as `#report-0001` opens with them and
support staff, showing their answers and Roblox account. Staff press **Claim**. **Close** sends a transcript to
the log channel and the member's DMs, then deletes the channel. One open ticket per member.

The categories and their questions are in `config.json` (`ticketTypes`): General Support, Report a Player,
Bug Report, Purchase Issue. Edit and push to change them.

## Running locally

```bash
npm install
cp .env.example .env   # DISCORD_TOKEN, CLIENT_ID, MONGODB_URI (+ GUILD_ID for instant command updates)
npm run deploy
npm start
```

Without `MONGODB_URI`, data goes to `data/db.json`. That's fine on your computer, but never on Render, which wipes
its disk on every deploy.

`npm test` runs the offline tests. To also test against your database:
`MONGODB_TEST_URI="<connection string>" npm test` (uses a throwaway `roblox-bot-test` database).

## Project layout

```
src/
  index.js              starts the bot + web server
  deploy-commands.js    registers slash commands
  config.js             secrets from the environment + config.json
  commands/             one file per slash command (setup.js is the wizard)
  events/               ready (status), member join (welcome + sync), interaction router
  lib/settings.js       per-server settings from /setup
  lib/store.js          MongoDB storage (JSON file fallback for local dev)
  lib/roblox.js         Roblox API calls
  lib/roles.js          role + nickname sync
  lib/oauth.js          Sign in with Roblox
  web/server.js         health check + Roblox sign-in redirect
render.yaml             Render deployment config
```
