import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, teardownDatabase, rmDir } from './helpers';
import { ServiceError, SYSTEM_ACTOR, type ServiceActor } from '../../src/main/services/common';
import * as setup from '../../src/main/services/setup';
import * as auth from '../../src/main/services/auth';
import * as admin from '../../src/main/services/admin';
import * as patients from '../../src/main/services/patients';
import * as dashboard from '../../src/main/services/dashboard';
import { currentDb } from '../../src/main/db/database';
import { PERMISSIONS } from '../../src/shared/permissions';

let dir: string;
const ADMIN = 'bossdent';
const ADMIN_PW = 'Clinic#Root99';

beforeAll(() => {
  ({ dir } = freshDatabase('auth'));
  setup.setupSaveClinic({ name: 'Auth Test Clinic' });
  setup.setupSaveDentists([{ fullName: 'Dr. One', designations: [] }]);
  setup.setupSaveAdmin({ username: ADMIN, password: ADMIN_PW });
  setup.setupFinish();
});

afterAll(() => {
  teardownDatabase();
  rmDir(dir);
});

describe('login & lockout', () => {
  it('rejects unknown users and wrong passwords', () => {
    expect(auth.login('ghost', ADMIN_PW).reason).toBe('invalid_credentials');
    expect(auth.login(ADMIN, 'wrong-password-1').reason).toBe('invalid_credentials');
    expect(auth.getSession()).toBeNull();
  });

  it('logs in a valid user with a full permission set', () => {
    const res = auth.login(ADMIN, ADMIN_PW);
    expect(res.ok).toBe(true);
    expect(res.user?.username).toBe(ADMIN);
    expect((res.user?.permissions.length ?? 0)).toBeGreaterThan(10);
    expect(auth.getSession()).not.toBeNull();
    auth.logout();
  });

  it('locks the session and requires the password to unlock', () => {
    auth.login(ADMIN, ADMIN_PW);
    auth.lockSession();
    expect(auth.getSession()?.locked).toBe(true);

    expect(auth.unlock('not-the-password').ok).toBe(false);
    expect(auth.unlock(ADMIN_PW).ok).toBe(true);
    expect(auth.getSession()?.locked).toBe(false);
    auth.logout();
  });

  it('locks the account after repeated failures and rejects even the correct password', () => {
    auth.logout();
    const max = 5;
    let last: { ok: boolean; reason?: string } = { ok: false };
    for (let i = 0; i < max + 2; i++) {
      last = auth.login(ADMIN, ADMIN_PW); // correct password, but repeated wrong ones came first
      if (!last.ok) break;
    }
    // hammer with wrong passwords deterministically
    currentDb().prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL').run();
    for (let i = 0; i < max; i++) {
      auth.login(ADMIN, 'definitely-wrong-' + i);
    }
    const afterLock = auth.login(ADMIN, ADMIN_PW);
    expect(afterLock.ok).toBe(false);
    expect(['locked', 'rate_limited']).toContain(afterLock.reason);

    // clear the lockout for later tests
    currentDb()
      .prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = ?')
      .run(ADMIN);
  });

  it('changes password and rejects the old one afterwards', () => {
    auth.login(ADMIN, ADMIN_PW);
    expect(auth.changePassword('wrong-current', 'NewPass#2026').ok).toBe(false);
    expect(auth.changePassword(ADMIN_PW, 'NewPass#2026').ok).toBe(true);
    auth.logout();

    expect(auth.login(ADMIN, ADMIN_PW).ok).toBe(false);
    expect(auth.login(ADMIN, 'NewPass#2026').ok).toBe(true);
    auth.logout();

    // restore original for consistency
    auth.login(ADMIN, 'NewPass#2026');
    auth.changePassword('NewPass#2026', ADMIN_PW);
    auth.logout();
  });
});

describe('service-layer RBAC', () => {
  const viewer: ServiceActor = {
    userId: 99,
    username: 'viewer',
    permissions: ['patient.view', 'clinical.view'],
  };
  const receptionist = (): ServiceActor => {
    const adminId = (
      currentDb().prepare('SELECT id FROM users WHERE username = ?').get(ADMIN) as { id: number }
    ).id;
    return {
      userId: adminId,
      username: 'frontdesk',
      permissions: ['patient.view', 'patient.create', 'patient.edit', 'appointment.view'],
    };
  };

  it('allows reads for patient.view but blocks writes', () => {
    const list = patients.listPatients(viewer, { pageSize: 5 });
    expect(Array.isArray(list.items)).toBe(true);

    let err: ServiceError | null = null;
    try {
      patients.createPatient(viewer, { fullName: 'Should Fail' });
    } catch (e) {
      err = e as ServiceError;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect(err!.code).toBe('forbidden');
    expect(err!.message).toContain('patient.create');
  });

  it('permission denials are audited', () => {
    const denials = currentDb()
      .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'permission.denied'")
      .get() as { c: number };
    expect(denials.c).toBeGreaterThan(0);
  });

  it('receptionist can create patients, dashboard hides financials', () => {
    const created = patients.createPatient(receptionist(), {
      fullName: 'Front Desk Patient',
      phone: '+880 1700-123456',
    });
    expect(created.id).toBeGreaterThan(0);

    const d = dashboard.getDashboard(receptionist());
    expect(d.financial).toBeNull();
  });

  it('system actor exists only in memory', () => {
    expect(SYSTEM_ACTOR.isSystem).toBe(true);
    const rows = currentDb()
      .prepare("SELECT COUNT(*) AS c FROM users WHERE username = 'system'")
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });
});

describe('users & roles', () => {
  it('creates a custom role, a user, and the user sees only its permissions', () => {
    const { id: roleId } = admin.saveRole(SYSTEM_ACTOR, {
      name: 'X-Ray Only',
      description: 'Limited helper role',
      permissions: ['patient.view'],
    });
    expect(roleId).toBeGreaterThan(0);

    const { id: userId } = admin.createUser(SYSTEM_ACTOR, {
      username: 'helper1',
      password: 'Helper#Pass1',
      roleId,
    });
    expect(userId).toBeGreaterThan(0);

    const helper = admin.listUsers(SYSTEM_ACTOR).find((u) => u.id === userId);
    expect(helper?.roleName).toBe('X-Ray Only');

    const res = auth.login('helper1', 'Helper#Pass1');
    expect(res.ok).toBe(true);
    expect(res.user?.permissions).toEqual(['patient.view']);
    auth.logout();
  });

  it('built-in roles are seeded with full Owner permissions', () => {
    const roles = admin.listRoles(SYSTEM_ACTOR);
    expect(roles.length).toBeGreaterThanOrEqual(7);
    const owner = roles.find((r) => r.name === 'Owner');
    expect(owner?.isSystem).toBe(true);
    expect(owner?.permissions.length).toBe(PERMISSIONS.length);
  });
});
