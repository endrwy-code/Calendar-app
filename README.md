# Daybook

Your calendar and your to-do list in one place. It's built to run as a
**Telegram Mini App in fullscreen**, and it also works as a normal web app (or
an installable PWA) on your phone and desktop.

## What's in it

**Today** (the home screen)
- A progress ring for today's tasks, a greeting, and what's on **now / next**.
- **My Tasks** shows To Do, In Progress and Done counts. Tap one to jump to it.
- **Today's schedule** lists events and time-blocked tasks in order. Free gaps
  show up as **"Free for 2h 30m · Plan"**, so you can drop a to-do straight
  into the gap.
- **Needs a time**: open to-dos with no time yet. **Plan** puts one in your
  next free slot.
- **Overdue** tasks, and **Lists this week** cards with a progress ring per
  calendar.

**Calendar**
- Day, 3-day, Week, Month and Schedule (agenda) views.
- Week numbers, a today button, a month/date picker, and swipe left/right to
  change week.
- Tap an empty slot to create an event there.
- Events can repeat daily, on weekdays, weekly on chosen days, monthly or
  yearly, with an end date. When you edit or delete a repeating event, you
  choose "only this", "this and following" or "all".
- Tasks show on the calendar too. Time-blocked tasks appear as dashed blocks
  you can tick off, and tasks with only a due date sit in the all-day row.
- Calendars (Personal, Work, Church…) have colours and can be shown or hidden.
- On desktop, the task list sits next to the calendar. **Drag a task onto
  the grid** to schedule it, or drag an event to move it.

**Tasks**
- **To Do / In Progress / Done**: tabs on a phone, a drag-and-drop board on
  desktop.
- Each task can have a priority, a list (calendar), a due date, a time block
  with duration, steps (subtasks) and notes.
- **Find the next free slot** checks your calendar and fills in the time
  block for you.
- Quick-add, filtering by list, and Undo on every change.

**Settings**: your name, theme (System / Light / Dark, where System follows
Telegram), week start, 12/24h clock, default event length, plannable hours,
and calendar names and colours. There's also backup export/import, and you can
remove the sample data.

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
npm test        # unit tests (recurrence, free-slot finder, overlap layout)
npm run build   # type-check + production build into dist/
```

## Put it in Telegram

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

Every header, drawer and sheet is laid out below `--inset-top`. The bottom
navigation pads by the bottom inset (the home indicator), and the left and
right insets are respected in landscape.

## Your data

Everything is stored on the device. Inside Telegram (Bot API 9.0+) that's
Telegram's `DeviceStorage` (5 MB per user per bot), mirrored to
`localStorage`. In a browser it's `localStorage` only. Use **Settings → Data**
to download, copy or import a backup. Nothing is sent to a server.

## Project layout

```
src/
  lib/          dates, recurrence, overlap layout, free-slot finder, Telegram bridge
  store/        persisted data store (events, tasks, calendars, settings) + UI state
  views/        Today, Calendar (TimeGrid, Month, Agenda), Tasks, Settings
  components/   editor sheet, task item, sidebar/drawer, bottom nav, search, …
  styles/       design tokens (light/dark), base controls, layout, views
```

Stack: React 19, TypeScript, Vite, Zustand, date-fns and lucide icons.
The fonts are Poppins for headings and Inter for text, bundled so it works
offline.
