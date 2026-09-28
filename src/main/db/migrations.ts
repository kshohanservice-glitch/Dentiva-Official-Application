export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Versioned schema migrations. Startup verifies schema compatibility —
 * never silently altering production schema.
 *
 * Migration rules for this product: additive only for a released schema;
 * every schema change must be represented as a new migration entry.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: '001_init',
    sql: String.raw`
CREATE TABLE IF NOT EXISTS app_settings (
  group_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (group_name, key)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  activated INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  payload TEXT
);
INSERT OR IGNORE INTO activation_state (id, activated) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS dentists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  photo_path TEXT,
  designations_json TEXT NOT NULL DEFAULT '[]',
  qualifications TEXT,
  license_no TEXT,
  phone TEXT,
  email TEXT,
  signature_path TEXT,
  availability_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  working_hours TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_params TEXT NOT NULL,
  display_name TEXT,
  photo_path TEXT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  preferred_name TEXT,
  dob TEXT,
  age INTEGER,
  gender TEXT,
  blood_group TEXT,
  phone TEXT,
  emergency_phone TEXT,
  email TEXT,
  address TEXT,
  occupation TEXT,
  source TEXT,
  chief_complaint TEXT,
  previous_problems TEXT,
  medical_history TEXT,
  dental_history TEXT,
  allergies TEXT,
  current_medication TEXT,
  notes TEXT,
  emergency_notes TEXT,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_registered ON patients(registered_at);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);

CREATE TABLE IF NOT EXISTS patient_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_patient_notes_patient ON patient_notes(patient_id, created_at);

CREATE TABLE IF NOT EXISTS patient_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_patient ON patient_attachments(patient_id);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  referring_name TEXT,
  referred_to TEXT,
  specialty TEXT,
  organization TEXT,
  reason TEXT,
  referral_date TEXT NOT NULL,
  notes TEXT,
  follow_up TEXT,
  status TEXT NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','followed_up','closed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals(patient_id);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_no INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  visit_at TEXT NOT NULL,
  chief_complaint TEXT,
  history TEXT,
  examination TEXT,
  diagnosis TEXT,
  findings TEXT,
  treatment_notes TEXT,
  advice TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_at);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_at);
CREATE INDEX IF NOT EXISTS idx_visits_dentist ON visits(dentist_id, visit_at);

CREATE TABLE IF NOT EXISTS chart_conditions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  category TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dental_charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentition TEXT NOT NULL DEFAULT 'adult' CHECK (dentition IN ('adult','pediatric')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_charts_patient ON dental_charts(patient_id, created_at);

CREATE TABLE IF NOT EXISTS dental_chart_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chart_id INTEGER NOT NULL REFERENCES dental_charts(id) ON DELETE CASCADE,
  tooth_id TEXT NOT NULL,
  condition_code TEXT NOT NULL REFERENCES chart_conditions(code),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_chart_entries_chart ON dental_chart_entries(chart_id);

CREATE TABLE IF NOT EXISTS treatment_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT,
  default_fee REAL NOT NULL DEFAULT 0,
  duration_min INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_treatments_name ON treatment_catalog(name);

CREATE TABLE IF NOT EXISTS treatment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  treatment_id INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
  tooth_ids_json TEXT NOT NULL DEFAULT '[]',
  fee REAL NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_treatment_records_patient ON treatment_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_records_visit ON treatment_records(visit_id);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  generic_name TEXT,
  form TEXT,
  strength TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  prescribed_at TEXT NOT NULL,
  chief_complaint TEXT,
  on_examination TEXT,
  examination_result TEXT,
  advice TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id, prescribed_at);
CREATE INDEX IF NOT EXISTS idx_prescriptions_date ON prescriptions(prescribed_at);

CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT,
  form TEXT,
  dose TEXT,
  quantity TEXT,
  frequency TEXT,
  morning INTEGER NOT NULL DEFAULT 0,
  noon INTEGER NOT NULL DEFAULT 0,
  night INTEGER NOT NULL DEFAULT 0,
  meal TEXT CHECK (meal IS NULL OR meal IN ('before','after','any')),
  duration TEXT,
  instruction TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prescription_items_rx ON prescription_items(prescription_id, sort);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  reason TEXT,
  treatment_id INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled'
    CHECK (status IN ('Scheduled','Confirmed','Checked In','In Progress','Completed','Cancelled','No Show','Rescheduled')),
  notes TEXT,
  reminder_min INTEGER,
  rescheduled_from INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_dentist_start ON appointments(dentist_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status, start_at);

CREATE TABLE IF NOT EXISTS queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_date TEXT NOT NULL,
  number INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','in_consultation','completed','skipped','cancelled')),
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  called_at TEXT,
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (queue_date, number)
);
CREATE INDEX IF NOT EXISTS idx_queue_date ON queue_entries(queue_date, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_active_patient
  ON queue_entries(queue_date, patient_id)
  WHERE status IN ('waiting','called','in_consultation');

CREATE TABLE IF NOT EXISTS payment_methods (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  scope TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(issued_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  treatment_id INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
  treatment_record_id INTEGER REFERENCES treatment_records(id) ON DELETE SET NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, sort);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL,
  method_code TEXT NOT NULL REFERENCES payment_methods(code),
  reference TEXT,
  notes TEXT,
  received_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  reversal_of INTEGER REFERENCES payments(id) ON DELETE RESTRICT,
  reversed_by INTEGER REFERENCES payments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_at);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  unit TEXT NOT NULL DEFAULT 'pcs',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price REAL NOT NULL DEFAULT 0,
  use_price REAL NOT NULL DEFAULT 0,
  opening_stock REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  location TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory_items(name);
CREATE INDEX IF NOT EXISTS idx_inventory_stock ON inventory_items(current_stock, min_stock);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_no TEXT,
  expiry_date TEXT,
  qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  received_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_batches_item ON inventory_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','damaged','expired','returned')),
  qty REAL NOT NULL,
  stock_after REAL NOT NULL,
  unit_cost REAL,
  reference TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_tx_date ON inventory_transactions(created_at);

CREATE TABLE IF NOT EXISTS accounting_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, name)
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  category_id INTEGER NOT NULL REFERENCES accounting_categories(id),
  amount REAL NOT NULL CHECK (amount > 0),
  method_code TEXT NOT NULL DEFAULT 'cash' REFERENCES payment_methods(code),
  paid_at TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  reversal_of INTEGER REFERENCES financial_transactions(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON financial_transactions(paid_at);
CREATE INDEX IF NOT EXISTS idx_ledger_kind ON financial_transactions(kind, paid_at);
CREATE INDEX IF NOT EXISTS idx_ledger_category ON financial_transactions(category_id);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  dob TEXT,
  gender TEXT,
  address TEXT,
  phone TEXT,
  emergency_phone TEXT,
  blood_group TEXT,
  id_no TEXT,
  designation TEXT,
  department TEXT,
  joining_date TEXT,
  salary REAL,
  payment_info TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  photo_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS backup_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  prev_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, ts);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  route TEXT,
  entity TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  read_at TEXT,
  dismissed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, dismissed_at);

CREATE TABLE IF NOT EXISTS printer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  printer_name TEXT,
  paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4','A5','80mm','58mm','custom')),
  width_mm REAL NOT NULL DEFAULT 210,
  height_mm REAL NOT NULL DEFAULT 297,
  margin_top REAL NOT NULL DEFAULT 8,
  margin_right REAL NOT NULL DEFAULT 8,
  margin_bottom REAL NOT NULL DEFAULT 8,
  margin_left REAL NOT NULL DEFAULT 8,
  orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
  scale REAL NOT NULL DEFAULT 100,
  copies INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`,
  },
];
