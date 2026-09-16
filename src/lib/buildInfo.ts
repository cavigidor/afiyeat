// Build identity, stamped in by Vite at build time (see the `define` block
// in vite.config.ts). Surfaced in two places:
//   - the bottom of the Profile screen, as small muted text
//   - a console.info on boot, visible in Safari Web Inspector
//
// The point is to make "which build is this device actually running?"
// answerable in one glance, instead of something to be inferred from
// whether a given fix appears to be present.

declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev';

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/** e.g. "d7f3d13 · Sep 15, 14:32" - short enough for a one-line footer. */
export function buildLabel(): string {
  if (!BUILD_TIME) return BUILD_COMMIT;
  const when = new Date(BUILD_TIME);
  if (Number.isNaN(when.getTime())) return BUILD_COMMIT;
  const stamp = when.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${BUILD_COMMIT} · ${stamp}`;
}
