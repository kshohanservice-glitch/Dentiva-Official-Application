/**
 * Dentiva Pro IPC contract — the complete, typed surface exposed by the main
 * process to the renderer through a narrow preload bridge.
 *
 * Every method name listed here is allow-listed in both preload and main.
 * Inputs are validated with zod inside the service layer; permissions are
 * checked before any data query executes.
 */
import type { Permission } from './permissions';

/* ---------------------------------- generic ---------------------------------- */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type DateRangeFilter = 'today' | 'd7' | 'd30' | 'd90' | 'd365' | 'all' | 'custom';

export interface DateRange {
  range: DateRangeFilter;
  from?: string;
  to?: string;
}

export interface Ok {
  ok: true;
}

export type AppPhase = 'activate' | 'setup' | 'login' | 'locked' | 'ready';

export interface AppError {
  code: string;
  message: string;
  details?: unknown;
}

/* ---------------------------------- identities ---------------------------------- */

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  photoPath: string | null;
  roleId: number;
  roleName: string;
  permissions: Permission[];
  dentistId: number | null;
}

export interface AppState {
  phase: AppPhase;
  appVersion: string;
  schemaVersion: number;
  buildNumber: string;
  activated: boolean;
  setupComplete: boolean;
  setupStep: number;
  clinicName: string | null;
  user: SessionUser | null;
  now: string;
  /**
   * Format preferences derived from the canonical settings (clinic.moneyDecimals,
   * clinic.use24HourTime, general.dateFormat) — applied by the renderer on every
   * state load so every money/date render honors the user's configuration (FD-007).
   */
  formatPrefs: {
    moneyDecimals: number;
    use24HourTime: boolean;
    dateFormat: 'short' | 'long';
  };
}

/* ---------------------------------- activation ---------------------------------- */

export interface ActivationInput {
  code: string;
}

export interface ActivationResult {
  ok: boolean;
  reason?: 'invalid' | 'format';
}

/* ---------------------------------- setup wizard ---------------------------------- */

export interface ClinicInput {
  name: string;
  logoPath?: string | null;
  logoData?: string | null; // base64 png/jpg ≤ 2MB, stored by main
  address?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  website?: string;
  openingHours?: string;
  closingDays?: number[]; // 0=Sunday..6=Saturday
  emergencyContact?: string;
  footerMessage?: string;
  prescriptionMessage?: string;
  timezone?: string;
  use24HourTime?: boolean;
  moneyDecimals?: number;
}

export interface DentistInput {
  id?: number;
  dentistCode?: string;
  fullName: string;
  photoData?: string | null;
  designations: string[];
  qualifications?: string;
  licenseNo?: string;
  phone?: string;
  email?: string;
  signatureData?: string | null;
  availability?: number[]; // weekday indexes
  workingHours?: string;
  active?: boolean;
}

export interface DentistDto {
  id: number;
  dentistCode: string;
  fullName: string;
  photoPath: string | null;
  designations: string[];
  qualifications: string | null;
  licenseNo: string | null;
  phone: string | null;
  email: string | null;
  signaturePath: string | null;
  availability: number[];
  workingHours: string | null;
  active: boolean;
  createdAt: string;
}

export interface AdminAccountInput {
  username: string;
  password: string;
  displayName?: string;
}

export interface SetupProgress {
  step: number; // 0=clinic 1=dentists 2=admin 3=preferences 4=complete
  clinicSaved: boolean;
  dentistsSaved: boolean;
  adminSaved: boolean;
  preferencesSaved: boolean;
}

export interface SetupSaveResult {
  ok: true;
  step: number;
}

/* ---------------------------------- auth ---------------------------------- */

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResult {
  ok: boolean;
  reason?: 'invalid_credentials' | 'locked' | 'inactive' | 'rate_limited';
  retryAfterSec?: number;
  user?: SessionUser;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/* ---------------------------------- settings ---------------------------------- */

export interface SettingsPayload {
  [group: string]: Record<string, unknown>;
}

export interface PrinterProfileDto {
  id: number;
  name: string;
  printerName: string | null;
  paperSize: 'A4' | 'A5' | '80mm' | '58mm' | 'custom';
  widthMm: number;
  heightMm: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  orientation: 'portrait' | 'landscape';
  scale: number;
  copies: number;
  isDefault: boolean;
}

export interface PrinterProfileInput {
  id?: number;
  name: string;
  printerName?: string | null;
  paperSize: PrinterProfileDto['paperSize'];
  widthMm?: number;
  heightMm?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  orientation?: 'portrait' | 'landscape';
  scale?: number;
  copies?: number;
  isDefault?: boolean;
}

export interface SystemPrinterDto {
  name: string;
  isDefault: boolean;
}

/* ---------------------------------- patients ---------------------------------- */

export interface PatientListQuery {
  q?: string;
  range?: DateRangeFilter;
  from?: string;
  to?: string;
  status?: 'active' | 'archived' | 'all';
  dentistId?: number;
  treatmentId?: number;
  hasBalance?: boolean;
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'last_visit';
  page?: number;
  pageSize?: number;
}

export interface PatientListItem {
  id: number;
  patientCode: string;
  fullName: string;
  phone: string | null;
  gender: string | null;
  age: number | null;
  dob: string | null;
  address: string | null;
  registeredAt: string;
  lastVisitAt: string | null;
  visitCount: number;
  outstanding: number;
  status: 'active' | 'archived';
  allergies: string | null;
}

export interface PatientInput {
  id?: number;
  fullName: string;
  preferredName?: string;
  dob?: string | null;
  age?: number | null;
  gender?: string | null;
  bloodGroup?: string | null;
  phone?: string;
  emergencyPhone?: string;
  email?: string;
  address?: string;
  occupation?: string;
  source?: string;
  chiefComplaint?: string;
  previousProblems?: string;
  medicalHistory?: string;
  dentalHistory?: string;
  allergies?: string;
  currentMedication?: string;
  notes?: string;
  emergencyNotes?: string;
  status?: 'active' | 'archived';
  photoData?: string | null;
}

export interface PatientProfile {
  patient: PatientListItem & { fullName: string } & Omit<PatientInput, keyof PatientListItem> & {
      createdAt: string;
      createdBy: number | null;
      updatedAt: string;
    };
  alerts: { allergies: string | null; medicalHistory: string | null; emergencyNotes: string | null; notes: string | null };
  clinical: {
    totalVisits: number;
    lastVisitAt: string | null;
    nextAppointment: AppointmentDto | null;
    activeTreatments: number;
    totalPrescriptions: number;
    totalInvoices: number;
  };
  financial: {
    permitted: boolean;
    totalBilled: number;
    totalPaid: number;
    outstanding: number;
  };
  appointmentStats: { upcoming: number; completed: number; cancelled: number; noShow: number };
  attachments: AttachmentDto[];
  referrals: ReferralDto[];
  notes: PatientNoteDto[];
}

export interface TimelineEntry {
  id: string;
  at: string;
  kind:
    | 'registration'
    | 'visit'
    | 'prescription'
    | 'appointment'
    | 'invoice'
    | 'payment'
    | 'note'
    | 'attachment'
    | 'referral'
    | 'chart';
  title: string;
  detail: string | null;
  actor: string | null;
  route?: string;
}

export interface PatientNoteInput {
  patientId: number;
  body: string;
}

export interface PatientNoteDto {
  id: number;
  body: string;
  author: string | null;
  createdAt: string;
}

/* ---------------------------------- attachments ---------------------------------- */

export interface AttachmentDto {
  id: number;
  patientId: number;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  uploadedBy: string | null;
}

export interface AttachmentAddInput {
  patientId: number;
  filename: string;
  dataBase64: string;
}

/* ---------------------------------- visits ---------------------------------- */

export interface VisitInput {
  id?: number;
  patientId: number;
  dentistId?: number | null;
  visitAt?: string;
  chiefComplaint?: string;
  history?: string;
  examination?: string;
  diagnosis?: string;
  findings?: string;
  treatmentNotes?: string;
  advice?: string;
  notes?: string;
  status?: 'open' | 'closed';
}

export interface VisitDto {
  id: number;
  visitNo: number;
  patientId: number;
  patientName?: string;
  patientCode?: string;
  dentistId: number | null;
  dentistName: string | null;
  visitAt: string;
  chiefComplaint: string | null;
  history: string | null;
  examination: string | null;
  diagnosis: string | null;
  findings: string | null;
  treatmentNotes: string | null;
  advice: string | null;
  notes: string | null;
  status: 'open' | 'closed';
  treatmentCount: number;
  prescriptionCount: number;
  createdAt: string;
}

/* ---------------------------------- dental chart ---------------------------------- */

export interface ChartEntryInput {
  toothId: string; // e.g. "16" (FDI) or "51" primary
  conditionCode: string;
  notes?: string;
}

export interface ChartConditionDto {
  code: string;
  label: string;
  color: string;
  category: string;
  sort: number;
}

export interface DentalChartDto {
  id: number;
  patientId: number;
  visitId: number | null;
  dentition: 'adult' | 'pediatric';
  entries: ChartEntryInput[];
  createdAt: string;
  updatedAt: string;
}

export interface ChartSaveInput {
  patientId: number;
  visitId?: number | null;
  dentition: 'adult' | 'pediatric';
  entries: ChartEntryInput[];
}

/* ---------------------------------- treatments ---------------------------------- */

export interface TreatmentDto {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string | null;
  defaultFee: number;
  durationMin: number | null;
  active: boolean;
}

export interface TreatmentInput {
  id?: number;
  code: string;
  name: string;
  category: string;
  description?: string;
  defaultFee: number;
  durationMin?: number | null;
  active?: boolean;
}

export interface TreatmentRecordInput {
  patientId: number;
  visitId?: number | null;
  treatmentId?: number | null;
  toothIds?: string[];
  fee: number;
  notes?: string;
}

export interface TreatmentRecordDto {
  id: number;
  patientId: number;
  visitId: number | null;
  treatmentId: number | null;
  treatmentName: string;
  toothIds: string[];
  fee: number;
  notes: string | null;
  status: 'planned' | 'done';
  invoiced: boolean;
  createdAt: string;
}

/* ---------------------------------- prescriptions ---------------------------------- */

export interface PrescriptionItemInput {
  id?: number;
  medicineName: string;
  genericName?: string;
  strength?: string;
  form?: string;
  dose?: string;
  quantity?: string;
  frequency?: string;
  morning?: boolean;
  noon?: boolean;
  night?: boolean;
  meal?: 'before' | 'after' | 'any' | null;
  duration?: string;
  instruction?: string;
}

export interface PrescriptionInput {
  id?: number;
  patientId: number;
  visitId?: number | null;
  dentistId?: number | null;
  prescribedAt?: string;
  chiefComplaint?: string;
  onExamination?: string;
  examinationResult?: string;
  advice?: string;
  items: PrescriptionItemInput[];
}

export interface PrescriptionDto extends PrescriptionInput {
  id: number;
  code: string;
  dentistName: string;
  patientName: string;
  patientCode: string;
  gender: string | null;
  age: number | null;
  createdAt: string;
  items: (PrescriptionItemInput & { id: number })[];
}

export interface MedicationDto {
  id: number;
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  active: boolean;
}

export interface MedicationInput {
  id?: number;
  name: string;
  genericName?: string;
  form?: string;
  strength?: string;
  active?: boolean;
}

/* ---------------------------------- appointments ---------------------------------- */

export type AppointmentStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Checked In'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'No Show'
  | 'Rescheduled';

export interface AppointmentInput {
  id?: number;
  patientId: number;
  dentistId: number;
  startAt: string;
  durationMin: number;
  reason?: string;
  treatmentId?: number | null;
  status?: AppointmentStatus;
  notes?: string;
  reminderMin?: number | null;
}

export interface AppointmentDto {
  id: number;
  patientId: number;
  patientName: string;
  patientCode: string;
  dentistId: number;
  dentistName: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  reason: string | null;
  treatmentId: number | null;
  treatmentName: string | null;
  status: AppointmentStatus;
  notes: string | null;
  reminderMin: number | null;
  createdBy: number;
  createdAt: string;
}

export interface AppointmentConflict {
  id: number;
  patientName: string;
  dentistName: string;
  startAt: string;
  endAt: string;
}

export interface AppointmentSaveResult {
  ok: boolean;
  conflict?: AppointmentConflict;
  appointment?: AppointmentDto;
}

/* ---------------------------------- queue ---------------------------------- */

export type QueueStatus = 'waiting' | 'called' | 'in_consultation' | 'completed' | 'skipped' | 'cancelled';

export interface QueueEntryDto {
  id: number;
  number: number;
  queueDate: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  dentistId: number | null;
  dentistName: string | null;
  appointmentId: number | null;
  priority: number;
  status: QueueStatus;
  checkedInAt: string;
  calledAt: string | null;
  completedAt: string | null;
}

export interface QueueCheckInInput {
  patientId: number;
  dentistId?: number | null;
  appointmentId?: number | null;
  priority?: number;
}

/* ---------------------------------- invoices ---------------------------------- */

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

export interface InvoiceItemInput {
  id?: number;
  description: string;
  treatmentId?: number | null;
  treatmentRecordId?: number | null;
  qty: number;
  unitPrice: number;
  discount?: number;
}

export interface InvoiceInput {
  id?: number;
  patientId: number;
  issuedAt?: string;
  items: InvoiceItemInput[];
  discountAmount?: number;
  taxAmount?: number;
  notes?: string;
}

export interface InvoiceLine {
  id?: number;
  description: string;
  treatmentId: number | null;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface InvoiceDto {
  id: number;
  invoiceNo: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  issuedAt: string;
  items: InvoiceLine[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paidTotal: number;
  balance: number;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: string;
  createdBy: number | null;
  payments: PaymentDto[];
}

export interface InvoiceListQuery {
  q?: string;
  status?: InvoiceStatus | 'all';
  range?: DateRangeFilter;
  from?: string;
  to?: string;
  patientId?: number;
  page?: number;
  pageSize?: number;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'balance_desc';
}

/* ---------------------------------- payments ---------------------------------- */

export type PaymentMethodCode =
  | 'cash'
  | 'bank'
  | 'card'
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'upay'
  | 'wallet'
  | 'other';

export interface PaymentInput {
  patientId: number;
  invoiceId?: number | null;
  amount: number;
  methodCode: PaymentMethodCode;
  paidAt?: string;
  reference?: string;
  notes?: string;
}

export interface PaymentDto {
  id: number;
  paymentNo: string;
  patientId: number;
  patientName: string;
  invoiceId: number | null;
  invoiceNo: string | null;
  amount: number;
  paidAt: string;
  methodCode: PaymentMethodCode;
  methodLabel: string;
  reference: string | null;
  notes: string | null;
  receivedBy: number | null;
  receivedByName: string | null;
  status: 'posted' | 'reversed';
  reversalOf: number | null;
  createdAt: string;
}

export interface PaymentListQuery {
  q?: string;
  range?: DateRangeFilter;
  from?: string;
  to?: string;
  methodCode?: PaymentMethodCode | 'all';
  patientId?: number;
  status?: 'posted' | 'all';
  page?: number;
  pageSize?: number;
}

export interface PaymentsDashboard {
  permitted: boolean;
  period: string;
  totalCollected: number;
  byMethod: { code: string; label: string; total: number; count: number }[];
  outstanding: number;
  paymentCount: number;
}

/* ---------------------------------- inventory ---------------------------------- */

export interface InventoryItemDto {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  supplierId: number | null;
  supplierName: string | null;
  purchasePrice: number;
  usePrice: number;
  openingStock: number;
  currentStock: number;
  minStock: number;
  location: string | null;
  notes: string | null;
  active: boolean;
  expirySoon: boolean;
  nearestExpiry: string | null;
}

export interface InventoryItemInput {
  id?: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  supplierId?: number | null;
  purchasePrice?: number;
  usePrice?: number;
  openingStock?: number;
  minStock?: number;
  location?: string;
  notes?: string;
  active?: boolean;
}

export interface StockMoveInput {
  itemId: number;
  type: 'in' | 'out' | 'adjust' | 'damaged' | 'expired' | 'returned';
  qty: number;
  batchNo?: string;
  expiryDate?: string | null;
  unitCost?: number;
  note?: string;
  reference?: string;
}

export interface InventoryBatchDto {
  id: number;
  itemId: number;
  batchNo: string | null;
  expiryDate: string | null;
  qty: number;
  unitCost: number | null;
  receivedAt: string;
}

export interface InventoryAlerts {
  lowStock: InventoryItemDto[];
  outOfStock: InventoryItemDto[];
  expiringSoon: InventoryItemDto[];
  expired: InventoryBatchDto[] & { itemName?: string }[];
}

export interface SupplierInput {
  id?: number;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface SupplierDto {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  purchaseCount: number;
  totalPurchase: number;
  createdAt: string;
}

/* ---------------------------------- accounting ---------------------------------- */

export interface AccountingCategoryDto {
  id: number;
  kind: 'income' | 'expense';
  name: string;
  active: boolean;
}

export interface LedgerEntryInput {
  kind: 'income' | 'expense';
  categoryId: number;
  amount: number;
  methodCode?: PaymentMethodCode;
  paidAt: string;
  reference?: string;
  notes?: string;
  patientId?: number | null;
  invoiceId?: number | null;
}

export interface LedgerEntryDto {
  id: number;
  kind: 'income' | 'expense';
  categoryId: number;
  categoryName: string;
  amount: number;
  methodCode: string;
  methodLabel: string;
  paidAt: string;
  reference: string | null;
  notes: string | null;
  patientId: number | null;
  invoiceId: number | null;
  status: 'posted' | 'reversed';
  createdBy: number | null;
  createdAt: string;
}

/* ---------------------------------- reports ---------------------------------- */

export interface FinancialSummaryReport {
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  collected: number;
  outstanding: number;
  byCategory: { name: string; kind: string; total: number }[];
}

export interface TreatmentRevenueRow {
  treatment: string;
  count: number;
  revenue: number;
}

export interface DentistRevenueRow {
  dentist: string;
  visits: number;
  revenue: number;
}

export interface PatientBalanceRow {
  patientId: number;
  patientCode: string;
  patientName: string;
  billed: number;
  paid: number;
  balance: number;
}

/* ---------------------------------- staff ---------------------------------- */

export interface StaffInput {
  id?: number;
  fullName: string;
  dob?: string | null;
  gender?: string | null;
  address?: string;
  phone?: string;
  emergencyPhone?: string;
  bloodGroup?: string | null;
  idNo?: string;
  designation?: string;
  department?: string;
  joiningDate?: string | null;
  salary?: number | null;
  paymentInfo?: string;
  notes?: string;
  active?: boolean;
  photoData?: string | null;
}

export interface StaffDto {
  id: number;
  staffCode: string;
  fullName: string;
  dob: string | null;
  gender: string | null;
  address: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  bloodGroup: string | null;
  idNo: string | null;
  designation: string | null;
  department: string | null;
  joiningDate: string | null;
  salary: number | null;
  paymentInfo: string | null;
  notes: string | null;
  active: boolean;
  photoPath: string | null;
  createdAt: string;
}

/* ---------------------------------- users & roles ---------------------------------- */

export interface UserInput {
  id?: number;
  username: string;
  password?: string;
  displayName?: string;
  roleId: number;
  dentistId?: number | null;
  active?: boolean;
}

export interface UserDto {
  id: number;
  username: string;
  displayName: string | null;
  roleId: number;
  roleName: string;
  dentistId: number | null;
  active: boolean;
  photoPath: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleDto {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface RoleInput {
  id?: number;
  name: string;
  description?: string;
  permissions: Permission[];
}

/* ---------------------------------- referrals ---------------------------------- */

export interface ReferralInput {
  patientId: number;
  referringName?: string;
  referredTo?: string;
  specialty?: string;
  organization?: string;
  reason?: string;
  referralDate?: string;
  notes?: string;
  followUp?: string | null;
  status?: 'referred' | 'followed_up' | 'closed';
}

export interface ReferralDto {
  id: number;
  patientId: number;
  referringName: string | null;
  referredTo: string | null;
  specialty: string | null;
  organization: string | null;
  reason: string | null;
  referralDate: string;
  notes: string | null;
  followUp: string | null;
  status: 'referred' | 'followed_up' | 'closed';
  createdAt: string;
}

/* ---------------------------------- backup / restore ---------------------------------- */

export interface BackupRecordDto {
  id: number;
  filename: string;
  path: string;
  createdAt: string;
  size: number;
  sha256: string | null;
  status: 'ok' | 'failed';
  schemaVersion: number;
  appVersion: string;
  note: string | null;
}

export interface BackupManifest {
  format: 'dentiva-backup';
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  clinicName: string | null;
  counts: Record<string, number>;
  files: { name: string; sha256: string; size: number }[];
}

export interface RestorePreview {
  manifest: BackupManifest;
  valid: boolean;
  reason?: string;
}

export interface RestoreResult {
  ok: boolean;
  safetyBackupPath?: string;
  reason?: string;
}

/* ---------------------------------- audit ---------------------------------- */

export interface AuditEntryDto {
  id: number;
  ts: string;
  userId: number | null;
  username: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  result: 'success' | 'failure';
  beforeState: unknown;
  afterState: unknown;
  metadata: unknown;
}

export interface AuditQuery {
  action?: string;
  entity?: string;
  userId?: number;
  result?: 'success' | 'failure';
  q?: string;
  range?: DateRangeFilter;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/* ---------------------------------- notifications ---------------------------------- */

export interface NotificationDto {
  id: number;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  route: string | null;
  createdAt: string;
  readAt: string | null;
}

/* ---------------------------------- dashboard ---------------------------------- */

export interface DashboardData {
  period: string;
  todayPatients: number;
  todayAppointments: number;
  waitingQueue: number;
  completedVisits: number;
  upcomingAppointments: AppointmentDto[];
  recentPatients: PatientListItem[];
  lowStockCount: number;
  expiringCount: number;
  unreadNotifications: number;
  financial: null | {
    todayRevenue: number;
    outstanding: number;
    todayPayments: number;
    recentPayments: { id: number; patientName: string; amount: number; paidAt: string; methodLabel: string }[];
  };
}

/* ---------------------------------- global search ---------------------------------- */

export interface GlobalSearchResult {
  category: 'patients' | 'invoices' | 'appointments' | 'prescriptions' | 'treatments' | 'inventory' | 'staff' | 'payments';
  id: number;
  title: string;
  subtitle: string | null;
  route: string;
}

/* ---------------------------------- print ---------------------------------- */

export type PrintTemplateId =
  | 'prescription'
  | 'invoice'
  | 'patientSummary'
  | 'chart'
  | 'appointmentSummary'
  | 'financialReport'
  | 'inventoryReport';

export interface PrintPreviewInput {
  template: PrintTemplateId;
  entityId: number;
  profileId?: number | null;
  range?: { from: string; to: string };
}

export interface PrintPreviewPayload {
  html: string;
  widthMm: number;
  heightMm: number;
  paperSize: string;
}

export interface PrintRunInput extends PrintPreviewInput {
  mode: 'pdf' | 'printer';
  printerName?: string | null;
}

export interface PrintRunResult {
  ok: boolean;
  pdfBase64?: string;
  reason?: string;
}

/* ---------------------------------- exports ---------------------------------- */

export type ExportKind =
  | 'patients'
  | 'appointments'
  | 'invoices'
  | 'payments'
  | 'inventory'
  | 'accounting'
  | 'audit';

export interface ExportInput {
  kind: ExportKind;
  range?: DateRangeFilter;
  from?: string;
  to?: string;
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  rowCount?: number;
  reason?: string;
}

/* ---------------------------------- destructive ops ---------------------------------- */

export interface DestructiveInput {
  password: string;
  confirmPhrase?: string;
}

export interface DestructiveResult {
  ok: boolean;
  reason?: string;
}

/* ---------------------------------- API map ---------------------------------- */

export interface ApiMethods {
  // app / activation / setup / auth
  'app.state': { input: void; output: AppState };
  'activation.verify': { input: ActivationInput; output: ActivationResult };
  'setup.status': { input: void; output: SetupProgress };
  'setup.saveClinic': { input: ClinicInput; output: SetupSaveResult };
  'setup.saveDentists': { input: { dentists: DentistInput[] }; output: SetupSaveResult };
  'setup.saveAdmin': { input: AdminAccountInput; output: SetupSaveResult };
  'setup.savePreferences': { input: SettingsPayload; output: SetupSaveResult };
  'setup.finish': { input: void; output: SetupSaveResult };
  'auth.login': { input: LoginInput; output: LoginResult };
  'auth.lock': { input: void; output: Ok };
  'auth.unlock': { input: { password: string }; output: { ok: boolean; reason?: string } };
  'auth.logout': { input: void; output: Ok };
  'auth.changePassword': { input: ChangePasswordInput; output: { ok: boolean; reason?: string } };

  // settings / clinic / printers
  'settings.get': { input: { group?: string } | undefined; output: SettingsPayload };
  'settings.set': { input: { group: string; values: Record<string, unknown> }; output: Ok };
  'settings.resetSecurity': { input: DestructiveInput; output: DestructiveResult };
  'clinic.get': { input: void; output: ClinicInput & { id: number } };
  'clinic.update': { input: ClinicInput; output: Ok };
  /** Returns the stored clinic logo as a data URL for on-screen preview (renderer
   *  cannot load raw filesystem paths). Empty string when no logo is set. */
  'clinic.getLogo': { input: void; output: { dataUrl: string } };
  'dentists.list': { input: { includeInactive?: boolean } | undefined; output: DentistDto[] };
  'dentists.create': { input: DentistInput; output: { id: number } };
  'dentists.update': { input: DentistInput; output: Ok };
  'dentists.delete': { input: { id: number }; output: DestructiveResult };
  'printers.profiles': { input: void; output: PrinterProfileDto[] };
  'printers.saveProfile': { input: PrinterProfileInput; output: { id: number } };
  'printers.deleteProfile': { input: { id: number }; output: Ok };
  'printers.systemPrinters': { input: void; output: SystemPrinterDto[] };

  // users / roles
  'users.list': { input: void; output: UserDto[] };
  'users.create': { input: UserInput; output: { id: number } };
  'users.update': { input: UserInput; output: Ok };
  'users.delete': { input: DestructiveInput & { id: number }; output: DestructiveResult };
  'users.resetPassword': { input: DestructiveInput & { id: number; newPassword: string }; output: DestructiveResult };
  'roles.list': { input: void; output: RoleDto[] };
  'roles.save': { input: RoleInput; output: { id: number } };
  'roles.delete': { input: { id: number }; output: DestructiveResult };

  // patients
  'patients.list': { input: PatientListQuery; output: Page<PatientListItem> };
  'patients.get': { input: { id: number }; output: PatientProfile };
  'patients.create': { input: PatientInput; output: { id: number; patientCode: string } };
  'patients.update': { input: PatientInput; output: Ok };
  'patients.archive': { input: { id: number }; output: Ok };
  'patients.restore': { input: { id: number }; output: Ok };
  'patients.delete': { input: DestructiveInput & { id: number }; output: DestructiveResult };
  'patients.timeline': { input: { id: number }; output: TimelineEntry[] };
  'patients.addNote': { input: PatientNoteInput; output: { id: number } };
  'patients.duplicateCheck': { input: { phone?: string; name?: string }; output: { matches: PatientListItem[] } };

  // referrals
  'referrals.create': { input: ReferralInput; output: { id: number } };
  'referrals.list': { input: { patientId: number }; output: ReferralDto[] };

  // attachments
  'attachments.list': { input: { patientId: number }; output: AttachmentDto[] };
  'attachments.add': { input: AttachmentAddInput; output: { id: number } };
  'attachments.read': { input: { id: number }; output: { filename: string; mime: string; dataBase64: string } };
  'attachments.export': { input: { id: number }; output: ExportResult };
  'attachments.delete': { input: { id: number }; output: DestructiveResult };

  // visits
  'visits.list': { input: { patientId?: number; q?: string; dentistId?: number; status?: 'open' | 'closed'; range?: DateRangeFilter; from?: string; to?: string; page?: number; pageSize?: number }; output: Page<VisitDto> };
  'visits.get': { input: { id: number }; output: VisitDto };
  'visits.create': { input: VisitInput; output: { id: number } };
  'visits.update': { input: VisitInput; output: Ok };
  'visits.delete': { input: { id: number }; output: DestructiveResult };

  // chart
  'chart.conditions': { input: void; output: ChartConditionDto[] };
  'chart.get': { input: { patientId: number }; output: DentalChartDto | null };
  'chart.save': { input: ChartSaveInput; output: { id: number } };

  // treatments
  'treatments.list': { input: { q?: string; category?: string; includeInactive?: boolean } | undefined; output: TreatmentDto[] };
  'treatments.save': { input: TreatmentInput; output: { id: number } };
  'treatments.delete': { input: { id: number }; output: DestructiveResult };
  'treatmentRecords.list': { input: { patientId: number }; output: TreatmentRecordDto[] };
  'treatmentRecords.create': { input: TreatmentRecordInput; output: { id: number } };
  'treatmentRecords.delete': { input: { id: number }; output: DestructiveResult };

  // prescriptions
  'prescriptions.list': { input: { q?: string; patientId?: number; range?: DateRangeFilter; from?: string; to?: string; page?: number; pageSize?: number }; output: Page<PrescriptionDto> };
  'prescriptions.get': { input: { id: number }; output: PrescriptionDto };
  'prescriptions.create': { input: PrescriptionInput; output: { id: number } };
  'prescriptions.update': { input: PrescriptionInput; output: Ok };
  'prescriptions.delete': { input: { id: number }; output: DestructiveResult };
  'medications.list': { input: void; output: MedicationDto[] };
  'medications.save': { input: MedicationInput; output: { id: number } };
  'medications.delete': { input: { id: number }; output: DestructiveResult };

  // appointments
  'appointments.list': { input: { from: string; to: string; dentistId?: number; status?: AppointmentStatus | 'all'; patientId?: number }; output: AppointmentDto[] };
  'appointments.get': { input: { id: number }; output: AppointmentDto };
  'appointments.save': { input: AppointmentInput; output: AppointmentSaveResult };
  'appointments.setStatus': { input: { id: number; status: AppointmentStatus }; output: AppointmentSaveResult };
  'appointments.delete': { input: { id: number }; output: DestructiveResult };
  'appointments.conflicts': { input: { dentistId: number; startAt: string; durationMin: number; ignoreId?: number }; output: AppointmentConflict[] };

  // queue
  'queue.list': { input: { date?: string } | undefined; output: QueueEntryDto[] };
  'queue.checkIn': { input: QueueCheckInInput; output: { id: number; number: number } };
  'queue.setStatus': { input: { id: number; status: QueueStatus }; output: Ok };
  'queue.callNext': { input: { dentistId?: number | null } | undefined; output: { entry: QueueEntryDto | null } };

  // invoices / payments
  'invoices.list': { input: InvoiceListQuery; output: Page<InvoiceDto> };
  'invoices.get': { input: { id: number }; output: InvoiceDto };
  'invoices.create': { input: InvoiceInput; output: { id: number; invoiceNo: string } };
  'invoices.update': { input: InvoiceInput; output: Ok };
  'invoices.void': { input: DestructiveInput & { id: number }; output: DestructiveResult };
  'payments.list': { input: PaymentListQuery; output: Page<PaymentDto> };
  'payments.get': { input: { id: number }; output: PaymentDto };
  'payments.create': { input: PaymentInput; output: { id: number; paymentNo: string; invoiceStatus?: InvoiceStatus } };
  'payments.reverse': { input: DestructiveInput & { id: number; reason: string }; output: DestructiveResult };
  'payments.dashboard': { input: { period: DateRangeFilter; from?: string; to?: string }; output: PaymentsDashboard };

  // inventory / suppliers
  'inventory.list': { input: { q?: string; category?: string; filter?: 'all' | 'low' | 'out' | 'expiring'; includeInactive?: boolean }; output: InventoryItemDto[] };
  'inventory.get': { input: { id: number }; output: InventoryItemDto };
  'inventory.save': { input: InventoryItemInput; output: { id: number } };
  'inventory.delete': { input: { id: number }; output: DestructiveResult };
  'inventory.move': { input: StockMoveInput; output: { id: number; currentStock: number } };
  'inventory.batches': { input: { itemId: number }; output: InventoryBatchDto[] };
  'inventory.alerts': { input: void; output: InventoryAlerts };
  'suppliers.list': { input: void; output: SupplierDto[] };
  'suppliers.save': { input: SupplierInput; output: { id: number } };
  'suppliers.delete': { input: { id: number }; output: DestructiveResult };

  // accounting
  'accounting.categories': { input: void; output: AccountingCategoryDto[] };
  'accounting.saveCategory': { input: { id?: number; kind: 'income' | 'expense'; name: string; active?: boolean }; output: { id: number } };
  'accounting.entries': { input: { kind?: 'income' | 'expense' | 'all'; range?: DateRangeFilter; from?: string; to?: string; categoryId?: number; page?: number; pageSize?: number }; output: Page<LedgerEntryDto> };
  'accounting.addEntry': { input: LedgerEntryInput; output: { id: number } };
  'accounting.reverseEntry': { input: DestructiveInput & { id: number; reason: string }; output: DestructiveResult };

  // reports (financial — permission enforced before query)
  'reports.summary': { input: { from: string; to: string }; output: FinancialSummaryReport };
  'reports.byTreatment': { input: { from: string; to: string }; output: TreatmentRevenueRow[] };
  'reports.byDentist': { input: { from: string; to: string }; output: DentistRevenueRow[] };
  'reports.paymentMethods': { input: { from: string; to: string }; output: { label: string; total: number; count: number }[] };
  'reports.outstanding': { input: void; output: PatientBalanceRow[] };
  'reports.patientBalances': { input: void; output: PatientBalanceRow[] };
  'reports.dashboard': { input: void; output: DashboardData };

  // staff
  'staff.list': { input: { includeInactive?: boolean } | undefined; output: StaffDto[] };
  'staff.save': { input: StaffInput; output: { id: number } };
  'staff.delete': { input: { id: number }; output: DestructiveResult };

  // backup / restore
  'backup.list': { input: void; output: BackupRecordDto[] };
  'backup.create': { input: { destDir?: string } | undefined; output: { ok: boolean; path?: string; reason?: string } };
  'backup.chooseFolder': { input: void; output: { path: string | null } };
  /** Native file picker for a backup archive (restore-from-file). Returns null on cancel. */
  'backup.chooseFile': { input: void; output: { path: string | null } };
  'backup.verify': { input: { path: string }; output: { valid: boolean; manifest?: BackupManifest; reason?: string } };
  'restore.preview': { input: { path: string }; output: RestorePreview };
  'restore.run': { input: DestructiveInput & { path: string }; output: RestoreResult };

  // audit
  'audit.list': { input: AuditQuery; output: Page<AuditEntryDto> };

  // notifications
  'notifications.list': { input: { unreadOnly?: boolean } | undefined; output: NotificationDto[] };
  'notifications.markRead': { input: { ids?: number[] } | undefined; output: Ok };
  'notifications.dismiss': { input: { id: number }; output: Ok };

  // search / export / print
  'search.global': { input: { q: string; limit?: number }; output: GlobalSearchResult[] };
  'export.csv': { input: ExportInput; output: ExportResult };
  'print.preview': { input: PrintPreviewInput; output: PrintPreviewPayload };
  'print.run': { input: PrintRunInput; output: PrintRunResult };

  // ledger lists reused by pages
  'ledger.patientPayments': { input: { patientId: number }; output: PaymentDto[] };
}

export type ApiMethod = keyof ApiMethods;
export type ApiInput<M extends ApiMethod> = ApiMethods[M]['input'];
export type ApiOutput<M extends ApiMethod> = ApiMethods[M]['output'];

/** Runtime allow-list (must stay in sync with ApiMethods; enforced by tests). */
export const API_METHODS: ApiMethod[] = [
  'app.state',
  'activation.verify',
  'setup.status',
  'setup.saveClinic',
  'setup.saveDentists',
  'setup.saveAdmin',
  'setup.savePreferences',
  'setup.finish',
  'auth.login',
  'auth.lock',
  'auth.unlock',
  'auth.logout',
  'auth.changePassword',
  'settings.get',
  'settings.set',
  'settings.resetSecurity',
  'clinic.get',
  'clinic.update',
  'clinic.getLogo',
  'dentists.list',
  'dentists.create',
  'dentists.update',
  'dentists.delete',
  'printers.profiles',
  'printers.saveProfile',
  'printers.deleteProfile',
  'printers.systemPrinters',
  'users.list',
  'users.create',
  'users.update',
  'users.delete',
  'users.resetPassword',
  'roles.list',
  'roles.save',
  'roles.delete',
  'patients.list',
  'patients.get',
  'patients.create',
  'patients.update',
  'patients.archive',
  'patients.restore',
  'patients.delete',
  'patients.timeline',
  'patients.addNote',
  'patients.duplicateCheck',
  'referrals.create',
  'referrals.list',
  'attachments.list',
  'attachments.add',
  'attachments.read',
  'attachments.export',
  'attachments.delete',
  'visits.list',
  'visits.get',
  'visits.create',
  'visits.update',
  'visits.delete',
  'chart.conditions',
  'chart.get',
  'chart.save',
  'treatments.list',
  'treatments.save',
  'treatments.delete',
  'treatmentRecords.list',
  'treatmentRecords.create',
  'treatmentRecords.delete',
  'prescriptions.list',
  'prescriptions.get',
  'prescriptions.create',
  'prescriptions.update',
  'prescriptions.delete',
  'medications.list',
  'medications.save',
  'medications.delete',
  'appointments.list',
  'appointments.get',
  'appointments.save',
  'appointments.setStatus',
  'appointments.delete',
  'appointments.conflicts',
  'queue.list',
  'queue.checkIn',
  'queue.setStatus',
  'queue.callNext',
  'invoices.list',
  'invoices.get',
  'invoices.create',
  'invoices.update',
  'invoices.void',
  'payments.list',
  'payments.get',
  'payments.create',
  'payments.reverse',
  'payments.dashboard',
  'inventory.list',
  'inventory.get',
  'inventory.save',
  'inventory.delete',
  'inventory.move',
  'inventory.batches',
  'inventory.alerts',
  'suppliers.list',
  'suppliers.save',
  'suppliers.delete',
  'accounting.categories',
  'accounting.saveCategory',
  'accounting.entries',
  'accounting.addEntry',
  'accounting.reverseEntry',
  'reports.summary',
  'reports.byTreatment',
  'reports.byDentist',
  'reports.paymentMethods',
  'reports.outstanding',
  'reports.patientBalances',
  'reports.dashboard',
  'staff.list',
  'staff.save',
  'staff.delete',
  'backup.list',
  'backup.create',
  'backup.chooseFolder',
  'backup.chooseFile',
  'backup.verify',
  'restore.preview',
  'restore.run',
  'audit.list',
  'notifications.list',
  'notifications.markRead',
  'notifications.dismiss',
  'search.global',
  'export.csv',
  'print.preview',
  'print.run',
  'ledger.patientPayments',
];

/** Events pushed from main → renderer. */
export type AppEvent =
  | { type: 'locked' }
  | { type: 'unlocked' }
  | { type: 'notification'; notification: NotificationDto; unreadCount: number }
  | { type: 'queue' }
  | { type: 'data-changed'; entity: string }
  | { type: 'backup-completed'; ok: boolean; detail: string }
  | { type: 'ready' };
