// Builds a single-div CSS "teardrop" map pin: a rounded square rotated
// -45deg (border-radius 50% 50% 50% 0 leaves one sharp corner, which the
// rotation swings straight down) filled with the type's color, with its
// emoji rendered unrotated on top so it stays upright and centered in the
// round head. Falls back to the original plain map-pin glyph when the type
// has no emoji set (or the restaurant has no type at all).
//
// The wrapper is taller than it is wide on purpose - the rotated square's
// sharp point sits below its own box (by size * (Math.SQRT2 - 1) / 2), so
// the wrapper height accounts for that offset. Pair this with
// `new mapboxgl.Marker(el, { anchor: 'bottom' })` so Mapbox anchors the
// wrapper's bottom-center (i.e. the pin's point) at the coordinate, not
// the wrapper's visual center.

export interface PinOptions {
  color?: string | null;
  icon?: string | null;
  focused?: boolean;
}

const FALLBACK_COLOR = 'hsl(var(--primary))';

const PIN_GLYPH_PATH =
  'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';

export function createPinElement({ color, icon, focused = false }: PinOptions): HTMLDivElement {
  const size = focused ? 44 : 32;
  const wrapHeight = Math.round(size * ((Math.SQRT2 - 1) / 2 + 1));
  const pinColor = color || FALLBACK_COLOR;

  const wrap = document.createElement('div');
  wrap.className = 'transition-transform duration-300 hover:scale-110';
  wrap.style.position = 'relative';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${wrapHeight}px`;
  wrap.style.cursor = 'pointer';

  const head = document.createElement('div');
  head.style.position = 'absolute';
  head.style.top = '0';
  head.style.left = '0';
  head.style.width = `${size}px`;
  head.style.height = `${size}px`;
  head.style.boxSizing = 'border-box';
  head.style.background = pinColor;
  head.style.borderRadius = '50% 50% 50% 0';
  head.style.transform = 'rotate(-45deg)';
  head.style.border = '2px solid white';
  head.style.boxShadow = focused
    ? '0 2px 8px rgba(0,0,0,0.4), 0 0 0 4px rgba(0,0,0,0.15)'
    : '0 2px 6px rgba(0,0,0,0.35)';

  const content = document.createElement('div');
  content.style.position = 'absolute';
  content.style.top = '0';
  content.style.left = '0';
  content.style.width = `${size}px`;
  content.style.height = `${size}px`;
  content.style.display = 'flex';
  content.style.alignItems = 'center';
  content.style.justifyContent = 'center';
  content.style.pointerEvents = 'none';

  if (icon) {
    content.style.fontSize = `${focused ? 20 : 15}px`;
    content.style.lineHeight = '1';
    content.textContent = icon;
  } else {
    const glyphSize = focused ? 20 : 14;
    content.innerHTML = `<svg width="${glyphSize}" height="${glyphSize}" fill="white" viewBox="0 0 24 24"><path d="${PIN_GLYPH_PATH}"/></svg>`;
  }

  wrap.appendChild(head);
  wrap.appendChild(content);

  return wrap;
}
