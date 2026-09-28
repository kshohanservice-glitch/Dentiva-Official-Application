import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, Field, Icon, Input, Textarea, useToast, Checkbox, Select } from '../components/ui';
import type { AdminAccountInput, ClinicInput, DentistInput, SettingsPayload } from '@shared/contract';

/**
 * First-run setup wizard — resumable (each step persists server-side),
 * validated, with progress indicator.
 */
const STEPS = ['Clinic information', 'Dentists', 'Administrator account', 'Preferences', 'Finish'];

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const status = await api('setup.status');
        if (status.clinicSaved && status.dentistsSaved && status.adminSaved && status.preferencesSaved) setStep(4);
        else if (status.clinicSaved && status.dentistsSaved && status.adminSaved) setStep(3);
        else if (status.clinicSaved && status.dentistsSaved) setStep(2);
        else if (status.clinicSaved) setStep(1);
      } catch {
        /* start at 0 */
      }
    })();
  }, []);

  const next = () => {
    setError(null);
    setStep((s) => Math.min(4, s + 1));
  };

  return (
    <div className="auth-screen">
      <div className="auth-card wide">
        <div style={{ padding: '26px 30px 0' }}>
          <div className="auth-brand">
            <div className="brand-mark">
              <Icon name="tooth" size={24} />
            </div>
            <div>
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>Welcome to Dentiva Pro</h1>
              <div className="sub">First-run setup — takes about two minutes</div>
            </div>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`step ${i < step ? 'done' : ''} ${i === step ? 'current' : ''}`} title={s} />
            ))}
          </div>
          <div className="tiny muted" style={{ marginBottom: 14 }}>
            Step {step + 1} of {STEPS.length} — <strong>{STEPS[step]}</strong>
          </div>
        </div>
        <div style={{ padding: '0 30px 30px' }}>
          {error ? (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          ) : null}
          {step === 0 ? (
            <ClinicStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onSaved={() => {
                toast.push({ kind: 'success', title: 'Clinic information saved' });
                next();
              }}
            />
          ) : null}
          {step === 1 ? (
            <DentistsStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onSaved={() => {
                toast.push({ kind: 'success', title: 'Dentist profiles saved' });
                next();
              }}
            />
          ) : null}
          {step === 2 ? (
            <AdminStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onSaved={() => {
                toast.push({ kind: 'success', title: 'Administrator account created' });
                next();
              }}
            />
          ) : null}
          {step === 3 ? (
            <PreferencesStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onSaved={() => {
                toast.push({ kind: 'success', title: 'Preferences saved' });
                next();
              }}
            />
          ) : null}
          {step === 4 ? (
            <FinishStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onFinished={() => {
                toast.push({ kind: 'success', title: 'Setup complete — welcome to Dentiva Pro!' });
                onDone();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onSaved: () => void;
}

function readLogo(file: File | undefined): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      reject(new Error('Logo must be a PNG or JPEG image'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Logo must be 2 MB or smaller'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the logo file'));
    reader.readAsDataURL(file);
  });
}

function ClinicStep({ busy, setBusy, setError, onSaved }: StepProps) {
  const [form, setForm] = useState<ClinicInput>({
    name: '',
    address: '',
    phone: '',
    altPhone: '',
    email: '',
    website: '',
    openingHours: '9:00 AM – 9:00 PM',
    closingDays: [5],
    emergencyContact: '',
    footerMessage: '',
    prescriptionMessage: '',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const set = (k: keyof ClinicInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('setup.saveClinic', form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save clinic information');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="col" style={{ gap: 'var(--sp-4)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 'var(--r-lg)',
            border: '1.5px dashed var(--c-border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            background: 'var(--c-surface-2)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={() => fileRef.current?.click()}
          title="Upload clinic logo"
        >
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--c-text-3)' }}>
              <Icon name="upload" size={18} />
              <div className="tiny">Logo</div>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={async (e) => {
            try {
              const data = await readLogo(e.target.files?.[0]);
              if (data) {
                setLogoPreview(data);
                set('logoData', data);
              }
            } catch (err) {
              toast.push({ kind: 'error', title: err instanceof Error ? err.message : 'Logo upload failed' });
            }
          }}
        />
        <div className="col" style={{ flex: 1, gap: 'var(--sp-4)' }}>
          <div className="form-grid">
            <Field label="Clinic / practice name" required>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Smile Dental Care" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+880 1XXX-XXXXXX" />
            </Field>
            <Field label="Alternative phone">
              <Input value={form.altPhone} onChange={(e) => set('altPhone', e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Website">
              <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="optional" />
            </Field>
            <Field label="Emergency contact">
              <Input value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} />
            </Field>
          </div>
          <Field label="Address">
            <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} />
          </Field>
          <div className="form-grid">
            <Field label="Opening hours">
              <Input value={form.openingHours} onChange={(e) => set('openingHours', e.target.value)} />
            </Field>
            <Field label="Weekly closing days" hint="Friday is typical in Bangladesh — toggle as needed">
              <div className="row wrap" style={{ gap: 6 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
                  const on = (form.closingDays ?? []).includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`chip ${on ? 'active' : ''}`}
                      onClick={() =>
                        set(
                          'closingDays',
                          on ? (form.closingDays ?? []).filter((x) => x !== i) : [...(form.closingDays ?? []), i],
                        )
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Default prescription footer message">
              <Input value={form.prescriptionMessage} onChange={(e) => set('prescriptionMessage', e.target.value)} />
            </Field>
            <Field label="Default invoice/footer message">
              <Input value={form.footerMessage} onChange={(e) => set('footerMessage', e.target.value)} />
            </Field>
          </div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon="arrowRight">
          Save & continue
        </Button>
      </div>
    </form>
  );
}

interface DentistRow extends DentistInput {
  key: number;
}

function DentistsStep({ busy, setBusy, setError, onSaved }: StepProps) {
  const [rows, setRows] = useState<DentistRow[]>([{ key: 0, fullName: '', designations: [], qualifications: '' }]);
  const update = (key: number, patch: Partial<DentistRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rows.length || rows.some((r) => !r.fullName.trim())) {
      setError('Each dentist needs a full name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('setup.saveDentists', {
        dentists: rows.map(({ key: _k, ...d }) => ({
          ...d,
          designations: typeof d.designations === 'string' ? [] : d.designations ?? [],
        })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save dentists');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="col" style={{ gap: 'var(--sp-4)' }}>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
        Add one or more dentists. You can always add more later from Settings → Dentists.
      </p>
      {rows.map((r, idx) => (
        <div key={r.key} className="card card-pad">
          <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
            <strong>Dentist {idx + 1}</strong>
            <span style={{ flex: 1 }} />
            {rows.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <div className="form-grid">
            <Field label="Full name" required>
              <Input value={r.fullName} onChange={(e) => update(r.key, { fullName: e.target.value })} placeholder="Dr. …" />
            </Field>
            <Field label="Designations" hint="Comma separated, e.g. BDS, PGT (Oral Surgery)">
              <Input
                value={(r.designations ?? []).join(', ')}
                onChange={(e) =>
                  update(r.key, {
                    designations: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Qualifications">
              <Input value={r.qualifications ?? ''} onChange={(e) => update(r.key, { qualifications: e.target.value })} />
            </Field>
            <Field label="Registration / license no.">
              <Input value={r.licenseNo ?? ''} onChange={(e) => update(r.key, { licenseNo: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={r.phone ?? ''} onChange={(e) => update(r.key, { phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input value={r.email ?? ''} onChange={(e) => update(r.key, { email: e.target.value })} />
            </Field>
            <Field label="Working hours" className="span-2">
              <Input
                value={r.workingHours ?? ''}
                onChange={(e) => update(r.key, { workingHours: e.target.value })}
                placeholder="e.g. 10:00 AM – 8:00 PM (Sat–Thu)"
              />
            </Field>
          </div>
        </div>
      ))}
      <div>
        <Button type="button" icon="plus" onClick={() => setRows((rs) => [...rs, { key: Date.now(), fullName: '', designations: [] }])}>
          Add another dentist
        </Button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon="arrowRight">
          Save & continue
        </Button>
      </div>
    </form>
  );
}

function AdminStep({ busy, setBusy, setError, onSaved }: StepProps) {
  const [form, setForm] = useState<AdminAccountInput>({ username: '', password: '', displayName: '' });
  const [confirm, setConfirm] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const pwIssues = validatePassword(form.password, form.username);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (pwIssues.length) {
      setIssues(pwIssues);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('setup.saveAdmin', form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create administrator account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="col" style={{ gap: 'var(--sp-4)', maxWidth: 560 }}>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
        This account becomes the clinic <strong>Owner</strong> — full access to every module, financial reports and
        security settings.
      </p>
      <Field label="Username" required hint="3–32 characters: letters, numbers, . _ -">
        <Input
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          autoComplete="off"
        />
      </Field>
      <Field label="Display name">
        <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
      </Field>
      <div className="form-grid">
        <Field label="Password" required error={issues.length ? issues.join(' · ') : null}>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => {
              setForm((f) => ({ ...f, password: e.target.value }));
              setIssues([]);
            }}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password" required error={confirm && confirm !== form.password ? 'Passwords do not match' : null}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      {form.password ? (
        <div className={`alert ${pwIssues.length ? 'alert-warn' : 'alert-ok'}`}>
          <Icon name={pwIssues.length ? 'alert' : 'check'} size={15} />
          <div>
            {pwIssues.length ? (
              <>Password needs: {pwIssues.join(', ')}</>
            ) : (
              <>Password strength: good (min 8 chars, letter + number)</>
            )}
          </div>
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon="arrowRight">
          Create administrator
        </Button>
      </div>
    </form>
  );
}

function validatePassword(pw: string, username: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push('8+ characters');
  if (!/[A-Za-z]/.test(pw)) issues.push('a letter');
  if (!/\d/.test(pw)) issues.push('a number');
  if (username && pw.toLowerCase().includes(username.toLowerCase()) && username.length >= 3)
    issues.push('no username');
  return issues;
}

function PreferencesStep({ busy, setBusy, setError, onSaved }: StepProps) {
  const [autoLock, setAutoLock] = useState(10);
  const [currencyDecimals, setCurrencyDecimals] = useState(2);
  const [use24h, setUse24h] = useState(false);
  const [backupEvery, setBackupEvery] = useState(7);
  const [backupFolder, setBackupFolder] = useState('');
  const [printer, setPrinter] = useState('');
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);

  useEffect(() => {
    void api('printers.systemPrinters')
      .then(setPrinters)
      .catch(() => setPrinters([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const prefs: SettingsPayload = {
        security: { autoLockMinutes: autoLock },
        general: { moneyDecimals: currencyDecimals, dateFormat: 'short', language: 'en' },
        clinic: { use24HourTime: use24h, moneyDecimals: currencyDecimals },
        backup: { autoEveryDays: backupEvery, folder: backupFolder },
      };
      await api('setup.savePreferences', prefs);
      if (printer) {
        await api('printers.saveProfile', {
          name: 'Default printer',
          printerName: printer,
          paperSize: 'A4',
          isDefault: true,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save preferences');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="col" style={{ gap: 'var(--sp-5)' }}>
      <div className="grid-2">
        <div className="card card-pad col">
          <strong>
            <Icon name="shield" size={14} /> Security
          </strong>
          <Field label="Auto-lock after inactivity" hint="Locks the screen to protect patient data">
            <Select
              value={autoLock}
              onChange={(e) => setAutoLock(Number(e.target.value))}
              options={[
                { value: 5, label: '5 minutes' },
                { value: 10, label: '10 minutes' },
                { value: 15, label: '15 minutes' },
                { value: 30, label: '30 minutes' },
              ]}
            />
          </Field>
          <Field label="Currency display" hint="Bangladeshi Taka (৳)">
            <Select
              value={currencyDecimals}
              onChange={(e) => setCurrencyDecimals(Number(e.target.value))}
              options={[
                { value: 2, label: '৳ 1,250.00 (2 decimals)' },
                { value: 0, label: '৳ 1,250 (no decimals)' },
              ]}
            />
          </Field>
          <Checkbox label="Use 24-hour time format" checked={use24h} onChange={(e) => setUse24h(e.target.checked)} />
        </div>
        <div className="card card-pad col">
          <strong>
            <Icon name="database" size={14} /> Backup
          </strong>
          <Field label="Automatic backup schedule" hint="Backups never interrupt clinic work">
            <Select
              value={backupEvery}
              onChange={(e) => setBackupEvery(Number(e.target.value))}
              options={[
                { value: 0, label: 'Disabled (manual only)' },
                { value: 7, label: 'Every 7 days' },
                { value: 15, label: 'Every 15 days' },
                { value: 30, label: 'Every 30 days' },
              ]}
            />
          </Field>
          <Field label="Backup folder" hint="Optional — you can pick it later in Backup & Restore">
            <div className="row">
              <Input value={backupFolder} onChange={(e) => setBackupFolder(e.target.value)} placeholder="Default location" />
              <Button
                type="button"
                icon="folder"
                onClick={async () => {
                  const res = await api('backup.chooseFolder');
                  if (res.path) setBackupFolder(res.path);
                }}
              >
                Browse
              </Button>
            </div>
          </Field>
        </div>
      </div>
      <div className="card card-pad col">
        <strong>
          <Icon name="print" size={14} /> Printer suggestion
        </strong>
        <p className="muted tiny">
          Pick your main printer now (optional). You can fully configure paper profiles later in Settings → Printing.
        </p>
        <div className="row">
          <Select
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
            placeholder={printers.length ? 'Select a printer…' : 'No printers detected yet'}
            options={printers.map((p) => ({ value: p.name, label: p.name + (p.isDefault ? ' (default)' : '') }))}
          />
          <Button type="button" icon="refresh" onClick={() => void api('printers.systemPrinters').then(setPrinters)}>
            Refresh
          </Button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon="arrowRight">
          Save & continue
        </Button>
      </div>
    </form>
  );
}

function FinishStep({
  busy,
  setBusy,
  setError,
  onFinished,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onFinished: () => void;
}) {
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('setup.finish');
      onFinished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not finish setup');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 'var(--sp-4)', maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
      <div className="state-icon" style={{ margin: '0 auto', width: 64, height: 64, background: 'var(--c-ok-soft)', color: 'var(--c-ok)' }}>
        <Icon name="check" size={30} />
      </div>
      <h2>You're all set!</h2>
      <p className="muted">
        Your clinic, dentists and administrator account are configured. Next steps after finishing:
      </p>
      <div className="col" style={{ textAlign: 'left', gap: 8 }}>
        {[
          'Add your treatment catalog and prices (Clinical → Treatments)',
          'Configure paper profiles for prescriptions/invoices (Settings → Printing)',
          'Choose a backup folder (Administration → Backup)',
          'Create receptionist / dentist user accounts (Staff & Users)',
        ].map((t) => (
          <div key={t} className="row" style={{ gap: 10 }}>
            <Icon name="check" size={14} />
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {t}
            </span>
          </div>
        ))}
      </div>
      <Button variant="primary" size="lg" loading={busy} onClick={() => void submit()} style={{ marginTop: 10 }}>
        Launch Dentiva Pro
      </Button>
    </div>
  );
}
