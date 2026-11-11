export function uid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}
