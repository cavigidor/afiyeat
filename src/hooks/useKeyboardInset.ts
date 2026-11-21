import { useEffect, useState } from 'react';

/**
 * How many pixels of the layout viewport the on-screen keyboard covers right now (0 when it's closed).
 *
 * The iOS web view doesn't resize for the keyboard; only the visual viewport shrinks. A sheet pinned to
 * the bottom of the screen would sit behind the keyboard, buttons included. Lifting it by this amount
 * keeps it above the keyboard. Where the browser resizes the layout viewport instead, this stays 0.
 */
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) { setInset(0); return; }
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore small differences (toolbars, rounding): a keyboard is well over 100px.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return inset;
}
