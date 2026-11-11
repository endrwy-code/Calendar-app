# Daybook

A calm to-do list and a calendar in one place. It's built to run as a
**Telegram Mini App in fullscreen**, and it also works as a normal web app (or
an installable PWA) on your phone and desktop.

On its own, everything stays on your device. With its small **server** (one
container, see [DEPLOY.md](DEPLOY.md)) your phone and computer stay in sync,
your calendar is stored in a database with daily backups, and your Telegram
bot sends alerts like a calendar app would.

There are two places, **To-do** and **Calendar**, switched with the tab bar at
the bottom (in thumb reach). Tap a tab or drag the highlight across. The **☰**
menu at the top left of either screen holds the calendar views, which
tags are shown, and Settings.

## To-do

One running list that isn't tied to any day. Write things down as they come to
you, then look over the list whenever you open the app.

The page opens with today's date at the top and a centred quote, *"If you fail
to plan, you are planning to fail."* (usually attributed to Benjamin
Franklin). Below it:

- **Add a to-do** adds a to-do. The field stays pinned while you scroll.
- Each to-do is **Not started**, **In progress** or **Done**. Each group is its
  own card. Done is folded away until you open it.
- **Tap the circle** to tick a to-do off. It fills in, the title is struck
  through, and after a moment it moves to Done. Every change has **Undo**.
- **Swipe right** to start (or pause) a to-do. **Swipe left** for *Calendar*
  and *Delete*; a full swipe left deletes. On desktop, these show as buttons
  when you hover over a row.
- **Tap a to-do** to edit its title or notes, change its status, or add it to
  the calendar.

### Adding a to-do to the calendar

*Add to calendar* (from the swipe, or from the to-do itself) asks how long it
will take (15 min, 30 min, 1 hour or 2 hours), then offers the **next free times on your calendar**: the earliest
gap today, then one on each of the next days. Suggestions use your planning
hours (Settings). You can also pick any date and time.

The to-do stays on your list and also appears on the calendar as a grey time
block with its own tick circle. Ticking it in either place updates both. The
row shows when it's planned (red if that time has passed); tap that label to
jump to the day. You can also go the other way: tap an empty slot on the
calendar and choose **Or put a to-do here**.

## Calendar

- One row at the top, like Proton Calendar: **☰** menu, the month (tap it to
  jump to any date), the **today** button (it shows today's date) and **+**
  for a new event.
- **Day, 3 days, Week, Month and List** views, picked from the ☰ menu. The
  menu also shows and hides tags and opens Settings. Swipe it back to
  close it.
- **Swipe to change week, day or month.** The next page follows your finger
  and settles with a spring, based on how far and how fast you swiped. You can
  catch it while it's still moving. On desktop, use the arrows or ← / →.
- **Pinch to zoom the hours** in the day, 3-day and week views. Zoom out until
  the whole day fits on screen (labels thin out to every other hour), or in to
  place things precisely (half-hour lines appear and taps snap to 15 minutes).
  The time under your fingers stays put, and the size is remembered on each
  device. On a computer: Ctrl/⌘ + scroll, a trackpad pinch, or `+` `−` `0`.
- **Search** (the magnifier, or `/`) finds events and to-dos by any word in
  the title, place or notes. Repeating events jump to their next occurrence.
- The **current time** shows as a red time label in the hour column, a faint
  line across the week, and a solid line on today.
- All-day events are drawn as bars across the days they cover.
- **Tap an event to read it**: title, day and time, how it repeats, its tag,
  place and notes. Tap **Edit** to change it.
- The edit form is one short list: title; all day, start and end (shown as
  "Fri 13 Nov · 19:30", and a tap opens your phone's own picker); repeat;
  tag; place; notes. Repeat options only appear once you choose to repeat.
- Tap an empty slot to create an event there (a placeholder marks the spot).
  Tap a day heading to open that day.
- Events can repeat daily, on weekdays, weekly on chosen days, monthly
  (on the same date, or on the same weekday, like "the 1st Sunday" or "the
  last Friday") or yearly, with an end date. When you edit or delete a
  repeating event you choose "this event only", "this and following" or
  "all events".
- **Alerts** (when the server is connected): each event follows the default
  alert from Settings, or has its own (and a second one). They arrive as
  Telegram messages.
- From an event: **Duplicate** (same details, new time) or **Export as .ics**
  to send it to someone.
- Keyboard on a computer: `D` `3` `W` `M` `L` views, `N` new event, `T`
  today, `/` search, `←` `→` pages, `+` `−` `0` zoom.
- **Tags** (Personal, Work, Church…) are yours to name. The form shows only
  the one an event has; tap it to pick another or type a **New tag** on the
  spot. Rename, recolour or delete tags at the top of Settings, and show or
  hide them from the ☰ menu.

## Import and export

- **Import** `.ics` files from Google, Apple or Outlook Calendar: **Settings →
  Import a calendar (.ics)**, or drop the files anywhere on the window. You see
  how many events there are, pick the tag they go under (a new tag named after
  the calendar is suggested), and can undo. Times written in other time zones
  are moved to yours, repeat rules are kept (rules Daybook can't express are
  kept as their first date, and the import says how many), cancelled or moved
  occurrences become exceptions, and alarms become alerts. Importing the same
  file again updates those events instead of adding them twice.
- **Export** all events, or one tag's, as an `.ics` file from Settings, or a
  single event from its page. Inside Telegram (which can't download files) the
  bot sends the file to your chat instead.
- With the server: a private **subscription link** shows Daybook in Apple,
  Google or Outlook Calendar and keeps it up to date.

## Alerts and the bot (with the server)

- Alerts for events (a default for timed and for all-day events, or per
  event) and when a to-do you put on the calendar starts.
- A **morning summary** at a time you choose: the day's events, planned
  to-dos, and how many to-dos are open.
- `/today`, `/tomorrow`, `/next`. Send the bot any text and it becomes a
  to-do (the first line is the title, the rest notes), with an Undo button.
- `/login` sends a one-time link to sign in from a browser.

Alerts are worked out in your time zone (your phone tells the server), each is
sent once, and one missed during a restart is still sent within 10 minutes.

## Motion

The animations follow Apple's *Designing Fluid Interfaces* (WWDC 2018) and
the Human Interface Guidelines on motion. The building blocks are in
`src/lib/motion.ts`:

- **Springs, not timed curves.** Each spring is set by a damping ratio and a
  response time. CSS transitions use the same springs, converted to
  `linear()` easing curves.
- **Direct manipulation.** Calendar pages, list rows, sheets, the side menu
  and the tab bar highlight track your finger 1:1.
- **Momentum.** When you let go, the app projects your finger's speed forward
  to choose where to settle, and the spring starts at that speed so there's
  no visible jump.
- **Interruptible.** You can grab anything while it's still animating.
- **Rubber-banding.** Dragging past a limit gets harder the further you pull.
- **Reduce Motion** is respected.

## Settings

Tags come first (rename, recolour, delete, add). Then appearance (Automatic /
Light / Dark, where Automatic follows Telegram), and the calendar: week start,
12/24h clock, week numbers, default event length and the hours that "Add to
calendar" suggests. Then alerts, import and export, and your account (with the
server). Backup and sample data are folded away under **Backup and data**.

## Run it locally

```bash
npm install
npm run dev
```

Open the printed URL. Add **`?tgsim`** to the URL (e.g.
`http://localhost:5173/?tgsim`) to preview the Telegram fullscreen layout.
That draws a fake status bar and Telegram's Close / ⋯ buttons, using typical
iPhone inset values.

```bash
npm test        # unit tests: recurrence, free slots, paging, springs, .ics, alerts, time zones,
                # and the server (sign-in checks, sync conflicts, the API, alerts, bot commands)
npm run build   # type-check + production build into dist/
npm run server  # build everything and run the server on :8080 (see DEPLOY.md for settings)
```

## Put it online

**[DEPLOY.md](DEPLOY.md)** walks through running the server on Railway or on
your own VPS, pointing your bot at it, and moving your data across.

## Put it in Telegram (app only, no server)

1. **Host it on HTTPS.** The included workflow deploys to GitHub Pages. In the
   repo, go to *Settings → Pages* and set *Source* to **GitHub Actions**. Then
   push to `main` or run *Deploy to GitHub Pages* from the Actions tab. (Pages
   on a private repo needs a paid GitHub plan; any static host works since the
   build uses relative paths.)
2. **Create a bot** with [@BotFather](https://t.me/BotFather) (`/newbot`).
3. **Attach the Mini App** in BotFather. Either set it as the bot's Mini App /
   menu button under the bot's settings, or create a direct-link app with
   `/newapp`, and give it your Pages URL.
4. Open it from Telegram. On iOS and Android the app asks for fullscreen
   (`requestFullscreen`, Bot API 8.0+) and turns off swipe-to-minimise so
   calendar scrolling isn't hijacked. It also uses Telegram's back button,
   haptics, theme and status-bar colours.

### About the top gap in fullscreen

Telegram does **not** define a fixed size (such as 90px) for the area at the
top in fullscreen mode. Two runtime values add up to make it:

| Value | What it covers |
| --- | --- |
| `safeAreaInset.top` | The device's status bar, notch or Dynamic Island |
| `contentSafeAreaInset.top` | Telegram's floating **Close** and **⋯** buttons |

Both vary by phone and Telegram client. On a recent iPhone the total is often
around 90–105px, and on Android it's usually less. So the app reads both values
from `Telegram.WebApp` at startup and again on every `safeAreaChanged`,
`contentSafeAreaChanged` and `fullscreenChanged` event. It exposes them as CSS
variables in `src/lib/telegram.ts` and `src/styles/tokens.css`:

```css
--inset-top: max(env(safe-area-inset-top), safeAreaInset.top + contentSafeAreaInset.top);
```

Each screen's top row and every sheet are laid out below `--inset-top`. The
tab bar and sheets pad by the bottom inset (the home indicator), and the left
and right insets are respected in landscape.

## Your data

Everything is saved on the device first, so the app works offline. Inside
Telegram (Bot API 9.0+) that's Telegram's `DeviceStorage` (5 MB per user per
bot), mirrored to `localStorage`. In a browser it's `localStorage` only. Use
**Settings → Backup and data** to download, copy or import a backup. Data
from earlier versions loads as-is.

Without the server nothing leaves the device. With it, each change goes up a
moment later and other devices pick it up within half a minute (or as soon as
they're opened). Sample data never leaves the device. See
[DEPLOY.md](DEPLOY.md#your-data) for what the server keeps and how it's backed up.

## Project layout

```
src/
  lib/          motion (springs, momentum), pager, FLIP, dates, recurrence,
                free-slot finder, Telegram bridge, .ics, time zones, alerts,
                search, sync with the server
  store/        persisted data store (events, to-dos, calendars, settings) + UI state
  views/        To-do (list + swipe rows), Calendar (TimeGrid, Month, List)
  components/   sheets (to-do, add to calendar, event, settings, search,
                import), side menu, icons, segmented control (also drives the
                tab bar), popover, toasts
  styles/       tokens (light/dark), base controls, layout, to-do, calendar, forms
server/         the server: HTTP API + static hosting, SQLite store, Telegram
                sign-in, bot, alerts scheduler (shares src/lib with the app)
```

Stack: React 19, TypeScript, Vite, Zustand, date-fns, lucide plus a few
custom icons (tabs, menu, today, views). The server is plain Node (26 in the
image; 22.13+ works) with its built-in `node:http` and `node:sqlite`, bundled
into one file, so it adds no runtime dependencies. Text uses the system font (SF Pro on
Apple devices) with Inter as the fallback. The quote, the month title and the
menu title use Fraunces, upright with soft terminals. Fonts are bundled so
the app works offline.
