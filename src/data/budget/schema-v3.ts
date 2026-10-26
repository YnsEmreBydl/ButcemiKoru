/** Opt-in schema only. The application's v2 opener deliberately does not import this module. */
const max = '9007199254740991';
const publicId = `TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))) UNIQUE
  CHECK (length(public_id) = 32 AND public_id NOT GLOB '*[^0-9a-f]*')`;
const positiveId = `INTEGER NOT NULL CHECK (id BETWEEN 1 AND ${max})`;
const instant = (column: string) => `COALESCE(length(${column}) = 24 AND
  strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}, 0)`;
const minorPaths = [
  'spentSinceSnapshotMinor', 'todayOutflowMinor', 'todayBudgetImpactMinor',
  'remainingBalanceMinor', 'reservedPaymentsMinor', 'savingsReservedMinor',
  'spendableAtDayStartMinor', 'spendableMinor', 'budgetDeficitMinor',
];
const safeJsonMinor = (path: string) => `COALESCE(
  json_type(closing_result_json, '$.${path}') = 'integer' AND
  json_extract(closing_result_json, '$.${path}') BETWEEN -${max} AND ${max}, 0)`;
const snapshotCheck = minorPaths.map(safeJsonMinor).join(' AND ');
const dailySnapshotCheck = ['recommendedDailyMinor', 'todayStartTargetMinor', 'todayRemainingMinor',
  'uniformRemainderMinor', 'forwardRemainderMinor'].map(path => safeJsonMinor(`daily.${path}`)).join(' AND ');

// Build a separate, internally related table family. Never rename the old parent first.
export const createV3Tables = `-- v3:create
CREATE TABLE v3_budget_books (
  id ${positiveId} PRIMARY KEY,
  public_id ${publicId},
  activation_revision INTEGER NOT NULL CHECK (activation_revision BETWEEN 0 AND ${max})
) STRICT;
CREATE TABLE v3_budget_periods (
  id ${positiveId} PRIMARY KEY,
  public_id ${publicId},
  book_id INTEGER NOT NULL REFERENCES v3_budget_books(id) ON DELETE RESTRICT,
  previous_period_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  opened_at TEXT NOT NULL CHECK (${instant('opened_at')}),
  created_at TEXT CHECK (created_at IS NULL OR (${instant('created_at')})),
  closed_at TEXT,
  closing_result_json TEXT,
  calculation_version TEXT,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND ${max}),
  currency TEXT NOT NULL CHECK (currency = 'TRY'),
  time_zone TEXT NOT NULL CHECK (length(trim(time_zone)) > 0 AND trim(time_zone) = time_zone),
  balance_minor INTEGER NOT NULL CHECK (balance_minor BETWEEN -${max} AND ${max}),
  balance_captured_at TEXT NOT NULL,
  next_payday TEXT NOT NULL CHECK (length(next_payday) = 10),
  savings_minor INTEGER NOT NULL CHECK (savings_minor BETWEEN 0 AND ${max}),
  UNIQUE (book_id, id),
  UNIQUE (book_id, previous_period_id),
  FOREIGN KEY (book_id, previous_period_id) REFERENCES v3_budget_periods(book_id, id) ON DELETE RESTRICT,
  CHECK (previous_period_id IS NULL OR previous_period_id != id),
  CHECK ((status = 'active' AND closed_at IS NULL AND closing_result_json IS NULL AND calculation_version IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL AND (${instant('closed_at')}) AND closed_at >= opened_at AND
     calculation_version IS NOT NULL AND length(trim(calculation_version)) BETWEEN 1 AND 80 AND
     closing_result_json IS NOT NULL AND CASE WHEN json_valid(closing_result_json) THEN
       COALESCE(json_type(closing_result_json) = 'object' AND
       json_extract(closing_result_json, '$.currency') = 'TRY', 0) AND ${snapshotCheck}
       AND COALESCE(json_type(closing_result_json, '$.daily') = 'null' OR
         (json_type(closing_result_json, '$.daily') = 'object' AND ${dailySnapshotCheck} AND
          (json_type(closing_result_json, '$.daily.forwardDailyAverageMinor') = 'null' OR
           ${safeJsonMinor('daily.forwardDailyAverageMinor')})), 0)
       ELSE 0 END))
) STRICT;
CREATE TABLE v3_budget_payments (
  period_id INTEGER NOT NULL REFERENCES v3_budget_periods(id) ON DELETE RESTRICT,
  id TEXT NOT NULL CHECK (length(trim(id)) > 0 AND trim(id) = id),
  public_id ${publicId},
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND ${max}),
  due_on TEXT NOT NULL CHECK (length(due_on) = 10),
  carried_from_period_id INTEGER,
  carried_from_payment_id TEXT,
  PRIMARY KEY (period_id, id),
  UNIQUE (period_id, carried_from_period_id, carried_from_payment_id),
  FOREIGN KEY (carried_from_period_id, carried_from_payment_id)
    REFERENCES v3_budget_payments(period_id, id) ON DELETE RESTRICT,
  CHECK ((carried_from_period_id IS NULL AND carried_from_payment_id IS NULL) OR
    (carried_from_period_id IS NOT NULL AND carried_from_payment_id IS NOT NULL AND carried_from_period_id != period_id))
) STRICT;
CREATE TABLE v3_budget_expenses (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND trim(id) = id),
  public_id ${publicId},
  period_id INTEGER NOT NULL REFERENCES v3_budget_periods(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND ${max}),
  category TEXT NOT NULL CHECK (category IN ('market', 'food', 'transport', 'shopping', 'entertainment', 'other')),
  description TEXT NOT NULL CHECK (length(description) <= 200 AND trim(description) = description),
  occurred_at TEXT NOT NULL CHECK (${instant('occurred_at')}),
  created_at TEXT NOT NULL CHECK ((${instant('created_at')}) AND created_at >= occurred_at),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  CHECK ((status = 'active' AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND (${instant('cancelled_at')}) AND cancelled_at >= created_at))
) STRICT;
CREATE TABLE v3_budget_save_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
  public_id ${publicId},
  book_id INTEGER NOT NULL REFERENCES v3_budget_books(id) ON DELETE RESTRICT,
  period_id INTEGER NOT NULL,
  source_period_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('legacy', 'budget-save', 'expense-add', 'expense-cancel', 'period-open')),
  command_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision BETWEEN 1 AND ${max}),
  FOREIGN KEY (book_id, period_id) REFERENCES v3_budget_periods(book_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, source_period_id) REFERENCES v3_budget_periods(book_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'legacy' AND command_version = 0 AND source_period_id IS NULL) OR
    (kind != 'legacy' AND command_version = 1 AND
     CASE WHEN json_valid(payload) THEN json_type(payload) = 'object' ELSE 0 END AND
     ((kind = 'period-open' AND source_period_id IS NOT NULL AND source_period_id != period_id) OR
      (kind != 'period-open' AND source_period_id IS NULL))))
) STRICT;
`;

export const copyV2Books = `-- v3:books
INSERT INTO v3_budget_books (id, activation_revision)
  SELECT 1, CASE WHEN EXISTS (SELECT 1 FROM budget_periods) THEN 1 ELSE 0 END;`;

// Canonical instant is supplied by the existing domain-backed normalizer, not SQLite's
// more limited offset parser. The original balance_captured_at text stays byte-for-byte.
export const copyV2Period = `INSERT INTO v3_budget_periods (id, book_id, previous_period_id, status, opened_at, created_at,
  revision, currency, time_zone, balance_minor, balance_captured_at, next_payday, savings_minor)
  SELECT id, 1, NULL, 'active', ?, NULL,
    revision, currency, time_zone, balance_minor, balance_captured_at, next_payday, savings_minor FROM budget_periods WHERE id = ?`;

export const copyV2ToV3 = `-- v3:copy
INSERT INTO v3_budget_payments (period_id, id, name, amount_minor, due_on)
  SELECT period_id, id, name, amount_minor, due_on FROM budget_payments;
INSERT INTO v3_budget_expenses (id, period_id, amount_minor, category, description, occurred_at, created_at, status, cancelled_at)
  SELECT id, period_id, amount_minor, category, description, occurred_at, created_at, status, cancelled_at FROM budget_expenses;
INSERT INTO v3_budget_save_operations (operation_id, book_id, period_id, source_period_id, kind, command_version, payload, resulting_revision)
  SELECT operation_id, 1, period_id, NULL, 'legacy', 0, payload, resulting_revision FROM budget_save_operations;
`;

// All old children are removed before the old parent. New FKs reference only the new family.
// Works with foreign_keys ON or OFF; no ineffective PRAGMA toggle inside the transaction.
export const replaceV2Tables = `-- v3:replace
DROP TABLE budget_expenses;
DROP TABLE budget_payments;
DROP TABLE budget_save_operations;
DROP TABLE budget_periods;
ALTER TABLE v3_budget_books RENAME TO budget_books;
ALTER TABLE v3_budget_periods RENAME TO budget_periods;
ALTER TABLE v3_budget_payments RENAME TO budget_payments;
ALTER TABLE v3_budget_expenses RENAME TO budget_expenses;
ALTER TABLE v3_budget_save_operations RENAME TO budget_save_operations;
`;

export const v3Indexes = [
  'budget_one_active_period', 'budget_one_root_period', 'budget_expenses_by_time',
  'budget_operations_by_period', 'budget_operations_by_source', 'budget_payment_sources',
] as const;

// Existence triggers supplement FK enforcement on Expo's separate exclusive connection.
// INSERT collision guards also prevent INSERT OR REPLACE from deleting protected history
// when recursive_triggers is OFF. Repository retries must read receipts, not use REPLACE.
const collisionGuards = [
  ['budget_books', 'id = NEW.id'],
  ['budget_periods', `id = NEW.id OR (book_id = NEW.book_id AND
    ((status = 'active' AND NEW.status = 'active') OR previous_period_id IS NEW.previous_period_id))`],
  ['budget_payments', `(period_id = NEW.period_id AND (id = NEW.id OR
    (NEW.carried_from_period_id IS NOT NULL AND carried_from_period_id = NEW.carried_from_period_id AND
     carried_from_payment_id = NEW.carried_from_payment_id)))`],
  ['budget_expenses', 'id = NEW.id'], ['budget_save_operations', 'operation_id = NEW.operation_id'],
].map(([table, identity]) => `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${identity} OR public_id = NEW.public_id)
BEGIN SELECT RAISE(ABORT, 'identity already exists'); END;`).join('\n');

export const installV3Guards = `-- v3:guards
CREATE UNIQUE INDEX budget_one_active_period ON budget_periods(book_id) WHERE status = 'active';
CREATE UNIQUE INDEX budget_one_root_period ON budget_periods(book_id) WHERE previous_period_id IS NULL;
CREATE INDEX budget_expenses_by_time ON budget_expenses(period_id, occurred_at DESC, created_at DESC, id DESC);
CREATE INDEX budget_operations_by_period ON budget_save_operations(period_id, resulting_revision);
CREATE INDEX budget_operations_by_source ON budget_save_operations(source_period_id);
CREATE INDEX budget_payment_sources ON budget_payments(carried_from_period_id, carried_from_payment_id);
${collisionGuards}
CREATE TRIGGER book_identity BEFORE UPDATE ON budget_books
WHEN NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR NEW.activation_revision < OLD.activation_revision
BEGIN SELECT RAISE(ABORT, 'book identity and revision are protected'); END;
CREATE TRIGGER book_keep_history BEFORE DELETE ON budget_books
BEGIN SELECT RAISE(ABORT, 'keep budget history'); END;
CREATE TRIGGER period_parent_insert BEFORE INSERT ON budget_periods
WHEN NOT EXISTS (SELECT 1 FROM budget_books WHERE id = NEW.book_id) OR
  (NEW.previous_period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM budget_periods p
   WHERE p.id = NEW.previous_period_id AND p.book_id = NEW.book_id AND p.status = 'closed' AND p.closed_at = NEW.opened_at))
BEGIN SELECT RAISE(ABORT, 'invalid period predecessor or book'); END;
CREATE TRIGGER period_protect_update BEFORE UPDATE ON budget_periods
WHEN OLD.status = 'closed' OR NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR NEW.book_id != OLD.book_id OR
  NEW.previous_period_id IS NOT OLD.previous_period_id OR NEW.opened_at != OLD.opened_at OR
  NEW.created_at IS NOT OLD.created_at OR NEW.revision < OLD.revision
BEGIN SELECT RAISE(ABORT, 'period history and identity are protected'); END;
CREATE TRIGGER period_keep_history BEFORE DELETE ON budget_periods
BEGIN SELECT RAISE(ABORT, 'keep budget history'); END;
CREATE TRIGGER period_close_without_rewrite BEFORE UPDATE ON budget_periods
WHEN NEW.status = 'closed' AND (NEW.balance_minor != OLD.balance_minor OR
  NEW.balance_captured_at != OLD.balance_captured_at OR NEW.currency != OLD.currency OR
  NEW.time_zone != OLD.time_zone OR NEW.next_payday != OLD.next_payday OR NEW.savings_minor != OLD.savings_minor OR
  EXISTS (SELECT 1 FROM budget_expenses WHERE period_id = OLD.id AND
    (occurred_at > NEW.closed_at OR created_at > NEW.closed_at OR cancelled_at > NEW.closed_at)))
BEGIN SELECT RAISE(ABORT, 'closing cannot rewrite financial inputs'); END;
CREATE TRIGGER period_lock_opening BEFORE UPDATE ON budget_periods
WHEN EXISTS (SELECT 1 FROM budget_expenses WHERE period_id = OLD.id) AND
  (NEW.balance_minor != OLD.balance_minor OR NEW.balance_captured_at != OLD.balance_captured_at OR
   NEW.currency != OLD.currency OR NEW.time_zone != OLD.time_zone OR NEW.next_payday != OLD.next_payday)
BEGIN SELECT RAISE(ABORT, 'budget opening and period are locked'); END;
CREATE TRIGGER payment_parent_insert BEFORE INSERT ON budget_payments
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id AND status = 'active') OR
  (NEW.carried_from_period_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM budget_payments s JOIN budget_periods p ON p.id = s.period_id
   JOIN budget_periods t ON t.id = NEW.period_id
   WHERE s.period_id = NEW.carried_from_period_id AND s.id = NEW.carried_from_payment_id AND
     p.status = 'closed' AND p.book_id = t.book_id AND t.previous_period_id = p.id))
BEGIN SELECT RAISE(ABORT, 'invalid payment period or source'); END;
CREATE TRIGGER payment_protect_update BEFORE UPDATE ON budget_payments
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = OLD.period_id AND status = 'active') OR
  NEW.period_id != OLD.period_id OR NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR
  NEW.carried_from_period_id IS NOT OLD.carried_from_period_id OR NEW.carried_from_payment_id IS NOT OLD.carried_from_payment_id
BEGIN SELECT RAISE(ABORT, 'payment history and identity are protected'); END;
CREATE TRIGGER payment_protect_delete BEFORE DELETE ON budget_payments
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = OLD.period_id AND status = 'active') OR
  EXISTS (SELECT 1 FROM budget_payments WHERE carried_from_period_id = OLD.period_id AND carried_from_payment_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'closed or carried payment cannot be deleted'); END;
CREATE TRIGGER expense_parent_insert BEFORE INSERT ON budget_expenses
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id AND status = 'active' AND NEW.occurred_at > opened_at)
BEGIN SELECT RAISE(ABORT, 'expense must belong to an active period after its opening'); END;
CREATE TRIGGER expense_protect_update BEFORE UPDATE ON budget_expenses
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = OLD.period_id AND status = 'active') OR
  NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR NEW.period_id != OLD.period_id OR NEW.amount_minor != OLD.amount_minor OR
  NEW.category != OLD.category OR NEW.description != OLD.description OR NEW.occurred_at != OLD.occurred_at OR NEW.created_at != OLD.created_at OR
  OLD.status != 'active' OR NEW.status != 'cancelled' OR NEW.cancelled_at IS NULL
BEGIN SELECT RAISE(ABORT, 'expense may only be cancelled once in an active period'); END;
CREATE TRIGGER expense_keep_history BEFORE DELETE ON budget_expenses
BEGIN SELECT RAISE(ABORT, 'cancel expenses instead of deleting'); END;
CREATE TRIGGER operation_parent_insert BEFORE INSERT ON budget_save_operations
WHEN NEW.kind = 'legacy' OR
  NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id AND book_id = NEW.book_id AND status = 'active' AND revision >= NEW.resulting_revision) OR
  (NEW.source_period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM budget_periods s JOIN budget_periods t ON t.id = NEW.period_id
   WHERE s.id = NEW.source_period_id AND s.book_id = NEW.book_id AND s.status = 'closed' AND t.previous_period_id = s.id))
BEGIN SELECT RAISE(ABORT, 'invalid operation target or source'); END;
CREATE TRIGGER operation_immutable BEFORE UPDATE ON budget_save_operations
BEGIN SELECT RAISE(ABORT, 'operation receipts are immutable'); END;
CREATE TRIGGER operation_keep_history BEFORE DELETE ON budget_save_operations
BEGIN SELECT RAISE(ABORT, 'keep operation receipts'); END;
`;

export const v3Triggers = [
  ...['budget_books', 'budget_periods', 'budget_payments', 'budget_expenses', 'budget_save_operations'].map(table => `${table}_no_replace`),
  'book_identity', 'book_keep_history', 'period_parent_insert', 'period_protect_update', 'period_keep_history', 'period_close_without_rewrite',
  'period_lock_opening', 'payment_parent_insert', 'payment_protect_update', 'payment_protect_delete',
  'expense_parent_insert', 'expense_protect_update', 'expense_keep_history', 'operation_parent_insert',
  'operation_immutable', 'operation_keep_history',
] as const;
