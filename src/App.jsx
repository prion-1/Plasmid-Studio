import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronUp, ArrowRight, ArrowLeft,
  Search, Hash, Download, AlertCircle, Eye, EyeOff, Upload, FolderOpen, Save
} from 'lucide-react';

/* ---------- constants ---------- */
const R_DEFAULT = 200; // default plasmid radius
const BAND_THICKNESS = 14;
const RING_GAP = 8;
const LABEL_OFFSET = 18;
const DEFAULT_ANNOTATION_OUTLINE_WIDTH = 1.3;
const VIEWBOX = 820; // -410 to 410
const LINEAR_VIEWBOX_W = 820;
const LINEAR_VIEWBOX_H = 520;
const LINEAR_SEQ_LEFT = -315;
const LINEAR_SEQ_RIGHT = 315;
const LINEAR_SEQ_Y = 55;
const LINEAR_TERMINUS_EXT = 46;
const PROJECT_FORMAT = 'plasmid-studio-project';
const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = `plasmid-studio:autosave:v${PROJECT_VERSION}`;

// matplotlib plasma colormap, sampled at 10 evenly-spaced points
const PALETTE_PLASMA = [
  '#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786',
  '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921',
];

// matplotlib viridis colormap, sampled at 10 evenly-spaced points
// Standard reference values from matplotlib's viridis.
const PALETTE_VIRIDIS = [
  '#440154', '#482878', '#3e4a89', '#31688e', '#26828e',
  '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725',
];

const PALETTE = [...PALETTE_PLASMA, ...PALETTE_VIRIDIS];

// darken a hex color for outlines / shading
const darken = (hex, amount = 0.45) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const dr = Math.max(0, Math.floor(r * (1 - amount)));
  const dg = Math.max(0, Math.floor(g * (1 - amount)));
  const db = Math.max(0, Math.floor(b * (1 - amount)));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
};

// perceptual luminance for choosing readable text on a given bg
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const BG_PRESETS = [
  '#F5F1EA', // cream (default)
  '#FFFFFF', // pure white
  '#F0EDE3', // warm paper
  '#1F1B16', // ink
  '#0E1A2B', // navy
  '#1A1F1C', // forest
];

const FONT_OPTIONS = [
  { label: 'Sans (Instrument)', value: "'Instrument Sans', system-ui, sans-serif" },
  { label: 'Serif (Instrument)', value: "'Instrument Serif', Georgia, serif" },
  { label: 'Mono (JetBrains)', value: "'JetBrains Mono', ui-monospace, monospace" },
  { label: 'System sans', value: "system-ui, -apple-system, sans-serif" },
  { label: 'System serif', value: "Georgia, 'Times New Roman', serif" },
];

// Highlight color presets — soft pastels (low saturation, work well at low opacity)
const HIGHLIGHT_PALETTE = [
  '#7FA67D', '#7B96B8', '#B88578', '#9B7DA8',
  '#C7A86B', '#7FA8A3', '#B89C7F', '#A87878',
];

// matplotlib magma — sampled at 10 evenly-spaced points.
const HIGHLIGHT_PALETTE_MAGMA = [
  '#000004', '#170c3a', '#3b0f70', '#641a80', '#8c2981',
  '#b63779', '#de4968', '#f6705b', '#fc9f6f', '#fcfdbf',
];

// matplotlib cividis — sampled at 10 evenly-spaced points.
const HIGHLIGHT_PALETTE_CIVIDIS = [
  '#00224e', '#123570', '#3b496c', '#575c6d', '#707173',
  '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838',
];

/* ---------- sequence helpers ---------- */
const cleanSeq = (s) => (s || '').toUpperCase().replace(/[^ACGTN]/g, '');
const COMPLEMENT = { A: 'T', T: 'A', C: 'G', G: 'C', N: 'N' };
const revComp = (s) => s.split('').reverse().map(c => COMPLEMENT[c] || 'N').join('');

const findSubseq = (plasmid, query, { circular = true } = {}) => {
  if (!query || !plasmid) return null;
  const q = cleanSeq(query);
  if (!q || q.length > plasmid.length) return null;
  const searchSeq = circular ? plasmid + plasmid : plasmid;
  let idx = searchSeq.indexOf(q);
  if (idx !== -1 && idx < plasmid.length) {
    const start = idx + 1;
    const end = circular ? ((idx + q.length - 1) % plasmid.length) + 1 : idx + q.length;
    return { start, end, direction: 'forward', length: q.length };
  }
  const rc = revComp(q);
  idx = searchSeq.indexOf(rc);
  if (idx !== -1 && idx < plasmid.length) {
    const start = idx + 1;
    const end = circular ? ((idx + rc.length - 1) % plasmid.length) + 1 : idx + rc.length;
    return { start, end, direction: 'reverse', length: q.length };
  }
  return null;
};

const resolveLocatedItems = (items, sequence, total, circular) => {
  return items.map(item => {
    if (item.mode === 'sequence') {
      const found = findSubseq(sequence, item.querySeq, { circular });
      if (found) {
        return {
          ...item,
          start: found.start,
          end: found.end,
          matchedDirection: found.direction,
          found: true,
          error: null,
        };
      }
      return { ...item, found: false, error: item.querySeq ? 'Not found in sequence' : 'Enter a sequence' };
    }
    if (!item.start || !item.end || item.start < 1 || item.end < 1) {
      return { ...item, found: false, error: 'Enter start and end' };
    }
    if (item.start > total || item.end > total) {
      return { ...item, found: false, error: 'Position out of range' };
    }
    if (!circular && item.end < item.start) {
      return { ...item, found: false, error: 'End must be after start' };
    }
    return { ...item, found: true, error: null };
  });
};

/* ---------- geometry ---------- */
const angleAt = (pos, total) => -Math.PI / 2 + ((pos - 1) / total) * 2 * Math.PI;
const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

const ringRadii = (n, thickness, R) => {
  // Ring spacing is anchored to the constant BAND_THICKNESS — so individual
  // annotations can grow or shrink without shifting other rings.
  if (n === 0) {
    return { inner: R - thickness / 2, outer: R + thickness / 2 };
  }
  const center = R + n * (BAND_THICKNESS + RING_GAP);
  const inner = Math.max(1, center - thickness / 2);
  const outer = Math.max(inner + 1, center + thickness / 2);
  return { inner, outer };
};

const computeAngles = (start, end, total) => {
  const a1 = angleAt(start, total);
  let span = end - start + 1;
  if (span <= 0) span += total;
  const sweep = (span / total) * 2 * Math.PI;
  return { a1, a2: a1 + sweep, sweep };
};

const bandPath = (a1, a2, r1, r2) => {
  const sweep = a2 - a1;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const [x1o, y1o] = polar(a1, r2);
  const [x2o, y2o] = polar(a2, r2);
  const [x2i, y2i] = polar(a2, r1);
  const [x1i, y1i] = polar(a1, r1);
  return `M ${x1o} ${y1o} A ${r2} ${r2} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${r1} ${r1} 0 ${largeArc} 0 ${x1i} ${y1i} Z`;
};

const arrowPath = (a1, a2, r1, r2, direction) => {
  const sweep = a2 - a1;
  const midR = (r1 + r2) / 2;
  const tipPx = (r2 - r1) * 0.7; // arrowhead extension (30% shorter than thickness)
  let tipAng = tipPx / midR;
  tipAng = Math.min(tipAng, sweep * 0.5);
  if (sweep < 0.001) {
    const [x1o, y1o] = polar(a1, r2);
    const [x1i, y1i] = polar(a1, r1);
    const [xt, yt] = polar(a2, midR);
    return `M ${x1o} ${y1o} L ${xt} ${yt} L ${x1i} ${y1i} Z`;
  }
  if (direction === 'forward') {
    const aTipBase = a2 - tipAng;
    const bodySweep = aTipBase - a1;
    const largeArc = bodySweep > Math.PI ? 1 : 0;
    const [x1o, y1o] = polar(a1, r2);
    const [xtbo, ytbo] = polar(aTipBase, r2);
    const [xtip, ytip] = polar(a2, midR);
    const [xtbi, ytbi] = polar(aTipBase, r1);
    const [x1i, y1i] = polar(a1, r1);
    return `M ${x1o} ${y1o} A ${r2} ${r2} 0 ${largeArc} 1 ${xtbo} ${ytbo} L ${xtip} ${ytip} L ${xtbi} ${ytbi} A ${r1} ${r1} 0 ${largeArc} 0 ${x1i} ${y1i} Z`;
  } else {
    const aTipBase = a1 + tipAng;
    const bodySweep = a2 - aTipBase;
    const largeArc = bodySweep > Math.PI ? 1 : 0;
    const [xtbo, ytbo] = polar(aTipBase, r2);
    const [x2o, y2o] = polar(a2, r2);
    const [x2i, y2i] = polar(a2, r1);
    const [xtbi, ytbi] = polar(aTipBase, r1);
    const [xtip, ytip] = polar(a1, midR);
    return `M ${xtbo} ${ytbo} A ${r2} ${r2} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${r1} ${r1} 0 ${largeArc} 0 ${xtbi} ${ytbi} L ${xtip} ${ytip} Z`;
  }
};

const linePath = (a1, a2, r) => {
  const sweep = a2 - a1;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const [x1, y1] = polar(a1, r);
  const [x2, y2] = polar(a2, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
};

const linearSeqWidth = () => LINEAR_SEQ_RIGHT - LINEAR_SEQ_LEFT;

const linearBaseX = (pos, total) => {
  if (total <= 1) return LINEAR_SEQ_LEFT;
  return LINEAR_SEQ_LEFT + ((pos - 1) / (total - 1)) * linearSeqWidth();
};

const linearRangeX = (start, end, total) => {
  if (!total) return { x1: LINEAR_SEQ_LEFT, x2: LINEAR_SEQ_LEFT };
  const x1 = LINEAR_SEQ_LEFT + ((start - 1) / total) * linearSeqWidth();
  const x2 = LINEAR_SEQ_LEFT + (end / total) * linearSeqWidth();
  return { x1, x2: Math.max(x1 + 2, x2) };
};

const linearTrackY = (ring = 0) => LINEAR_SEQ_Y - ring * (BAND_THICKNESS + RING_GAP);
const trackMin = () => -8;
const trackMax = () => 8;

const linearBlockPath = (x1, x2, y, height, cornerStyle = 'rounded', cornerRadius = 0) => {
  const top = y - height / 2;
  const bottom = y + height / 2;
  const width = Math.max(1, x2 - x1);
  const cr = cornerStyle === 'rounded'
    ? Math.max(0, Math.min(cornerRadius, height / 2 - 0.5, width / 2 - 0.5))
    : 0;
  if (cr <= 0.5) {
    return `M ${x1} ${top} L ${x2} ${top} L ${x2} ${bottom} L ${x1} ${bottom} Z`;
  }
  return [
    `M ${x1 + cr} ${top}`,
    `L ${x2 - cr} ${top}`,
    `Q ${x2} ${top} ${x2} ${top + cr}`,
    `L ${x2} ${bottom - cr}`,
    `Q ${x2} ${bottom} ${x2 - cr} ${bottom}`,
    `L ${x1 + cr} ${bottom}`,
    `Q ${x1} ${bottom} ${x1} ${bottom - cr}`,
    `L ${x1} ${top + cr}`,
    `Q ${x1} ${top} ${x1 + cr} ${top}`,
    'Z',
  ].join(' ');
};

const linearArrowPath = (x1, x2, y, height, direction, cornerStyle = 'rounded', cornerRadius = 0) => {
  const top = y - height / 2;
  const bottom = y + height / 2;
  const width = Math.max(1, x2 - x1);
  const head = Math.min(height * 0.7, width * 0.5);
  const cr = cornerStyle === 'rounded'
    ? Math.max(0, Math.min(cornerRadius, height / 2 - 0.5, Math.max(0, width - head) / 2 - 0.5))
    : 0;

  if (direction === 'reverse') {
    const bodyStart = x1 + head;
    if (cr <= 0.5) {
      return `M ${x1} ${y} L ${bodyStart} ${top} L ${x2} ${top} L ${x2} ${bottom} L ${bodyStart} ${bottom} Z`;
    }
    return [
      `M ${x1} ${y}`,
      `L ${bodyStart} ${top}`,
      `L ${x2 - cr} ${top}`,
      `Q ${x2} ${top} ${x2} ${top + cr}`,
      `L ${x2} ${bottom - cr}`,
      `Q ${x2} ${bottom} ${x2 - cr} ${bottom}`,
      `L ${bodyStart} ${bottom}`,
      'Z',
    ].join(' ');
  }

  const bodyEnd = x2 - head;
  if (cr <= 0.5) {
    return `M ${x1} ${top} L ${bodyEnd} ${top} L ${x2} ${y} L ${bodyEnd} ${bottom} L ${x1} ${bottom} Z`;
  }
  return [
    `M ${x1 + cr} ${top}`,
    `L ${bodyEnd} ${top}`,
    `L ${x2} ${y}`,
    `L ${bodyEnd} ${bottom}`,
    `L ${x1 + cr} ${bottom}`,
    `Q ${x1} ${bottom} ${x1} ${bottom - cr}`,
    `L ${x1} ${top + cr}`,
    `Q ${x1} ${top} ${x1 + cr} ${top}`,
    'Z',
  ].join(' ');
};

/* Rounded band: all 4 corners filleted with a circular arc of radius cr. */
const roundedBandPath = (a1, a2, r1, r2, cr) => {
  const thickness = r2 - r1;
  const sweep = a2 - a1;
  const arcLenInner = sweep * r1;
  const arcLenOuter = sweep * r2;
  cr = Math.max(0, Math.min(cr, thickness / 2 - 0.5, arcLenInner / 2 - 0.5, arcLenOuter / 2 - 0.5));
  if (cr <= 0.5) return bandPath(a1, a2, r1, r2);

  const angOuter = cr / r2;
  const angInner = cr / r1;
  const oStartA = a1 + angOuter;
  const oEndA = a2 - angOuter;
  const iStartA = a2 - angInner;
  const iEndA = a1 + angInner;

  const [oStartX, oStartY] = polar(oStartA, r2);
  const [oEndX, oEndY] = polar(oEndA, r2);
  const [endRadOutX, endRadOutY] = polar(a2, r2 - cr);
  const [endRadInX, endRadInY] = polar(a2, r1 + cr);
  const [iStartX, iStartY] = polar(iStartA, r1);
  const [iEndX, iEndY] = polar(iEndA, r1);
  const [startRadInX, startRadInY] = polar(a1, r1 + cr);
  const [startRadOutX, startRadOutY] = polar(a1, r2 - cr);

  const outerLA = (oEndA - oStartA) > Math.PI ? 1 : 0;
  const innerLA = (iStartA - iEndA) > Math.PI ? 1 : 0;

  return [
    `M ${oStartX} ${oStartY}`,
    `A ${r2} ${r2} 0 ${outerLA} 1 ${oEndX} ${oEndY}`,
    `A ${cr} ${cr} 0 0 1 ${endRadOutX} ${endRadOutY}`,
    `L ${endRadInX} ${endRadInY}`,
    `A ${cr} ${cr} 0 0 1 ${iStartX} ${iStartY}`,
    `A ${r1} ${r1} 0 ${innerLA} 0 ${iEndX} ${iEndY}`,
    `A ${cr} ${cr} 0 0 1 ${startRadInX} ${startRadInY}`,
    `L ${startRadOutX} ${startRadOutY}`,
    `A ${cr} ${cr} 0 0 1 ${oStartX} ${oStartY}`,
    'Z',
  ].join(' ');
};

/* Rounded arrow: only the 2 *back* corners are rounded — the tip and pre-tip
   corners stay sharp because that's what makes the arrow read as an arrow. */
const roundedArrowPath = (a1, a2, r1, r2, direction, cr) => {
  const sweep = a2 - a1;
  const midR = (r1 + r2) / 2;
  const thickness = r2 - r1;
  const tipPx = thickness * 0.7; // 30% shorter arrowhead
  let tipAng = tipPx / midR;
  tipAng = Math.min(tipAng, sweep * 0.5);
  if (sweep < 0.001) return arrowPath(a1, a2, r1, r2, direction);

  // Body angular span (after subtracting arrowhead)
  const bodySweep = sweep - tipAng;
  cr = Math.max(0, Math.min(cr, thickness / 2 - 0.5, bodySweep * r1 / 2 - 0.5, bodySweep * r2 / 2 - 0.5));
  if (cr <= 0.5) return arrowPath(a1, a2, r1, r2, direction);

  if (direction === 'forward') {
    const aTipBase = a2 - tipAng;
    const angOuter = cr / r2;
    const angInner = cr / r1;
    const oStartA = a1 + angOuter;
    const iEndA = a1 + angInner;
    const outerLA = (aTipBase - oStartA) > Math.PI ? 1 : 0;
    const innerLA = (aTipBase - iEndA) > Math.PI ? 1 : 0;

    const [oStartX, oStartY] = polar(oStartA, r2);
    const [tbtX, tbtY] = polar(aTipBase, r2);
    const [tipX, tipY] = polar(a2, midR);
    const [tbbX, tbbY] = polar(aTipBase, r1);
    const [iEndX, iEndY] = polar(iEndA, r1);
    const [bRadInX, bRadInY] = polar(a1, r1 + cr);
    const [bRadOutX, bRadOutY] = polar(a1, r2 - cr);

    return [
      `M ${oStartX} ${oStartY}`,
      `A ${r2} ${r2} 0 ${outerLA} 1 ${tbtX} ${tbtY}`,
      `L ${tipX} ${tipY}`,
      `L ${tbbX} ${tbbY}`,
      `A ${r1} ${r1} 0 ${innerLA} 0 ${iEndX} ${iEndY}`,
      `A ${cr} ${cr} 0 0 1 ${bRadInX} ${bRadInY}`,
      `L ${bRadOutX} ${bRadOutY}`,
      `A ${cr} ${cr} 0 0 1 ${oStartX} ${oStartY}`,
      'Z',
    ].join(' ');
  } else {
    // reverse: tip at a1, back corners at a2
    const aTipBase = a1 + tipAng;
    const angOuter = cr / r2;
    const angInner = cr / r1;
    const oEndA = a2 - angOuter;
    const iStartA = a2 - angInner;
    const outerLA = (oEndA - aTipBase) > Math.PI ? 1 : 0;
    const innerLA = (iStartA - aTipBase) > Math.PI ? 1 : 0;

    const [tipX, tipY] = polar(a1, midR);
    const [tbtX, tbtY] = polar(aTipBase, r2);
    const [oEndX, oEndY] = polar(oEndA, r2);
    const [bRadOutX, bRadOutY] = polar(a2, r2 - cr);
    const [bRadInX, bRadInY] = polar(a2, r1 + cr);
    const [iStartX, iStartY] = polar(iStartA, r1);
    const [tbbX, tbbY] = polar(aTipBase, r1);

    return [
      `M ${tipX} ${tipY}`,
      `L ${tbtX} ${tbtY}`,
      `A ${r2} ${r2} 0 ${outerLA} 1 ${oEndX} ${oEndY}`,
      `A ${cr} ${cr} 0 0 1 ${bRadOutX} ${bRadOutY}`,
      `L ${bRadInX} ${bRadInY}`,
      `A ${cr} ${cr} 0 0 1 ${iStartX} ${iStartY}`,
      `A ${r1} ${r1} 0 ${innerLA} 0 ${tbbX} ${tbbY}`,
      `L ${tipX} ${tipY}`,
      'Z',
    ].join(' ');
  }
};

const tickInterval = (total) => {
  const target = total / 12;
  const mags = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  for (const m of mags) if (m >= target) return m;
  return 100000;
};

/* ---------- demo data ---------- */
const generateDummySeq = (length, seed = 42) => {
  const bases = 'ACGT';
  let s = '';
  let n = seed;
  for (let i = 0; i < length; i++) {
    n = (n * 9301 + 49297) % 233280;
    s += bases[Math.floor((n / 233280) * 4)];
  }
  return s;
};

const initialAnnotations = [
  { id: 1, name: 'AmpR', mode: 'position', querySeq: '', start: 200, end: 1050, direction: 'forward', color: '#46039f', outlineColor: null, outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH, ring: 1, shape: 'arrow', sizeScale: 1, cornerStyle: 'rounded', showLabel: true, collapsed: true },
  { id: 2, name: 'ori', mode: 'position', querySeq: '', start: 1300, end: 1900, direction: 'forward', color: '#d8576b', outlineColor: null, outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH, ring: 1, shape: 'arrow', sizeScale: 1, cornerStyle: 'rounded', showLabel: true, collapsed: true },
  { id: 3, name: 'MCS', mode: 'position', querySeq: '', start: 2200, end: 2300, direction: 'forward', color: '#fb9f3a', outlineColor: null, outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH, ring: 0, shape: 'block', sizeScale: 1, cornerStyle: 'rounded', showLabel: true, collapsed: true },
  { id: 4, name: 'T7 promoter', mode: 'position', querySeq: '', start: 2500, end: 2600, direction: 'forward', color: '#fdca26', outlineColor: null, outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH, ring: 2, shape: 'block', sizeScale: 1, cornerStyle: 'rounded', showLabel: true, collapsed: true },
];

const createDefaultTerminiLabels = () => ({
  left: { visible: true, text: 'left terminus' },
  right: { visible: true, text: 'right terminus' },
  distance: 22,
  size: 12,
  color: null,
});

const createDefaultProjectState = () => ({
  activeView: 'plasmid',
  plasmidName: 'pExample',
  plasmidSeqRaw: generateDummySeq(3000),
  annotations: initialAnnotations.map(annotation => ({ ...annotation })),
  bgColor: '#F5F1EA',
  showName: true,
  showSize: true,
  showTicks: true,
  backboneThickness: 1.2,
  backboneColor: null,
  rotation: 0,
  radiusOffset: 0,
  linearTermini: 'none',
  terminiLabels: createDefaultTerminiLabels(),
  fontFamily: "'Instrument Serif', Georgia, serif",
  labelFontSize: 11.5,
  tickFontSize: 8.5,
  nameFontSize: 32,
  linearTitleDistance: 229,
  textColor: null,
  highlights: [],
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const stringOr = (value, fallback) => typeof value === 'string' ? value : fallback;
const booleanOr = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const nullableStringOr = (value, fallback) => value === null || typeof value === 'string' ? value : fallback;

const normalizeProjectState = (state) => {
  if (!isRecord(state)) throw new Error('Project state is missing or invalid.');
  if (typeof state.plasmidSeqRaw !== 'string') throw new Error('Project sequence is missing or invalid.');
  if (!Array.isArray(state.annotations) || !Array.isArray(state.highlights)) {
    throw new Error('Project annotations or highlights are invalid.');
  }

  const defaults = createDefaultProjectState();
  const normalizeItem = (item, index, type) => {
    if (!isRecord(item)) throw new Error(`Project ${type} ${index + 1} is invalid.`);
    return {
      ...item,
      id: Number.isFinite(item.id) ? item.id : index + 1,
      name: stringOr(item.name, `${type === 'annotation' ? 'Feature' : 'Region'} ${index + 1}`),
      mode: item.mode === 'sequence' ? 'sequence' : 'position',
      querySeq: stringOr(item.querySeq, ''),
      start: finiteOr(item.start, 1),
      end: finiteOr(item.end, 1),
      color: stringOr(item.color, type === 'annotation' ? PALETTE[index % PALETTE.length] : HIGHLIGHT_PALETTE[index % HIGHLIGHT_PALETTE.length]),
    };
  };

  const termini = isRecord(state.terminiLabels) ? state.terminiLabels : {};
  const defaultTermini = defaults.terminiLabels;

  return {
    activeView: state.activeView === 'linear' ? 'linear' : 'plasmid',
    plasmidName: stringOr(state.plasmidName, defaults.plasmidName),
    plasmidSeqRaw: state.plasmidSeqRaw,
    annotations: state.annotations.map((item, index) => normalizeItem(item, index, 'annotation')),
    bgColor: stringOr(state.bgColor, defaults.bgColor),
    showName: booleanOr(state.showName, defaults.showName),
    showSize: booleanOr(state.showSize, defaults.showSize),
    showTicks: booleanOr(state.showTicks, defaults.showTicks),
    backboneThickness: finiteOr(state.backboneThickness, defaults.backboneThickness),
    backboneColor: nullableStringOr(state.backboneColor, defaults.backboneColor),
    rotation: finiteOr(state.rotation, defaults.rotation),
    radiusOffset: finiteOr(state.radiusOffset, defaults.radiusOffset),
    linearTermini: ['none', 'line', 'itr', 'break'].includes(state.linearTermini) ? state.linearTermini : defaults.linearTermini,
    terminiLabels: {
      left: {
        visible: booleanOr(termini.left?.visible, defaultTermini.left.visible),
        text: stringOr(termini.left?.text, defaultTermini.left.text),
      },
      right: {
        visible: booleanOr(termini.right?.visible, defaultTermini.right.visible),
        text: stringOr(termini.right?.text, defaultTermini.right.text),
      },
      distance: finiteOr(termini.distance, defaultTermini.distance),
      size: finiteOr(termini.size, defaultTermini.size),
      color: nullableStringOr(termini.color, defaultTermini.color),
    },
    fontFamily: stringOr(state.fontFamily, defaults.fontFamily),
    labelFontSize: finiteOr(state.labelFontSize, defaults.labelFontSize),
    tickFontSize: finiteOr(state.tickFontSize, defaults.tickFontSize),
    nameFontSize: finiteOr(state.nameFontSize, defaults.nameFontSize),
    linearTitleDistance: finiteOr(state.linearTitleDistance, defaults.linearTitleDistance),
    textColor: nullableStringOr(state.textColor, defaults.textColor),
    highlights: state.highlights.map((item, index) => normalizeItem(item, index, 'highlight')),
  };
};

const parseProjectDocument = (text) => {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isRecord(document) || document.format !== PROJECT_FORMAT) {
    throw new Error('This is not a Plasmid Studio project file.');
  }
  if (document.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${document.version ?? 'missing'}.`);
  }
  return normalizeProjectState(document.state);
};

const createProjectDocument = state => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  savedAt: new Date().toISOString(),
  state,
});

const loadInitialProject = () => {
  const fallback = { state: createDefaultProjectState(), notice: null };
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return fallback;
    return {
      state: parseProjectDocument(saved),
      notice: { type: 'success', text: 'Restored your locally autosaved project.' },
    };
  } catch {
    return {
      ...fallback,
      notice: { type: 'error', text: 'The local autosave could not be restored; the example project was loaded.' },
    };
  }
};

const parseSequenceFile = (text, fileName) => {
  const normalized = text.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new Error('The selected sequence file is empty.');

  let name = fileName.replace(/\.(fa|fasta|fna|ffn|txt|dna)$/i, '');
  let sequenceText = normalized;

  if (normalized.startsWith('>')) {
    const lines = normalized.split(/\r?\n/);
    const header = lines.shift().slice(1).trim();
    if (lines.some(line => line.trim().startsWith('>'))) {
      throw new Error('Please upload a FASTA file containing exactly one sequence.');
    }
    if (header) name = header;
    sequenceText = lines.join('');
  }

  const compactSequence = sequenceText.replace(/\s/g, '').toUpperCase();
  if (!compactSequence) throw new Error('No DNA sequence was found in the selected file.');
  if (/[^ACGTN]/.test(compactSequence)) {
    throw new Error('Sequence files may contain only A, C, G, T, N, and whitespace.');
  }

  return { name, sequence: compactSequence };
};

const safeFileName = (name, fallback) => {
  const cleaned = (name || fallback).trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cleaned || fallback;
};

const downloadFile = (contents, type, fileName) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

/* ---------- small UI primitives ---------- */
const Field = ({ label, children, hint }) => (
  <label className="block">
    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">{label}</div>
    {children}
    {hint && <div className="text-[10px] text-[var(--muted)] mt-1 italic">{hint}</div>}
  </label>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors ${props.className || ''}`}
  />
);

const TextArea = (props) => (
  <textarea
    {...props}
    className={`w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[12px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors font-mono ${props.className || ''}`}
  />
);

const SegBtn = ({ active, onClick, children, title }) => (
  <button
    onClick={onClick}
    title={title}
    className={`flex-1 px-2 py-1.5 text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1 ${active ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--border)]/40'}`}
  >
    {children}
  </button>
);

/* ---------- main component ---------- */
export default function PlasmidMapEditor() {
  const [initialLoad] = useState(loadInitialProject);
  const initialProject = initialLoad.state;

  const [activeView, setActiveView] = useState(initialProject.activeView);
  const [plasmidName, setPlasmidName] = useState(initialProject.plasmidName);
  const [plasmidSeqRaw, setPlasmidSeqRaw] = useState(initialProject.plasmidSeqRaw);
  const [annotations, setAnnotations] = useState(initialProject.annotations);
  const [hoveredId, setHoveredId] = useState(null);
  const [showSeqInput, setShowSeqInput] = useState(false);
  // canvas-level display settings
  const [bgColor, setBgColor] = useState(initialProject.bgColor);
  const [showName, setShowName] = useState(initialProject.showName);
  const [showSize, setShowSize] = useState(initialProject.showSize);
  const [showTicks, setShowTicks] = useState(initialProject.showTicks);
  const [backboneThickness, setBackboneThickness] = useState(initialProject.backboneThickness);
  const [backboneColor, setBackboneColor] = useState(initialProject.backboneColor); // null = use theme
  const [rotation, setRotation] = useState(initialProject.rotation); // degrees, applies to ring content
  const [radiusOffset, setRadiusOffset] = useState(initialProject.radiusOffset); // -100 to +150, modifies plasmid radius
  const [linearTermini, setLinearTermini] = useState(initialProject.linearTermini);
  const [terminiLabels, setTerminiLabels] = useState(initialProject.terminiLabels);
  // typography
  const [fontFamily, setFontFamily] = useState(initialProject.fontFamily);
  const [labelFontSize, setLabelFontSize] = useState(initialProject.labelFontSize);
  const [tickFontSize, setTickFontSize] = useState(initialProject.tickFontSize);
  const [nameFontSize, setNameFontSize] = useState(initialProject.nameFontSize);
  const [linearTitleDistance, setLinearTitleDistance] = useState(initialProject.linearTitleDistance);
  const [textColor, setTextColor] = useState(initialProject.textColor); // null = theme.ink
  // highlights — translucent bands with curved labels
  const [highlights, setHighlights] = useState(initialProject.highlights);
  const [notice, setNotice] = useState(initialLoad.notice);
  const [confirmingBlank, setConfirmingBlank] = useState(false);
  const svgRef = useRef(null);
  const listEndRef = useRef(null);
  const projectFileRef = useRef(null);
  const sequenceFileRef = useRef(null);
  const highestInitialId = Math.max(0, ...initialProject.annotations.map(item => item.id), ...initialProject.highlights.map(item => item.id));
  const idCounter = useRef(Math.max(100, highestInitialId + 1));
  const isPlasmidView = activeView === 'plasmid';

  const projectState = useMemo(() => ({
    activeView,
    plasmidName,
    plasmidSeqRaw,
    annotations,
    bgColor,
    showName,
    showSize,
    showTicks,
    backboneThickness,
    backboneColor,
    rotation,
    radiusOffset,
    linearTermini,
    terminiLabels,
    fontFamily,
    labelFontSize,
    tickFontSize,
    nameFontSize,
    linearTitleDistance,
    textColor,
    highlights,
  }), [
    activeView, plasmidName, plasmidSeqRaw, annotations, bgColor, showName,
    showSize, showTicks, backboneThickness, backboneColor, rotation, radiusOffset,
    linearTermini, terminiLabels, fontFamily, labelFontSize, tickFontSize,
    nameFontSize, linearTitleDistance, textColor, highlights,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify(createProjectDocument(projectState)),
        );
      } catch (error) {
        console.warn('Could not autosave Plasmid Studio project.', error);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [projectState]);

  // SVG theme — derived from bg luminance so labels stay readable on any bg
  const theme = useMemo(() => {
    const lum = luminance(bgColor);
    const isDark = lum < 0.5;
    return {
      bg: bgColor,
      ink: isDark ? '#F2EDE3' : '#1F1B16',
      muted: isDark ? '#9A9182' : '#8A8174',
      backbone: isDark ? '#C0B5A0' : '#3D3530',
    };
  }, [bgColor]);

  const plasmidSeq = useMemo(() => cleanSeq(plasmidSeqRaw), [plasmidSeqRaw]);
  const total = plasmidSeq.length;

  // Active plasmid radius. Annotations and highlights scale in arc length with R
  // (since their angular spans are anchored to genomic positions) but their
  // thickness and the ring spacing stay fixed.
  const currentR = R_DEFAULT + radiusOffset;

  const resolved = useMemo(() => (
    resolveLocatedItems(annotations, plasmidSeq, total, isPlasmidView)
  ), [annotations, plasmidSeq, total, isPlasmidView]);

  const resolvedHighlights = useMemo(() => (
    resolveLocatedItems(highlights, plasmidSeq, total, isPlasmidView)
  ), [highlights, plasmidSeq, total, isPlasmidView]);

  // Label collision avoidance: annotations on the same ring with very close
  // label angles get progressively pushed outward so labels don't overlap.
  // Uses the labelPosition-adjusted angle, so manually shifting one of two
  // co-located labels with the slider actually de-stacks them.
  const labelLayout = useMemo(() => {
    const groups = {};
    for (const ann of resolved) {
      if (!ann.found || !ann.showLabel) continue;
      const { a1, a2 } = computeAngles(ann.start, ann.end, total);
      const sweep = a2 - a1;
      const labelA = a1 + sweep * (0.5 + (ann.labelPosition ?? 0) / 100);
      if (!groups[ann.ring]) groups[ann.ring] = [];
      groups[ann.ring].push({ id: ann.id, midA: labelA });
    }
    const layout = {};
    const threshold = 0.05; // ~3°
    for (const ring in groups) {
      const items = groups[ring].sort((a, b) => a.midA - b.midA);
      let prevA = -Infinity;
      let stack = 0;
      for (const item of items) {
        if (item.midA - prevA < threshold) {
          stack += 1;
        } else {
          stack = 0;
        }
        layout[item.id] = stack;
        prevA = item.midA;
      }
    }
    return layout;
  }, [resolved, total]);

  const linearLabelLayout = useMemo(() => {
    if (!total) return {};
    const groups = {};
    for (const ann of resolved) {
      if (!ann.found || !ann.showLabel) continue;
      const { x1, x2 } = linearRangeX(ann.start, ann.end, total);
      const labelX = x1 + (x2 - x1) * (0.5 + (ann.labelPosition ?? 0) / 100);
      const ring = ann.ring ?? 0;
      if (!groups[ring]) groups[ring] = [];
      groups[ring].push({ id: ann.id, x: labelX });
    }
    const layout = {};
    const threshold = 56;
    for (const ring in groups) {
      const items = groups[ring].sort((a, b) => a.x - b.x);
      let prevX = -Infinity;
      let stack = 0;
      for (const item of items) {
        if (item.x - prevX < threshold) {
          stack += 1;
        } else {
          stack = 0;
        }
        layout[item.id] = stack;
        prevX = item.x;
      }
    }
    return layout;
  }, [resolved, total]);

  const addAnnotation = useCallback(() => {
    const id = idCounter.current++;
    const colorIdx = annotations.length % PALETTE.length;
    const newAnn = {
      id,
      name: `Feature ${annotations.length + 1}`,
      mode: 'sequence',
      querySeq: '',
      start: 1,
      end: 100,
      direction: 'forward',
      color: PALETTE[colorIdx],
      outlineColor: null,
      outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH,
      ring: 0,
      shape: 'arrow',
      sizeScale: 1,
      cornerStyle: 'rounded',
      showLabel: true,
      collapsed: false,
    };
    setAnnotations(prev => [...prev, newAnn]);
    setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  }, [annotations.length]);

  const updateAnn = useCallback((id, updates) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const removeAnn = useCallback((id) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  const addHighlight = useCallback(() => {
    const id = idCounter.current++;
    const colorIdx = highlights.length % HIGHLIGHT_PALETTE.length;
    const newHl = {
      id,
      name: `Region ${highlights.length + 1}`,
      mode: 'position',
      querySeq: '',
      start: 1,
      end: Math.max(2, Math.floor(plasmidSeq.length / 4)),
      color: HIGHLIGHT_PALETTE[colorIdx],
      opacity: 0.25,
      ring: 1,
      sizeScale: 3,
      cornerStyle: 'rounded',
      labelSize: 13,
      showBoundaries: true,
      showLabel: true,
      collapsed: false,
    };
    setHighlights(prev => [...prev, newHl]);
  }, [highlights.length, plasmidSeq.length]);

  const updateHighlight = useCallback((id, updates) => {
    setHighlights(prev => prev.map(h => h.id === id ? { ...h, ...updates } : h));
  }, []);

  const removeHighlight = useCallback((id) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
  }, []);

  const updateTerminiLabels = useCallback((updates) => {
    setTerminiLabels(prev => ({ ...prev, ...updates }));
  }, []);

  const updateTerminiLabel = useCallback((side, updates) => {
    setTerminiLabels(prev => ({
      ...prev,
      [side]: { ...prev[side], ...updates },
    }));
  }, []);

  const applyProjectState = (project) => {
    setActiveView(project.activeView);
    setPlasmidName(project.plasmidName);
    setPlasmidSeqRaw(project.plasmidSeqRaw);
    setAnnotations(project.annotations);
    setBgColor(project.bgColor);
    setShowName(project.showName);
    setShowSize(project.showSize);
    setShowTicks(project.showTicks);
    setBackboneThickness(project.backboneThickness);
    setBackboneColor(project.backboneColor);
    setRotation(project.rotation);
    setRadiusOffset(project.radiusOffset);
    setLinearTermini(project.linearTermini);
    setTerminiLabels(project.terminiLabels);
    setFontFamily(project.fontFamily);
    setLabelFontSize(project.labelFontSize);
    setTickFontSize(project.tickFontSize);
    setNameFontSize(project.nameFontSize);
    setLinearTitleDistance(project.linearTitleDistance);
    setTextColor(project.textColor);
    setHighlights(project.highlights);
    setHoveredId(null);
    setConfirmingBlank(false);
    const highestId = Math.max(0, ...project.annotations.map(item => item.id), ...project.highlights.map(item => item.id));
    idCounter.current = Math.max(100, highestId + 1);
  };

  const handleProjectUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const project = parseProjectDocument(await file.text());
      applyProjectState(project);
      setNotice({ type: 'success', text: `Opened project “${file.name}”.` });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not open this project.' });
    }
  };

  const handleSequenceUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = parseSequenceFile(await file.text(), file.name);
      setPlasmidName(imported.name);
      setPlasmidSeqRaw(imported.sequence);
      setShowSeqInput(false);
      setNotice({
        type: 'success',
        text: `Loaded ${imported.sequence.length.toLocaleString()} bp from “${file.name}”. Existing annotations were retained.`,
      });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not open this sequence file.' });
    }
  };

  const downloadProjectJSON = () => {
    const fileName = `${safeFileName(plasmidName, 'plasmid')}.plasmid.json`;
    const json = JSON.stringify(createProjectDocument(projectState), null, 2);
    downloadFile(json, 'application/json', fileName);
    setNotice({ type: 'success', text: `Saved editable project as “${fileName}”.` });
  };

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    downloadFile(
      `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`,
      'image/svg+xml',
      `${safeFileName(plasmidName, 'plasmid')}.svg`,
    );
  };

  const blankAll = () => {
    // Two-click confirm: first click arms the button, second click commits.
    // (Avoids window.confirm, which is silently blocked in many sandboxed
    // iframes including the artifact preview environment.)
    if (!confirmingBlank) {
      setConfirmingBlank(true);
      // Auto-disarm after 4 seconds so the button doesn't stay hot indefinitely
      setTimeout(() => setConfirmingBlank(false), 4000);
      return;
    }
    setConfirmingBlank(false);
    setPlasmidName('');
    setPlasmidSeqRaw('');
    setAnnotations([]);
    setHighlights([]);
    setRotation(0);
    setRadiusOffset(0);
    setLinearTermini('none');
    setTerminiLabels(createDefaultTerminiLabels());
    setLinearTitleDistance(229);
    setShowTicks(true);
    setHoveredId(null);
    setShowSeqInput(true); // open input ready for paste
  };

  /* ---------- render ---------- */
  const ticks = useMemo(() => {
    if (!total) return [];
    const interval = tickInterval(total);
    const arr = [];
    // When a ring-0 annotation grows thick enough to fully swallow the tick
    // line (thickness/2 > 10 px), shift ticks and labels inward by the amount
    // the annotation extends past the original tick's inner end.
    const maxRing0HalfThickness = Math.max(0, ...resolved
      .filter(a => a.found && a.ring === 0)
      .map(a => (BAND_THICKNESS * (a.sizeScale ?? 1)) / 2));
    const tickShift = Math.max(0, maxRing0HalfThickness - 10);
    // Position 1 marker at 12 o'clock (same style as the rest)
    {
      const a = angleAt(1, total);
      const [x1, y1] = polar(a, currentR - 4 - tickShift);
      const [x2, y2] = polar(a, currentR - 10 - tickShift);
      const [tx, ty] = polar(a, currentR - 32 - tickShift);
      arr.push({ p: 1, a, x1, y1, x2, y2, tx, ty });
    }
    // Regular interval ticks
    const lastTick = Math.floor(total / interval) * interval;
    for (let p = interval; p <= total; p += interval) {
      if (p === 1) continue;
      // Omit last tick if its gap to position 1 is smaller than the interval —
      // otherwise its label collides with the "1" at 12 o'clock.
      if (p === lastTick && (total - p + 1) < interval) continue;
      const a = angleAt(p, total);
      const [x1, y1] = polar(a, currentR - 4 - tickShift);
      const [x2, y2] = polar(a, currentR - 10 - tickShift);
      const [tx, ty] = polar(a, currentR - 32 - tickShift);
      arr.push({ p, a, x1, y1, x2, y2, tx, ty });
    }
    return arr;
  }, [total, currentR, resolved]);

  const linearTicks = useMemo(() => {
    if (!total) return [];
    const interval = tickInterval(total);
    const seen = new Set();
    const arr = [];
    const addTick = (p) => {
      if (seen.has(p)) return;
      seen.add(p);
      arr.push({ p, x: linearBaseX(p, total) });
    };
    addTick(1);
    for (let p = interval; p < total; p += interval) addTick(p);
    if (total > 1) addTick(total);
    return arr.sort((a, b) => a.p - b.p);
  }, [total]);

  return (
    <div className="w-full h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden" style={{
      '--bg': '#F5F1EA',
      '--bg-tint': '#EFEAE0',
      '--ink': '#1F1B16',
      '--muted': '#8A8174',
      '--border': '#D9D0BE',
      '--border-strong': '#B8AE99',
      '--accent': '#B8472D',
      '--backbone': '#3D3530',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        body, html, #root { background: #F5F1EA; font-family: 'Instrument Sans', system-ui, sans-serif; }
        input, button, select, textarea { font-family: inherit; }
        .font-display { font-family: 'Instrument Serif', Georgia, serif; }
        .font-ui { font-family: 'Instrument Sans', system-ui, sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        textarea, input.font-mono, .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace !important; }
        .annotation-hover { filter: brightness(1.1) drop-shadow(0 2px 4px rgba(31,27,22,0.18)); }
        .scroll-fade::-webkit-scrollbar { width: 8px; }
        .scroll-fade::-webkit-scrollbar-track { background: transparent; }
        .scroll-fade::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .scroll-fade::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
        .thickness-slider { -webkit-appearance: none; appearance: none; height: 4px; background: var(--border); border-radius: 2px; outline: none; cursor: pointer; }
        .thickness-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--ink); border: 2px solid var(--bg); box-shadow: 0 1px 3px rgba(31,27,22,0.25); cursor: grab; transition: transform 0.1s; }
        .thickness-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.15); }
        .thickness-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--ink); border: 2px solid var(--bg); box-shadow: 0 1px 3px rgba(31,27,22,0.25); cursor: grab; }
        .thickness-slider::-moz-range-track { height: 4px; background: var(--border); border-radius: 2px; border: none; }
      `}</style>

      {/* Header */}
      <header className="flex-shrink-0 border-b border-[var(--border)] px-6 py-3 flex items-center justify-between bg-[var(--bg)]">
        <div className="flex items-baseline gap-3">
          <div className="font-display text-[22px] italic leading-none">plasmid<span className="text-[var(--accent)]">.</span>studio</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            {isPlasmidView ? 'circular map editor' : 'linear sequence editor'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={projectFileRef}
            type="file"
            accept=".json,.plasmid.json,application/json"
            onChange={handleProjectUpload}
            className="hidden"
          />
          <button
            onClick={() => projectFileRef.current?.click()}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 border border-[var(--border-strong)] rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-tint)] transition-colors"
            title="Open an editable Plasmid Studio JSON project"
          >
            <FolderOpen size={13} /> Open
          </button>
          <button
            onClick={downloadProjectJSON}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 border border-[var(--border-strong)] rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-tint)] transition-colors"
            title="Save an editable Plasmid Studio JSON project"
          >
            <Save size={13} /> Save project
          </button>
          <button
            onClick={blankAll}
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 border rounded-md transition-colors ${confirmingBlank ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--accent)] hover:text-white hover:border-[var(--accent)]'}`}
            title={confirmingBlank ? 'Click again to confirm' : 'Clear sequence, name, annotations, and highlights'}
          >
            <Trash2 size={13} /> {confirmingBlank ? 'Click again to confirm' : 'Blank'}
          </button>
          <button
            onClick={downloadSVG}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 border border-[var(--border-strong)] rounded-md hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors"
          >
            <Download size={13} /> Export SVG
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Controls panel */}
        <aside className="w-[420px] flex-shrink-0 border-r border-[var(--border)] flex flex-col min-h-0">
          <div className="flex-shrink-0 p-3 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn active={isPlasmidView} onClick={() => setActiveView('plasmid')}>
                Plasmid
              </SegBtn>
              <SegBtn active={!isPlasmidView} onClick={() => setActiveView('linear')}>
                Linear sequence
              </SegBtn>
            </div>
            <div className="mt-2 flex items-start justify-between gap-2 px-1" aria-live="polite">
              <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted)]">
                Autosave on · this browser
              </div>
              {notice && (
                <button
                  onClick={() => setNotice(null)}
                  className={`flex-1 text-right text-[10px] leading-snug ${notice.type === 'error' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}
                  title="Dismiss message"
                >
                  {notice.text} ×
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto scroll-fade flex-1 p-5 space-y-4">
            {/* Plasmid info card */}
            <div className="bg-[var(--bg-tint)] border border-[var(--border)] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-semibold">
                  {isPlasmidView ? 'Plasmid' : 'Linear sequence'}
                </div>
                <div className="font-mono text-[11px] text-[var(--muted)]">{total.toLocaleString()} bp</div>
              </div>
              <Field label="Name">
                <Input value={plasmidName} onChange={e => setPlasmidName(e.target.value)} placeholder={isPlasmidView ? 'pUC19' : 'linear construct'} />
              </Field>
              <div>
                <input
                  ref={sequenceFileRef}
                  type="file"
                  accept=".fa,.fasta,.fna,.ffn,.txt,.dna,text/plain"
                  onChange={handleSequenceUpload}
                  className="hidden"
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setShowSeqInput(v => !v)}
                    className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors"
                  >
                    {showSeqInput ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showSeqInput ? 'Hide' : 'Edit'} sequence
                  </button>
                  <button
                    onClick={() => sequenceFileRef.current?.click()}
                    className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1 transition-colors"
                    title="Upload one FASTA or raw DNA sequence"
                  >
                    <Upload size={12} /> Upload FASTA / DNA
                  </button>
                </div>
                {showSeqInput && (
                  <div className="mt-2">
                    <TextArea
                      value={plasmidSeqRaw}
                      onChange={e => setPlasmidSeqRaw(e.target.value)}
                      placeholder="Paste sequence (ACGTN, whitespace OK)"
                      rows={5}
                      style={{ fontSize: 10, lineHeight: 1.4 }}
                    />
                    <div className="text-[10px] text-[var(--muted)] mt-1 italic">
                      Length is recomputed automatically. Sequence-find annotations re-locate live.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Canvas card */}
            <div className="bg-[var(--bg-tint)] border border-[var(--border)] rounded-lg p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-semibold">Canvas</div>

              {/* Background color */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Background</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={e => setBgColor(e.target.value)}
                    className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)]"
                  />
                  <div className="flex flex-wrap gap-1">
                    {BG_PRESETS.map(c => (
                      <button
                        key={c}
                        onClick={() => setBgColor(c)}
                        className={`w-3.5 h-3.5 rounded-sm border hover:scale-125 transition-transform ${bgColor.toLowerCase() === c.toLowerCase() ? 'border-[var(--ink)] ring-1 ring-[var(--ink)]' : 'border-[var(--border-strong)]'}`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-[9.5px] text-[var(--muted)] mt-1 italic">
                  Tick + label colors auto-adjust to stay readable.
                </div>
              </div>

              {!isPlasmidView && (
                <div className="space-y-2 pt-1 border-t border-[var(--border)]">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Termini</div>
                  <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
                    <SegBtn active={linearTermini === 'none'} onClick={() => setLinearTermini('none')}>
                      No termini
                    </SegBtn>
                    <SegBtn active={linearTermini === 'line'} onClick={() => setLinearTermini('line')}>
                      Line
                    </SegBtn>
                    <SegBtn active={linearTermini === 'itr'} onClick={() => setLinearTermini('itr')}>
                      ITR
                    </SegBtn>
                    <SegBtn active={linearTermini === 'break'} onClick={() => setLinearTermini('break')}>
                      · · · //
                    </SegBtn>
                  </div>
                  <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Termini labels</div>
                    {['left', 'right'].map(side => (
                      <div key={side}>
                        {terminiLabels[side].visible ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={terminiLabels[side].text}
                              onChange={e => updateTerminiLabel(side, { text: e.target.value })}
                              placeholder={`${side} label`}
                            />
                            <button
                              onClick={() => updateTerminiLabel(side, { visible: false })}
                              className="text-[var(--muted)] hover:text-[var(--accent)] p-1"
                              title={`Remove ${side} terminus label`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => updateTerminiLabel(side, { visible: true })}
                            className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-[var(--border-strong)] rounded-md text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors uppercase tracking-wider"
                          >
                            <Plus size={12} /> Add {side} label
                          </button>
                        )}
                      </div>
                    ))}
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                        <span>Vertical distance</span>
                        <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{terminiLabels.distance}</span>
                      </div>
                      <input
                        type="range"
                        min="4"
                        max="80"
                        step="1"
                        value={terminiLabels.distance}
                        onChange={e => updateTerminiLabels({ distance: parseInt(e.target.value) })}
                        className="thickness-slider w-full"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                        <span>Label size</span>
                        <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{terminiLabels.size ?? 12}</span>
                      </div>
                      <input
                        type="range"
                        min="7"
                        max="24"
                        step="1"
                        value={terminiLabels.size ?? 12}
                        onChange={e => updateTerminiLabels({ size: parseInt(e.target.value) })}
                        className="thickness-slider w-full"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Label color</div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={terminiLabels.color || (textColor || theme.ink)}
                          onChange={e => updateTerminiLabels({ color: e.target.value })}
                          className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)]"
                          title={terminiLabels.color ? 'Custom label color' : 'Auto (text color)'}
                        />
                        <button
                          onClick={() => updateTerminiLabels({ color: null })}
                          className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors ${terminiLabels.color === null ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--ink)]'}`}
                        >
                          Auto
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Backbone thickness + color */}
              <div className="space-y-2 pt-1 border-t border-[var(--border)]">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                    <span>Backbone thickness</span>
                    <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                      {backboneThickness.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="8"
                    step="0.1"
                    value={backboneThickness}
                    onChange={e => setBackboneThickness(parseFloat(e.target.value))}
                    className="thickness-slider w-full"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Backbone color</div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={backboneColor || theme.backbone}
                      onChange={e => setBackboneColor(e.target.value)}
                      className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)]"
                      title={backboneColor ? 'Custom color' : 'Auto (matches bg)'}
                    />
                    <button
                      onClick={() => setBackboneColor(null)}
                      className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors ${backboneColor === null ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--ink)]'}`}
                      title="Auto-derive from background"
                    >
                      Auto
                    </button>
                  </div>
                </div>
              </div>

              {isPlasmidView && (
                <>
                  {/* Rotation */}
                  <div className="pt-1 border-t border-[var(--border)]">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                      <span>Rotation</span>
                      <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                        {rotation}°
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="360"
                        step="1"
                        value={rotation}
                        onChange={e => setRotation(parseInt(e.target.value))}
                        className="thickness-slider flex-1"
                      />
                      <button
                        onClick={() => setRotation(0)}
                        className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                      >
                        reset
                      </button>
                    </div>
                  </div>

                  {/* Plasmid radius */}
                  <div className="pt-1 border-t border-[var(--border)]">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                      <span>Plasmid radius</span>
                      <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                        {radiusOffset > 0 ? '+' : ''}{radiusOffset}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="-100"
                        max="150"
                        step="2"
                        value={radiusOffset}
                        onChange={e => setRadiusOffset(parseInt(e.target.value))}
                        className="thickness-slider flex-1"
                      />
                      <button
                        onClick={() => setRadiusOffset(0)}
                        className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                      >
                        reset
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Typography */}
              <div className="pt-1 border-t border-[var(--border)] space-y-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-semibold pt-1">Typography</div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Font</div>
                  <select
                    value={fontFamily}
                    onChange={e => setFontFamily(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[12px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    style={{ fontFamily }}
                  >
                    {FONT_OPTIONS.map(f => (
                      <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                    <span>Annotation label size</span>
                    <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{labelFontSize.toFixed(1)}</span>
                  </div>
                  <input type="range" min="8" max="20" step="0.5"
                    value={labelFontSize}
                    onChange={e => setLabelFontSize(parseFloat(e.target.value))}
                    className="thickness-slider w-full" />
                </div>
                <div>
                  {showTicks && (
                    <>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                        <span>Tick label size</span>
                        <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{tickFontSize.toFixed(1)}</span>
                      </div>
                      <input type="range" min="6" max="14" step="0.5"
                        value={tickFontSize}
                        onChange={e => setTickFontSize(parseFloat(e.target.value))}
                        className="thickness-slider w-full" />
                    </>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                    <span>{isPlasmidView ? 'Plasmid name size' : 'Sequence name size'}</span>
                    <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{nameFontSize}</span>
                  </div>
                  <input type="range" min="14" max="56" step="1"
                    value={nameFontSize}
                    onChange={e => setNameFontSize(parseInt(e.target.value))}
                    className="thickness-slider w-full" />
                </div>
                {!isPlasmidView && (showName || showSize) && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                      <span>Name + size vertical distance</span>
                      <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{linearTitleDistance}</span>
                    </div>
                    <input type="range" min="90" max="330" step="1"
                      value={linearTitleDistance}
                      onChange={e => setLinearTitleDistance(parseInt(e.target.value))}
                      className="thickness-slider w-full" />
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Text color</div>
                  <div className="flex items-center gap-1.5">
                    <input type="color"
                      value={textColor || theme.ink}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)]"
                      title={textColor ? 'Custom' : 'Auto (theme)'}
                    />
                    <button
                      onClick={() => setTextColor(null)}
                      className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors ${textColor === null ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--ink)]'}`}
                    >
                      Auto
                    </button>
                  </div>
                </div>
              </div>

              {/* Center label visibility */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--border)]">
                <button
                  onClick={() => setShowName(v => !v)}
                  className="flex items-center gap-2 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  {showName ? <Eye size={12} /> : <EyeOff size={12} />}
                  {isPlasmidView ? 'Plasmid' : 'Sequence'} name {showName ? 'visible' : 'hidden'}
                </button>
                <button
                  onClick={() => setShowSize(v => !v)}
                  className="flex items-center gap-2 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  {showSize ? <Eye size={12} /> : <EyeOff size={12} />}
                  Size label {showSize ? 'visible' : 'hidden'}
                </button>
                <button
                  onClick={() => setShowTicks(v => !v)}
                  className="flex items-center gap-2 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  {showTicks ? <Eye size={12} /> : <EyeOff size={12} />}
                  Ticks {showTicks ? 'visible' : 'hidden'}
                </button>
              </div>
            </div>

            {/* Annotations list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-semibold">
                  Annotations · {annotations.length}
                </div>
              </div>

              {resolved.map((ann) => (
                <AnnotationCard
                  key={ann.id}
                  ann={ann}
                  total={total}
                  viewMode={activeView}
                  onUpdate={(u) => updateAnn(ann.id, u)}
                  onRemove={() => removeAnn(ann.id)}
                  onHover={setHoveredId}
                  isHovered={hoveredId === ann.id}
                />
              ))}

              {annotations.length === 0 && (
                <div className="text-center text-[12px] text-[var(--muted)] italic py-6 border border-dashed border-[var(--border)] rounded-lg">
                  No annotations yet. Click + below to start.
                </div>
              )}

              {/* + button — always at bottom of list */}
              <button
                onClick={addAnnotation}
                className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-[var(--border-strong)] rounded-lg text-[12px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--bg-tint)] transition-all uppercase tracking-wider"
              >
                <Plus size={14} /> Add annotation
              </button>
              <div ref={listEndRef} />
            </div>

            {/* Highlights list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] font-semibold">
                  Highlights · {highlights.length}
                </div>
              </div>

              {resolvedHighlights.map(hl => (
                <HighlightCard
                  key={hl.id}
                  hl={hl}
                  total={total}
                  viewMode={activeView}
                  onUpdate={(u) => updateHighlight(hl.id, u)}
                  onRemove={() => removeHighlight(hl.id)}
                />
              ))}

              {highlights.length === 0 && (
                <div className="text-center text-[12px] text-[var(--muted)] italic py-6 border border-dashed border-[var(--border)] rounded-lg">
                  No highlights yet. Translucent bands across regions.
                </div>
              )}

              <button
                onClick={addHighlight}
                className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-[var(--border-strong)] rounded-lg text-[12px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--bg-tint)] transition-all uppercase tracking-wider"
              >
                <Plus size={14} /> Add highlight
              </button>
            </div>
          </div>
        </aside>

        {/* Map canvas */}
        <main
          className="flex-1 flex items-center justify-center min-h-0 p-6 relative overflow-hidden transition-colors"
          style={{ background: theme.bg }}
        >
          {isPlasmidView ? (
            <div className="w-full h-full max-w-[800px] max-h-[800px] aspect-square">
              <svg
                ref={svgRef}
                viewBox={`-${VIEWBOX/2} -${VIEWBOX/2} ${VIEWBOX} ${VIEWBOX}`}
                className="w-full h-full"
                style={{ overflow: 'visible', fontFamily }}
              >
                {/* Background — included in export */}
                <rect
                  x={-VIEWBOX/2} y={-VIEWBOX/2}
                  width={VIEWBOX} height={VIEWBOX}
                  fill={theme.bg}
                />

                {/* Rotating ring — highlights, backbone, ticks, annotations all rotate together; center labels stay static */}
                <g transform={`rotate(${rotation})`}>
                  {/* Highlights — translucent bands; rendered FIRST so they sit at the very back, behind the plasmid ring itself */}
                  {resolvedHighlights.filter(h => h.found).map(hl => (
                    <Highlight
                      key={hl.id}
                      hl={hl}
                      total={total}
                      rotation={rotation}
                      fontFamily={fontFamily}
                      textColor={textColor}
                      currentR={currentR}
                    />
                  ))}

                  {/* Backbone */}
                  <circle
                    cx="0" cy="0" r={currentR}
                    fill="none"
                    stroke={backboneColor || theme.backbone}
                    strokeWidth={backboneThickness}
                  />

                  {/* Ticks */}
                  {showTicks && ticks.map((t) => (
                    <g key={t.p}>
                      <line
                        x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                        stroke={theme.backbone}
                        strokeWidth="0.8"
                        opacity="0.55"
                      />
                      <text
                        x={t.tx} y={t.ty}
                        fontSize={tickFontSize}
                        fill={theme.muted}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${-rotation} ${t.tx} ${t.ty})`}
                        style={{ fontFamily, letterSpacing: '0.02em' }}
                      >
                        {t.p}
                      </text>
                    </g>
                  ))}

                  {/* Annotations — rendered on top */}
                  {resolved.filter(a => a.found).map(ann => (
                    <Annotation
                      key={ann.id}
                      ann={ann}
                      total={total}
                      isHovered={hoveredId === ann.id}
                      onHover={setHoveredId}
                      theme={theme}
                      labelStack={labelLayout[ann.id] || 0}
                      rotation={rotation}
                      fontFamily={fontFamily}
                      labelFontSize={labelFontSize}
                      textColor={textColor}
                      currentR={currentR}
                    />
                  ))}
                </g>

                {/* Center labels — static, do not rotate */}
                {showName && (
                  <text x="0" y={showSize ? -8 : 6} textAnchor="middle" fontSize={nameFontSize} fill={textColor || theme.ink} style={{ fontFamily, fontStyle: 'italic' }}>
                    {plasmidName || 'untitled'}
                  </text>
                )}
                {showSize && (
                  <text x="0" y={showName ? 18 : 6} textAnchor="middle" fontSize="11" fill={theme.muted} style={{ fontFamily, letterSpacing: '0.05em' }}>
                    {total.toLocaleString()} bp
                  </text>
                )}
              </svg>
            </div>
          ) : (
            <div className="w-full h-full max-w-[980px] max-h-[620px] aspect-[820/520]">
              <svg
                ref={svgRef}
                viewBox={`-${LINEAR_VIEWBOX_W/2} -${LINEAR_VIEWBOX_H/2} ${LINEAR_VIEWBOX_W} ${LINEAR_VIEWBOX_H}`}
                className="w-full h-full"
                style={{ overflow: 'visible', fontFamily }}
              >
                <rect
                  x={-LINEAR_VIEWBOX_W/2} y={-LINEAR_VIEWBOX_H/2}
                  width={LINEAR_VIEWBOX_W} height={LINEAR_VIEWBOX_H}
                  fill={theme.bg}
                />

                <LinearTermini
                  terminiStyle={linearTermini}
                  backboneColor={backboneColor || theme.backbone}
                  backboneThickness={backboneThickness}
                  labels={terminiLabels}
                  fontFamily={fontFamily}
                  textColor={textColor || theme.ink}
                />

                {resolvedHighlights.filter(h => h.found).map(hl => (
                  <LinearHighlight
                    key={hl.id}
                    hl={hl}
                    total={total}
                    fontFamily={fontFamily}
                    textColor={textColor}
                  />
                ))}

                <line
                  x1={LINEAR_SEQ_LEFT}
                  y1={LINEAR_SEQ_Y}
                  x2={LINEAR_SEQ_RIGHT}
                  y2={LINEAR_SEQ_Y}
                  stroke={backboneColor || theme.backbone}
                  strokeWidth={backboneThickness}
                  strokeLinecap={linearTermini === 'line' || linearTermini === 'break' ? 'round' : 'butt'}
                  />

                {showTicks && linearTicks.map(t => (
                  <g key={t.p}>
                    <line
                      x1={t.x} y1={LINEAR_SEQ_Y + 8} x2={t.x} y2={LINEAR_SEQ_Y + 17}
                      stroke={theme.backbone}
                      strokeWidth="0.8"
                      opacity="0.55"
                    />
                    <text
                      x={t.x} y={LINEAR_SEQ_Y + 33}
                      fontSize={tickFontSize}
                      fill={theme.muted}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ fontFamily, letterSpacing: '0.02em' }}
                    >
                      {t.p}
                    </text>
                  </g>
                ))}

                {resolved.filter(a => a.found).map(ann => (
                  <LinearAnnotation
                    key={ann.id}
                    ann={ann}
                    total={total}
                    isHovered={hoveredId === ann.id}
                    onHover={setHoveredId}
                    theme={theme}
                    labelStack={linearLabelLayout[ann.id] || 0}
                    fontFamily={fontFamily}
                    labelFontSize={labelFontSize}
                    textColor={textColor}
                  />
                ))}

                {(() => {
                  const titleCenterY = LINEAR_SEQ_Y - linearTitleDistance;
                  const nameY = showName && showSize ? titleCenterY - 14 : titleCenterY;
                  const sizeY = showName && showSize ? titleCenterY + 14 : titleCenterY;
                  return (
                    <>
                      {showName && (
                        <text x="0" y={nameY} textAnchor="middle" fontSize={nameFontSize} fill={textColor || theme.ink} style={{ fontFamily, fontStyle: 'italic' }}>
                          {plasmidName || 'untitled'}
                        </text>
                      )}
                      {showSize && (
                        <text x="0" y={sizeY} textAnchor="middle" fontSize="11" fill={theme.muted} style={{ fontFamily, letterSpacing: '0.05em' }}>
                          {total.toLocaleString()} bp
                        </text>
                      )}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- annotation drawing on the map ---------- */
function Annotation({ ann, total, isHovered, onHover, theme, labelStack = 0, fontFamily, labelFontSize = 11.5, textColor, rotation = 0, currentR = R_DEFAULT }) {
  const { a1, a2 } = computeAngles(ann.start, ann.end, total);
  const sizeScale = ann.sizeScale ?? 1;
  const thickness = BAND_THICKNESS * sizeScale;
  const lineStroke = 3.5 * sizeScale;
  const { inner, outer } = ringRadii(ann.ring, thickness, currentR);
  const cornerRadius = thickness * 0.35; // proportional rounding
  const cornerStyle = ann.cornerStyle ?? 'rounded';
  const outlineColor = ann.outlineColor || darken(ann.color, 0.5);
  const outlineWidth = ann.outlineWidth ?? DEFAULT_ANNOTATION_OUTLINE_WIDTH;
  let pathEl;
  if (ann.shape === 'arrow') {
    const d = cornerStyle === 'rounded'
      ? roundedArrowPath(a1, a2, inner, outer, ann.direction, cornerRadius)
      : arrowPath(a1, a2, inner, outer, ann.direction);
    pathEl = (
      <path
        d={d}
        fill={ann.color}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeLinejoin={cornerStyle === 'rounded' ? 'round' : 'miter'}
        strokeLinecap={cornerStyle === 'rounded' ? 'round' : 'butt'}
        opacity={1}
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'filter 0.15s, opacity 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  } else if (ann.shape === 'block') {
    const d = cornerStyle === 'rounded'
      ? roundedBandPath(a1, a2, inner, outer, cornerRadius)
      : bandPath(a1, a2, inner, outer);
    pathEl = (
      <path
        d={d}
        fill={ann.color}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeLinejoin={cornerStyle === 'rounded' ? 'round' : 'miter'}
        strokeLinecap={cornerStyle === 'rounded' ? 'round' : 'butt'}
        opacity={1}
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'filter 0.15s, opacity 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  } else {
    // line — stroke width scales with sizeScale, already round caps
    const midR = (inner + outer) / 2;
    pathEl = (
      <path
        d={linePath(a1, a2, midR)}
        fill="none"
        stroke={ann.color}
        strokeWidth={isHovered ? lineStroke + 1 : lineStroke}
        strokeLinecap="round"
        opacity={1}
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'all 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  }

  // label
  let labelEl = null;
  if (ann.showLabel) {
    // labelPosition (-50..+50) shifts the label along the annotation's arc
    // between its termini; 0 = center.
    const sweep = a2 - a1;
    const labelA = a1 + sweep * (0.5 + (ann.labelPosition ?? 0) / 100);
    const isInnerRing = (ann.ring ?? 0) < 0;
    const labelGap = LABEL_OFFSET + labelStack * 16 + (ann.labelDistance ?? 0);
    const labelR = isInnerRing
      ? Math.max(4, inner - labelGap)
      : outer + labelGap;
    const [lx, ly] = polar(labelA, labelR);
    const leaderStartR = ann.shape === 'line'
      ? (inner + outer) / 2 + (isInnerRing ? -1 : 1) * (lineStroke / 2 + 2)
      : (isInnerRing ? Math.max(4, inner - 2) : outer + 2);
    const [lineStartX, lineStartY] = polar(labelA, Math.max(4, leaderStartR));
    const [lineEndX, lineEndY] = polar(labelA, isInnerRing ? labelR + 4 : labelR - 4);
    // Anchor based on screen-space angle (after rotation), so labels still
    // extend outward from the circle even when ring is rotated.
    const screenA = labelA + (rotation * Math.PI) / 180;
    const cosA = Math.cos(screenA);
    let anchor = 'middle';
    if (cosA > 0.2) anchor = 'start';
    else if (cosA < -0.2) anchor = 'end';
    labelEl = (
      <g style={{ pointerEvents: 'none' }}>
        <line
          x1={lineStartX} y1={lineStartY} x2={lineEndX} y2={lineEndY}
          stroke={theme.backbone} strokeWidth="0.6" opacity="0.55"
        />
        <text
          x={lx} y={ly}
          textAnchor={anchor}
          dominantBaseline="middle"
          fontSize={labelFontSize}
          fill={textColor || theme.ink}
          transform={`rotate(${-rotation} ${lx} ${ly})`}
          style={{ fontFamily, fontWeight: 500, letterSpacing: '0.01em' }}
        >
          {ann.name}
        </text>
      </g>
    );
  }

  return <g>{pathEl}{labelEl}</g>;
}

/* ---------- highlight: translucent band with curved label ---------- */
function Highlight({ hl, total, fontFamily, textColor, rotation = 0, currentR = R_DEFAULT }) {
  const { a1, a2 } = computeAngles(hl.start, hl.end, total);
  const sizeScale = hl.sizeScale ?? 3;
  const thickness = BAND_THICKNESS * sizeScale;
  const { inner, outer } = ringRadii(hl.ring ?? 1, thickness, currentR);
  const midR = (inner + outer) / 2;
  const cornerStyle = hl.cornerStyle ?? 'rounded';
  const cornerRadius = thickness * 0.2;
  const opacity = hl.opacity ?? 0.25;
  const labelSize = hl.labelSize ?? 13;
  const isInnerRing = (hl.ring ?? 1) < 0;

  const bandD = cornerStyle === 'rounded'
    ? roundedBandPath(a1, a2, inner, outer, cornerRadius)
    : bandPath(a1, a2, inner, outer);

  // Path for the curved label — by default sits on the band's midline, but
  // labelDistance lets the user push it outward (positive) or pull it inward
  // (negative) of the band.
  const labelR = Math.max(4, midR + (isInnerRing ? -1 : 1) * (hl.labelDistance ?? 0));
  const sweep = a2 - a1;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const [px1, py1] = polar(a1, labelR);
  const [px2, py2] = polar(a2, labelR);
  const midA = (a1 + a2) / 2;
  const rotatedMidA = midA + (rotation * Math.PI) / 180;
  const flip = Math.sin(rotatedMidA) > 0;
  const textPathD = flip
    ? `M ${px2} ${py2} A ${labelR} ${labelR} 0 ${largeArc} 0 ${px1} ${py1}`
    : `M ${px1} ${py1} A ${labelR} ${labelR} 0 ${largeArc} 1 ${px2} ${py2}`;

  // Boundary dashed lines at start/end (extending from outer edge inward toward backbone)
  const boundaryEls = hl.showBoundaries ? (() => {
    const boundaryOuterR = isInnerRing ? Math.max(4, inner - 4) : outer + 4;
    const boundaryInnerR = isInnerRing ? currentR + 6 : currentR - 6;
    const [b1ox, b1oy] = polar(a1, boundaryOuterR);
    const [b1ix, b1iy] = polar(a1, boundaryInnerR);
    const [b2ox, b2oy] = polar(a2, boundaryOuterR);
    const [b2ix, b2iy] = polar(a2, boundaryInnerR);
    return (
      <g>
        <line x1={b1ox} y1={b1oy} x2={b1ix} y2={b1iy}
          stroke={hl.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
        <line x1={b2ox} y1={b2oy} x2={b2ix} y2={b2iy}
          stroke={hl.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
      </g>
    );
  })() : null;

  // Boundary position labels (tinted to match highlight) — counter-rotated upright
  const boundaryLabels = hl.showBoundaries ? (() => {
    const boundaryLabelR = isInnerRing ? Math.max(4, inner - 14) : outer + 14;
    const [t1x, t1y] = polar(a1, boundaryLabelR);
    const [t2x, t2y] = polar(a2, boundaryLabelR);
    return (
      <g>
        <text x={t1x} y={t1y} textAnchor="middle" dominantBaseline="middle"
          fontSize="10" fill={hl.color}
          transform={`rotate(${-rotation} ${t1x} ${t1y})`}
          style={{ fontFamily, fontWeight: 600, letterSpacing: '0.02em' }}>
          {hl.start}
        </text>
        <text x={t2x} y={t2y} textAnchor="middle" dominantBaseline="middle"
          fontSize="10" fill={hl.color}
          transform={`rotate(${-rotation} ${t2x} ${t2y})`}
          style={{ fontFamily, fontWeight: 600, letterSpacing: '0.02em' }}>
          {hl.end}
        </text>
      </g>
    );
  })() : null;

  const pathId = `hl-path-${hl.id}`;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <path id={pathId} d={textPathD} fill="none" />
      </defs>
      {/* Translucent band */}
      <path
        d={bandD}
        fill={hl.color}
        stroke={hl.color}
        strokeWidth="0.5"
        strokeOpacity={Math.min(1, opacity * 2.5)}
        fillOpacity={opacity}
      />
      {boundaryEls}
      {boundaryLabels}
      {/* Curved label along the band — labelOffset (-50..+50) slides it
          between the two termini, with 0 at center. When the path is flipped
          for bottom-hemisphere readability, invert so positive always moves
          in the same physical direction along the band. */}
      {hl.showLabel !== false && (() => {
        const raw = hl.labelOffset ?? 0;
        const offsetPct = flip ? (50 - raw) : (50 + raw);
        return (
          <text fontSize={labelSize} fill={textColor || hl.color}
            style={{ fontFamily, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <textPath href={`#${pathId}`} startOffset={`${offsetPct}%`} textAnchor="middle">
              {hl.name}
            </textPath>
          </text>
        );
      })()}
    </g>
  );
}

/* ---------- linear map drawing ---------- */
function BrokenTerminusMarker({ x, flip = false, color, strokeWidth, dotRadius }) {
  const slashHalfH = 8;
  const slashLean = 4.5;
  const dotOffsets = [-17, -11, -5];
  const slashOffsets = [7, 14];
  const dots = flip ? dotOffsets.map(v => -v) : dotOffsets;
  const slashes = flip ? slashOffsets.map(v => -v) : slashOffsets;

  return (
    <g>
      {dots.map(dx => (
        <circle
          key={`dot-${dx}`}
          cx={x + dx}
          cy={LINEAR_SEQ_Y}
          r={dotRadius}
          fill={color}
        />
      ))}
      {slashes.map(dx => (
        <line
          key={`slash-${dx}`}
          x1={x + dx - slashLean / 2}
          y1={LINEAR_SEQ_Y + slashHalfH}
          x2={x + dx + slashLean / 2}
          y2={LINEAR_SEQ_Y - slashHalfH}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function LinearTermini({ terminiStyle, backboneColor, backboneThickness, labels, fontFamily, textColor }) {
  let terminiEl = null;
  let leftLabelX = LINEAR_SEQ_LEFT;
  let rightLabelX = LINEAR_SEQ_RIGHT;
  let labelTopY = LINEAR_SEQ_Y;

  if (terminiStyle === 'line') {
    leftLabelX = LINEAR_SEQ_LEFT - LINEAR_TERMINUS_EXT / 2;
    rightLabelX = LINEAR_SEQ_RIGHT + LINEAR_TERMINUS_EXT / 2;
    terminiEl = (
      <g>
        <line
          x1={LINEAR_SEQ_LEFT - LINEAR_TERMINUS_EXT}
          y1={LINEAR_SEQ_Y}
          x2={LINEAR_SEQ_LEFT}
          y2={LINEAR_SEQ_Y}
          stroke={backboneColor}
          strokeWidth={backboneThickness}
          strokeLinecap="round"
        />
        <line
          x1={LINEAR_SEQ_RIGHT}
          y1={LINEAR_SEQ_Y}
          x2={LINEAR_SEQ_RIGHT + LINEAR_TERMINUS_EXT}
          y2={LINEAR_SEQ_Y}
          stroke={backboneColor}
          strokeWidth={backboneThickness}
          strokeLinecap="round"
        />
      </g>
    );
  } else if (terminiStyle === 'break') {
    const markerOffset = 28;
    const slashStroke = backboneThickness;
    const dotR = slashStroke * 0.75;
    leftLabelX = LINEAR_SEQ_LEFT - markerOffset;
    rightLabelX = LINEAR_SEQ_RIGHT + markerOffset;
    labelTopY = LINEAR_SEQ_Y - 8;
    terminiEl = (
      <g>
        <BrokenTerminusMarker x={leftLabelX} color={backboneColor} strokeWidth={slashStroke} dotRadius={dotR} />
        <BrokenTerminusMarker x={rightLabelX} flip color={backboneColor} strokeWidth={slashStroke} dotRadius={dotR} />
      </g>
    );
  } else if (terminiStyle === 'itr') {
    const loopW = 34;
    const loopH = 84;
    const loopR = 11;
    const stem = 26;
    const pairEndGap = 6;
    const pairGap = 14;
    const pairY = LINEAR_SEQ_Y - pairGap;
    const loopCenterY = (LINEAR_SEQ_Y + pairY) / 2;
    const leftInnerX = LINEAR_SEQ_LEFT - stem;
    const leftOuterX = leftInnerX - loopW;
    const rightInnerX = LINEAR_SEQ_RIGHT + stem;
    const rightOuterX = rightInnerX + loopW;
    const topY = loopCenterY - loopH / 2;
    const bottomY = loopCenterY + loopH / 2;
    leftLabelX = (leftOuterX + leftInnerX) / 2;
    rightLabelX = (rightOuterX + rightInnerX) / 2;
    labelTopY = topY;
    const leftD = [
      `M ${LINEAR_SEQ_LEFT} ${LINEAR_SEQ_Y}`,
      `L ${leftInnerX} ${LINEAR_SEQ_Y}`,
      `L ${leftInnerX} ${bottomY - loopR}`,
      `Q ${leftInnerX} ${bottomY} ${leftInnerX - loopR} ${bottomY}`,
      `L ${leftOuterX + loopR} ${bottomY}`,
      `Q ${leftOuterX} ${bottomY} ${leftOuterX} ${bottomY - loopR}`,
      `L ${leftOuterX} ${topY + loopR}`,
      `Q ${leftOuterX} ${topY} ${leftOuterX + loopR} ${topY}`,
      `L ${leftInnerX - loopR} ${topY}`,
      `Q ${leftInnerX} ${topY} ${leftInnerX} ${topY + loopR}`,
      `L ${leftInnerX} ${pairY}`,
      `L ${LINEAR_SEQ_LEFT - pairEndGap} ${pairY}`,
    ].join(' ');
    const rightD = [
      `M ${LINEAR_SEQ_RIGHT} ${LINEAR_SEQ_Y}`,
      `L ${rightInnerX} ${LINEAR_SEQ_Y}`,
      `L ${rightInnerX} ${bottomY - loopR}`,
      `Q ${rightInnerX} ${bottomY} ${rightInnerX + loopR} ${bottomY}`,
      `L ${rightOuterX - loopR} ${bottomY}`,
      `Q ${rightOuterX} ${bottomY} ${rightOuterX} ${bottomY - loopR}`,
      `L ${rightOuterX} ${topY + loopR}`,
      `Q ${rightOuterX} ${topY} ${rightOuterX - loopR} ${topY}`,
      `L ${rightInnerX + loopR} ${topY}`,
      `Q ${rightInnerX} ${topY} ${rightInnerX} ${topY + loopR}`,
      `L ${rightInnerX} ${pairY}`,
      `L ${LINEAR_SEQ_RIGHT + pairEndGap} ${pairY}`,
    ].join(' ');
    terminiEl = (
      <g fill="none" stroke={backboneColor} strokeWidth={backboneThickness} strokeLinecap="round" strokeLinejoin="round">
        <path d={leftD} />
        <path d={rightD} />
      </g>
    );
  }

  const labelColor = labels?.color || textColor || backboneColor;
  const labelY = labelTopY - (labels?.distance ?? 22);

  return (
    <g>
      {terminiEl}
      {labels?.left?.visible && (
        <text
          x={leftLabelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={labels?.size ?? 12}
          fill={labelColor}
          style={{ fontFamily, letterSpacing: '0.02em' }}
        >
          {labels.left.text}
        </text>
      )}
      {labels?.right?.visible && (
        <text
          x={rightLabelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={labels?.size ?? 12}
          fill={labelColor}
          style={{ fontFamily, letterSpacing: '0.02em' }}
        >
          {labels.right.text}
        </text>
      )}
    </g>
  );
}

function LinearAnnotation({ ann, total, isHovered, onHover, theme, labelStack = 0, fontFamily, labelFontSize = 11.5, textColor }) {
  const { x1, x2 } = linearRangeX(ann.start, ann.end, total);
  const sizeScale = ann.sizeScale ?? 1;
  const thickness = BAND_THICKNESS * sizeScale;
  const lineStroke = 3.5 * sizeScale;
  const y = linearTrackY(ann.ring ?? 0);
  const cornerRadius = thickness * 0.35;
  const cornerStyle = ann.cornerStyle ?? 'rounded';
  const outlineColor = ann.outlineColor || darken(ann.color, 0.5);
  const outlineWidth = ann.outlineWidth ?? DEFAULT_ANNOTATION_OUTLINE_WIDTH;

  let pathEl;
  if (ann.shape === 'arrow') {
    pathEl = (
      <path
        d={linearArrowPath(x1, x2, y, thickness, ann.direction, cornerStyle, cornerRadius)}
        fill={ann.color}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeLinejoin={cornerStyle === 'rounded' ? 'round' : 'miter'}
        strokeLinecap={cornerStyle === 'rounded' ? 'round' : 'butt'}
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'filter 0.15s, opacity 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  } else if (ann.shape === 'block') {
    pathEl = (
      <path
        d={linearBlockPath(x1, x2, y, thickness, cornerStyle, cornerRadius)}
        fill={ann.color}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeLinejoin={cornerStyle === 'rounded' ? 'round' : 'miter'}
        strokeLinecap={cornerStyle === 'rounded' ? 'round' : 'butt'}
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'filter 0.15s, opacity 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  } else {
    pathEl = (
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={ann.color}
        strokeWidth={isHovered ? lineStroke + 1 : lineStroke}
        strokeLinecap="round"
        className={isHovered ? 'annotation-hover' : ''}
        style={{ transition: 'all 0.15s' }}
        onMouseEnter={() => onHover(ann.id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  }

  let labelEl = null;
  if (ann.showLabel) {
    const labelX = x1 + (x2 - x1) * (0.5 + (ann.labelPosition ?? 0) / 100);
    const track = ann.ring ?? 0;
    const side = track < 0 ? 1 : -1;
    const visibleHalfThickness = ann.shape === 'line' ? lineStroke / 2 : thickness / 2;
    const labelY = y + side * (visibleHalfThickness + LABEL_OFFSET + labelStack * 16 + (ann.labelDistance ?? 0));
    const lineStartY = y + side * (visibleHalfThickness + 2);
    const lineEndY = labelY - side * 8;
    labelEl = (
      <g style={{ pointerEvents: 'none' }}>
        <line
          x1={labelX} y1={lineStartY} x2={labelX} y2={lineEndY}
          stroke={theme.backbone} strokeWidth="0.6" opacity="0.55"
        />
        <text
          x={labelX} y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={labelFontSize}
          fill={textColor || theme.ink}
          style={{ fontFamily, fontWeight: 500, letterSpacing: '0.01em' }}
        >
          {ann.name}
        </text>
      </g>
    );
  }

  return <g>{pathEl}{labelEl}</g>;
}

function LinearHighlight({ hl, total, fontFamily, textColor }) {
  const { x1, x2 } = linearRangeX(hl.start, hl.end, total);
  const sizeScale = hl.sizeScale ?? 3;
  const thickness = BAND_THICKNESS * sizeScale;
  const y = linearTrackY(hl.ring ?? 1);
  const cornerStyle = hl.cornerStyle ?? 'rounded';
  const cornerRadius = thickness * 0.2;
  const opacity = hl.opacity ?? 0.25;
  const labelSize = hl.labelSize ?? 13;
  const track = hl.ring ?? 1;
  const side = track < 0 ? 1 : -1;
  const boundaryBandY = y + side * (thickness / 2 + 4);
  const boundaryLabelY = y + side * (thickness / 2 + 12);

  const boundaryEls = hl.showBoundaries ? (
    <g>
      <line
        x1={x1} y1={boundaryBandY}
        x2={x1} y2={LINEAR_SEQ_Y + 22}
        stroke={hl.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.7"
      />
      <line
        x1={x2} y1={boundaryBandY}
        x2={x2} y2={LINEAR_SEQ_Y + 22}
        stroke={hl.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.7"
      />
    </g>
  ) : null;

  const boundaryLabels = hl.showBoundaries ? (
    <g>
      <text x={x1} y={boundaryLabelY} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fill={hl.color}
        style={{ fontFamily, fontWeight: 600, letterSpacing: '0.02em' }}>
        {hl.start}
      </text>
      <text x={x2} y={boundaryLabelY} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fill={hl.color}
        style={{ fontFamily, fontWeight: 600, letterSpacing: '0.02em' }}>
        {hl.end}
      </text>
    </g>
  ) : null;

  const labelX = x1 + (x2 - x1) * (0.5 + (hl.labelOffset ?? 0) / 100);
  const labelY = y + side * (hl.labelDistance ?? 0);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <path
        d={linearBlockPath(x1, x2, y, thickness, cornerStyle, cornerRadius)}
        fill={hl.color}
        stroke={hl.color}
        strokeWidth="0.5"
        strokeOpacity={Math.min(1, opacity * 2.5)}
        fillOpacity={opacity}
      />
      {boundaryEls}
      {boundaryLabels}
      {hl.showLabel !== false && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={labelSize}
          fill={textColor || hl.color}
          style={{ fontFamily, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {hl.name}
        </text>
      )}
    </g>
  );
}

/* ---------- annotation card in the panel ---------- */
function AnnotationCard({ ann, total, viewMode, onUpdate, onRemove, onHover, isHovered }) {
  const collapsed = ann.collapsed;
  const isLinear = viewMode === 'linear';
  return (
    <div
      onMouseEnter={() => onHover(ann.id)}
      onMouseLeave={() => onHover(null)}
      className={`bg-[var(--bg-tint)] border rounded-lg overflow-hidden transition-all ${isHovered ? 'border-[var(--ink)] shadow-sm' : 'border-[var(--border)]'}`}
    >
      {/* Header */}
      <div className="flex items-center px-3 py-2 gap-2 cursor-pointer" onClick={() => onUpdate({ collapsed: !collapsed })}>
        <div
          className="w-3 h-3 rounded-sm flex-shrink-0"
          style={{ background: ann.color }}
        />
        <div className="flex-1 text-[13px] font-medium truncate">{ann.name || <span className="italic text-[var(--muted)]">unnamed</span>}</div>
        <div className="text-[9px] uppercase tracking-wider text-[var(--muted)] font-mono">
          {isLinear ? 'T' : 'R'}{ann.ring}
        </div>
        {!ann.found && (
          <AlertCircle size={12} className="text-[var(--accent)]" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-[var(--muted)] hover:text-[var(--accent)] p-0.5"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
        {collapsed ? <ChevronDown size={14} className="text-[var(--muted)]" /> : <ChevronUp size={14} className="text-[var(--muted)]" />}
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--border)]">
          {/* Name */}
          <Field label="Name">
            <Input value={ann.name} onChange={e => onUpdate({ name: e.target.value })} placeholder="e.g., AmpR" />
          </Field>

          {/* Mode toggle */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Locate by</div>
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn
                active={ann.mode === 'sequence'}
                onClick={() => onUpdate({ mode: 'sequence' })}
                title="Search subsequence"
              >
                <Search size={11} /> Sequence
              </SegBtn>
              <SegBtn
                active={ann.mode === 'position'}
                onClick={() => onUpdate({ mode: 'position' })}
                title="Specify start and end positions"
              >
                <Hash size={11} /> Position
              </SegBtn>
            </div>
          </div>

          {/* Position inputs */}
          {ann.mode === 'sequence' ? (
            <div>
              <Field label="Subsequence">
                <TextArea
                  value={ann.querySeq}
                  onChange={e => onUpdate({ querySeq: e.target.value })}
                  placeholder="Paste sequence stretch (forward or reverse)"
                  rows={2}
                  style={{ fontSize: 10, lineHeight: 1.4 }}
                />
              </Field>
              {ann.found && (
                <div className="text-[10px] text-[var(--muted)] mt-1 font-mono flex items-center gap-2 flex-wrap">
                  <span>→ {ann.start}–{ann.end}</span>
                  <span className="opacity-60">·</span>
                  <span>matched as {ann.matchedDirection === 'forward' ? 'forward' : 'reverse-complement'}</span>
                  {ann.matchedDirection && ann.matchedDirection !== ann.direction && (
                    <button
                      onClick={() => onUpdate({ direction: ann.matchedDirection })}
                      className="text-[var(--accent)] underline hover:no-underline"
                      title="Set arrow direction to match the strand it was found on"
                    >apply to arrow</button>
                  )}
                </div>
              )}
              {ann.error && (
                <div className="text-[10px] text-[var(--accent)] mt-1 italic">{ann.error}</div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <Input
                    type="number" min={1} max={total}
                    value={ann.start}
                    onChange={e => onUpdate({ start: parseInt(e.target.value) || 0 })}
                    className="font-mono"
                  />
                </Field>
                <Field label="End">
                  <Input
                    type="number" min={1} max={total}
                    value={ann.end}
                    onChange={e => onUpdate({ end: parseInt(e.target.value) || 0 })}
                    className="font-mono"
                  />
                </Field>
              </div>
              {ann.error && (
                <div className="text-[10px] text-[var(--accent)] italic">{ann.error}</div>
              )}
            </>
          )}

          {/* Direction — always editable */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Arrow direction</div>
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn active={ann.direction === 'forward'} onClick={() => onUpdate({ direction: 'forward' })}>
                <ArrowRight size={11} /> Forward
              </SegBtn>
              <SegBtn active={ann.direction === 'reverse'} onClick={() => onUpdate({ direction: 'reverse' })}>
                <ArrowLeft size={11} /> Reverse
              </SegBtn>
            </div>
          </div>

          {/* Shape */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Shape</div>
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn active={ann.shape === 'arrow'} onClick={() => onUpdate({ shape: 'arrow' })}>Arrow</SegBtn>
              <SegBtn active={ann.shape === 'block'} onClick={() => onUpdate({ shape: 'block' })}>Block</SegBtn>
              <SegBtn active={ann.shape === 'line'} onClick={() => onUpdate({ shape: 'line' })}>Line</SegBtn>
            </div>
          </div>

          {/* Corners */}
          {ann.shape !== 'line' && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Corners</div>
              <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
                <SegBtn active={(ann.cornerStyle ?? 'rounded') === 'rounded'} onClick={() => onUpdate({ cornerStyle: 'rounded' })}>Rounded</SegBtn>
                <SegBtn active={(ann.cornerStyle ?? 'rounded') === 'straight'} onClick={() => onUpdate({ cornerStyle: 'straight' })}>Straight</SegBtn>
              </div>
            </div>
          )}

          {/* Ring */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">
              {isLinear ? 'Track' : 'Ring'}
            </div>
            <div className="flex items-center border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)] max-w-[140px]">
              <button
                onClick={() => onUpdate({ ring: Math.max(trackMin(isLinear), (ann.ring ?? 0) - 1) })}
                className="px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors"
              >−</button>
              <div className="flex-1 text-center font-mono text-[12px]">{ann.ring ?? 0}</div>
              <button
                onClick={() => onUpdate({ ring: Math.min(trackMax(isLinear), (ann.ring ?? 0) + 1) })}
                className="px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors"
              >+</button>
            </div>
            <div className="text-[9.5px] text-[var(--muted)] mt-1 italic">
              {(ann.ring ?? 0) === 0
                ? 'on backbone'
                : isLinear
                  ? `track ${ann.ring} ${ann.ring > 0 ? 'above' : 'below'}`
                  : `ring ${ann.ring} ${ann.ring > 0 ? 'outward' : 'inward'}`}
            </div>
          </div>

          {/* Thickness */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Thickness</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                {(ann.sizeScale ?? 1).toFixed(1)}×
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.4"
                max="5.0"
                step="0.1"
                value={ann.sizeScale ?? 1}
                onChange={e => onUpdate({ sizeScale: parseFloat(e.target.value) })}
                className="thickness-slider flex-1"
              />
              <button
                onClick={() => onUpdate({ sizeScale: 1 })}
                className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                title="Reset to 1.0×"
              >
                reset
              </button>
            </div>
            {(ann.sizeScale ?? 1) > 2 && (
              <div className="text-[9.5px] text-[var(--muted)] mt-1 italic">
                may overlap adjacent rings
              </div>
            )}
          </div>

          {/* Fill color */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">
              {ann.shape === 'line' ? 'Line color' : 'Fill'}
            </div>
            <div className="flex items-start gap-1.5">
              <input
                type="color"
                value={ann.color}
                onChange={e => onUpdate({ color: e.target.value })}
                className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)] flex-shrink-0"
              />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  {PALETTE_PLASMA.map(c => (
                    <button
                      key={c}
                      onClick={() => onUpdate({ color: c })}
                      className="w-3.5 h-3.5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {PALETTE_VIRIDIS.map(c => (
                    <button
                      key={c}
                      onClick={() => onUpdate({ color: c })}
                      className="w-3.5 h-3.5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Outline color */}
          {ann.shape !== 'line' && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Outline</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={ann.outlineColor || darken(ann.color, 0.5)}
                  onChange={e => onUpdate({ outlineColor: e.target.value })}
                  className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)]"
                  title={ann.outlineColor ? 'Custom outline color' : 'Auto (darkened fill)'}
                />
                <button
                  onClick={() => onUpdate({ outlineColor: null })}
                  className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors ${ann.outlineColor === null ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--ink)]'}`}
                  title="Reset to auto-darkened fill color"
                >
                  Auto
                </button>
                {[ '#1F1B16', '#FFFFFF', '#000000' ].map(c => (
                  <button
                    key={c}
                    onClick={() => onUpdate({ outlineColor: c })}
                    className={`w-5 h-5 rounded-sm border hover:scale-110 transition-transform ${ann.outlineColor && ann.outlineColor.toLowerCase() === c.toLowerCase() ? 'border-[var(--ink)] ring-1 ring-[var(--ink)]' : 'border-[var(--border-strong)]'}`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}

          {ann.shape !== 'line' && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
                <span>Outline thickness</span>
                <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                  {(ann.outlineWidth ?? DEFAULT_ANNOTATION_OUTLINE_WIDTH).toFixed(1)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="0.1"
                  value={ann.outlineWidth ?? DEFAULT_ANNOTATION_OUTLINE_WIDTH}
                  onChange={e => onUpdate({ outlineWidth: parseFloat(e.target.value) })}
                  className="thickness-slider flex-1"
                />
                <button
                  onClick={() => onUpdate({ outlineWidth: DEFAULT_ANNOTATION_OUTLINE_WIDTH })}
                  className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                  title="Reset to default outline thickness"
                >
                  reset
                </button>
              </div>
            </div>
          )}

          {/* Label distance */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Label distance</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                {(ann.labelDistance ?? 0) > 0 ? '+' : ''}{ann.labelDistance ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="-15" max="80" step="1"
                value={ann.labelDistance ?? 0}
                onChange={e => onUpdate({ labelDistance: parseInt(e.target.value) })}
                className="thickness-slider flex-1"
              />
              <button
                onClick={() => onUpdate({ labelDistance: 0 })}
                className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                title="Reset to 0"
              >
                reset
              </button>
            </div>
          </div>

          {/* Label position along the annotation's arc */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Label position</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                {(ann.labelPosition ?? 0) > 0 ? '+' : ''}{ann.labelPosition ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="-50" max="50" step="1"
                value={ann.labelPosition ?? 0}
                onChange={e => onUpdate({ labelPosition: parseInt(e.target.value) })}
                className="thickness-slider flex-1"
              />
              <button
                onClick={() => onUpdate({ labelPosition: 0 })}
                className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                title="Reset to 0 (centered)"
              >
                reset
              </button>
            </div>
          </div>

          {/* Show label toggle */}
          <button
            onClick={() => onUpdate({ showLabel: !ann.showLabel })}
            className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            {ann.showLabel ? <Eye size={12} /> : <EyeOff size={12} />}
            {ann.showLabel ? 'Label visible' : 'Label hidden'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- highlight card in the panel ---------- */
function HighlightCard({ hl, total, viewMode, onUpdate, onRemove }) {
  const collapsed = hl.collapsed;
  const valid = !hl.error;
  const isLinear = viewMode === 'linear';
  return (
    <div className="bg-[var(--bg-tint)] border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="flex items-center px-3 py-2 gap-2 cursor-pointer" onClick={() => onUpdate({ collapsed: !collapsed })}>
        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: hl.color, opacity: 0.5 }} />
        <div className="flex-1 text-[13px] font-medium truncate">{hl.name || <span className="italic text-[var(--muted)]">unnamed</span>}</div>
        <div className="text-[9px] uppercase tracking-wider text-[var(--muted)] font-mono">
          {isLinear ? 'T' : 'R'}{hl.ring ?? 1}
        </div>
        {!valid && <AlertCircle size={12} className="text-[var(--accent)]" />}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-[var(--muted)] hover:text-[var(--accent)] p-0.5"
        >
          <Trash2 size={13} />
        </button>
        {collapsed ? <ChevronDown size={14} className="text-[var(--muted)]" /> : <ChevronUp size={14} className="text-[var(--muted)]" />}
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--border)]">
          <Field label="Name">
            <Input value={hl.name} onChange={e => onUpdate({ name: e.target.value })} placeholder="e.g., Sequencing Region" />
          </Field>

          {/* Mode toggle */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Locate by</div>
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn active={hl.mode === 'sequence'} onClick={() => onUpdate({ mode: 'sequence' })} title="Search subsequence">
                <Search size={11} /> Sequence
              </SegBtn>
              <SegBtn active={(hl.mode ?? 'position') === 'position'} onClick={() => onUpdate({ mode: 'position' })} title="Specify start and end positions">
                <Hash size={11} /> Position
              </SegBtn>
            </div>
          </div>

          {/* Position inputs — mode-dependent */}
          {hl.mode === 'sequence' ? (
            <div>
              <Field label="Subsequence">
                <TextArea
                  value={hl.querySeq || ''}
                  onChange={e => onUpdate({ querySeq: e.target.value })}
                  placeholder="Paste sequence stretch (forward or reverse)"
                  rows={2}
                  style={{ fontSize: 10, lineHeight: 1.4 }}
                />
              </Field>
              {hl.found && (
                <div className="text-[10px] text-[var(--muted)] mt-1 font-mono flex items-center gap-2 flex-wrap">
                  <span>→ {hl.start}–{hl.end}</span>
                  {hl.matchedDirection && (
                    <>
                      <span className="opacity-60">·</span>
                      <span>matched as {hl.matchedDirection === 'forward' ? 'forward' : 'reverse-complement'}</span>
                    </>
                  )}
                </div>
              )}
              {hl.error && (
                <div className="text-[10px] text-[var(--accent)] mt-1 italic">{hl.error}</div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <Input type="number" min={1} max={total} value={hl.start}
                    onChange={e => onUpdate({ start: parseInt(e.target.value) || 0 })}
                    className="font-mono" />
                </Field>
                <Field label="End">
                  <Input type="number" min={1} max={total} value={hl.end}
                    onChange={e => onUpdate({ end: parseInt(e.target.value) || 0 })}
                    className="font-mono" />
                </Field>
              </div>
              {!valid && (
                <div className="text-[10px] text-[var(--accent)] italic">{hl.error}</div>
              )}
            </>
          )}

          {/* Corners */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Corners</div>
            <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
              <SegBtn active={(hl.cornerStyle ?? 'rounded') === 'rounded'} onClick={() => onUpdate({ cornerStyle: 'rounded' })}>Rounded</SegBtn>
              <SegBtn active={(hl.cornerStyle ?? 'rounded') === 'straight'} onClick={() => onUpdate({ cornerStyle: 'straight' })}>Straight</SegBtn>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">
              {isLinear ? 'Track' : 'Ring'}
            </div>
            <div className="flex items-center border border-[var(--border)] rounded-md overflow-hidden bg-[var(--bg)] max-w-[140px]">
              <button onClick={() => onUpdate({ ring: Math.max(trackMin(isLinear), (hl.ring ?? 1) - 1) })}
                className="px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors">−</button>
              <div className="flex-1 text-center font-mono text-[12px]">{hl.ring ?? 1}</div>
              <button onClick={() => onUpdate({ ring: Math.min(trackMax(isLinear), (hl.ring ?? 1) + 1) })}
                className="px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors">+</button>
            </div>
            <div className="text-[9.5px] text-[var(--muted)] mt-1 italic">
              {(hl.ring ?? 1) === 0
                ? 'on backbone'
                : isLinear
                  ? `track ${hl.ring ?? 1} ${(hl.ring ?? 1) > 0 ? 'above' : 'below'}`
                  : `ring ${hl.ring ?? 1} ${(hl.ring ?? 1) > 0 ? 'outward' : 'inward'}`}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Thickness</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{(hl.sizeScale ?? 3).toFixed(1)}×</span>
            </div>
            <input type="range" min="1" max="10" step="0.1"
              value={hl.sizeScale ?? 3}
              onChange={e => onUpdate({ sizeScale: parseFloat(e.target.value) })}
              className="thickness-slider w-full" />
            <button
              onClick={() => {
                // Set ring=1 and compute sizeScale so inner edge sits exactly on the backbone.
                // Math: at ring=1, inner = R + (BAND_THICKNESS+RING_GAP) - thickness/2.
                // Setting inner=R gives thickness = 2*(BAND_THICKNESS+RING_GAP),
                // i.e. sizeScale = 2*(BAND_THICKNESS+RING_GAP)/BAND_THICKNESS.
                const targetScale = (2 * (BAND_THICKNESS + RING_GAP)) / BAND_THICKNESS;
                onUpdate({ ring: 1, sizeScale: parseFloat(targetScale.toFixed(2)) });
              }}
              className="mt-1.5 w-full text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] py-1 border border-[var(--border-strong)] rounded transition-colors"
              title="Reset ring + thickness so the highlight's inner edge sits on the backbone"
            >
              Anchor to backbone
            </button>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Opacity</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{Math.round((hl.opacity ?? 0.25) * 100)}%</span>
            </div>
            <input type="range" min="0.05" max="1" step="0.05"
              value={hl.opacity ?? 0.25}
              onChange={e => onUpdate({ opacity: parseFloat(e.target.value) })}
              className="thickness-slider w-full" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium">Color</div>
            <div className="flex items-start gap-1.5">
              <input type="color" value={hl.color}
                onChange={e => onUpdate({ color: e.target.value })}
                className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-[var(--bg)] flex-shrink-0" />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  {HIGHLIGHT_PALETTE.map(c => (
                    <button key={c} onClick={() => onUpdate({ color: c })}
                      className="w-3.5 h-3.5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                      style={{ background: c }} title={c} />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {HIGHLIGHT_PALETTE_MAGMA.map(c => (
                    <button key={c} onClick={() => onUpdate({ color: c })}
                      className="w-3.5 h-3.5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                      style={{ background: c }} title={c} />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {HIGHLIGHT_PALETTE_CIVIDIS.map(c => (
                    <button key={c} onClick={() => onUpdate({ color: c })}
                      className="w-3.5 h-3.5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                      style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Label size</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">{hl.labelSize ?? 13}</span>
            </div>
            <input type="range" min="8" max="24" step="1"
              value={hl.labelSize ?? 13}
              onChange={e => onUpdate({ labelSize: parseInt(e.target.value) })}
              className="thickness-slider w-full" />
          </div>

          {/* Label distance from band midline */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Label distance</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                {(hl.labelDistance ?? 0) > 0 ? '+' : ''}{hl.labelDistance ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min="-40" max="80" step="1"
                value={hl.labelDistance ?? 0}
                onChange={e => onUpdate({ labelDistance: parseInt(e.target.value) })}
                className="thickness-slider flex-1" />
              <button
                onClick={() => onUpdate({ labelDistance: 0 })}
                className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                title="Reset to 0 (band midline)"
              >
                reset
              </button>
            </div>
          </div>

          {/* Label position along the band (between termini) */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mb-1.5 font-medium flex items-center justify-between">
              <span>Label position</span>
              <span className="font-mono text-[var(--ink)] normal-case tracking-normal text-[11px]">
                {(hl.labelOffset ?? 0) > 0 ? '+' : ''}{hl.labelOffset ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min="-50" max="50" step="1"
                value={hl.labelOffset ?? 0}
                onChange={e => onUpdate({ labelOffset: parseInt(e.target.value) })}
                className="thickness-slider flex-1" />
              <button
                onClick={() => onUpdate({ labelOffset: 0 })}
                className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 transition-colors"
                title="Reset to 0 (centered)"
              >
                reset
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--border)]">
            <button
              onClick={() => onUpdate({ showLabel: hl.showLabel === false })}
              className="flex items-center gap-2 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              {hl.showLabel !== false ? <Eye size={12} /> : <EyeOff size={12} />}
              {isLinear ? 'Label' : 'Curved label'} {hl.showLabel !== false ? 'visible' : 'hidden'}
            </button>
            <button
              onClick={() => onUpdate({ showBoundaries: !hl.showBoundaries })}
              className="flex items-center gap-2 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              {hl.showBoundaries ? <Eye size={12} /> : <EyeOff size={12} />}
              Boundary markers {hl.showBoundaries ? 'visible' : 'hidden'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
