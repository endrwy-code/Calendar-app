/** A small client for the Telegram Bot API (plain fetch, no library). */

export class TelegramError extends Error {
  constructor(
    public code: number,
    public description: string,
    public retryAfter?: number,
  ) {
    super(`Telegram ${code}: ${description}`);
  }
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

export type InlineButton = { text: string; url?: string; web_app?: { url: string }; callback_data?: string };

export class BotApi {
  constructor(private token: string) {}

  /** Calls a Bot API method. The token never appears in errors or logs. */
  async call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new TelegramError(0, 'network error');
    }
    const body = (await res.json().catch(() => null)) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (!body?.ok) throw new TelegramError(body?.error_code ?? res.status, body?.description ?? 'unknown error', body?.parameters?.retry_after);
    return body.result as T;
  }

  /** Sends a file as a document. */
  async sendDocument(chatId: number, fileName: string, content: string, mime: string, caption?: string): Promise<void> {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('document', new Blob([content], { type: mime }), fileName);
    if (caption) form.set('caption', caption);
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: 'POST', body: form });
    } catch {
      throw new TelegramError(0, 'network error');
    }
    const body = (await res.json().catch(() => null)) as { ok: boolean; error_code?: number; description?: string } | null;
    if (!body?.ok) throw new TelegramError(body?.error_code ?? res.status, body?.description ?? 'unknown error');
  }
}
