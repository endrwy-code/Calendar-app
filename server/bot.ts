/**
 * The Telegram bot: sends alerts and the morning summary, answers /today,
 * /tomorrow and /next, adds to-dos from messages, and hands out sign-in links
 * for using Daybook in a browser. It fetches updates by long polling, so it
 * works behind any host without setting up a webhook.
 */
import { startOfDay, addDays, format } from 'date-fns';
import type { Task } from '../src/types';
import { uid } from '../src/lib/id';
import { isValidTimeZone, wallClock } from '../src/lib/tz';
import { isAllowed, type Config } from './config';
import { newToken, sha256 } from './auth';
import { agendaText, esc, nextText } from './messages';
import type { Store, User } from './store';
import { BotApi, TelegramError, type InlineButton, type TgUpdate, type TgUser } from './telegram';

export interface Messenger {
  send(chatId: number, html: string, opts?: { app?: boolean; buttons?: InlineButton[][] }): Promise<void>;
}

const COMMANDS = [
  { command: 'today', description: 'What’s on today' },
  { command: 'tomorrow', description: 'What’s on tomorrow' },
  { command: 'next', description: 'Your next event' },
  { command: 'todo', description: 'Add a to-do (or just send me the text)' },
  { command: 'login', description: 'Sign in on a computer or in a browser' },
  { command: 'help', description: 'What I can do' },
];

const LOGIN_TTL_MS = 15 * 60000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bot implements Messenger {
  username: string | null = null;
  private running = false;
  private abort = new AbortController();

  constructor(
    readonly api: BotApi,
    private store: Store,
    private cfg: Config,
  ) {}

  /** The app's address, if Telegram will accept it in a button (https only). */
  private get appLink(): string | null {
    return this.cfg.appUrl?.startsWith('https://') ? this.cfg.appUrl : null;
  }

  /** Connects to Telegram and sets up the command list and menu button. */
  async init(): Promise<boolean> {
    try {
      const me = await this.api.call<TgUser>('getMe');
      this.username = me.username ?? null;
    } catch (e) {
      console.error(`Telegram: couldn’t connect the bot (${(e as Error).message}). Check BOT_TOKEN.`);
      return false;
    }
    try {
      await this.api.call('setMyCommands', { commands: COMMANDS });
      if (this.appLink) {
        await this.api.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Daybook', web_app: { url: this.appLink } } });
      }
    } catch (e) {
      console.warn(`Telegram: couldn’t set the menu (${(e as Error).message})`);
    }
    console.log(`Telegram: connected as @${this.username}`);
    return true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    this.abort.abort();
  }

  async send(chatId: number, html: string, opts: { app?: boolean; buttons?: InlineButton[][] } = {}) {
    const rows = [...(opts.buttons ?? [])];
    if (opts.app && this.appLink) rows.push([{ text: 'Open Daybook', web_app: { url: this.appLink } }]);
    await this.api.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    });
  }

  async sendFile(chatId: number, name: string, content: string, mime: string) {
    await this.api.sendDocument(chatId, name, content, mime);
  }

  private async loop() {
    while (this.running && !this.username) {
      if (await this.init()) break;
      await sleep(30000);
    }
    // Long polling and webhooks can't both be on.
    await this.api.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    let offset = Number(this.store.getMeta('telegram_offset') ?? 0);
    let backoff = 1000;
    while (this.running) {
      try {
        const updates = await this.api.call<TgUpdate[]>(
          'getUpdates',
          { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          this.abort.signal,
        );
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          this.store.setMeta('telegram_offset', String(offset));
          try {
            await this.handle(u);
          } catch (e) {
            console.error('Telegram: couldn’t handle an update:', (e as Error).message);
          }
        }
      } catch (e) {
        if (!this.running) break;
        if (e instanceof TelegramError && e.code === 409) console.error('Telegram: another copy of this bot is running (only one may poll for updates).');
        else if (e instanceof TelegramError && e.code !== 0) console.error(`Telegram: ${e.message}`);
        await sleep(e instanceof TelegramError && e.retryAfter ? e.retryAfter * 1000 : backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  /** Handles one update from Telegram. Public for tests. */
  async handle(u: TgUpdate) {
    if (u.callback_query) return this.onButton(u.callback_query);
    const m = u.message;
    if (!m?.from || m.from.is_bot || m.chat.type !== 'private') return;
    const from = m.from;
    if (!isAllowed(this.cfg, { id: from.id, username: from.username })) {
      await this.send(m.chat.id, 'Sorry, this Daybook is private.');
      return;
    }
    const user = this.store.upsertUser({ id: from.id, firstName: from.first_name, username: from.username ?? null });
    // A private chat with the bot means it may write back.
    if (!user.chatOk) this.store.setChatOk(user.id, true);

    const text = (m.text ?? '').trim();
    if (!text) return;
    const cmd = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
    if (!cmd) return this.addTodo(user, text);
    const arg = (cmd[2] ?? '').trim();
    switch (cmd[1].toLowerCase()) {
      case 'start':
        return arg === 'login' ? this.sendLogin(user) : this.welcome(user);
      case 'today':
        return this.agenda(user, 0);
      case 'tomorrow':
        return this.agenda(user, 1);
      case 'next':
        return this.next(user);
      case 'todo':
        return arg ? this.addTodo(user, arg) : this.send(user.id, 'Send <code>/todo</code> and what you need to do, e.g. <code>/todo Call the plumber</code>. Or just send me the text.');
      case 'login':
        return this.sendLogin(user);
      default:
        return this.welcome(user, true);
    }
  }

  private tzOf(user: User) {
    return user.tz && isValidTimeZone(user.tz) ? user.tz : this.cfg.defaultTz;
  }

  private async welcome(user: User, help = false) {
    const lines = [
      help ? 'Here’s what I can do:' : `Hi ${esc(user.firstName || 'there')}! I’m your Daybook.`,
      '',
      '• I send your alerts here, and a morning summary if you turn it on in Settings.',
      '• Send me any text and I’ll add it to your to-dos.',
      '• /today and /tomorrow show what’s on. /next shows your next event.',
      '• /login gives you a link to use Daybook in a browser.',
    ];
    await this.send(user.id, lines.join('\n'), { app: true });
  }

  private async agenda(user: User, offset: number) {
    const { events, tasks, settings } = this.store.userData(user.id);
    const day = addDays(startOfDay(wallClock(this.tzOf(user), Date.now())), offset);
    const heading = `${offset === 0 ? 'Today' : 'Tomorrow'} · ${format(day, 'EEEE d MMMM')}`;
    await this.send(user.id, agendaText(events, tasks, settings.timeFormat, day, heading), { app: true });
  }

  private async next(user: User) {
    const { events, tasks, settings } = this.store.userData(user.id);
    await this.send(user.id, nextText(events, tasks, settings.timeFormat, wallClock(this.tzOf(user), Date.now())), { app: true });
  }

  /** First line becomes the title, anything after it the notes. */
  private async addTodo(user: User, raw: string) {
    const [first, ...rest] = raw.split('\n');
    const title = first.trim().slice(0, 300);
    if (!title) return;
    const now = Date.now();
    const task: Task = {
      id: uid(),
      title,
      notes: rest.join('\n').trim().slice(0, 5000),
      status: 'todo',
      priority: 'none',
      calendarId: null,
      dueDate: null,
      scheduledStart: null,
      durationMin: 30,
      subtasks: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.store.putRecord(user.id, 'task', task.id, task);
    await this.send(user.id, `Added to your to-dos:\n<b>${esc(title)}</b>`, { buttons: [[{ text: 'Undo', callback_data: `undo:${task.id}` }]] });
  }

  private async onButton(q: NonNullable<TgUpdate['callback_query']>) {
    const [action, id] = (q.data ?? '').split(':');
    if (action !== 'undo' || !id) return;
    // Only ever touches the tapping user's own records.
    const task = this.store.record<Task>(q.from.id, 'task', id);
    if (task) this.store.putRecord(q.from.id, 'task', id, null);
    await this.api.call('answerCallbackQuery', { callback_query_id: q.id, text: task ? 'Removed' : 'Already removed' }).catch(() => {});
    if (task && q.message) {
      await this.api
        .call('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `Removed: <s>${esc(task.title)}</s>`, parse_mode: 'HTML' })
        .catch(() => {});
    }
  }

  /** A one-time link that signs a browser in (valid for 15 minutes). */
  private async sendLogin(user: User) {
    if (!this.cfg.appUrl) {
      await this.send(user.id, 'Sign-in links need the server’s address. Set APP_URL on the server.');
      return;
    }
    const code = newToken(24);
    this.store.createCode(sha256(code), user.id, Date.now() + LOGIN_TTL_MS);
    const url = `${this.cfg.appUrl}/?login=${code}`;
    const text = 'Open this link to sign in to Daybook in a browser. It works once, for the next 15 minutes. Don’t share it.';
    if (this.appLink) await this.send(user.id, text, { buttons: [[{ text: 'Sign in', url }]] });
    else await this.send(user.id, `${text}\n\n${esc(url)}`);
  }
}
