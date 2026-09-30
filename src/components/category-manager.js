/**
 * Category manager — full CRUD for categories *and* subcategories.
 *
 * Lives on the Settings page. Categories that are already used by transactions
 * are never hard-deleted (that would orphan ledger rows): they are archived and
 * hidden from pickers instead, which the UI explains inline.
 */

import store from '../services/store.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { icon, iconTile } from '../components/icons.js';
import {
  badgeHtml, confirmDialog, fieldHtml, openAdaptive, toast,
} from '../components/ui.js';
import { txns } from '../services/finance.js';

/** Curated icon set — enough variety without an unbounded picker. */
const ICON_CHOICES = [
  'utensils', 'coffee', 'cart', 'bag', 'shopping-bag', 'shirt', 'store', 'gift',
  'car', 'bus', 'bike', 'fuel', 'plane', 'home', 'building', 'landmark',
  'zap', 'wifi', 'smartphone', 'laptop', 'monitor', 'book', 'graduation', 'sparkles',
  'film', 'music', 'gamepad', 'heart', 'smile', 'heart-handshake', 'users', 'baby',
  'dog', 'pill', 'leaf', 'tools', 'repeat', 'credit-card', 'piggy-bank', 'wallet',
  'coins', 'bank', 'cash', 'receipt', 'calculator', 'chart', 'pie', 'briefcase',
  'trending-up', 'percent', 'shield', 'target', 'clock', 'calendar', 'tag', 'flag',
];

const COLOR_CHOICES = [
  '#2563eb', '#1d4ed8', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981',
  '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#a855f7', '#8b5cf6', '#64748b', '#0f172a',
];

const usageCount = (state, categoryId) => txns(state).filter(
  (t) => t.category_id === categoryId || t.subcategory_id === categoryId,
).length;

/**
 * @param {object} ctx page context provided by app.js
 * @param {string} kind 'expense' | 'income'
 */
export function categoryManagerHtml(state, kind = 'expense') {
  const categories = state.categories
    .filter((c) => c.kind === kind && !c.parent_id)
    .sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true) || a.name.localeCompare(b.name));

  const rows = categories.map((category) => {
    const children = state.categories.filter((c) => c.parent_id === category.id && !c.archived);
    const used = usageCount(state, category.id);
    return `
      <div class="cat-row${category.archived ? ' is-archived' : ''}" data-cat-row="${esc(category.id)}">
        <div class="cat-main">
          ${iconTile(category.icon || 'tag', { color: category.color || 'var(--brand-500)', size: 36, radius: 11, iconSize: 17 })}
          <div class="grow" style="min-width:0">
            <div class="row gap-2 wrap">
              <span class="t-sm t-bold">${esc(category.name)}</span>
              ${category.archived ? badgeHtml('Diarsipkan', 'outline', { icon: 'archive' }) : ''}
              ${used ? badgeHtml(`${used} transaksi`, 'neutral') : ''}
            </div>
            <div class="cat-subs">
              ${children.length
                ? children.map((child) => `
                    <span class="cat-sub">
                      ${esc(child.name)}
                      <button class="cat-sub-x" data-sub-delete="${esc(child.id)}" aria-label="Hapus subkategori ${esc(child.name)}" title="Hapus subkategori">${icon('x', { size: 12 })}</button>
                    </span>`).join('')
                : '<span class="t-2xs t-dim">Belum ada subkategori</span>'}
              <button class="chip chip-xs" data-sub-add="${esc(category.id)}">${icon('plus', { size: 12 })} Subkategori</button>
            </div>
          </div>
        </div>
        <div class="row gap-1">
          <button class="icon-btn-sm" data-cat-edit="${esc(category.id)}" aria-label="Ubah kategori ${esc(category.name)}" title="Ubah">${icon('pencil', { size: 15 })}</button>
          <button class="icon-btn-sm" data-cat-delete="${esc(category.id)}" aria-label="Hapus kategori ${esc(category.name)}" title="Hapus">${icon('trash', { size: 15 })}</button>
        </div>
      </div>`;
  }).join('');

  return `
    <section class="card col-12" id="kategori">
      <div class="card-head">
        <div>
          <div class="t-h3">Kategori & Subkategori</div>
          <div class="t-xs t-dim mt-1">Sesuaikan kategori agar cocok dengan kebiasaan Anda. Kategori yang sudah dipakai transaksi akan diarsipkan, bukan dihapus.</div>
        </div>
        <button class="btn btn-primary btn-sm" data-cat-add="${kind}">${icon('plus', { size: 16 })} Kategori</button>
      </div>

      <div class="segmented mt-3" data-cat-kind>
        <button data-kind="expense" aria-selected="${kind === 'expense'}">Pengeluaran</button>
        <button data-kind="income" aria-selected="${kind === 'income'}">Pemasukan</button>
      </div>

      <div class="cat-list mt-4">
        ${rows || `<div class="t-xs t-dim">Belum ada kategori ${kind === 'expense' ? 'pengeluaran' : 'pemasukan'}.</div>`}
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

function openCategoryForm({ category = null, parent = null, kind = 'expense', onSaved }) {
  const isChild = Boolean(parent) || Boolean(category?.parent_id);
  const model = category || {
    name: '', kind: parent?.kind || kind, icon: parent ? 'tag' : 'cart', color: parent?.color || '#2563eb',
    parent_id: parent?.id || null,
  };
  let pickedIcon = model.icon || 'tag';
  let pickedColor = model.color || '#2563eb';

  const api = openAdaptive({
    title: category ? 'Ubah kategori' : isChild ? 'Tambah subkategori' : 'Tambah kategori',
    size: 'md',
    body: `
      <form class="stack-4" data-cat-form>
        ${parent ? `<div class="banner is-brand">${icon('corner-down-right', { size: 16 })}<div class="grow t-xs">Subkategori dari <b>${esc(parent.name)}</b></div></div>` : ''}
        ${fieldHtml({
          label: isChild ? 'Nama subkategori' : 'Nama kategori', name: 'name', id: 'cat-name', required: true,
          control: `<input class="input" id="cat-name" data-name maxlength="40" placeholder="${isChild ? 'cth: Makan siang' : 'cth: Makan & Minum'}" value="${esc(model.name || '')}" />`,
        })}
        ${!isChild && !category ? fieldHtml({
          label: 'Jenis', name: 'kind', id: 'cat-kind-field',
          control: `<select class="select" id="cat-kind-field" data-kind-field>
            <option value="expense"${model.kind === 'expense' ? ' selected' : ''}>Pengeluaran</option>
            <option value="income"${model.kind === 'income' ? ' selected' : ''}>Pemasukan</option>
          </select>`,
        }) : ''}
        <div class="field">
          <span class="field-label">Ikon</span>
          <div class="pick-grid" data-icon-grid>
            ${ICON_CHOICES.map((name) => `<button type="button" class="pick${name === pickedIcon ? ' is-active' : ''}" data-icon-pick="${name}" aria-label="${name}" aria-pressed="${name === pickedIcon}">${icon(name, { size: 17 })}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <span class="field-label">Warna</span>
          <div class="pick-grid pick-colors" data-color-grid>
            ${COLOR_CHOICES.map((value) => `<button type="button" class="pick pick-color${value === pickedColor ? ' is-active' : ''}" style="--c:${value}" data-color-pick="${value}" aria-label="Warna ${value}" aria-pressed="${value === pickedColor}"></button>`).join('')}
          </div>
        </div>
        <div class="sheet-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Batal</button>
          <button type="submit" class="btn btn-primary">${category ? 'Simpan Perubahan' : 'Tambah'}</button>
        </div>
      </form>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-icon-pick]', (event, el) => {
        pickedIcon = el.dataset.iconPick;
        qsa('[data-icon-pick]', sheet).forEach((node) => {
          const active = node.dataset.iconPick === pickedIcon;
          node.classList.toggle('is-active', active);
          node.setAttribute('aria-pressed', String(active));
        });
      });
      on(sheet, 'click', '[data-color-pick]', (event, el) => {
        pickedColor = el.dataset.colorPick;
        qsa('[data-color-pick]', sheet).forEach((node) => {
          const active = node.dataset.colorPick === pickedColor;
          node.classList.toggle('is-active', active);
          node.setAttribute('aria-pressed', String(active));
        });
      });
      on(sheet, 'click', '[data-cancel]', () => api.close('cancel'));

      on(sheet, 'submit', '[data-cat-form]', async (event) => {
        event.preventDefault();
        const name = qs('[data-name]', sheet).value.trim();
        if (!name) { toast('Nama kategori wajib diisi.', { tone: 'warn' }); return; }

        const kindField = qs('[data-kind-field]', sheet);
        const payload = {
          name,
          kind: parent?.kind || model.kind || (kindField ? kindField.value : kind),
          icon: pickedIcon,
          color: pickedColor,
          parent_id: parent?.id || model.parent_id || null,
          is_default: false,
        };

        const siblings = store.getState().categories.filter(
          (c) => c.kind === payload.kind && (c.parent_id || null) === payload.parent_id && c.id !== category?.id,
        );
        if (siblings.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
          toast('Nama tersebut sudah dipakai.', { tone: 'warn' });
          return;
        }

        try {
          if (category) await store.updateCategory(category.id, payload);
          else await store.addCategory(payload);
          toast(category ? 'Kategori diperbarui.' : 'Kategori ditambahkan.', { tone: 'pos' });
          api.close('saved');
          onSaved?.();
        } catch (error) {
          toast(error?.message || 'Gagal menyimpan kategori.', { tone: 'neg' });
        }
      });
    },
  });
  return api;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attach the category manager behaviour to a rendered settings page.
 * @returns {Array<() => void>} teardown callbacks
 */
export function bindCategoryManager(root, ctx, { kind = 'expense', rerender, onKindChange }) {
  return [
    on(root, 'click', '[data-cat-kind] button', (event, el) => {
      const next = el.dataset.kind;
      if (next === kind) return;
      kind = next;
      // the host page owns the persisted tab, so tell it before re-rendering
      if (onKindChange) onKindChange(next);
      else rerender?.();
    }),
    on(root, 'click', '[data-cat-add]', (event, el) => {
      openCategoryForm({ kind: el.dataset.catAdd, onSaved: () => rerender?.() });
    }),
    on(root, 'click', '[data-sub-add]', (event, el) => {
      const parent = store.getState().categories.find((c) => c.id === el.dataset.subAdd);
      if (!parent) return;
      openCategoryForm({ parent, onSaved: () => rerender?.() });
    }),
    on(root, 'click', '[data-cat-edit]', (event, el) => {
      const category = store.getState().categories.find((c) => c.id === el.dataset.catEdit);
      if (!category) return;
      openCategoryForm({ category, onSaved: () => rerender?.() });
    }),
    on(root, 'click', '[data-sub-delete]', async (event, el) => {
      const child = store.getState().categories.find((c) => c.id === el.dataset.subDelete);
      if (!child) return;
      const used = usageCount(store.getState(), child.id);
      const ok = await confirmDialog({
        title: `Hapus subkategori "${child.name}"?`,
        message: used
          ? `${used} transaksi memakai subkategori ini, jadi akan diarsipkan agar riwayat tetap utuh.`
          : 'Subkategori ini belum dipakai transaksi apa pun.',
        confirmLabel: 'Hapus',
        tone: 'danger',
      });
      if (!ok) return;
      const result = await store.deleteCategory(child.id);
      toast(result?.archived ? 'Subkategori diarsipkan.' : 'Subkategori dihapus.', { tone: 'info' });
      rerender?.();
    }),
    on(root, 'click', '[data-cat-delete]', async (event, el) => {
      const category = store.getState().categories.find((c) => c.id === el.dataset.catDelete);
      if (!category) return;
      const used = usageCount(store.getState(), category.id);
      const children = store.getState().categories.filter((c) => c.parent_id === category.id);
      const ok = await confirmDialog({
        title: `Hapus kategori "${category.name}"?`,
        message: used
          ? `${used} transaksi memakai kategori ini. Kategori akan diarsipkan (disembunyikan) agar laporan lama tetap benar.`
          : `Kategori ini belum dipakai${children.length ? ` dan ${children.length} subkategorinya ikut terhapus` : ''}.`,
        confirmLabel: used ? 'Arsipkan' : 'Hapus',
        tone: 'danger',
      });
      if (!ok) return;
      const result = await store.deleteCategory(category.id);
      toast(result?.archived ? 'Kategori diarsipkan.' : 'Kategori dihapus.', { tone: 'info' });
      rerender?.();
    }),
  ];
}

/** Small helper used by tests to verify the manager renders real data. */
export function categoryManagerStats(state, kind = 'expense') {
  const parents = state.categories.filter((c) => c.kind === kind && !c.parent_id);
  return {
    parents: parents.length,
    children: state.categories.filter((c) => parents.some((p) => p.id === c.parent_id)).length,
    archived: parents.filter((c) => c.archived).length,
    used: parents.filter((p) => usageCount(state, p.id) > 0).length,
  };
}
