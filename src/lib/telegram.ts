/**
 * Telegram Mini App integration.
 *
 * Layout notes (Bot API 8.0+ fullscreen):
 *  - `safeAreaInset`        → device insets (status bar, notch, home indicator)
 *  - `contentSafeAreaInset` → extra inset covered by Telegram's own floating
 *                              controls (Close / ⋯ buttons) in fullscreen
 * Neither has a fixed size — they differ per device and client — so we read
 * them at runtime and expose them as CSS variables. The app header is pushed
 * below `safeAreaInset.top + contentSafeAreaInset.top`.
 *
 * Everything here is a no-op outside Telegram, so the app also runs as a
 * normal web app / PWA.
 */
import type { StateStorage } from 'zustand/middleware';

type Insets = { top: number; bottom: number; left: number; right: number };
type Cb = () => void;
type StorageCb = (err: string | null, value?: string | null) => void;

interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isFullscreen?: boolean;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  onEvent(name: string, cb: Cb): void;
  offEvent(name: string, cb: Cb): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: Cb): void; offClick(cb: Cb): void };
  requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  DeviceStorage?: {
    setItem(key: string, value: string, cb?: StorageCb): void;
    getItem(key: string, cb: StorageCb): void;
    removeItem(key: string, cb?: StorageCb): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

function getWebApp(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  const wa = window.Telegram?.WebApp;
  // The SDK script also loads in a normal browser; platform is "unknown" there.
  if (!wa || !wa.platform || wa.platform === 'unknown') return null;
  return wa;
}

export const tg = getWebApp();
export const isTelegram = !!tg;

/** `?tgsim` in the URL simulates Telegram fullscreen insets for previewing in a browser. */
export const isTgSimulation =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tgsim');

const atLeast = (v: string) => !!tg && tg.isVersionAtLeast(v);

function applyInsets() {
  const root = document.documentElement.style;
  let sa: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  let csa: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  if (tg) {
    sa = { ...sa, ...tg.safeAreaInset };
    csa = { ...csa, ...tg.contentSafeAreaInset };
  } else if (isTgSimulation) {
    // Typical iPhone (notch) values; real values are read at runtime in Telegram.
    sa = { top: 47, bottom: 34, left: 0, right: 0 };
    csa = { top: 46, bottom: 0, left: 0, right: 0 };
  }
  root.setProperty('--tg-sa-top', `${sa.top}px`);
  root.setProperty('--tg-sa-bottom', `${sa.bottom}px`);
  root.setProperty('--tg-sa-left', `${sa.left}px`);
  root.setProperty('--tg-sa-right', `${sa.right}px`);
  root.setProperty('--tg-csa-top', `${csa.top}px`);
  root.setProperty('--tg-csa-bottom', `${csa.bottom}px`);
  root.setProperty('--tg-csa-left', `${csa.left}px`);
  root.setProperty('--tg-csa-right', `${csa.right}px`);
}

export function initTelegram() {
  applyInsets();
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Our calendar scrolls vertically; don't let a downward swipe minimise the app.
  if (atLeast('7.7')) tg.disableVerticalSwipes?.();
  const mobile = tg.platform === 'ios' || tg.platform === 'android';
  if (atLeast('8.0') && mobile && !tg.isFullscreen) {
    try {
      tg.requestFullscreen?.();
    } catch {
      /* unsupported client */
    }
  }
  for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) {
    tg.onEvent(ev, applyInsets);
  }
}

export function telegramColorScheme(): 'light' | 'dark' | null {
  return tg ? tg.colorScheme : null;
}

export function onTelegramThemeChange(cb: Cb): () => void {
  if (!tg) return () => {};
  tg.onEvent('themeChanged', cb);
  return () => tg.offEvent('themeChanged', cb);
}

/** Matches Telegram's status bar / background / Android nav bar to our theme. */
export function setTelegramChrome(colors: { header: string; background: string; bottomBar: string }) {
  if (!tg) return;
  try {
    if (atLeast('6.1')) {
      tg.setHeaderColor?.(colors.header);
      tg.setBackgroundColor?.(colors.background);
    }
    if (atLeast('7.10')) tg.setBottomBarColor?.(colors.bottomBar);
  } catch {
    /* older client */
  }
}

/** Signed launch data, which the server checks to sign you in. */
export function telegramInitData(): string | null {
  return tg?.initData || null;
}

export function telegramUserId(): number | null {
  return tg?.initDataUnsafe?.user?.id ?? null;
}

/** Asks for permission for the bot to message you (Bot API 6.9+). */
export function requestWriteAccess(): Promise<boolean> {
  if (!tg || !atLeast('6.9') || !tg.requestWriteAccess) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      tg.requestWriteAccess!((granted) => resolve(!!granted));
    } catch {
      resolve(false);
    }
  });
}

/** Opens a t.me link: inside Telegram without leaving it, elsewhere in a new tab. */
export function openTelegramLink(url: string) {
  if (tg?.openTelegramLink && atLeast('6.1')) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export const haptic = {
  success() {
    if (atLeast('6.1')) tg?.HapticFeedback?.notificationOccurred('success');
  },
  tap() {
    if (atLeast('6.1')) tg?.HapticFeedback?.impactOccurred('light');
  },
  select() {
    if (atLeast('6.1')) tg?.HapticFeedback?.selectionChanged();
  },
};

/** Shows Telegram's native back button while `handler` is set. */
export function bindBackButton(handler: (() => void) | null): () => void {
  if (!tg || !atLeast('6.1') || !tg.BackButton) return () => {};
  const bb = tg.BackButton;
  if (!handler) {
    bb.hide();
    return () => {};
  }
  bb.onClick(handler);
  bb.show();
  return () => {
    bb.offClick(handler);
    bb.hide();
  };
}

/**
 * Storage for persisted state. Inside Telegram (Bot API 9.0+) data is kept in
 * DeviceStorage (up to 5 MB per user per bot) and mirrored to localStorage;
 * elsewhere it is plain localStorage.
 */
const deviceStorage = atLeast('9.0') ? tg?.DeviceStorage ?? null : null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

export const appStorage: StateStorage = {
  getItem: async (name) => {
    if (deviceStorage) {
      const value = await new Promise<string | null>((resolve) => {
        const t = setTimeout(() => resolve(null), 1500);
        try {
          deviceStorage.getItem(name, (err, val) => {
            clearTimeout(t);
            resolve(err ? null : (val ?? null));
          });
        } catch {
          clearTimeout(t);
          resolve(null);
        }
      });
      if (value) return value;
    }
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* storage unavailable */
    }
    if (deviceStorage) {
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        try {
          deviceStorage.setItem(name, value);
        } catch {
          /* ignore */
        }
      }, 400);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
    try {
      deviceStorage?.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
