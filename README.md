# Roblox Community Bot

A Discord bot for an official Roblox game community, built with [discord.js](https://discord.js.org) v14.

## Features

| Command | Who | What it does |
|---|---|---|
| `/verify` or the **Verify** button | Everyone | Links a Roblox account — see [Verification](#verification) |
| `/update [member]` | Everyone (staff for others) | Re-syncs roles and nickname from Roblox (e.g. after a group promotion) |
| `/unverify` | Everyone | Unlinks your Roblox account |
| `/whois [member] [username]` | Everyone | Shows a Roblox profile, group rank and linked Discord account |
| `/game` | Everyone | Live game stats: players online, visits, favorites, last update, Play button |
| **Ticket buttons**, `/ticket close` | Everyone | Opens a private support channel — see [Tickets](#tickets) |
| `/ticket add/remove member` | Support staff | Bring someone else into a ticket |
| `/panel verify`, `/panel tickets` | Admins | Posts the permanent Verify / Open-a-ticket button messages |
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

## Verification

There are two methods. The bot picks automatically:

1. **Sign in with Roblox (recommended).** Member clicks **Verify** → **Sign in with Roblox** → approves on roblox.com →
   done, roles applied instantly. Uses Roblox's official OAuth, so it can't be faked and nobody shares a password.
   Needs a one-time setup (below) and the bot reachable at a public HTTPS address.
2. **Profile code (fallback).** Used when OAuth isn't configured, or if someone runs `/verify username:<name>`.
   The member pastes a 6-word code into their Roblox profile's *About* and clicks **Done**. No setup, but more effort for members.

**Setting up Sign in with Roblox:**
1. Go to <https://create.roblox.com/dashboard/credentials> → **OAuth 2.0 Apps** → *Create OAuth App*
   (create it under the account or group that owns the game).
2. Add the redirect URL `https://<your-public-address>/oauth/callback`, and scopes **openid** and **profile**.
3. Copy the client ID and secret into `.env` (`ROBLOX_OAUTH_CLIENT_ID`, `ROBLOX_OAUTH_CLIENT_SECRET`) and set `PUBLIC_URL`.
4. The bot starts a small web server on `PORT` (default 3000). Point your HTTPS address at it — Railway/Fly.io/Render
   give you one automatically; on a VPS use Caddy or nginx in front of it.

Roblox may limit how many people can use a new OAuth app until it's reviewed. Check the app's page in the Creator
Dashboard and submit it for review before launch day.

## Tickets

1. Create a category (e.g. *Tickets*) and a private log channel. Put their IDs in `TICKET_CATEGORY_ID` and
   `TICKET_LOG_CHANNEL_ID`, and your support role(s) in `SUPPORT_ROLE_IDS`.
2. Edit `ticketTypes` in `config.json`. Each type is a button with its own form (up to 5 questions). The defaults
   are *General Support*, *Report a Player*, *Bug Report* and *Purchase Issue*.
3. Run `/panel tickets` in your #support channel.

What members see: click a category → fill a short form → a private `#report-0001` channel opens with them and
support staff, showing their answers and their linked Roblox account. Staff press **Claim** to take it. Either side
presses **Close**: a full transcript goes to the log channel and to the member's DMs, and the channel is deleted.
Members can have one open ticket at a time.

## Setup

1. **Create the bot** at <https://discord.com/developers/applications> → *New Application*.
   - *Bot* tab → **Reset Token** and copy it. Turn on **Server Members Intent** and **Message Content Intent**
     (the second is needed so ticket transcripts include message text).
   - *OAuth2 → URL Generator*: scopes `bot` + `applications.commands`; permissions **Manage Roles, Manage Channels, Manage Nicknames,
     Kick Members, Ban Members, Moderate Members, Manage Messages, Send Messages, Embed Links, Add Reactions,
     Create Public Threads, Read Message History**. Open the URL to invite the bot.
2. **In your server**, run `/panel verify` in your #verify channel (after step 4), and drag the bot's role **above** every role it should hand out (Verified, rank roles, etc.).
3. **Install and configure** (needs Node.js 20.19+):
   ```bash
   npm install
   cp .env.example .env      # fill in the token, IDs, MongoDB URI, place ID, group ID
   ```
   Edit `config.json` to map group ranks to role IDs (bindings with an empty `roleId` are ignored).
   Turn on *Developer Mode* in Discord (Settings → Advanced) to right-click → **Copy ID** on channels/roles.
4. **Register commands and start**:
   ```bash
   npm run deploy   # once, and after changing any command
   npm start
   ```

## Hosting on Render + MongoDB

**1. MongoDB (Atlas)**
- Create a database user (*Database Access*) and copy the connection string (*Database → Connect → Drivers*).
- *Network Access*: allow Render's outbound IPs (Render dashboard → your service → *Connect → Outbound*), or `0.0.0.0/0`.
- The bot creates its collections and indexes itself: `links`, `pendingVerifications`, `warnings`, `tickets`, `counters`.

**2. Render**
- Push this repo to GitHub, then in Render: **New → Blueprint** → pick the repo. It reads `render.yaml`.
- Fill in the values it asks for (same as `.env.example`), including `MONGODB_URI`.
- Every deploy registers the slash commands and starts the bot. `/health` is used as the health check.
- **Use the Starter plan or higher.** The free plan sleeps after 15 minutes with no web traffic, and the bot goes offline with it.

**3. Sign in with Roblox on Render**
- You don't need `PUBLIC_URL`: Render's address (e.g. `https://roblox-community-bot.onrender.com`) is picked up automatically.
- In the Roblox Creator Dashboard, set the OAuth redirect URL to `https://<your-service>.onrender.com/oauth/callback`.
- If you add a custom domain on Render, set `PUBLIC_URL` to it and update the redirect URL to match.

Locally, `npm start` works without MongoDB (data goes to `data/db.json`). Never use that mode on Render: its disk is
wiped on every deploy.

## Notes

- Uses Roblox's public web APIs — no Roblox API key needed.
- Data is stored in MongoDB (`MONGODB_URI`). Atlas backs it up for you on paid tiers; on the free tier, export it now and then.
- Built for one server (`GUILD_ID`).
- `npm test` runs offline tests with mocked Roblox responses. To also test against your MongoDB, run
  `MONGODB_TEST_URI="<connection string>" npm test`. That uses a throwaway `roblox-bot-test` database and deletes it afterwards.

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
  lib/store.js          MongoDB storage (JSON file fallback for local dev)
  lib/oauth.js          Sign in with Roblox
  web/server.js         health check + Roblox sign-in redirect
render.yaml             Render deployment config
```
