// Demo build only. Deterministic placeholder "photos" (SVG data URLs) for fixture rows, so cards
// and galleries have something to show without downloading anything.
const PALETTES: [string, string][] = [
  ['#7a1f3d', '#e8a1b3'], ['#2f4f2f', '#a7c4a0'], ['#5b3a1e', '#d9b38c'], ['#1e3a5f', '#9cc3e6'],
  ['#5f1e5a', '#e0a6da'], ['#3d3d1f', '#d8d48c'], ['#1f4d4d', '#8fd3cf'], ['#6b2e12', '#f0b08a'],
];
const EMOJI: Record<string, string> = {
  wine: '🍷', beer: '🍺', coffee: '☕', bean: '🫘', book: '📚', food: '🍽️', pizza: '🍕', ramen: '🍜',
  taco: '🌮', sushi: '🍣', cake: '🍰', city: '🏙️', beach: '🏖️', mountain: '⛰️', store: '🛍️', cocktail: '🍸',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function demoImage(seed: string): string {
  const h = hash(seed);
  const [a, b] = PALETTES[h % PALETTES.length];
  const key = Object.keys(EMOJI).find((k) => seed.toLowerCase().includes(k));
  const emoji = key ? EMOJI[key] : '📷';
  const angle = h % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/><circle cx="${150 + (h % 300)}" cy="${120 + (h % 200)}" r="${90 + (h % 80)}" fill="#fff" opacity=".12"/>
<text x="300" y="345" font-size="190" text-anchor="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
