/**
 * Diagram donat Beranda — kartu carousel tiga slide:
 *   1. Total Cashflow      (pemasukan vs pengeluaran bulan terpilih)
 *   2. Total Pengeluaran   (per kategori)
 *   3. Total Pemasukan     (per sumber)
 *
 * Ponsel  : satu slide per layar + titik navigasi, tombol panah, dan geser jari.
 * Desktop : ketiga slide tampil berdampingan (tanpa carousel).
 * Komponen ini murni soal tampilan; seluruh angka dihitung di halaman.
 */

import { esc } from '../utils/dom.js';
import { icon } from './icons.js';

const SIZE = 208;
const THICKNESS = 26;

/** Cincin SVG: satu `<circle>` per segmen, dengan jeda kecil antar segmen. */
function ringSvg(segments, size, thickness) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  const gap = Math.max(5, thickness * 0.32); // jeda antar segmen (px busur)

  // Satu segmen penuh (100%) tidak boleh menganga gara-gara jeda.
  const solo = segments.length === 1;
  let walked = 0;
  return segments.map((s, i) => {
    const fraction = s.value / total;
    const dash = solo ? circumference : Math.max(fraction * circumference - gap, 0.8);
    const el = `<circle class="cd-seg" cx="${size / 2}" cy="${size / 2}" r="${radius}"
      fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-walked).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"
      style="animation-delay:${i * 90}ms"></circle>`;
    walked += fraction * circumference;
    return el;
  }).join('');
}

/** Lingkaran ikon yang duduk di tengah busur tiap segmen (seperti contoh desain). */
function segmentNodes(segments, size, thickness) {
  const radius = (size - thickness) / 2;
  const total = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  let walked = 0;
  return segments.map((s) => {
    const fraction = s.value / total;
    const angle = (-90 + (walked + fraction / 2) * 360) * (Math.PI / 180);
    const x = size / 2 + radius * Math.cos(angle);
    const y = size / 2 + radius * Math.sin(angle);
    walked += fraction;
    return `<span class="cd-node" style="left:${((x / size) * 100).toFixed(2)}%;top:${((y / size) * 100).toFixed(2)}%;--node:${s.color}"
      title="${esc(s.label)}">${icon(s.icon || 'tag', { size: 13 })}</span>`;
  }).join('');
}

/** Satu slide: donat + label tengah + tombol mata + tautan detail. */
export function donutSlide({ key, title, value, segments = [], masked = false, link = '', hint = '', sub = '' }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const kosong = !segments.length || total <= 0;
  const rings = kosong
    ? `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${(SIZE - THICKNESS) / 2}" fill="none"
        stroke="var(--line)" stroke-width="${THICKNESS}" stroke-dasharray="4 7" stroke-linecap="round"></circle>`
    : ringSvg(segments, SIZE, THICKNESS);

  return `<article class="cd-slide" data-donut-slide="${esc(key)}">
    <div class="cd-holder" style="width:${SIZE}px;height:${SIZE}px">
      <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${esc(title)}">
        ${rings}
      </svg>
      ${kosong ? '' : segmentNodes(segments, SIZE, THICKNESS)}
      <div class="cd-center">
        <div class="cd-title">${esc(title)}</div>
        <div class="cd-value">${esc(value)}</div>
        <div class="cd-sub">${esc(kosong ? (hint || 'Belum ada data bulan ini') : (sub || `${segments.length} bagian`))}</div>
        <button class="cd-eye" type="button" data-toggle-secret aria-pressed="${masked}"
          aria-label="${masked ? 'Tampilkan nominal' : 'Sembunyikan nominal'}">${icon(masked ? 'eye-off' : 'eye', { size: 15 })}</button>
      </div>
    </div>
    ${link ? `<a class="cd-link" href="#/analytics" data-donut-link="${esc(key)}">${esc(link)}</a>` : ''}
  </article>`;
}

/**
 * Kartu carousel lengkap: pemilih bulan, jalur slide, dan navigasi.
 * `monthOptions` = [{ value, label }], `slide` = HTML dari `donutSlide`.
 */
export function donutCarousel({ slides, monthOptions = [], monthValue = '', title = 'Diagram Keuangan', sub = '' }) {
  return `<section class="card col-12 tint-brand cd-card" data-donut-card>
    <div class="card-head">
      <div><h3>${esc(title)}</h3><div class="card-sub">${esc(sub)}</div></div>
      <div class="card-head-actions">
        <label class="cd-month">
          ${icon('calendar', { size: 15 })}
          <select class="cd-month-select" data-donut-month aria-label="Pilih bulan diagram">
            ${monthOptions.map((o) => `<option value="${esc(o.value)}" ${o.value === monthValue ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
          ${icon('chevron-down', { size: 15 })}
        </label>
      </div>
    </div>

    <div class="cd-viewport" data-donut-viewport>
      <div class="cd-track" data-donut-track>
        ${slides.join('')}
      </div>
    </div>

    <div class="cd-nav">
      <button class="cd-nav-btn" type="button" data-donut-prev aria-label="Diagram sebelumnya">${icon('chevron-left', { size: 17 })}</button>
      <div class="cd-dots">
        ${slides.map((_, i) => `<button class="cd-dot ${i === 0 ? 'is-active' : ''}" type="button" data-donut-dot="${i}" aria-label="Diagram ${i + 1}"></button>`).join('')}
      </div>
      <button class="cd-nav-btn" type="button" data-donut-next aria-label="Diagram berikutnya">${icon('chevron-right', { size: 17 })}</button>
    </div>
  </section>`;
}

export default donutCarousel;
