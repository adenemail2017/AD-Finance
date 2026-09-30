-- ============================================================================
-- Personal Finance OS — PostgreSQL schema (v1)
-- ----------------------------------------------------------------------------
-- The PWA is local-first: it works with zero backend (IndexedDB on device).
-- This schema is the optional server-side mirror used for multi-device sync,
-- backup and reporting. Column names match the client model 1:1 so sync is a
-- straight upsert (`ON CONFLICT (id) DO UPDATE`).
--
-- Money: BIGINT in minor units (IDR → rupiah, no decimals). Never float.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid(), crypt()

-- ---------------------------------------------------------------- users -----
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL DEFAULT 'Pengguna',
  password_hash TEXT NOT NULL,                 -- scrypt/argon2 hash, never plain
  currency      CHAR(3) NOT NULL DEFAULT 'IDR',
  locale        TEXT NOT NULL DEFAULT 'id-ID',
  theme         TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  low_balance_threshold BIGINT NOT NULL DEFAULT 250000,
  pin_hash      TEXT,                          -- optional device PIN (client-side only in practice)
  onboarded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- accounts -----
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('bank','ewallet','cash','investment','emergency_fund')),
  institution     TEXT NOT NULL DEFAULT '',
  account_number  TEXT,                        -- stored but never returned unmasked by the API
  opening_balance BIGINT NOT NULL DEFAULT 0,
  color           TEXT NOT NULL DEFAULT '#2563eb',
  icon            TEXT NOT NULL DEFAULT 'bank',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_default      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id, status);

-- --------------------------------------------- categories & subcategories ---
-- Self-referencing tree: parent_id IS NULL → category, otherwise subcategory.
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  icon       TEXT NOT NULL DEFAULT 'tag',
  color      TEXT NOT NULL DEFAULT '#64748b',
  is_default BOOLEAN NOT NULL DEFAULT false,
  archived   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, parent_id, name)
);
CREATE INDEX IF NOT EXISTS categories_user_idx ON categories(user_id, kind, parent_id);

-- Rekening koran rows live here — the single source of truth for money.
CREATE TABLE IF NOT EXISTS transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_type       TEXT NOT NULL CHECK (transaction_type IN (
                           'income','expense','transfer','debt','receivable',
                           'debt_payment','receivable_payment','investment','emergency_fund')),
  date                   DATE NOT NULL,
  time                   TIME NOT NULL DEFAULT '00:00',
  amount                 BIGINT NOT NULL CHECK (amount > 0),
  category_id            UUID REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  reference_id           UUID,                -- debt/receivable id for linked entries
  reference_type         TEXT CHECK (reference_type IN ('debt','receivable')),
  counterparty           TEXT NOT NULL DEFAULT '',
  description            TEXT NOT NULL DEFAULT '',
  notes                  TEXT NOT NULL DEFAULT '',
  attachment             TEXT,
  tags                   TEXT[] NOT NULL DEFAULT '{}',
  fingerprint            TEXT,                -- dedupe guard (see client transactionFingerprint)
  client_id              TEXT,                -- idempotency key from the outbox
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  -- integrity: transfers & allocations must name a different destination account
  CONSTRAINT transfer_needs_destination CHECK (
    transaction_type NOT IN ('transfer','investment','emergency_fund')
    OR (destination_account_id IS NOT NULL AND destination_account_id <> account_id)
  ),
  CONSTRAINT linked_needs_reference CHECK (
    transaction_type NOT IN ('debt_payment','receivable_payment') OR reference_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS txn_user_date_idx ON transactions(user_id, date DESC, time DESC);
CREATE INDEX IF NOT EXISTS txn_user_type_idx ON transactions(user_id, transaction_type);
CREATE INDEX IF NOT EXISTS txn_account_idx   ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS txn_reference_idx ON transactions(reference_id);
-- one fingerprint per user per day → blocks accidental double entry
CREATE UNIQUE INDEX IF NOT EXISTS txn_fingerprint_uniq
  ON transactions(user_id, fingerprint) WHERE fingerprint IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------ debts ---------
CREATE TABLE IF NOT EXISTS debts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty   TEXT NOT NULL,
  principal      BIGINT NOT NULL CHECK (principal > 0),
  account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
  start_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  interest_rate  NUMERIC(5,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','partially_paid','paid','overdue')),
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debts_user_idx ON debts(user_id, status, due_date);

CREATE TABLE IF NOT EXISTS debt_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_id        UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  amount         BIGINT NOT NULL CHECK (amount > 0),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  time           TIME NOT NULL DEFAULT '00:00',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debt_payments_idx ON debt_payments(debt_id, date);

-- -------------------------------------------------------- receivables ------
CREATE TABLE IF NOT EXISTS receivables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty  TEXT NOT NULL,
  principal     BIGINT NOT NULL CHECK (principal > 0),
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  start_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date      DATE,
  reminder_days INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','partially_received','received','overdue')),
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receivables_user_idx ON receivables(user_id, status, due_date);

CREATE TABLE IF NOT EXISTS receivable_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receivable_id  UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  amount         BIGINT NOT NULL CHECK (amount > 0),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  time           TIME NOT NULL DEFAULT '00:00',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recv_payments_idx ON receivable_payments(receivable_id, date);

-- ----------------------------------------------------------- budgets -------
CREATE TABLE IF NOT EXISTS budgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period      CHAR(7) NOT NULL,               -- 'YYYY-MM'
  amount      BIGINT NOT NULL CHECK (amount >= 0),
  rollover    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, period)
);
CREATE INDEX IF NOT EXISTS budgets_period_idx ON budgets(user_id, period);

-- --------------------------------------------- monthly reports (cache) -----
-- Materialised recaps so the Reports page stays instant on large histories.
CREATE TABLE IF NOT EXISTS monthly_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period            CHAR(7) NOT NULL,
  opening_balance   BIGINT NOT NULL DEFAULT 0,
  total_income      BIGINT NOT NULL DEFAULT 0,
  total_expense     BIGINT NOT NULL DEFAULT 0,
  total_transfer    BIGINT NOT NULL DEFAULT 0,
  total_investment  BIGINT NOT NULL DEFAULT 0,
  total_emergency   BIGINT NOT NULL DEFAULT 0,
  total_debt_payment BIGINT NOT NULL DEFAULT 0,
  net_cash_flow     BIGINT NOT NULL DEFAULT 0,
  ending_balance    BIGINT NOT NULL DEFAULT 0,
  net_worth         BIGINT NOT NULL DEFAULT 0,
  savings_rate      NUMERIC(6,2) NOT NULL DEFAULT 0,
  payload           JSONB NOT NULL DEFAULT '{}',  -- category/account breakdowns
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)
);

-- ----------------------------------------------------- notifications -------
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,                   -- dedupe key (e.g. debt:<id>:overdue)
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  tone       TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info','pos','warn','neg')),
  icon       TEXT NOT NULL DEFAULT 'bell',
  priority   SMALLINT NOT NULL DEFAULT 5,
  read       BOOLEAN NOT NULL DEFAULT false,
  action     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read, created_at DESC);

-- ---------------------------------------------------------- settings -------
CREATE TABLE IF NOT EXISTS settings (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ------------------------------------------------------ sync journal -------
-- Every client mutation is appended here; it doubles as an audit trail and
-- lets any device pull "everything after cursor".
CREATE TABLE IF NOT EXISTS sync_operations (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,
  entity      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  payload     JSONB NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

-- =============================== derived views ==============================

-- Current balance per account (opening balance + signed movements).
CREATE OR REPLACE VIEW account_balances AS
SELECT a.id AS account_id,
       a.user_id,
       a.name,
       a.account_type,
       a.opening_balance
       + COALESCE(SUM(CASE
           WHEN t.transaction_type IN ('income','debt','receivable_payment') AND t.account_id = a.id THEN t.amount
           WHEN t.transaction_type IN ('expense','receivable','debt_payment') AND t.account_id = a.id THEN -t.amount
           WHEN t.transaction_type IN ('transfer','investment','emergency_fund') AND t.account_id = a.id THEN -t.amount
           WHEN t.transaction_type IN ('transfer','investment','emergency_fund') AND t.destination_account_id = a.id THEN t.amount
           ELSE 0 END), 0) AS balance
FROM accounts a
LEFT JOIN transactions t
  ON (t.account_id = a.id OR t.destination_account_id = a.id)
 AND t.deleted_at IS NULL
GROUP BY a.id;

-- Outstanding debt / receivable per entity.
CREATE OR REPLACE VIEW debt_outstanding AS
SELECT d.*, d.principal - COALESCE(SUM(p.amount), 0) AS remaining,
       COALESCE(SUM(p.amount), 0) AS paid,
       CASE WHEN d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
                 AND d.principal - COALESCE(SUM(p.amount), 0) > 0
            THEN 'overdue' ELSE d.status END AS derived_status
FROM debts d LEFT JOIN debt_payments p ON p.debt_id = d.id
GROUP BY d.id;

CREATE OR REPLACE VIEW receivable_outstanding AS
SELECT r.*, r.principal - COALESCE(SUM(p.amount), 0) AS remaining,
       COALESCE(SUM(p.amount), 0) AS received,
       CASE WHEN r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE
                 AND r.principal - COALESCE(SUM(p.amount), 0) > 0
            THEN 'overdue' ELSE r.status END AS derived_status
FROM receivables r LEFT JOIN receivable_payments p ON p.receivable_id = r.id
GROUP BY r.id;

-- Monthly recap (source for the Reports → Rekap table and monthly_reports cache).
CREATE OR REPLACE VIEW monthly_totals AS
SELECT user_id,
       to_char(date, 'YYYY-MM') AS period,
       SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) AS expense,
       SUM(CASE WHEN transaction_type = 'investment' THEN amount ELSE 0 END) AS investment,
       SUM(CASE WHEN transaction_type = 'emergency_fund' THEN amount ELSE 0 END) AS emergency_fund,
       SUM(CASE WHEN transaction_type = 'debt_payment' THEN amount ELSE 0 END) AS debt_payment,
       SUM(CASE WHEN transaction_type = 'receivable_payment' THEN amount ELSE 0 END) AS receivable_payment,
       SUM(CASE WHEN transaction_type = 'transfer' THEN amount ELSE 0 END) AS transfer,
       SUM(CASE WHEN transaction_type = 'income' THEN amount
                WHEN transaction_type = 'expense' THEN -amount ELSE 0 END) AS net_cash_flow,
       COUNT(*) AS txn_count
FROM transactions
WHERE deleted_at IS NULL
GROUP BY user_id, to_char(date, 'YYYY-MM');

-- ============================ row-level security ============================
-- Defence in depth: even a buggy query cannot leak another user's rows.
ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables          ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','transactions','categories','debts','debt_payments',
                           'receivables','receivable_payments','budgets','monthly_reports',
                           'notifications','settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_owner ON %I USING (user_id = current_setting(''app.user_id'', true)::uuid) '
      'WITH CHECK (user_id = current_setting(''app.user_id'', true)::uuid)', t, t);
  END LOOP;
END $$;
-- The API sets `SET LOCAL app.user_id = $1` inside every request transaction.
