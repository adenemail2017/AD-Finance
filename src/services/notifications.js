/**
 * Notification engine — derives alerts from the ledger on every mutation.
 * Deduped by `key`, so a user never sees the same warning twice.
 */

import { uid } from '../utils/id.js';
import { todayISO, monthKey, addMonths, daysBetween, formatDate, parseMonthKey } from '../utils/date.js';
import { debtState, receivableState, budgetUsage, txns } from './finance.js';

const nf = (value) => `Rp ${Math.round(Math.abs(value)).toLocaleString('id-ID')}`;

function make({ key, type, title, message, tone = 'info', icon = 'bell', priority = 5, action = null, date }) {
  return {
    id: uid('notif'),
    key,
    type,
    title,
    message,
    tone,
    icon,
    priority,
    action,
    read: false,
    created_at: date || new Date().toISOString(),
    sync_status: 'local',
  };
}

/**
 * @param {object} state current app state
 * @returns {Array} notifications to insert (already deduped against existing)
 */
export function refreshNotifications(state) {
  const out = [];
  const today = todayISO();
  const existingKeys = new Set((state.notifications || []).map((n) => n.key));
  const push = (n) => { if (!existingKeys.has(n.key)) out.push(n); };

  /* --- debts due / overdue ------------------------------------------- */
  (state.debts || []).forEach((debt) => {
    const info = debtState(debt, state.debtPayments);
    if (info.remaining <= 0 || !debt.due_date) return;
    const days = daysBetween(today, debt.due_date);
    if (days < 0) {
      push(make({
        key: `debt:${debt.id}:overdue:${debt.due_date}`,
        type: 'debt_overdue',
        title: `Hutang ke ${debt.counterparty} jatuh tempo`,
        message: `Terlambat ${Math.abs(days)} hari. Sisa ${nf(info.remaining)} dari ${nf(info.principal)}.`,
        tone: 'neg', icon: 'alert', priority: 1,
        action: { route: 'debts', params: { id: debt.id } },
      }));
    } else if (days <= 7) {
      push(make({
        key: `debt:${debt.id}:due:${debt.due_date}`,
        type: 'debt_due',
        title: `Hutang ke ${debt.counterparty} jatuh tempo ${formatDate(debt.due_date, { short: true })}`,
        message: `${days === 0 ? 'Hari ini' : `${days} hari lagi`} — sisa ${nf(info.remaining)}.`,
        tone: 'warn', icon: 'clock', priority: 2,
        action: { route: 'debts', params: { id: debt.id } },
      }));
    }
  });

  /* --- receivables due / overdue ------------------------------------- */
  (state.receivables || []).forEach((rec) => {
    const info = receivableState(rec, state.receivablePayments);
    if (info.remaining <= 0 || !rec.due_date) return;
    const days = daysBetween(today, rec.due_date);
    const reminder = Number(rec.reminder_days) || 3;
    if (days < 0) {
      push(make({
        key: `rec:${rec.id}:overdue:${rec.due_date}`,
        type: 'receivable_overdue',
        title: `Piutang dari ${rec.counterparty} terlambat`,
        message: `Lewat ${Math.abs(days)} hari. Sisa ${nf(info.remaining)} — kirim pengingat.`,
        tone: 'warn', icon: 'message-square', priority: 3,
        action: { route: 'debts', params: { id: rec.id, tab: 'receivables' } },
      }));
    } else if (days <= reminder) {
      push(make({
        key: `rec:${rec.id}:due:${rec.due_date}`,
        type: 'receivable_due',
        title: `Piutang ${rec.counterparty} jatuh tempo ${formatDate(rec.due_date, { short: true })}`,
        message: `Sisa ${nf(info.remaining)}. Ingatkan untuk pelunasan.`,
        tone: 'info', icon: 'message-square', priority: 4,
        action: { route: 'debts', params: { id: rec.id, tab: 'receivables' } },
      }));
    }
  });

  /* --- budgets ------------------------------------------------------- */
  const usage = budgetUsage(state, monthKey());
  usage.forEach((row) => {
    if (!row.category) return;
    if (row.usage >= 100) {
      push(make({
        key: `budget:${row.budget.id}:over:${row.budget.period}`,
        type: 'budget_over',
        title: `Budget ${row.category.name} terlewati`,
        message: `Terpakai ${nf(row.spent)} dari ${nf(row.amount)} (${row.usage.toFixed(0)}%). Lebih ${nf(row.overspend)}.`,
        tone: 'neg', icon: 'alert-circle', priority: 2,
        action: { route: 'budgets' },
      }));
    } else if (row.usage >= 80) {
      push(make({
        key: `budget:${row.budget.id}:warn:${row.budget.period}`,
        type: 'budget_warn',
        title: `Budget ${row.category.name} hampir habis`,
        message: `Terpakai ${row.usage.toFixed(0)}% (${nf(row.spent)} / ${nf(row.amount)}). Sisa ${nf(row.remaining)}.`,
        tone: 'warn', icon: 'target', priority: 4,
        action: { route: 'budgets' },
      }));
    }
  });

  /* --- low balance --------------------------------------------------- */
  const threshold = Number(state.profile?.low_balance_threshold) || 0;
  if (threshold > 0) {
    const balances = new Map();
    (state.accounts || []).forEach((a) => balances.set(a.id, a.opening_balance));
    txns(state).forEach((t) => {
      const ids = [t.account_id, t.destination_account_id].filter(Boolean);
      ids.forEach((id) => {
        if (!balances.has(id)) return;
        const amount = Math.abs(t.amount);
        const isOutflow = t.account_id === id && !['income', 'debt', 'receivable_payment'].includes(t.transaction_type);
        balances.set(id, balances.get(id) + (isOutflow ? -amount : amount));
      });
    });
    (state.accounts || []).filter((a) => a.status !== 'archived').forEach((a) => {
      const balance = balances.get(a.id) || 0;
      if (balance < threshold && balance >= 0) {
        push(make({
          key: `low:${a.id}:${monthKey()}`,
          type: 'low_balance',
          title: `Saldo ${a.name} rendah`,
          message: `Sisa ${nf(balance)} — di bawah ambang batas ${nf(threshold)}.`,
          tone: 'warn', icon: 'wallet', priority: 5,
          action: { route: 'accounts' },
        }));
      }
    });
  }

  /* --- monthly report ready ----------------------------------------- */
  const previousMonth = addMonths(monthKey(), -1);
  const { year, month } = parseMonthKey(previousMonth);
  const monthHasData = txns(state).some((t) => t.date.slice(0, 7) === previousMonth);
  if (monthHasData) {
    const dayOfMonth = new Date().getDate();
    if (dayOfMonth <= 5) {
      push(make({
        key: `report:${previousMonth}`,
        type: 'monthly_report',
        title: `Laporan bulan ${formatDate(`${year}-${String(month + 1).padStart(2, '0')}-01`, { year: false, short: false }).split(' ').slice(0, 2).join(' ')} siap`,
        message: 'Rekap lengkap bulan lalu sudah bisa dilihat di halaman Reports.',
        tone: 'info', icon: 'file-chart', priority: 6,
        action: { route: 'reports' },
      }));
    }
  }

  /* --- welcome / onboarding ------------------------------------------ */
  if (!state.profile?.onboarding_done) {
    push(make({
      key: 'welcome',
      type: 'system',
      title: 'Selamat datang di AD-Finance',
      message: 'Data contoh sudah dimuat. Hapus kapan saja dari Settings → Data.',
      tone: 'info', icon: 'sparkles', priority: 8,
      action: { route: 'settings' },
    }));
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export function unreadCount(state) {
  return (state.notifications || []).filter((n) => !n.read).length;
}
