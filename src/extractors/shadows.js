import { parseColor, rgbToHsl } from '../utils.js';

// Split a box-shadow value into its comma-separated layers, ignoring commas
// that live inside colour functions like `rgba(0, 0, 0, 0.1)`.
function splitLayers(raw) {
  const layers = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers.filter(Boolean);
}

function labelFor(visualWeight) {
  if (visualWeight <= 0) return 'none';
  if (visualWeight <= 3) return 'xs';
  if (visualWeight <= 8) return 'sm';
  if (visualWeight <= 16) return 'md';
  if (visualWeight <= 32) return 'lg';
  return 'xl';
}

// Parse a single layer: `inset? <x> <y> <blur>? <spread>? <color>?`
function parseLayer(raw) {
  const inset = /\binset\b/.test(raw);
  const cleaned = raw.replace(/\binset\b/g, '').trim();

  let color = '';
  let numericPart = cleaned;
  const colorFnMatch = cleaned.match(/((?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\([^)]*\)?)/);
  if (colorFnMatch) {
    color = colorFnMatch[1];
    numericPart = cleaned.replace(color, '').trim();
  } else {
    const hexMatch = cleaned.match(/(#[0-9a-fA-F]{3,8})/);
    if (hexMatch) {
      color = hexMatch[1];
      numericPart = cleaned.replace(color, '').trim();
    } else {
      const tokens = cleaned.split(/\s+/);
      const colorToken = tokens.find(t => !/^-?[\d.]+(px|rem|em)?$/.test(t) && !/^[\d.]+$/.test(t));
      if (colorToken) {
        color = colorToken;
        numericPart = cleaned.replace(colorToken, '').trim();
      }
    }
  }

  const nums = numericPart.match(/-?[\d.]+(?:px|rem|em)?/g)?.map(n => parseFloat(n)) || [];
  const offsetX = nums[0] || 0;
  const offsetY = nums[1] || 0;
  const blur = nums[2] || 0;
  const spread = nums[3] || 0;
  const visualWeight = Math.sqrt(offsetX * offsetX + offsetY * offsetY) + blur;

  return {
    raw,
    offsetX,
    offsetY,
    blur,
    spread,
    color,
    inset,
    visualWeight: Math.round(visualWeight * 100) / 100,
  };
}

// A shadow's tint tells you whether the site casts neutral black shadows or
// brand-coloured ones — the single most legible difference between a generic
// Material look and a designed one.
function describeTint(color) {
  if (!color) return { kind: 'unknown', alpha: null, hue: null, saturation: null };
  const parsed = parseColor(color);
  if (!parsed) return { kind: 'unknown', alpha: null, hue: null, saturation: null };
  const { h, s } = rgbToHsl(parsed);
  const alpha = parsed.a == null ? 1 : Math.round(parsed.a * 100) / 100;
  const kind = s > 12 ? 'colored' : 'neutral';
  return { kind, alpha, hue: Math.round(h), saturation: Math.round(s) };
}

function parseShadow(raw) {
  const layers = splitLayers(raw).map(parseLayer);
  if (layers.length === 0) layers.push(parseLayer(raw));

  // The composite reads from the widest layer — the one that defines the
  // perceived elevation. Ambient hairlines (`0 1px 2px`) stacked under a
  // `0 10px 15px` key shadow shouldn't drag the reported blur down.
  const key = layers.reduce((a, b) => (b.visualWeight > a.visualWeight ? b : a), layers[0]);
  const visualWeight = Math.round(key.visualWeight * 100) / 100;

  return {
    raw,
    offsetX: key.offsetX,
    offsetY: key.offsetY,
    blur: key.blur,
    spread: key.spread,
    color: key.color,
    inset: layers.some(l => l.inset),
    visualWeight,
    label: labelFor(visualWeight),
    layers,
    layerCount: layers.length,
    tint: describeTint(key.color),
  };
}

const LADDER_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

// Collapse the raw shadow set into an ordered elevation ladder. Sites emit
// dozens of near-identical shadows (hover variants, one-off tweaks); a design
// system has five or six levels. We bucket by visual weight and keep the most
// used raw value per bucket.
function buildElevation(values, usage) {
  const casts = values.filter(s => !s.inset && s.visualWeight > 0);
  if (casts.length === 0) return [];

  const buckets = [];
  for (const s of [...casts].sort((a, b) => a.visualWeight - b.visualWeight)) {
    const last = buckets[buckets.length - 1];
    // Within 25% of the previous bucket's weight reads as the same level.
    if (last && s.visualWeight <= last.weight * 1.25 + 1) {
      last.members.push(s);
    } else {
      buckets.push({ weight: s.visualWeight, members: [s] });
    }
  }

  return buckets.map((bucket, i) => {
    const winner = bucket.members.reduce(
      (a, b) => ((usage.get(b.raw) || 0) > (usage.get(a.raw) || 0) ? b : a),
      bucket.members[0],
    );
    const weights = bucket.members.map(m => m.visualWeight);
    return {
      level: i + 1,
      name: LADDER_NAMES[i] || `e${i + 1}`,
      raw: winner.raw,
      visualWeight: winner.visualWeight,
      blur: winner.blur,
      offsetY: winner.offsetY,
      layerCount: winner.layerCount,
      tint: winner.tint,
      usage: usage.get(winner.raw) || 0,
      variants: bucket.members.length,
      weightRange: [Math.min(...weights), Math.max(...weights)],
    };
  });
}

export function extractShadows(computedStyles) {
  const usage = new Map();
  const textShadowSet = new Set();

  for (const el of computedStyles) {
    if (el.boxShadow && el.boxShadow !== 'none') {
      usage.set(el.boxShadow, (usage.get(el.boxShadow) || 0) + 1);
    }
    if (el.textShadow && el.textShadow !== 'none') {
      textShadowSet.add(el.textShadow);
    }
  }

  const values = [...usage.keys()].map(raw => ({ ...parseShadow(raw), count: usage.get(raw) }));
  values.sort((a, b) => a.visualWeight - b.visualWeight);

  const textShadows = [...textShadowSet].map(raw => parseShadow(raw));
  textShadows.sort((a, b) => a.visualWeight - b.visualWeight);

  const elevation = buildElevation(values, usage);
  const colored = values.filter(s => s.tint.kind === 'colored');
  const layered = values.filter(s => s.layerCount > 1);

  return {
    values,
    textShadows,
    elevation,
    system: {
      levels: elevation.length,
      rawCount: values.length,
      // A ratio well above 1 means the site ships many one-off shadows for
      // few real elevation levels — a token-hygiene signal for `lint`.
      redundancy: elevation.length ? Math.round((values.length / elevation.length) * 100) / 100 : 0,
      layeredCount: layered.length,
      coloredCount: colored.length,
      insetCount: values.filter(s => s.inset).length,
      tint: colored.length > values.length / 2 ? 'colored' : 'neutral',
    },
  };
}
