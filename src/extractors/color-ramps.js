import { parseColor, rgbToHex } from '../utils.js';
import { hexToOklch, oklchToHex } from '../utils/color-gamut.js';

// ── Tonal ramps ─────────────────────────────────────────────────
//
// A site hands you one brand colour. Building anything with it needs the
// whole ladder — hover states, tinted surfaces, borders, disabled text. We
// generate it in OKLCH so every step is perceptually even, which HSL
// lightness famously is not (an HSL 50%-lightness blue and yellow look
// nothing alike in weight).

// Lightness targets per step, matching the shape most token systems ship.
const STEPS = [
  { name: '50', L: 0.971 },
  { name: '100', L: 0.936 },
  { name: '200', L: 0.885 },
  { name: '300', L: 0.808 },
  { name: '400', L: 0.704 },
  { name: '500', L: 0.606 },
  { name: '600', L: 0.531 },
  { name: '700', L: 0.455 },
  { name: '800', L: 0.396 },
  { name: '900', L: 0.343 },
  { name: '950', L: 0.238 },
];

// Chroma peaks in the middle of the ramp and falls off at both ends —
// holding chroma flat makes the light steps look radioactive and the dark
// steps muddy.
function chromaFor(baseChroma, L) {
  const falloff = 1 - Math.pow(Math.abs(L - 0.62) / 0.62, 1.6);
  return Math.max(0, baseChroma * Math.max(0.12, falloff));
}

export function buildRamp(hex) {
  const parsed = parseColor(hex);
  if (!parsed) return null;
  const base = hexToOklch(rgbToHex(parsed));
  if (!base || !Number.isFinite(base.L)) return null;

  // Which step the source colour itself occupies — so consumers can say
  // "this site's brand blue is our 600".
  let anchor = STEPS[0];
  for (const step of STEPS) {
    if (Math.abs(step.L - base.L) < Math.abs(anchor.L - base.L)) anchor = step;
  }

  const steps = {};
  for (const step of STEPS) {
    steps[step.name] = step === anchor
      ? rgbToHex(parsed)
      : oklchToHex({ L: step.L, C: chromaFor(base.C, step.L), h: base.h });
  }

  return {
    base: rgbToHex(parsed),
    anchor: anchor.name,
    hue: Math.round(base.h),
    chroma: Math.round(base.C * 1000) / 1000,
    steps,
  };
}

// ── Semantic pairs ──────────────────────────────────────────────

function luminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrast(a, b) {
  const c1 = parseColor(a);
  const c2 = parseColor(b);
  if (!c1 || !c2) return null;
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

function rate(ratio) {
  if (ratio == null) return 'unknown';
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'FAIL';
}

// Pick the foreground that reads best on a surface. The site's own text
// colours get first refusal — a pair it already ships beats one we invent —
// and black/white are the fallback of last resort, marked as such.
function bestForeground(surface, candidates) {
  let best = null;
  for (const fg of candidates) {
    const ratio = contrast(fg, surface);
    if (ratio == null) continue;
    if (!best || ratio > best.ratio) best = { fg, ratio, fromPalette: true };
  }
  if (best && best.ratio >= 4.5) return best;

  let fallback = null;
  for (const fg of ['#ffffff', '#000000']) {
    const ratio = contrast(fg, surface);
    if (ratio == null) continue;
    if (!fallback || ratio > fallback.ratio) fallback = { fg, ratio, fromPalette: false };
  }
  if (fallback && (!best || fallback.ratio > best.ratio)) return fallback;
  return best;
}

// The pairs a developer actually reaches for: what goes on the page
// background, on a card, and on the brand button — each with the contrast
// it lands at, so a failing pair is visible before it ships.
export function buildSemanticPairs(colors) {
  if (!colors) return [];
  const textCandidates = (colors.text || []).slice(0, 6);
  const surfaces = [];

  const page = colors.backgrounds?.[0];
  if (page) surfaces.push({ role: 'surface.page', bg: page });

  const raised = (colors.backgrounds || []).find(b => b !== page);
  if (raised) surfaces.push({ role: 'surface.raised', bg: raised });

  if (colors.primary?.hex) surfaces.push({ role: 'action.primary', bg: colors.primary.hex });
  if (colors.secondary?.hex) surfaces.push({ role: 'action.secondary', bg: colors.secondary.hex });
  if (colors.accent?.hex) surfaces.push({ role: 'action.accent', bg: colors.accent.hex });

  return surfaces.map(s => {
    const fg = bestForeground(s.bg, textCandidates);
    return {
      role: s.role,
      background: s.bg,
      foreground: fg ? fg.fg : null,
      ratio: fg ? fg.ratio : null,
      level: rate(fg ? fg.ratio : null),
      // False means we had to reach outside the site's own text colours to
      // find something readable on this surface.
      fromPalette: fg ? fg.fromPalette : false,
      // And this means even black or white doesn't get there.
      unresolvable: fg ? fg.ratio < 4.5 : true,
    };
  });
}
