/**
 * Charts — dependency-free, responsive, interactive SVG generators.
 *
 * Every chart is a pure function returning an SVG string sized by viewBox and
 * stretched to the container (`width:100%`), so it works at any breakpoint and
 * inside print/PDF. Hover data lives on `[data-tt]` attributes and is served
 * by a single delegated tooltip controller (`attachChartTooltips`).
 */

import { esc } from '../utils/dom.js';

const uidc = () => `c${Math.random().toString(36).slice(2, 8)}`;

function niceMax(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * base;
}

function fmtAxis(value, format) {
  if (format) return format(value);
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}jt`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}rb`;
  return String(Math.round(value));
}

/** Catmull-Rom → cubic bezier smoothing. */
function smoothPath(points, tension = 0.22) {
  if (points.length < 2) return points.length ? `M${points[0].x},${points[0].y}` : '';
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Line / area chart                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} cfg
 *   labels   : string[]
 *   series   : [{ name, color, values:number[], dashed?:boolean, fill?:boolean }]
 *   height   : number (viewBox height)
 *   format   : (v)=>string  (tooltip + axis)
 *   yTicks   : number
 *   showDots : boolean
 */
export function lineAreaChart({ labels, series, height = 240, format, yTicks = 4, showDots = true, zeroLine = false }) {
  const W = 720;
  const padL = 52;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const allValues = series.flatMap((s) => s.values);
  const rawMax = Math.max(...allValues, 0);
  const rawMin = Math.min(...allValues, 0);
  const max = niceMax(rawMax * 1.08) || 1;
  const min = rawMin < 0 ? -niceMax(Math.abs(rawMin) * 1.08) : 0;
  const span = max - min || 1;

  const xAt = (i) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((v - min) / span) * plotH;

  const gridLines = [];
  for (let t = 0; t <= yTicks; t += 1) {
    const value = min + (span * t) / yTicks;
    const y = yAt(value);
    gridLines.push(`<line class="chart-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" ${t === 0 ? 'stroke-dasharray="0"' : 'stroke-dasharray="3 5"'} opacity="${t === 0 ? 0.9 : 0.5}"/>`);
    gridLines.push(`<text class="chart-axis-label" x="${padL - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtAxis(value, format))}</text>`);
  }

  const labelStep = Math.max(1, Math.ceil(labels.length / 7));
  const xLabels = labels.map((label, i) => (i % labelStep === 0 || i === labels.length - 1
    ? `<text class="chart-axis-label" x="${xAt(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`
    : '')).join('');

  const defs = [];
  const paths = series.map((s, si) => {
    const points = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    const line = smoothPath(points);
    const gradId = `${uidc()}g`;
    let area = '';
    if (s.fill !== false) {
      defs.push(`<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.color}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`);
      area = `<path class="chart-area" d="${line} L${points[points.length - 1]?.x},${padT + plotH} L${points[0]?.x},${padT + plotH} Z" fill="url(#${gradId})"/>`;
    }
    const dots = showDots && points.length <= 40
      ? points.map((p, i) => `<circle class="chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--surface)" stroke="${s.color}" stroke-width="2" opacity="${s.dashed ? 0.85 : 1}"/>`).join('')
      : '';
    const hover = points.map((p, i) => `<rect x="${(xAt(i) - plotW / (labels.length * 2 || 1)).toFixed(1)}" y="${padT}" width="${Math.max(8, plotW / (labels.length || 1)).toFixed(1)}" height="${plotH}" fill="transparent"
      data-tt="${esc(labels[i])}|${esc(s.name)}: ${esc((format || fmtAxis)(s.values[i]))}" data-series="${si}" data-index="${i}"/>`).join('');
    return `${area}
      <path class="chart-line" d="${line}" stroke="${s.color}" pathLength="1" stroke-dasharray="${s.dashed ? '5 5' : '1'}" ${s.dashed ? '' : 'style="animation:drawLine 1s var(--ease) both"'}/>
      ${dots}${hover}`;
  }).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    <defs>${defs.join('')}</defs>
    ${gridLines.join('')}
    ${zeroLine && min < 0 ? `<line class="chart-grid-line" x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${W - padR}" y2="${yAt(0).toFixed(1)}" stroke="var(--line-strong)"/>` : ''}
    ${paths}
    ${xLabels}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Grouped bar chart                                                   */
/* ------------------------------------------------------------------ */

export function groupedBarChart({ labels, series, height = 240, format, stacked = false }) {
  const W = 720;
  const padL = 52;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;

  const totals = labels.map((_, i) => (stacked
    ? series.reduce((acc, s) => acc + (s.values[i] || 0), 0)
    : Math.max(...series.map((s) => s.values[i] || 0), 0)));
  const max = niceMax(Math.max(...totals, 0) * 1.08) || 1;

  const grid = [];
  for (let t = 0; t <= 4; t += 1) {
    const y = padT + plotH - (plotH * t) / 4;
    grid.push(`<line class="chart-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke-dasharray="${t === 0 ? '0' : '3 5'}" opacity="${t === 0 ? 0.9 : 0.5}"/>`);
    grid.push(`<text class="chart-axis-label" x="${padL - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtAxis((max * t) / 4, format))}</text>`);
  }

  const groupW = plotW / (labels.length || 1);
  const bandW = groupW * 0.62;
  const barW = stacked ? bandW : bandW / series.length;
  const radius = Math.min(5, barW / 2.4);

  const bars = labels.map((label, i) => {
    const gx = padL + i * groupW + (groupW - bandW) / 2;
    let stackY = padT + plotH;
    return series.map((s, si) => {
      const value = s.values[i] || 0;
      const h = Math.max(0, (value / max) * plotH);
      const x = stacked ? gx : gx + si * barW + 1;
      const y = stacked ? stackY - h : padT + plotH - h;
      if (stacked) stackY -= h;
      return `<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - (stacked ? 0 : 2)).toFixed(1)}" height="${h.toFixed(1)}"
        rx="${radius}" fill="${s.color}" opacity="${stacked ? 0.95 : 1}"
        style="animation-delay:${(i * 30 + si * 40)}ms"
        data-tt="${esc(label)}|${esc(s.name)}: ${esc((format || fmtAxis)(value))}"/>
        ${!stacked && value > 0 ? `<text class="chart-axis-label" x="${(x + barW / 2 - 1).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" opacity=".75">${esc(fmtAxis(value, format))}</text>` : ''}`;
    }).join('');
  }).join('');

  const xLabels = labels.map((label, i) => `<text class="chart-axis-label" x="${(padL + i * groupW + groupW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${grid.join('')}${bars}${xLabels}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */

export function donutChart({ segments, size = 168, thickness = 20, centerValue = '', centerLabel = '', format }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  let offset = 0;
  const rings = segments.map((s, i) => {
    const fraction = s.value / total;
    const dash = fraction * circumference;
    const el = `<circle class="donut-seg" cx="${size / 2}" cy="${size / 2}" r="${radius}"
      fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-linecap="butt"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"
      style="animation-delay:${i * 70}ms"
      data-tt="${esc(s.label)}|${esc((format || fmtAxis)(s.value))} · ${(fraction * 100).toFixed(1)}%"/>`;
    offset += dash;
    return el;
  }).join('');

  const legend = segments.map((s) => `<div class="donut-legend-row">
      <span class="legend-swatch" style="--swatch:${s.color}"></span>
      <span class="name t-clip">${esc(s.label)}</span>
      <span class="val">${esc((format || fmtAxis)(s.value))}</span>
      <span class="t-dim t-xs" style="min-width:42px;text-align:right">${((s.value / total) * 100).toFixed(0)}%</span>
    </div>`).join('');

  return `<div class="donut-wrap">
    <div class="donut-holder" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${rings}</svg>
      <div class="donut-center">
        <div class="donut-value">${esc(centerValue)}</div>
        <div class="donut-label">${esc(centerLabel)}</div>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

export function sparkline(values, { color = 'var(--brand-500)', height = 34, fill = true, width = 120 } = {}) {
  const values2 = values.length ? values : [0, 0];
  const max = Math.max(...values2, 0);
  const min = Math.min(...values2, 0);
  const span = max - min || 1;
  const xAt = (i) => (i / Math.max(1, values2.length - 1)) * width;
  const yAt = (v) => height - 3 - ((v - min) / span) * (height - 8);
  const points = values2.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  const line = smoothPath(points, 0.2);
  const id = uidc();
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg" style="height:${height}px" aria-hidden="true">
    ${fill ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${width},${height} L0,${height} Z" fill="url(#${id})"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Horizontal comparison bars (breakdowns)                             */
/* ------------------------------------------------------------------ */

export function breakdownBars(rows, { format, max = 0 } = {}) {
  const top = max || Math.max(...rows.map((r) => r.value), 1);
  return rows.map((row) => `<div class="bar-row">
    <div class="bar-row-head">
      <span class="t-clip" style="display:flex;align-items:center;gap:8px;min-width:0">
        <span class="legend-swatch" style="--swatch:${row.color}"></span>
        <span class="t-clip">${esc(row.label)}</span>
      </span>
      <span class="bar-row-value">${esc(format ? format(row.value) : fmtAxis(row.value))}${row.suffix ? `<span class="t-dim t-xs"> ${esc(row.suffix)}</span>` : ''}</span>
    </div>
    <div class="progress progress-sm"><div class="progress-bar" style="width:${((row.value / top) * 100).toFixed(1)}%;background:${row.color}"></div></div>
  </div>`).join('');
}

/* ------------------------------------------------------------------ */
/* Tooltip controller                                                  */
/* ------------------------------------------------------------------ */

const tooltipControllers = new WeakMap();

export function attachChartTooltips(container) {
  if (!container || tooltipControllers.has(container)) return;
  const wrap = container.closest('.chart-wrap') || container;
  let tip = wrap.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    wrap.appendChild(tip);
  }
  const onMove = (event) => {
    const target = event.target.closest('[data-tt]');
    if (!target) {
      tip.classList.remove('is-visible');
      return;
    }
    const [label, value] = target.dataset.tt.split('|');
    tip.innerHTML = `<div class="tt-label">${esc(label)}</div><div>${esc(value)}</div>`;
    const rect = wrap.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x = targetRect.left - rect.left + targetRect.width / 2;
    const y = targetRect.top - rect.top;
    tip.style.left = `${Math.min(Math.max(x, 60), rect.width - 60)}px`;
    tip.style.top = `${Math.max(y, 34)}px`;
    tip.classList.add('is-visible');
  };
  const onLeave = () => tip.classList.remove('is-visible');
  wrap.addEventListener('mousemove', onMove);
  wrap.addEventListener('mouseleave', onLeave);
  wrap.addEventListener('touchstart', (e) => onMove(e.touches ? { target: e.target } : e), { passive: true });
  tooltipControllers.set(container, true);
}

export const chartHelpers = { niceMax, fmtAxis, smoothPath };
