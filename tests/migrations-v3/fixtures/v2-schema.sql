
CREATE TABLE budget_periods (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (currency = 'TRY'),
  time_zone TEXT NOT NULL CHECK (length(trim(time_zone)) > 0),
  balance_minor INTEGER NOT NULL CHECK (balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
  balance_captured_at TEXT NOT NULL,
  next_payday TEXT NOT NULL CHECK (length(next_payday) = 10),
  savings_minor INTEGER NOT NULL CHECK (savings_minor BETWEEN 0 AND 9007199254740991)
) STRICT;
CREATE TABLE budget_payments (
  period_id INTEGER NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE CHECK (period_id = 1),
  id TEXT NOT NULL CHECK (length(trim(id)) > 0 AND trim(id) = id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  due_on TEXT NOT NULL CHECK (length(due_on) = 10),
  PRIMARY KEY (period_id, id)
) STRICT;
CREATE TABLE budget_save_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
  period_id INTEGER NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE CHECK (period_id = 1),
  payload TEXT NOT NULL,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision BETWEEN 1 AND 9007199254740991)
) STRICT;
-- Expo exclusive transactions use a fresh connection. Foreign-key PRAGMA is connection-local.
-- These triggers additionally enforce relations even on that connection with FK disabled.
CREATE TRIGGER payment_parent_insert BEFORE INSERT ON budget_payments
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'missing budget period'); END;
CREATE TRIGGER payment_parent_update BEFORE UPDATE OF period_id ON budget_payments
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'missing budget period'); END;
CREATE TRIGGER operation_parent_insert BEFORE INSERT ON budget_save_operations
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'missing budget period'); END;
CREATE TRIGGER operation_parent_update BEFORE UPDATE OF period_id ON budget_save_operations
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'missing budget period'); END;
CREATE TRIGGER period_delete_children AFTER DELETE ON budget_periods
BEGIN
  DELETE FROM budget_payments WHERE period_id = OLD.id;
  DELETE FROM budget_save_operations WHERE period_id = OLD.id;
END;


CREATE TABLE budget_expenses (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND trim(id) = id),
  period_id INTEGER NOT NULL REFERENCES budget_periods(id) ON DELETE RESTRICT CHECK (period_id = 1),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  category TEXT NOT NULL CHECK (category IN ('market', 'food', 'transport', 'shopping', 'entertainment', 'other')),
  description TEXT NOT NULL CHECK (length(description) <= 200 AND trim(description) = description),
  occurred_at TEXT NOT NULL CHECK (length(occurred_at) = 24 AND substr(occurred_at, 24) = 'Z'),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND substr(created_at, 24) = 'Z' AND created_at >= occurred_at),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  CHECK ((status = 'active' AND cancelled_at IS NULL) OR
         (status = 'cancelled' AND cancelled_at IS NOT NULL AND length(cancelled_at) = 24 AND
          substr(cancelled_at, 24) = 'Z' AND cancelled_at >= created_at))
) STRICT;
CREATE INDEX budget_expenses_by_time ON budget_expenses (period_id, occurred_at DESC, created_at DESC, id DESC);
CREATE TRIGGER expense_parent_insert BEFORE INSERT ON budget_expenses
WHEN NOT EXISTS (SELECT 1 FROM budget_periods WHERE id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'missing budget period'); END;
CREATE TRIGGER expense_immutable BEFORE UPDATE ON budget_expenses
WHEN NEW.id != OLD.id OR NEW.period_id != OLD.period_id OR NEW.amount_minor != OLD.amount_minor OR
     NEW.category != OLD.category OR NEW.description != OLD.description OR
     NEW.occurred_at != OLD.occurred_at OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT, 'expense data is immutable'); END;
CREATE TRIGGER expense_cancel_once BEFORE UPDATE OF status, cancelled_at ON budget_expenses
WHEN OLD.status != 'active' OR NEW.status != 'cancelled' OR NEW.cancelled_at IS NULL
BEGIN SELECT RAISE(ABORT, 'expense can only be cancelled once'); END;
CREATE TRIGGER expense_keep_history BEFORE DELETE ON budget_expenses
BEGIN SELECT RAISE(ABORT, 'cancel expenses instead of deleting'); END;
CREATE TRIGGER period_keep_expenses BEFORE DELETE ON budget_periods
WHEN EXISTS (SELECT 1 FROM budget_expenses WHERE period_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'budget has expense history'); END;
CREATE TRIGGER period_lock_opening BEFORE UPDATE OF balance_minor, balance_captured_at, currency, time_zone, next_payday ON budget_periods
WHEN EXISTS (SELECT 1 FROM budget_expenses WHERE period_id = OLD.id) AND
     (NEW.balance_minor != OLD.balance_minor OR NEW.balance_captured_at != OLD.balance_captured_at OR
      NEW.currency != OLD.currency OR NEW.time_zone != OLD.time_zone OR NEW.next_payday != OLD.next_payday)
BEGIN SELECT RAISE(ABORT, 'budget opening and period are locked'); END;
