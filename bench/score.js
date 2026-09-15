// Pure scoring for the extraction benchmark. Kept apart from the runner so the
// numbers we publish are unit-tested, not just printed.

export function toHex(value) {
  if (value == null) return null;
  if (typeof value === 'object') return toHex(value.hex ?? value.value ?? null);
  const s = String(value).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return '#' + m[1];
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return null;
}

function hexToLab(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76 distance in Lab.
export function deltaE(a, b) {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// ΔE ≤ 10 is "the same brand colour" (#0070f3 vs #0072f5 is under 1), while
// neighbouring hues on a brand's palette sit well above it.
export const COLOR_TOLERANCE = 10;

export function colorHit(predicted, truths, tolerance = COLOR_TOLERANCE) {
  const hex = toHex(predicted);
  if (!hex) return false;
  return truths.some((t) => {
    const truth = toHex(t);
    return truth != null && deltaE(hex, truth) <= tolerance;
  });
}

// "sohne-var" and "Söhne", "Inter Variable" and "Inter", "Mona Sans VF" and
// "Mona Sans" name the same family.
export function normalizeFont(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/["']/g, '')
    .replace(/\b(variable|var|vf)\b/g, '')
    .replace(/[\s_-]+/g, '');
}

export function fontHit(predicted, truths) {
  const p = normalizeFont(predicted);
  if (!p) return false;
  return truths.some((t) => {
    const n = normalizeFont(t);
    return n.length > 0 && (p.includes(n) || n.includes(p));
  });
}

function mostUsed(entries, nameKey) {
  const counts = new Map();
  for (const e of entries) {
    const name = e?.[nameKey];
    if (name) counts.set(name, (counts.get(name) || 0) + (e.count || 1));
  }
  let best = null;
  for (const [name, count] of counts) if (!best || count > best[1]) best = [name, count];
  return best?.[0] ?? null;
}

// Both readers apply the same rule: the family each tool labels as body text,
// else its most used family. Neither tool is judged on its heading face.
export function readDesignlang(design) {
  const families = design?.typography?.families || [];
  return {
    primary: toHex(design?.colors?.primary),
    font: families.find((f) => f.usage === 'body')?.name ?? mostUsed(families, 'name'),
  };
}

export function readDembrandt(output) {
  const styles = output?.typography?.styles || [];
  return {
    primary: toHex(output?.colors?.semantic?.primary),
    font: styles.find((s) => s.context === 'body')?.family ?? mostUsed(styles, 'family'),
  };
}

export function scoreSite(truth, predicted) {
  return {
    color: colorHit(predicted?.primary, truth.primary),
    font: fontHit(predicted?.font, truth.font),
  };
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// rows: [{ site, ok, seconds, score: { color, font } }] for one tool.
export function summarize(rows) {
  const ran = rows.filter((r) => r.ok);
  return {
    sites: rows.length,
    failures: rows.length - ran.length,
    colorHits: ran.filter((r) => r.score.color).length,
    fontHits: ran.filter((r) => r.score.font).length,
    medianSeconds: median(ran.map((r) => r.seconds)),
  };
}
