# Putting Daybook online

Daybook runs fine on its own (everything stays on the device), but to keep your
phone and computer in sync and to get alerts as Telegram messages, it needs its
server. The server is one small container that:

- hosts the app at your own https address,
- stores everything in a SQLite database on a disk that survives restarts, with a
  copy made every day (the last 7 are kept),
- keeps your devices in sync (newest edit wins when two devices change the same thing),
- runs your Telegram bot: alerts, a morning summary, `/today`, `/tomorrow`,
  `/next`, quick to-dos (send it any text) and sign-in links for browsers,
- serves a private calendar link that Apple, Google or Outlook Calendar can subscribe to.

It needs no other services: the database is built into Node.

## What you need

1. **A Telegram bot token.** If you already made a bot for the Mini App, reuse it.
   Otherwise open [@BotFather](https://t.me/BotFather), send `/newbot` and follow
   the steps. Treat the token like a password: don't commit it, don't paste it
   into chats (AI chats included), and only put it in your host's settings or
   your server's `.env` file.
2. **Somewhere to run a container all the time**, with a disk that's kept and an
   https address. Pick one:
   - **[Railway](https://railway.com)**: the easiest. No server to look after; it
     builds from your GitHub repo. A few dollars a month (check their current pricing).
   - **A small VPS** (any Ubuntu server from Hetzner, DigitalOcean, Vultr…): the
     cheapest and you're in full control, but you look after the machine.
3. **Your Telegram username** (or numeric id), so only you can use your server.

## Option A: Railway

1. Sign in to Railway with GitHub. Create a **New Project → Deploy from GitHub
   repo** and pick this repository and the branch you want to run. Railway finds
   the `Dockerfile` and builds it (the build runs the tests too).
2. In the service's **Settings → Networking**, generate a public domain for port
   **8080**. You get an address like `https://daybook-production.up.railway.app`.
3. Attach a **volume** to the service with the mount path **`/data`**. This is
   where the database lives. Without it, your data is lost on every deploy.
   ([Railway's volume guide](https://docs.railway.com/guides/volumes))
4. In the service's **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `BOT_TOKEN` | your bot token |
   | `APP_URL` | the https address from step 2, no slash at the end |
   | `ALLOWED_USERS` | your Telegram username, e.g. `@yourname` |
   | `DEFAULT_TZ` | your time zone, e.g. `Asia/Singapore` |
   | `RAILWAY_RUN_UID` | `0` (Railway's volumes belong to root; this lets Daybook write to it) |

5. Let it redeploy, then open `https://<your address>/api/health`. You should see
   `{"app":"daybook","ok":true,"bot":"your_bot_name"}`. If `bot` is `null`, the
   token is wrong (the deploy logs say so).

To update later, push to the branch; Railway rebuilds and redeploys.

## Option B: your own server (VPS)

1. Create an Ubuntu 24.04 server (1 GB RAM is plenty) and
   [install Docker](https://docs.docker.com/engine/install/ubuntu/).
2. Give it an address: point a domain's **A record** at the server's IP. No
   domain? Use `<your-ip-with-dashes>.sslip.io` (e.g. `203-0-113-7.sslip.io`),
   which points at your IP for free.
3. Open ports 22, 80 and 443 in the firewall.
4. On the server:

   ```bash
   git clone https://github.com/<you>/calendar-app.git daybook
   ```

   ```bash
   cd daybook && cp .env.example .env && nano .env
   ```

   Fill in `BOT_TOKEN`, `APP_URL` (`https://` + your domain), `ALLOWED_USERS`,
   `DEFAULT_TZ` and `DOMAIN` (just the domain).

   ```bash
   docker compose up -d --build
   ```

   Caddy gets the HTTPS certificate by itself. Check
   `https://<your domain>/api/health`.

To update later:

```bash
git pull && docker compose up -d --build
```

## Point Telegram at it

1. In @BotFather: `/mybots` → your bot → **Bot Settings → Configure Mini App**
   (and **Menu Button**) → set the URL to your `APP_URL`. If you made a direct
   link with `/newapp`, edit that too (`/myapps`). The server also sets the menu
   button itself when it starts.
2. Open your bot in Telegram and press **Start**. It replies with what it can do.
3. Open Daybook from the bot's menu button. Inside Telegram it signs you in by
   itself; **Settings → Account** shows your name and "Synced".
4. In **Settings → Alerts**, tap **Send a test message**. Choose the default
   alert for events, and turn on the **Morning summary** if you'd like one.

## Bring over what you already have

- **Inside Telegram**, the app keeps its data in Telegram's storage for your bot,
  so it should come along when the bot opens the new address, and goes up to the
  server on the first sync. Check that your events are there before deleting anything.
- **From a browser** (e.g. the GitHub Pages copy): on the old one, **Settings →
  Backup and data → Download a backup**; on the new one, **Import a backup file**.
- **From Google, Apple or Outlook Calendar**: export an `.ics` file there, then
  in Daybook use **Settings → Import a calendar (.ics)**, or on a computer just
  drop the file onto the window. Importing the same file again updates events
  instead of doubling them.

## Use it on a computer

Send `/login` to your bot and open the link it sends (it works once, for 15
minutes). On a computer: `/` searches, `N` adds an event, `D` `3` `W` `M` `L`
switch views, `T` goes to today, `←` `→` change page, and `+` `−` `0` (or Ctrl +
scroll) zoom the hours.

## See Daybook in another calendar app (optional)

**Settings → Show Daybook in another calendar app** gives you a private link.
Add it in Apple Calendar (*File → New Calendar Subscription*), Google Calendar
(*Other calendars → From URL*) or Outlook (*Add calendar → Subscribe from web*).
It updates by itself (how often depends on that app). Anyone with the link can
see your events, so keep it to yourself; **Turn off link** stops it working.

## Your data

- Everything is in one file, `/data/daybook.db`. Every day a copy is written to
  `/data/backups/` and the last 7 are kept. Now and then, keep a copy somewhere
  else as well: **Settings → Backup and data → Download a backup** from the app,
  or on a VPS `docker compose cp daybook:/data/backups ./backups`.
- Alerts and the morning summary are Telegram messages, so event titles, times
  and places pass through Telegram like any chat. Keep anything sensitive out of
  event titles and notes.
- Sign-in links, sessions and calendar links are stored only as hashes, so a
  copy of the database can't be used to sign in.
- If your bot token ever leaks: @BotFather → `/revoke`, then put the new token in
  your host's variables (or `.env`) and restart.

## If something's off

| You see | What to do |
| --- | --- |
| Logs: `couldn’t connect the bot (Telegram 401)` | `BOT_TOKEN` is wrong. |
| Logs: `another copy of this bot is running` | Two servers are using the same bot (often a local test copy). Use a separate bot for testing. |
| App: "This Daybook server is private." | Add your username or id to `ALLOWED_USERS`. |
| No alerts arrive | Press **Start** in your bot's chat once, then **Settings → Alerts → Let @bot message you**. |
| Alerts at the wrong time | Open the app once on your phone, which tells the server your time zone, or set `DEFAULT_TZ`. |
| Data gone after a Railway deploy | The volume isn't mounted at `/data`. |

## Running the server on your computer

```bash
npm install
```

```bash
BOT_TOKEN=<a test bot's token> APP_URL=http://localhost:8080 npm run server
```

Then open http://localhost:8080. To work on the app with live reload against
that server, run Vite with the API passed through:

```bash
DAYBOOK_SERVER=http://localhost:8080 npm run dev
```

All settings: `PORT` (8080), `DATA_DIR` (`./data`), `BOT_TOKEN`, `APP_URL`,
`ALLOWED_USERS`, `DEFAULT_TZ` (UTC), `TRUST_PROXY` (`1`; set `0` if the server
faces the internet directly), `BOT_POLLING` (`1`).
