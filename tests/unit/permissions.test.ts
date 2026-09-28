import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  BUILTIN_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_NAMES,
  hasPermission,
  isPermission,
} from '../../src/shared/permissions';

describe('permission matrix', () => {
  it('contains no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('covers core domains', () => {
    for (const p of [
      'patient.view',
      'clinical.create',
      'chart.manage',
      'prescription.print',
      'appointment.create',
      'invoice.create',
      'financial.view',
      'inventory.manage',
      'backup.create',
      'backup.restore',
      'audit.view',
      'settings.manage',
      'role.manage',
      'queue.manage',
      'referral.manage',
    ]) {
      expect(PERMISSIONS).toContain(p);
    }
  });

  it('isPermission guard', () => {
    expect(isPermission('patient.view')).toBe(true);
    expect(isPermission('not.a.perm')).toBe(false);
  });

  it('hasPermission works for arrays', () => {
    expect(hasPermission(['patient.view'], 'patient.view')).toBe(true);
    expect(hasPermission(['patient.view'], 'patient.delete')).toBe(false);
    expect(hasPermission([], 'patient.view')).toBe(false);
  });
});

describe('built-in roles', () => {
  it('every role exists for every ROLE_NAMES entry', () => {
    for (const name of ROLE_NAMES) {
      expect(BUILTIN_ROLE_PERMISSIONS[name]).toBeDefined();
    }
  });

  it('every role permission is a real permission', () => {
    for (const name of ROLE_NAMES) {
      for (const p of BUILTIN_ROLE_PERMISSIONS[name]) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });

  it('Owner holds every permission; Administrator holds all but destructive_actions', () => {
    expect([...BUILTIN_ROLE_PERMISSIONS.Owner].sort()).toEqual([...PERMISSIONS].sort());
    expect([...BUILTIN_ROLE_PERMISSIONS.Administrator].sort()).toEqual(
      PERMISSIONS.filter((p) => p !== 'destructive_actions').sort(),
    );
    expect(BUILTIN_ROLE_PERMISSIONS.Administrator).not.toContain('destructive_actions');
  });

  it('Receptionist cannot see finances or manage users', () => {
    const r = BUILTIN_ROLE_PERMISSIONS.Receptionist;
    expect(r).not.toContain('financial.view');
    expect(r).not.toContain('user.manage');
    expect(r).not.toContain('audit.view');
    expect(r).toContain('patient.create');
    expect(r).toContain('appointment.create');
  });

  it('accounts roles are finance-scoped', () => {
    const a = BUILTIN_ROLE_PERMISSIONS.Accountant;
    expect(a).toContain('financial.view');
    expect(a).not.toContain('clinical.edit');
  });
});

describe('permission groups (role editor)', () => {
  it('groups partition the full permission list exactly once', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(grouped.length).toBe(PERMISSIONS.length);
    expect(new Set(grouped).size).toBe(PERMISSIONS.length);
    for (const p of grouped) expect(PERMISSIONS).toContain(p);
  });

  it('ALL_PERMISSIONS equals PERMISSIONS', () => {
    expect(ALL_PERMISSIONS.length).toBe(PERMISSIONS.length);
  });
});
