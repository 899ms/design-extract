// Layout extraction — grid, flexbox, container patterns, structural design language

import { parseCSSValue } from '../utils.js';

const PX_RE = /(-?[\d.]+)px/;

function px(value) {
  if (!value || value === 'none' || value === 'normal' || value === 'auto') return null;
  const m = String(value).match(PX_RE);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Cluster numbers that are within `tolerance` of each other and return the
// most-used representative per cluster, heaviest first.
function clusterBy(values, tolerance = 0.04) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  const clusters = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(v - last.max) <= Math.max(1, last.max * tolerance)) {
      last.max = v;
      last.members.push(v);
    } else {
      clusters.push({ max: v, members: [v] });
    }
  }
  return clusters
    .map(c => {
      const rep = c.members.reduce((a, b) => ((counts.get(b) || 0) > (counts.get(a) || 0) ? b : a), c.members[0]);
      return { value: rep, count: c.members.reduce((s, m) => s + (counts.get(m) || 0), 0) };
    })
    .sort((a, b) => b.count - a.count);
}

// How many columns a grid template actually declares. `repeat(12, 1fr)` is
// twelve columns even though the computed value may collapse to explicit
// track sizes.
function trackCount(template) {
  if (!template || template === 'none') return 0;
  const repeat = template.match(/repeat\(\s*(\d+)/);
  if (repeat) return parseInt(repeat[1], 10);
  return template.trim().split(/\s+(?![^(]*\))/).filter(Boolean).length;
}

// ── Layout system ───────────────────────────────────────────────
//
// The raw inventory above says a site uses grids and has some max-widths.
// This says what its layout system *is*: how wide the content column runs,
// how much air sits at the edges, what column count the grids agree on, and
// what vertical rhythm separates its sections.

function analyzeLayoutSystem(computedStyles, gridPatterns, gaps, options = {}) {
  // Containers: elements that are centred and constrained. We read the
  // rendered width rather than the declared max-width so `max-width: 90%`
  // and clamp() containers still land in the ladder.
  const candidates = [];
  for (const el of computedStyles) {
    const w = typeof el.width === 'number' ? el.width : null;
    if (!w || w < 320) continue;
    // A constrained block, not a constrained button: real containers govern
    // a meaningful slab of the page.
    if ((el.area || 0) < 50000) continue;
    const declared = px(el.maxWidth);
    const centred = el.marginLeft === el.marginRight && /auto/.test(String(el.marginLeft || ''));
    if (declared || centred) {
      candidates.push({ width: Math.round(w), area: el.area || 0, declared: declared != null, gutter: px(el.paddingLeft) });
    }
  }

  // The content column is the width governing the most page area — picking
  // the most *frequent* width instead returns whatever card or button
  // repeats hardest.
  const viewport = options.viewportWidth
    || Math.max(0, ...computedStyles.map(el => (typeof el.width === 'number' ? el.width : 0)));

  function dominant(pool) {
    if (pool.length === 0) return null;
    const declaredFirst = pool.filter(c => c.declared);
    const use = declaredFirst.length >= 2 ? declaredFirst : pool;
    const ladder = clusterBy(use.map(c => c.width)).slice(0, 6);
    const areaByWidth = new Map();
    for (const c of use) {
      const bucket = ladder.reduce(
        (a, b) => (Math.abs(b.value - c.width) < Math.abs(a.value - c.width) ? b : a),
        ladder[0] || { value: c.width },
      ).value;
      areaByWidth.set(bucket, (areaByWidth.get(bucket) || 0) + c.area);
    }
    const [width, area] = [...areaByWidth.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (width == null) return null;
    return { width, area, ladder, pool: use };
  }

  // A wrapper as wide as the window is full-bleed rather than a content
  // column — but a page whose layout really is full-bleed (padding on a
  // full-width shell, no inner max-width) should be reported as such rather
  // than have some 440px card promoted in its place.
  const isFullBleed = c => viewport > 0 && c.width > viewport * 0.97;
  const constrainedPick = dominant(candidates.filter(c => !isFullBleed(c)));
  const bleedPick = dominant(candidates.filter(isFullBleed));

  let pick = constrainedPick;
  let fullBleed = false;
  if (bleedPick && (!constrainedPick || constrainedPick.area < bleedPick.area * 0.33)) {
    pick = bleedPick;
    fullBleed = true;
  }

  const gutters = (pick?.pool || [])
    .filter(c => Math.abs(c.width - pick.width) <= pick.width * 0.08)
    .map(c => c.gutter)
    .filter(g => g != null && g > 0)
    .map(Math.round);
  const gutterLadder = clusterBy(gutters).slice(0, 4);

  const container = pick
    ? {
        contentWidth: pick.width,
        gutter: gutterLadder[0]?.value ?? null,
        usage: pick.ladder.find(w => w.value === pick.width)?.count ?? 1,
        fullBleed,
        // The widest constrained block under a full-bleed shell — the number
        // a clone needs for its inner wrapper.
        innerWidth: fullBleed ? (constrainedPick?.width ?? null) : null,
        ladder: clusterBy(candidates.map(c => c.width)).slice(0, 6).map(w => w.value).sort((a, b) => a - b),
      }
    : null;

  // Column system: weight each grid's track count by the area it governs, so
  // a 12-column page shell outranks a hundred 2-column cards.
  const colWeight = new Map();
  for (const g of gridPatterns) {
    const cols = trackCount(g.gridTemplateColumns);
    if (cols < 2 || cols > 24) continue;
    colWeight.set(cols, (colWeight.get(cols) || 0) + (g.area || 0));
  }
  const rankedCols = [...colWeight.entries()].sort((a, b) => b[1] - a[1]);
  const columns = rankedCols.length
    ? {
        dominant: rankedCols[0][0],
        candidates: rankedCols.slice(0, 4).map(([cols, area]) => ({ columns: cols, area: Math.round(area) })),
        // 12 and 16 are the canonical page grids; anything else is either a
        // component grid or a bespoke shell.
        canonical: rankedCols.some(([cols]) => cols === 12 || cols === 16),
      }
    : null;

  // Vertical rhythm: the padding full-bleed sections put above and below
  // their content. This is the number that makes a clone feel right or
  // cramped, and it never appears in a spacing scale built from every
  // padding on the page.
  const sectionPads = [];
  for (const el of computedStyles) {
    const w = typeof el.width === 'number' ? el.width : null;
    if (!w || !container || w < container.contentWidth * 0.9) continue;
    if ((el.height || 0) < 120) continue;
    for (const prop of ['paddingTop', 'paddingBottom']) {
      const v = px(el[prop]);
      if (v != null && v >= 16 && v <= 400) sectionPads.push(Math.round(v));
    }
  }
  const rhythmLadder = clusterBy(sectionPads, 0.12).slice(0, 5);
  const rhythm = rhythmLadder.length
    ? { section: rhythmLadder[0].value, ladder: rhythmLadder.map(r => r.value).sort((a, b) => a - b) }
    : null;

  // Gap ladder — numeric, so it sorts as a scale rather than as strings
  // ('10px' sorted before '4px' before this).
  const gapValues = gaps.map(g => px(g)).filter(v => v != null && v > 0);
  const gapLadder = clusterBy(gapValues, 0.08).slice(0, 8).map(g => g.value).sort((a, b) => a - b);

  // Fluid container declarations (clamp/vw max-widths and gaps).
  const fluidLayout = (options.fluidValues || [])
    .filter(f => ['max-width', 'width', 'gap', 'padding-inline', 'padding'].includes(f.property) && /clamp\(|v(w|min)\b/i.test(f.value))
    .slice(0, 12);

  return {
    container,
    columns,
    rhythm,
    gapScale: gapLadder,
    fluid: { count: fluidLayout.length, declarations: fluidLayout },
    density: container && container.gutter != null
      ? Math.round((container.gutter / container.contentWidth) * 1000) / 1000
      : null,
  };
}

export function extractLayout(computedStyles, options = {}) {
  const containers = [];
  const gridPatterns = [];
  const flexPatterns = [];
  const columnCounts = new Map();

  for (const el of computedStyles) {
    const isGrid = el.display === 'grid' || el.display === 'inline-grid';
    const isFlex = el.display === 'flex' || el.display === 'inline-flex';

    if (isGrid) {
      gridPatterns.push({
        tag: el.tag,
        classList: el.classList,
        gridTemplateColumns: el.gridTemplateColumns || 'none',
        gridTemplateRows: el.gridTemplateRows || 'none',
        gap: el.gap,
        area: el.area,
      });

      // Count column patterns
      const cols = el.gridTemplateColumns;
      if (cols && cols !== 'none') {
        const colCount = cols.split(/\s+/).filter(v => v && v !== 'none').length;
        if (colCount > 0) columnCounts.set(colCount, (columnCounts.get(colCount) || 0) + 1);
      }
    }

    if (isFlex) {
      flexPatterns.push({
        tag: el.tag,
        classList: el.classList,
        flexDirection: el.flexDirection || 'row',
        flexWrap: el.flexWrap || 'nowrap',
        justifyContent: el.justifyContent || 'normal',
        alignItems: el.alignItems || 'normal',
        gap: el.gap,
        area: el.area,
      });
    }

    // Detect containers (large centered elements)
    if (el.area > 100000 && el.maxWidth && el.maxWidth !== 'none') {
      containers.push({
        tag: el.tag,
        classList: el.classList,
        maxWidth: el.maxWidth,
        paddingLeft: el.paddingLeft,
        paddingRight: el.paddingRight,
      });
    }
  }

  // Summarize flex direction usage
  const flexDirections = {};
  for (const f of flexPatterns) {
    const key = `${f.flexDirection}/${f.flexWrap}`;
    flexDirections[key] = (flexDirections[key] || 0) + 1;
  }

  // Summarize justify/align patterns
  const justifyPatterns = {};
  const alignPatterns = {};
  for (const f of flexPatterns) {
    justifyPatterns[f.justifyContent] = (justifyPatterns[f.justifyContent] || 0) + 1;
    alignPatterns[f.alignItems] = (alignPatterns[f.alignItems] || 0) + 1;
  }

  // Grid column summary
  const gridColumns = [...columnCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cols, count]) => ({ columns: cols, count }));

  // Container widths
  const containerWidths = [];
  const widthSet = new Set();
  for (const c of containers) {
    if (!widthSet.has(c.maxWidth)) {
      widthSet.add(c.maxWidth);
      containerWidths.push({ maxWidth: c.maxWidth, padding: c.paddingLeft });
    }
  }

  // Gap values
  const gaps = new Set();
  for (const el of [...gridPatterns, ...flexPatterns]) {
    if (el.gap && el.gap !== 'normal' && el.gap !== '0px') {
      gaps.add(el.gap);
    }
  }

  const gapList = [...gaps];
  const system = analyzeLayoutSystem(computedStyles, gridPatterns, gapList, options);

  return {
    system,
    gridCount: gridPatterns.length,
    flexCount: flexPatterns.length,
    gridColumns,
    flexDirections,
    justifyPatterns,
    alignPatterns,
    containerWidths,
    gaps: [...gaps].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)),
    // Sample grid patterns (top 5 by area)
    topGrids: gridPatterns
      .sort((a, b) => b.area - a.area)
      .slice(0, 5)
      .map(g => ({ columns: g.gridTemplateColumns, rows: g.gridTemplateRows, gap: g.gap })),
    // Sample flex patterns (top 5 by area)
    topFlex: flexPatterns
      .sort((a, b) => b.area - a.area)
      .slice(0, 5)
      .map(f => ({ direction: f.flexDirection, wrap: f.flexWrap, justify: f.justifyContent, align: f.alignItems, gap: f.gap })),
  };
}
