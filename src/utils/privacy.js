/**
 * Mode privasi (tombol mata di kartu Total Saldo).
 *
 * Menyensor seluruh nominal Rupiah yang tampil di halaman: teks biasa, label sumbu
 * grafik (SVG text), ringkasan kartu, sampai atribut title/aria-label. Dipakai sebagai
 * jaring pengaman setelah halaman dirender, sehingga komponen baru otomatis ikut aman.
 */
import { MASK } from './format.js';

/** Pola nominal: "Rp 1.234.000", "Rp2.5 jt", "Rp 800 rb". */
const MONEY_RE = /Rp\s?\d[\d.,]*(?:\s?(?:jt|rb|M|T))?/gi;

/** Konstanta TreeWalker (dipakai numerik agar aman di lingkungan tanpa NodeFilter global). */
const SHOW_TEXT = 0x04;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

/** Elemen yang isinya tidak boleh diubah (form & kode). */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'CODE', 'PRE']);

/**
 * Ganti semua nominal Rupiah di dalam `root` dengan MASK.
 * @param {Element} root
 * @param {{ attributes?: boolean }} [opts]
 * @returns {number} jumlah teks/atribut yang disensor
 */
export function maskMoneyInDom(root, { attributes = true } = {}) {
  if (!root || typeof document === 'undefined') return 0;
  let hits = 0;

  const skip = (node) => {
    let el = node.parentElement;
    while (el && el !== root) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      el = el.parentElement;
    }
    return false;
  };

  const localRe = () => new RegExp(MONEY_RE.source, MONEY_RE.flags);

  // 1) Teks (termasuk <text> di dalam SVG grafik)
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createTreeWalker !== 'function') return 0;
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.indexOf('Rp') < 0) return FILTER_REJECT;
      return skip(node) ? FILTER_REJECT : FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const re = localRe();
    if (!re.test(node.nodeValue)) continue;
    const next = node.nodeValue.replace(localRe(), () => { hits += 1; return MASK; });
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  // 2) Tooltip & label aksesibilitas
  if (attributes) {
    for (const el of root.querySelectorAll('[title], [aria-label], [data-tip]')) {
      for (const attr of ['title', 'aria-label', 'data-tip']) {
        const value = el.getAttribute(attr);
        if (!value || value.indexOf('Rp') < 0) continue;
        const re = localRe();
        if (!re.test(value)) continue;
        el.setAttribute(attr, value.replace(localRe(), MASK));
        hits += 1;
      }
    }
  }

  return hits;
}

export default maskMoneyInDom;
