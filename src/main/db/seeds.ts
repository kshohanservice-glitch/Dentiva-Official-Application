import type { DB } from './database';
import { BUILTIN_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES } from '../../shared/permissions';

/** Idempotent system seeds: permissions, built-in roles, payment methods, chart
 *  conditions, accounting categories, default printer profiles, settings. */
export function seedSystemData(db: DB): void {
  const tx = db.transaction(() => {
    const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (code) VALUES (?)');
    for (const p of PERMISSIONS) insPerm.run(p);

    for (const roleName of ROLE_NAMES) {
      const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName) as
        | { id: number }
        | undefined;
      let roleId: number;
      if (role) {
        roleId = role.id;
        db.prepare('UPDATE roles SET is_system = 1 WHERE id = ?').run(roleId);
      } else {
        const res = db
          .prepare('INSERT INTO roles (name, description, is_system) VALUES (?, ?, 1)')
          .run(roleName, `${roleName} (built-in role)`);
        roleId = Number(res.lastInsertRowid);
      }
      if (roleName === 'Owner') {
        const count = db
          .prepare('SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?')
          .get(roleId) as { c: number };
        if (count.c === 0) {
          const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)');
          for (const p of BUILTIN_ROLE_PERMISSIONS.Owner) ins.run(roleId, p);
        }
      } else if (roleName === 'Administrator') {
        const count = db
          .prepare('SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?')
          .get(roleId) as { c: number };
        if (count.c === 0) {
          const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)');
          for (const p of BUILTIN_ROLE_PERMISSIONS.Administrator) ins.run(roleId, p);
        }
      } else {
        // Non-owner built-in roles are always synced to their definition on startup
        // (only safe before the role is customized — detect via user count flag below)
        const custom = db.prepare('SELECT description FROM roles WHERE id = ?').get(roleId) as {
          description: string | null;
        };
        if (custom.description !== 'customized') {
          db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
          const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)');
          for (const p of BUILTIN_ROLE_PERMISSIONS[roleName]) ins.run(roleId, p);
        }
      }
    }

    const insMethod = db.prepare(
      'INSERT OR IGNORE INTO payment_methods (code, label, sort) VALUES (?, ?, ?)',
    );
    const methods: [string, string, number][] = [
      ['cash', 'Cash', 1],
      ['bank', 'Bank', 2],
      ['card', 'Card', 3],
      ['bkash', 'bKash', 4],
      ['nagad', 'Nagad', 5],
      ['rocket', 'Rocket', 6],
      ['upay', 'Upay', 7],
      ['wallet', 'Other Mobile Wallet', 8],
      ['other', 'Other', 9],
    ];
    for (const m of methods) insMethod.run(m[0], m[1], m[2]);

    const insChart = db.prepare(
      'INSERT OR IGNORE INTO chart_conditions (code, label, color, category, sort) VALUES (?, ?, ?, ?, ?)',
    );
    const conditions: [string, string, string, string, number][] = [
      ['caries', 'Caries', '#e11d48', 'Pathology', 1],
      ['bdr', 'BDR (Deep Caries)', '#be123c', 'Pathology', 2],
      ['bdc', 'BDC (Broken Down Crown)', '#9f1239', 'Pathology', 3],
      ['restoration', 'Restoration', '#2563eb', 'Restoration', 4],
      ['crown', 'Crown', '#7c3aed', 'Restoration', 5],
      ['root_canal', 'Root Canal', '#4f46e5', 'Restoration', 6],
      ['missing', 'Missing', '#64748b', 'Status', 7],
      ['extraction', 'Extraction Indicated', '#dc2626', 'Status', 8],
      ['impacted', 'Impacted', '#0f766e', 'Status', 9],
      ['fracture', 'Fracture', '#ea580c', 'Pathology', 10],
      ['mobility', 'Mobility', '#c2410c', 'Periodontal', 11],
      ['gingivitis', 'Gingivitis', '#16a34a', 'Periodontal', 12],
      ['periodontitis', 'Periodontitis', '#15803d', 'Periodontal', 13],
      ['pocket', 'Periodontal Pocket', '#166534', 'Periodontal', 14],
      ['abscess', 'Abscess', '#a21caf', 'Pathology', 15],
      ['sealant', 'Sealant', '#0891b2', 'Preventive', 16],
      ['implant', 'Implant', '#0369a1', 'Restoration', 17],
      ['bridge', 'Bridge', '#6d28d9', 'Restoration', 18],
      ['denture', 'Denture', '#9333ea', 'Restoration', 19],
      ['attrition', 'Attrition', '#a16207', 'Wear', 20],
      ['erosion', 'Erosion', '#ca8a04', 'Wear', 21],
      ['healthy', 'Healthy', '#16a34a', 'Status', 22],
      ['other', 'Other', '#475569', 'Other', 23],
    ];
    for (const c of conditions) insChart.run(c[0], c[1], c[2], c[3], c[4]);

    const insCat = db.prepare(
      'INSERT OR IGNORE INTO accounting_categories (kind, name) VALUES (?, ?)',
    );
    const incomeCats = ['Treatment Income', 'Consultation Income', 'Other Income'];
    const expenseCats = [
      'Clinic Rent',
      'Electricity',
      'Internet',
      'Staff Salary',
      'Supplies',
      'Dental Accessories',
      'Equipment',
      'Maintenance',
      'Transportation',
      'Marketing',
      'Miscellaneous',
    ];
    for (const c of incomeCats) insCat.run('income', c);
    for (const c of expenseCats) insCat.run('expense', c);

    const insProfile = db.prepare(`
      INSERT OR IGNORE INTO printer_profiles
        (name, printer_name, paper_size, width_mm, height_mm, margin_top, margin_right, margin_bottom, margin_left, orientation, scale, copies, is_default)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'portrait', 100, 1, ?)`);
    insProfile.run('A4 (Default)', 'A4', 210, 297, 8, 8, 8, 8, 1);
    insProfile.run('A5 Prescription', 'A5', 148, 210, 6, 6, 6, 6, 0);
    insProfile.run('Thermal 80mm', '80mm', 80, 2000, 2, 2, 2, 2, 0);
    insProfile.run('Thermal 58mm', '58mm', 58, 2000, 2, 2, 2, 2, 0);
  });
  tx();
}
