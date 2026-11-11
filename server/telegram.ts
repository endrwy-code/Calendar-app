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

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  date?: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  /** Set on forwarded messages; `date` is when the original was sent */
  forward_origin?: { type: string; date: number };
  media_group_id?: string;
  reply_to_message?: TgMessage;
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

  /** Downloads a file someone sent the bot (photos are JPEG). Capped at 8 MB. */
  async downloadFile(fileId: string): Promise<Buffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path || (file.file_size ?? 0) > 8 * 1024 * 1024) throw new TelegramError(400, 'file too large');
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    } catch {
      throw new TelegramError(0, 'network error');
    }
    if (!res.ok) throw new TelegramError(res.status, 'download failed');
    return Buffer.from(await res.arrayBuffer());
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
