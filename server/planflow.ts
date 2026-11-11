/**
 * Plans from forwarded messages, in the chat with the bot.
 *
 *  1. Forward one or more messages (or photos of a poster) to the bot.
 *     Forwards that arrive together are read together.
 *  2. Claude suggests events and to-dos. The bot shows them as a draft with
 *     Add / Edit in Daybook / Cancel. Nothing is added yet.
 *  3. Reply to the draft in your own words to change it ("make it 3pm"), open
 *     it in Daybook to edit each item, or add it as it is (with Undo).
 *
 * Only on when the server has an Anthropic API key and you've turned it on in
 * Settings. Contact details are removed before anything is sent to Claude, and
 * the message text itself isn't stored: a draft keeps only the suggestions.
 */
import type { CalEvent, Task } from '../src/types';
import { uid } from '../src/lib/id';
import { isValidTimeZone, wallClock } from '../src/lib/tz';
import { describeWhen, planToEvent, planToTask, redactContacts, type PlanItem } from '../src/lib/plans';
import { newToken } from './auth';
import { ClaudeError, type PlanReader, type ReadContext } from './claude';
import type { Config } from './config';
import { esc } from './messages';
import type { Kind, Store, User } from './store';
import type { InlineButton, TgMessage, TgPhotoSize } from './telegram';

/** What the plan flow needs from the bot */
export interface ChatPort {
  post(chatId: number, html: string, rows?: InlineButton[][]): Promise<number | null>;
  edit(chatId: number, messageId: number, html: string, rows?: InlineButton[][]): Promise<void>;
  typing(chatId: number): Promise<void>;
  answer(callbackId: string, text: string): Promise<void>;
  photo(fileId: string): Promise<Buffer>;
  appLink: string | null;
}

interface Pending {
  user: User;
  texts: string[];
  photos: string[];
  sentAt: number | null;
  timer?: ReturnType<typeof setTimeout>;
}

const MAX_PHOTOS = 4;
const CALLS_PER_HOUR = 30;
const TG_TEXT_LIMIT = 4000;

/** The largest version of a photo that's still a sensible size to read. */
function pickPhoto(sizes: TgPhotoSize[]): TgPhotoSize {
  const fit = sizes.filter((s) => Math.max(s.width, s.height) <= 2000);
  return (fit.length ? fit : sizes).reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

export class PlanFlow {
  private pending = new Map<number, Pending>();
  private calls = new Map<number, number[]>();

  constructor(
    private chat: ChatPort,
    private store: Store,
    private cfg: Config,
    private reader: PlanReader,
    private batchMs = 2000,
  ) {}

  /** Collects a forwarded message or photo; the batch is read once forwards stop arriving. */
  collect(user: User, m: TgMessage) {
    let p = this.pending.get(user.id);
    if (!p) {
      p = { user, texts: [], photos: [], sentAt: null };
      this.pending.set(user.id, p);
    }
    const text = (m.text ?? m.caption ?? '').trim();
    if (text) p.texts.push(text);
    if (m.photo?.length) p.photos.push(pickPhoto(m.photo).file_id);
    const sent = (m.forward_origin?.date ?? m.date ?? 0) * 1000;
    if (sent) p.sentAt = p.sentAt ? Math.min(p.sentAt, sent) : sent;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.flush(user.id).catch((e) => console.error('Plans:', (e as Error).message)), this.batchMs);
  }

  /** Reads what's been collected for a user. Public so tests needn't wait. */
  async flush(userId: number) {
    const p = this.pending.get(userId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(userId);
    if (!this.enabled(p.user)) return;
    const images: { mediaType: 'image/jpeg'; data: string }[] = [];
    for (const id of p.photos.slice(0, MAX_PHOTOS)) {
      try {
        images.push({ mediaType: 'image/jpeg', data: (await this.chat.photo(id)).toString('base64') });
      } catch {
        /* skip a photo that can't be fetched */
      }
    }
    if (!p.texts.length && !images.length) return;
    await this.read(p.user, { texts: p.texts.map(redactContacts), images }, p.sentAt);
  }

  /** /plan <text>: read plans from text typed straight to the bot. */
  async planText(user: User, text: string) {
    if (!this.enabled(user)) return;
    await this.read(user, { texts: [redactContacts(text)], images: [] }, Date.now());
  }

  private enabled(user: User): boolean {
    if (this.store.userData(user.id).settings.aiPlans) return true;
    void this.chat.post(
      user.id,
      'I can turn plans in forwarded messages into calendar items, using Claude (Anthropic’s AI). It’s off for now: turn on <b>Plans from messages</b> in Daybook’s Settings, then forward the message again.',
      this.chat.appLink ? [[{ text: 'Open Daybook', web_app: { url: this.chat.appLink } }]] : undefined,
    );
    return false;
  }

  private overBudget(userId: number): boolean {
    const now = Date.now();
    const recent = (this.calls.get(userId) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= CALLS_PER_HOUR) return true;
    recent.push(now);
    this.calls.set(userId, recent);
    return false;
  }

  private context(user: User, sentAt: number | null): ReadContext {
    const { calendars, settings } = this.store.userData(user.id);
    const tz = user.tz && isValidTimeZone(user.tz) ? user.tz : this.cfg.defaultTz;
    return {
      tz,
      now: wallClock(tz, Date.now()),
      sentAt: sentAt ? wallClock(tz, sentAt) : null,
      tags: calendars.map((c) => ({ id: c.id, name: c.name })),
      weekStartsOn: settings.weekStartsOn,
    };
  }

  private async read(user: User, input: { texts: string[]; images: { mediaType: 'image/jpeg'; data: string }[] }, sentAt: number | null) {
    if (this.overBudget(user.id)) {
      await this.chat.post(user.id, 'That’s a lot of messages this hour. Try again a little later.');
      return;
    }
    await this.chat.typing(user.id);
    try {
      const { items, note } = await this.reader.read(input, this.context(user, sentAt));
      if (!items.length) {
        await this.chat.post(user.id, `I couldn’t find anything to add in that.${note ? `\n<i>${esc(note)}</i>` : ''}`);
        return;
      }
      const id = newToken(16);
      this.store.createDraft(id, user.id, items, note);
      await this.showDraft(user, id);
    } catch (e) {
      await this.chat.post(user.id, this.failure(e));
    }
  }

  /** A reply to a draft: apply the change in words. */
  async revise(user: User, draftId: string, request: string) {
    const draft = this.store.draft(user.id, draftId);
    if (!draft) return;
    if (draft.status !== 'open') {
      await this.chat.post(user.id, draft.status === 'added' ? 'Those are already on your calendar. Change them in Daybook.' : 'That draft was cancelled. Forward the message again to start over.');
      return;
    }
    if (this.overBudget(user.id)) {
      await this.chat.post(user.id, 'That’s a lot of changes this hour. Try again a little later, or edit it in Daybook.');
      return;
    }
    await this.chat.typing(user.id);
    try {
      const { items, note } = await this.reader.revise(draft.items, redactContacts(request), this.context(user, null));
      if (draft.messageId) await this.chat.edit(user.id, draft.messageId, this.draftHtml(user, draft.items, null, 'Updated below.'), []);
      if (!items.length) {
        this.store.updateDraft(user.id, draftId, { items, status: 'cancelled' });
        await this.chat.post(user.id, 'That leaves nothing to add, so I’ve cancelled it.');
        return;
      }
      this.store.updateDraft(user.id, draftId, { items, note });
      await this.showDraft(user, draftId);
    } catch (e) {
      await this.chat.post(user.id, this.failure(e));
    }
  }

  private failure(e: unknown): string {
    if (!(e instanceof ClaudeError)) {
      console.error('Plans:', (e as Error).message);
      return 'Something went wrong reading that. Try again in a moment.';
    }
    switch (e.kind) {
      case 'auth':
        return 'Reading plans isn’t working right now: the server’s Anthropic API key was turned down. Whoever runs this Daybook should check ANTHROPIC_API_KEY.';
      case 'busy':
        return 'Claude is busy right now. Forward it again in a minute.';
      case 'refused':
        return 'Claude didn’t read that one. You can add it yourself in Daybook.';
      case 'too_long':
        return 'That’s too much to read in one go. Forward a shorter part.';
      default:
        return 'I couldn’t read plans from that. Try again, or add it yourself in Daybook.';
    }
  }

  /* ---------- How a draft looks in the chat ---------- */

  private tagNames(userId: number) {
    const { calendars } = this.store.userData(userId);
    return { names: new Map(calendars.map((c) => [c.id, c.name])), fallback: calendars[0]?.name ?? 'Personal' };
  }

  private draftHtml(user: User, items: PlanItem[], note: string | null, footer?: string): string {
    const { settings } = this.store.userData(user.id);
    const tags = this.tagNames(user.id);
    const now = wallClock(user.tz && isValidTimeZone(user.tz) ? user.tz : this.cfg.defaultTz, Date.now());
    const lines = [items.length === 1 ? 'I found 1 plan. Check it before I add it:' : `I found ${items.length} plans. Check them before I add them:`, ''];
    let shown = 0;
    for (const it of items) {
      const block = [`${shown + 1}. ${it.kind === 'event' ? '📅' : '☐'} <b>${esc(it.title)}</b>`];
      const details = [esc(describeWhen(it, settings.timeFormat, now))];
      if (it.location) details.push(esc(it.location));
      if (it.kind === 'event') details.push(esc(it.tagId ? (tags.names.get(it.tagId) ?? tags.fallback) : tags.fallback));
      block.push(`    ${details.join(' · ')}`);
      if (it.assumption) block.push(`    <i>${esc(it.assumption)}</i>`);
      if (lines.join('\n').length + block.join('\n').length > TG_TEXT_LIMIT - 400) {
        lines.push(`…and ${items.length - shown} more. Open it in Daybook to see them all.`);
        break;
      }
      lines.push(...block);
      shown++;
    }
    if (note) lines.push('', `<i>${esc(note)}</i>`);
    lines.push('', footer ?? 'Reply to this message to change something, e.g. “make it 3pm” or “drop the second one”.');
    return lines.join('\n');
  }

  private draftButtons(draftId: string, count: number): InlineButton[][] {
    const top: InlineButton[] = [{ text: count === 1 ? 'Add it' : `Add all ${count}`, callback_data: `padd:${draftId}` }];
    if (this.chat.appLink) top.push({ text: 'Edit in Daybook', web_app: { url: `${this.chat.appLink}/?review=${draftId}` } });
    return [top, [{ text: 'Cancel', callback_data: `pcancel:${draftId}` }]];
  }

  private async showDraft(user: User, draftId: string) {
    const draft = this.store.draft(user.id, draftId)!;
    const messageId = await this.chat.post(user.id, this.draftHtml(user, draft.items, draft.note), this.draftButtons(draftId, draft.items.length));
    this.store.updateDraft(user.id, draftId, { messageId });
  }

  /* ---------- Buttons under a draft ---------- */

  /** Handles Add / Undo / Cancel. Returns false for buttons that aren't the plan flow's. */
  async onButton(q: { id: string; from: { id: number }; data?: string; message?: TgMessage }): Promise<boolean> {
    const [action, draftId] = (q.data ?? '').split(':');
    if (!['padd', 'pundo', 'pcancel'].includes(action) || !draftId) return false;
    const user = this.store.user(q.from.id);
    // Only the person the draft belongs to can act on it.
    const draft = user ? this.store.draft(user.id, draftId) : null;
    if (!user || !draft) {
      await this.chat.answer(q.id, 'That draft has expired');
      return true;
    }

    if (action === 'padd') {
      if (draft.status !== 'open') return this.chat.answer(q.id, draft.status === 'added' ? 'Already added' : 'That was cancelled').then(() => true);
      const added = this.addAll(user, draft.items);
      this.store.updateDraft(user.id, draftId, { status: 'added', added });
      await this.chat.answer(q.id, 'Added');
      if (draft.messageId) await this.chat.edit(user.id, draft.messageId, this.addedHtml(user, draft.items), this.addedButtons(draftId));
      return true;
    }

    if (action === 'pundo') {
      if (draft.status !== 'added' || !draft.added.length) return this.chat.answer(q.id, 'Nothing to undo').then(() => true);
      for (const a of draft.added) this.store.putRecord(user.id, a.kind, a.id, null);
      this.store.updateDraft(user.id, draftId, { status: 'open', added: [] });
      await this.chat.answer(q.id, 'Removed from your calendar');
      if (draft.messageId) await this.chat.edit(user.id, draft.messageId, this.draftHtml(user, draft.items, draft.note), this.draftButtons(draftId, draft.items.length));
      return true;
    }

    // pcancel
    if (draft.status === 'open') this.store.updateDraft(user.id, draftId, { status: 'cancelled' });
    await this.chat.answer(q.id, 'Cancelled');
    if (draft.messageId && draft.status === 'open') await this.chat.edit(user.id, draft.messageId, 'Cancelled. Nothing was added.', []);
    return true;
  }

  /** Adds every item to the calendar, the same way the app would. */
  private addAll(user: User, items: PlanItem[]): { kind: Kind; id: string }[] {
    const { calendars, settings } = this.store.userData(user.id);
    const fallbackTag = calendars[0]?.id ?? 'personal';
    const added: { kind: Kind; id: string }[] = [];
    for (const it of items) {
      const now = Date.now();
      const id = uid();
      if (it.kind === 'event') {
        const ev: CalEvent = { ...planToEvent(it, { defaultMinutes: settings.defaultEventMinutes, fallbackTag }), id, createdAt: now, updatedAt: now };
        this.store.putRecord(user.id, 'event', id, ev);
        added.push({ kind: 'event', id });
      } else {
        const task: Task = {
          id,
          ...planToTask(it),
          status: 'todo',
          priority: 'none',
          calendarId: null,
          dueDate: null,
          subtasks: [],
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        this.store.putRecord(user.id, 'task', id, task);
        added.push({ kind: 'task', id });
      }
    }
    return added;
  }

  private addedHtml(user: User, items: PlanItem[], via?: string): string {
    const { settings } = this.store.userData(user.id);
    const now = wallClock(user.tz && isValidTimeZone(user.tz) ? user.tz : this.cfg.defaultTz, Date.now());
    const lines = [`Added to Daybook${via ? ` ${via}` : ''} ✓`];
    for (const it of items) lines.push(`${it.kind === 'event' ? '📅' : '☐'} <b>${esc(it.title)}</b> · ${esc(describeWhen(it, settings.timeFormat, now))}`);
    return lines.join('\n').slice(0, TG_TEXT_LIMIT);
  }

  private addedButtons(draftId: string): InlineButton[][] {
    const row: InlineButton[] = [{ text: 'Undo', callback_data: `pundo:${draftId}` }];
    if (this.chat.appLink) row.push({ text: 'Open Daybook', web_app: { url: this.chat.appLink } });
    return [row];
  }

  /** The app added (some of) a draft's items, or discarded it: update the chat to match. */
  async closedInApp(user: User, draftId: string, outcome: { added: PlanItem[] } | 'cancelled') {
    const draft = this.store.draft(user.id, draftId);
    if (!draft || draft.status !== 'open') return;
    if (outcome === 'cancelled') {
      this.store.updateDraft(user.id, draftId, { status: 'cancelled' });
      if (draft.messageId) await this.chat.edit(user.id, draft.messageId, 'Cancelled in Daybook. Nothing was added.', []);
      return;
    }
    this.store.updateDraft(user.id, draftId, { status: 'added', items: outcome.added.length ? outcome.added : draft.items });
    if (draft.messageId) {
      const rows = this.chat.appLink ? [[{ text: 'Open Daybook', web_app: { url: this.chat.appLink } }]] : [];
      await this.chat.edit(user.id, draft.messageId, this.addedHtml(user, outcome.added, 'from the app'), rows);
    }
  }
}
