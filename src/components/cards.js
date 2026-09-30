/**
 * Reusable card components — hero card, metric, chart card, account card,
 * debt/receivable cards, budget rows, insight list, quick actions.
 */

import { esc, qs, qsa } from '../utils/dom.js';
import { MASK, maskAccountNumber, money, percent } from '../utils/format.js';
import { formatDate, relativeDays } from '../utils/date.js';
import { icon, iconTile, logoMark } from './icons.js';
import { badgeHtml, moneyHtml, progressHtml } from './ui.js';
import { STATUS_META } from '../types/models.js';

const toneClass = (tone) => (tone === 'pos' || tone === 'positive' ? 't-pos'
  : tone === 'neg' || tone === 'negative' ? 't-neg'
    : tone === 'warn' || tone === 'warning' ? 't-warn' : '');

export function deltaHtml(value, { suffix = 'vs periode lalu', invert = false } = {}) {
  const n = Number(value) || 0;
  const flat = Math.abs(n) < 0.05;
  const good = invert ? n < 0 : n > 0;
  const cls = flat ? 'delta-flat' : good ? 'delta-pos' : 'delta-neg';
  const iconName = flat ? 'minus' : n > 0 ? 'arrow-up-right' : 'arrow-down-left';
  return `<span class="metric-delta ${cls}">${icon(iconName, { size: 13 })}${flat ? 'stabil' : percent(n, 1, true)}
    ${suffix ? `<span class="t-dim" style="font-weight:520">${esc(suffix)}</span>` : ''}</span>`;
}

export function chartCard({
  title, sub = '', actions = '', body = '', legend = '', flush = false, cls = '', id = '',
}) {
  return `<section class="card ${flush ? 'card-flush' : ''} ${cls}" ${id ? `id="${esc(id)}"` : ''}>
    <div class="card-head" style="${flush ? 'padding:var(--s-5) var(--s-5) 0' : ''}">
      <div>
        <h3>${esc(title)}</h3>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      </div>
      ${actions ? `<div class="card-head-actions">${actions}</div>` : ''}
    </div>
    ${body}
    ${legend ? `<div class="chart-legend" style="margin-top:var(--s-4)">${legend}</div>` : ''}
  </section>`;
}

export function legendItem(label, color, { line = false } = {}) {
  return `<span class="legend-item"><span class="${line ? 'legend-line' : 'legend-swatch'}" style="--swatch:${color}"></span>${esc(label)}</span>`;
}

export function metricCard({
  label, value, iconName, color = 'var(--brand-500)', sub = '', delta = null, deltaOpts = {}, spark = '', cls = 'col-3', footnote = '',
  masked = false,
}) {
  return `<section class="card card-hover ${cls}">
    <div class="metric">
      <div class="metric-label">
        ${iconTile(iconName, { color, size: 28, radius: 9, iconSize: 15 })}
        <span>${esc(label)}</span>
      </div>
      ${masked
    ? `<div class="metric-value is-masked">${MASK}</div>`
    : `<div class="metric-value" data-count="${Number(value) || 0}">${esc(money(Number(value) || 0))}</div>`}
      ${delta !== null ? deltaHtml(delta, deltaOpts) : ''}
      ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
      ${footnote}
    </div>
    ${spark ? `<div class="metric-spark">${spark}</div>` : ''}
  </section>`;
}

export function accountCard({ account, balance, meta = '', onClick = '', masked = false }) {
  const typeLabel = { bank: 'Bank', ewallet: 'E-Wallet', cash: 'Cash', investment: 'Investasi', emergency_fund: 'Dana Darurat' }[account.account_type] || 'Akun';
  return `<button class="account-card" style="--account-color:${esc(account.color)}" data-account-card="${esc(account.id)}" type="button" ${onClick}>
    <div class="account-card-top">
      ${iconTile(account.icon, { color: account.color, size: 36, radius: 11, iconSize: 18 })}
      <div class="grow" style="min-width:0">
        <div class="account-name t-clip">${esc(account.name)}</div>
        <div class="account-meta">${esc(account.account_number ? maskAccountNumber(account.account_number) : typeLabel)}</div>
      </div>
      ${account.status === 'archived' ? badgeHtml('Arsip', 'outline') : ''}
    </div>
    <div class="account-balance ${balance < 0 ? 't-neg' : ''}">${esc(masked ? MASK : money(balance))}</div>
    <div class="account-foot">
      <span>${esc(typeLabel)}</span>
      ${meta ? `<span class="txn-dot"></span><span class="t-clip">${esc(meta)}</span>` : ''}
    </div>
  </button>`;
}

export function debtCard({ debt, info, onPay, onClick }) {
  const meta = STATUS_META[info.status] || {};
  const tone = ['paid', 'received'].includes(info.status) ? 'pos' : info.status === 'overdue' ? 'neg' : info.status.startsWith('partial') ? 'warn' : 'info';
  return `<article class="debt-card ${info.isOverdue ? 'is-overdue' : ''}" data-debt-card="${esc(debt.id)}">
    <div class="debt-top">
      ${iconTile('hand-coins', { color: info.isOverdue ? 'var(--neg)' : 'var(--warn)', size: 38, radius: 12, iconSize: 19 })}
      <div class="grow" style="min-width:0">
        <div class="t-sm t-bold t-clip">${esc(debt.counterparty)}</div>
        <div class="t-2xs t-dim">${esc(debt.start_date ? `Mulai ${formatDate(debt.start_date, { year: false })}` : '')}
          ${debt.due_date ? ` · Jatuh tempo ${esc(formatDate(debt.due_date, { year: false, short: true }))} (${esc(relativeDays(debt.due_date))})` : ''}</div>
      </div>
      ${badgeHtml(meta.label || 'Aktif', tone)}
    </div>
    <div class="debt-amounts">
      <div class="debt-amount"><div class="label">Total</div><div class="value">${esc(money(info.principal))}</div></div>
      <div class="debt-amount"><div class="label">Dibayar</div><div class="value t-pos">${esc(money(info.paid))}</div></div>
      <div class="debt-amount"><div class="label">Sisa</div><div class="value t-neg">${esc(money(info.remaining))}</div></div>
    </div>
    <div class="debt-progress-head">
      <span>Progress ${info.progress.toFixed(0)}%</span>
      <span>${esc(debt.notes ? debt.notes.slice(0, 40) : '')}</span>
    </div>
    ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : 'warn' })}
    <div class="row gap-2">
      ${info.remaining > 0
    ? `<button class="btn btn-sm btn-primary" data-pay-debt="${esc(debt.id)}">${icon('hand-coins', { size: 15 })} Bayar</button>`
    : badgeHtml('Lunas', 'pos', { icon: 'circle-check' })}
      <button class="btn btn-sm btn-ghost" data-view-debt="${esc(debt.id)}">Detail</button>
    </div>
  </article>`;
}

export function receivableCard({ receivable, info, onClick }) {
  const meta = STATUS_META[info.status] || {};
  const tone = info.status === 'received' ? 'pos' : info.status === 'overdue' ? 'neg' : info.status.startsWith('partial') ? 'warn' : 'info';
  return `<article class="debt-card ${info.isOverdue ? 'is-overdue' : ''}" data-receivable-card="${esc(receivable.id)}">
    <div class="debt-top">
      ${iconTile('file-text', { color: info.isOverdue ? 'var(--neg)' : 'var(--info)', size: 38, radius: 12, iconSize: 19 })}
      <div class="grow" style="min-width:0">
        <div class="t-sm t-bold t-clip">${esc(receivable.counterparty)}</div>
        <div class="t-2xs t-dim">${receivable.due_date ? `Jatuh tempo ${esc(formatDate(receivable.due_date, { year: false, short: true }))} (${esc(relativeDays(receivable.due_date))})` : 'Tanpa jatuh tempo'}</div>
      </div>
      ${badgeHtml(meta.label || 'Aktif', tone)}
    </div>
    <div class="debt-amounts">
      <div class="debt-amount"><div class="label">Total</div><div class="value">${esc(money(info.principal))}</div></div>
      <div class="debt-amount"><div class="label">Diterima</div><div class="value t-pos">${esc(money(info.received))}</div></div>
      <div class="debt-amount"><div class="label">Sisa</div><div class="value">${esc(money(info.remaining))}</div></div>
    </div>
    <div class="debt-progress-head">
      <span>Progress ${info.progress.toFixed(0)}%</span>
      <span>${info.isDueSoon && info.remaining > 0 ? 'Segera jatuh tempo — kirim pengingat' : ''}</span>
    </div>
    ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : '' })}
    <div class="row gap-2">
      ${info.remaining > 0
    ? `<button class="btn btn-sm btn-success" data-receive="${esc(receivable.id)}">${icon('circle-check', { size: 15 })} Terima</button>`
    : badgeHtml('Selesai', 'pos', { icon: 'circle-check' })}
      ${receivable.reminder_days ? `<button class="btn btn-sm btn-ghost" data-remind="${esc(receivable.id)}">${icon('message-square', { size: 15 })} Pengingat</button>` : ''}
    </div>
  </article>`;
}

export function budgetRow({ row, format = money }) {
  const tone = row.level === 'over' ? 'neg' : row.level === 'warn' ? 'warn' : 'pos';
  const cat = row.category || { name: 'Tanpa kategori', icon: 'tag', color: '#94a3b8' };
  return `<div class="budget-item" data-budget="${esc(row.budget.id)}">
    <div class="budget-head">
      ${iconTile(cat.icon, { color: cat.color, size: 32, radius: 10, iconSize: 16 })}
      <div class="grow" style="min-width:0">
        <div class="budget-name t-clip">${esc(cat.name)}</div>
        <div class="t-2xs t-dim">${row.level === 'over' ? `Lebih ${esc(format(row.overspend))}` : `Sisa ${esc(format(row.remaining))}`}</div>
      </div>
      <div class="budget-nums">
        <strong>${esc(format(row.spent))}</strong>
        <div>dari ${esc(format(row.amount))}</div>
      </div>
      ${badgeHtml(`${row.usage.toFixed(0)}%`, tone)}
    </div>
    ${progressHtml(Math.min(row.usage, 100), { tone })}
  </div>`;
}

export function insightCard(insight) {
  const tone = insight.tone === 'pos' ? 'pos' : insight.tone === 'neg' ? 'neg' : insight.tone === 'warn' ? 'warn' : 'brand';
  const color = tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--brand-500)';
  return `<div class="insight is-${tone}">
    ${iconTile(insight.icon || 'sparkles', { color, size: 34, radius: 11, iconSize: 17 })}
    <div class="grow">
      <div class="insight-title">${esc(insight.title)}</div>
      <div class="insight-text">${esc(insight.text)}</div>
    </div>
  </div>`;
}

/**
 * Hero of the dashboard: the balance presented as a premium ATM/bank card —
 * brand lockup, chip, contactless waves, masked account number, holder name —
 * followed by a compact strip with the month's headline numbers.
 */
export function heroCard({
  balance, monthLabel, netWorth: worth, trend, income, expense, net,
  holder = 'Pemilik Akun', cardNumber = '', institution = 'AD-Finance', since = '',
  hideBalance = false,
}) {
  /** Format nominal, atau sensor bila mode privasi aktif. */
  const m = (value, opts = {}) => (hideBalance ? MASK : money(value, opts));
  const trendPos = trend.change >= 0;
  const digits = String(cardNumber).replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : '';
  const masked = last4 ? `••••  ••••  ••••  ${last4}` : '••••  ••••  ••••  ••••';
  const holderName = String(holder || 'Pemilik Akun').toUpperCase().slice(0, 26);
  const memberSince = since || String(new Date().getFullYear());

  return `<section class="card hero-wrap bento-hero">
    <div class="atm-scene">
      <article class="atm-card" data-atm-card aria-label="Kartu saldo AD-Finance">
        <div class="atm-glow" aria-hidden="true"></div>
        <div class="atm-grid" aria-hidden="true"></div>

        <header class="atm-top">
          <span class="atm-brand">
            ${logoMark(30, { radius: 9 })}
            <span class="atm-brand-text">
              <b>${esc(institution)}</b>
              <i>Digital Wallet &amp; Ledger</i>
            </span>
          </span>
          <span class="atm-contactless" aria-hidden="true">${contactlessMark()}</span>
        </header>

        <div class="atm-mid">
          <span class="atm-chip" aria-hidden="true">${chipMark()}</span>
          <span class="atm-number">${esc(masked)}</span>
        </div>

        <div class="atm-balance">
          <span class="atm-balance-head">
            <span class="atm-label">Total Saldo</span>
            <button class="atm-eye" type="button" data-toggle-secret
              aria-pressed="${hideBalance}" aria-label="${hideBalance ? 'Tampilkan saldo' : 'Sembunyikan saldo'}"
              title="${hideBalance ? 'Tampilkan saldo' : 'Sembunyikan saldo'}">
              ${icon(hideBalance ? 'eye-off' : 'eye', { size: 15 })}
            </button>
          </span>
          ${hideBalance
    ? `<span class="atm-value is-masked" data-secret-value>${MASK}</span>`
    : `<span class="atm-value" data-count="${balance}">${esc(money(balance))}</span>`}
          <span class="atm-delta ${trendPos ? 'is-pos' : 'is-neg'}">
            ${icon(trendPos ? 'trending-up' : 'trending-down', { size: 13 })}
            ${percent(trend.pct, 1, true)} · 30 hari
          </span>
        </div>

        <footer class="atm-foot">
          <span class="atm-holder">
            <i>Card Holder</i>
            <b data-atm-holder>${esc(holderName)}</b>
          </span>
          <span class="atm-since">
            <i>Member Since</i>
            <b>${esc(memberSince)}</b>
          </span>
          <span class="atm-net">
            <i>Net Worth</i>
            <b>${esc(m(worth.net, { compact: true }))}</b>
          </span>
        </footer>
      </article>
    </div>

    <div class="atm-stats">
      <div class="atm-stat">
        <span class="as-label">${icon('trending-up', { size: 13 })} Pemasukan</span>
        <span class="as-value t-pos">+${esc(m(income, { compact: true }).replace('-', ''))}</span>
      </div>
      <div class="atm-stat">
        <span class="as-label">${icon('trending-down', { size: 13 })} Pengeluaran</span>
        <span class="as-value t-neg">−${esc(m(expense, { compact: true }).replace('-', ''))}</span>
      </div>
      <div class="atm-stat">
        <span class="as-label">${icon('switch', { size: 13 })} Cash Flow</span>
        <span class="as-value ${net >= 0 ? 't-pos' : 't-neg'}">${esc(m(net, { compact: true }))}</span>
      </div>
      <div class="atm-stat">
        <span class="as-label">${icon('calendar', { size: 13 })} Periode</span>
        <span class="as-value">${esc(monthLabel)}</span>
      </div>
    </div>

    <div class="atm-chips">
      <span class="hero-chip">${icon('hand-coins', { size: 13 })} Piutang ${esc(m(worth.receivables, { compact: true }))}</span>
      <span class="hero-chip">${icon('credit-card', { size: 13 })} Hutang ${esc(m(worth.debts, { compact: true }))}</span>
    </div>
  </section>`;
}

/** EMV-style chip */
function chipMark() {
  return `<svg viewBox="0 0 40 30" width="40" height="30" aria-hidden="true">
    <rect x="0.6" y="0.6" width="38.8" height="28.8" rx="6" fill="url(#chipG)" stroke="rgba(255,255,255,.4)"/>
    <defs>
      <linearGradient id="chipG" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#F6DFA8"/><stop offset="0.45" stop-color="#D8B979"/><stop offset="1" stop-color="#B99551"/>
      </linearGradient>
    </defs>
    <g stroke="rgba(90,68,26,.55)" stroke-width="1.4" fill="none">
      <path d="M0 10h12M0 20h12M28 10h12M28 20h12M12 0v30M28 0v30"/>
      <rect x="12" y="8" width="16" height="14" rx="2.4"/>
    </g>
  </svg>`;
}

/** Contactless waves */
function contactlessMark() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
    <path d="M6.5 7.5a8.6 8.6 0 0 1 0 9"/><path d="M10 5.6a11.6 11.6 0 0 1 0 12.8"/>
    <path d="M13.6 3.8a14.6 14.6 0 0 1 0 16.4"/><path d="M17.2 2a17.6 17.6 0 0 1 0 20"/>
  </svg>`;
}

export function quickActions(list) {
  return `<div class="quick-actions">
    ${list.map((a) => `<button class="quick-action" data-quick="${esc(a.key)}" type="button">
      ${iconTile(a.icon, { color: a.color, size: 36, radius: 11, iconSize: 18 })}
      <span class="qa-label">${esc(a.label)}</span>
    </button>`).join('')}
  </div>`;
}

/**
 * Subtle 3D response for [data-atm-card]: the card tips toward the cursor and a
 * highlight sweeps across it. Skipped entirely for touch/prefers-reduced-motion.
 */
export function attachCardTilt(scope) {
  if (!scope) return () => {};
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? false;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (!fine || calm) return () => {};

  let frame = 0;
  const onMove = (event) => {
    const card = event.target.closest?.('[data-atm-card]');
    if (!card) return;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      card.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((0.5 - py) * 6).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    });
  };
  const onLeave = (event) => {
    const card = event.target.closest?.('[data-atm-card]');
    if (!card) return;
    card.style.removeProperty('--ry');
    card.style.removeProperty('--rx');
  };

  scope.addEventListener('pointermove', onMove);
  scope.addEventListener('pointerleave', onLeave, true);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    scope.removeEventListener('pointermove', onMove);
    scope.removeEventListener('pointerleave', onLeave, true);
  };
}

/** Animate every [data-count] element inside root. */
export function animateCounters(root, { duration = 800 } = {}) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  qsa('[data-count]', root).forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    // Sebagian kartu menampilkan persentase, bukan rupiah — hormati data-format.
    const isPercent = (el.dataset.format || 'money') === 'percent';
    const decimals = Number(el.dataset.decimals ?? 1);
    const fmt = (v) => (isPercent ? percent(v, decimals) : money(v));
    if (reduce) { el.textContent = fmt(target); return; }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = fmt(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(target);
    };
    requestAnimationFrame(tick);
  });
}

export { toneClass };
