
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
