/**
 * Central permission matrix for Dentiva Pro RBAC.
 * Permissions are enforced inside the service layer (src/main/services/**),
 * never merely hidden in the UI.
 */

export const PERMISSIONS = [
  // Patients
  'patient.view',
  'patient.create',
  'patient.edit',
  'patient.delete',
  'patient.export',
  'patient.restore',
  // Clinical
  'clinical.view',
  'clinical.create',
  'clinical.edit',
  'clinical.delete',
  'chart.manage',
  'treatment.manage',
  'medication.manage',
  'referral.manage',
  // Prescriptions
  'prescription.view',
  'prescription.create',
  'prescription.edit',
  'prescription.delete',
  'prescription.print',
  // Appointments / queue
  'appointment.view',
  'appointment.create',
  'appointment.edit',
  'appointment.delete',
  'queue.manage',
  // Billing
  'invoice.view',
  'invoice.create',
  'invoice.edit',
  'invoice.delete',
  'payment.view',
  'payment.create',
  'payment.edit',
  'payment.delete',
  'financial.view',
  // Accounting
  'accounting.view',
  'accounting.manage',
  // Inventory
  'inventory.view',
  'inventory.manage',
  'supplier.manage',
  // People
  'staff.view',
  'staff.manage',
  'user.manage',
  'role.manage',
  // Operations
  'backup.create',
  'backup.restore',
  'settings.view',
  'settings.manage',
  'audit.view',
  'notification.manage',
  'export.manage',
  'destructive_actions',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = [
  'Owner',
  'Administrator',
  'Dentist',
  'Receptionist',
  'Assistant',
  'Accountant',
  'Inventory Manager',
] as const;

export type BuiltinRoleName = (typeof ROLE_NAMES)[number];

/** Role → permissions for built-in roles. Owner always has every permission. */
export const BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRoleName, Permission[]> = {
  Owner: [...PERMISSIONS],
  Administrator: PERMISSIONS.filter((p) => p !== 'destructive_actions'),
  Dentist: [
    'patient.view',
    'patient.create',
    'patient.edit',
    'patient.export',
    'clinical.view',
    'clinical.create',
    'clinical.edit',
    'chart.manage',
    'treatment.manage',
    'medication.manage',
    'referral.manage',
    'prescription.view',
    'prescription.create',
    'prescription.edit',
    'prescription.delete',
    'prescription.print',
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'queue.manage',
    'invoice.view',
    'invoice.create',
    'payment.view',
    'financial.view',
    'inventory.view',
    'staff.view',
    'settings.view',
    'notification.manage',
    'export.manage',
  ],
  Receptionist: [
    'patient.view',
    'patient.create',
    'patient.edit',
    'patient.export',
    'clinical.view',
    'prescription.view',
    'prescription.print',
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.delete',
    'queue.manage',
    'invoice.view',
    'invoice.create',
    'invoice.edit',
    'payment.view',
    'payment.create',
    'inventory.view',
    'staff.view',
    'settings.view',
    'notification.manage',
  ],
  Assistant: [
    'patient.view',
    'patient.create',
    'patient.edit',
    'clinical.view',
    'clinical.create',
    'clinical.edit',
    'chart.manage',
    'appointment.view',
    'appointment.create',
    'queue.manage',
    'prescription.view',
    'prescription.print',
    'invoice.view',
    'inventory.view',
    'notification.manage',
  ],
  Accountant: [
    'patient.view',
    'invoice.view',
    'invoice.edit',
    'payment.view',
    'payment.create',
    'payment.edit',
    'payment.delete',
    'financial.view',
    'accounting.view',
    'accounting.manage',
    'inventory.view',
    'staff.view',
    'export.manage',
    'settings.view',
    'notification.manage',
  ],
  'Inventory Manager': [
    'patient.view',
    'inventory.view',
    'inventory.manage',
    'supplier.manage',
    'financial.view',
    'accounting.view',
    'staff.view',
    'export.manage',
    'settings.view',
    'notification.manage',
  ],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

/** Grouped view of PERMISSIONS for role-editor UI. */
export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  { group: 'Patients', permissions: PERMISSIONS.filter((p) => p.startsWith('patient.')) },
  { group: 'Clinical', permissions: PERMISSIONS.filter((p) => p.startsWith('clinical.') || p.startsWith('chart.') || p.startsWith('treatment.') || p.startsWith('medication.') || p.startsWith('referral.')) },
  { group: 'Prescriptions', permissions: PERMISSIONS.filter((p) => p.startsWith('prescription.')) },
  { group: 'Appointments & queue', permissions: PERMISSIONS.filter((p) => p.startsWith('appointment.') || p.startsWith('queue.')) },
  { group: 'Billing', permissions: PERMISSIONS.filter((p) => p.startsWith('invoice.') || p.startsWith('payment.') || p === 'financial.view') },
  { group: 'Accounting & inventory', permissions: PERMISSIONS.filter((p) => p.startsWith('accounting.') || p.startsWith('inventory.') || p.startsWith('supplier.')) },
  { group: 'People', permissions: PERMISSIONS.filter((p) => p.startsWith('staff.') || p.startsWith('user.') || p.startsWith('role.')) },
  { group: 'Operations', permissions: PERMISSIONS.filter((p) => p.startsWith('backup.') || p.startsWith('audit.') || p.startsWith('settings.') || p.startsWith('notification.') || p === 'export.manage' || p === 'destructive_actions') },
];

/** Every permission in one flat list (role editor “select all”). */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;
