import React, { useState } from 'react';
import { api, useApi, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  LoadingState,
  Modal,
  PageHead,
  Stat,
  useToast,
} from '../components/ui';
import { formatDateTime } from '@shared/format';
import type { BackupManifest, RestorePreview } from '@shared/contract';

export function BackupPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('backup.create');
  const canRestore = perms.includes('backup.restore');
  const toast = useToast();
  const list = useApi('backup.list', undefined, { staleTime: 3000 });
  const settings = useApi('settings.get', { group: 'backup' }, { staleTime: 30_000 });
  const backupSettings = settings.data?.backup as { autoEveryDays?: number; folder?: string } | undefined;
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; data: RestorePreview } | null>(null);
  const [restore, setRestore] = useState<{ path: string; preview: RestorePreview } | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ path: string; valid: boolean; manifest?: BackupManifest; reason?: string } | null>(null);

  const backups = list.data ?? [];
  const totalBytes = backups.reduce((s, b) => s + b.size, 0);

  const chooseFolder = async () => {
    try {
      const res = await api('backup.chooseFolder');
      if (res.path) setFolder(res.path);
    } catch (e) {
      toast.push({ kind: 'error', title: 'Folder picker failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      const res = await api('backup.create', folder ? { destDir: folder } : undefined);
      if (res.ok) {
        toast.push({ kind: 'success', title: 'Backup created', msg: res.path });
        void list.refetch();
      } else {
        toast.push({ kind: 'error', title: 'Backup failed', msg: res.reason });
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'Backup failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (path: string) => {
    setVerifying(path);
    try {
      const res = await api('backup.verify', { path });
      setVerifyResult({ path, ...res });
    } catch (e) {
      setVerifyResult({ path, valid: false, reason: e instanceof Error ? e.message : 'Verify failed' });
    } finally {
      setVerifying(null);
    }
  };

  const openRestore = async (path: string) => {
    try {
      const data = await api('restore.preview', { path });
      setPreview({ path, data });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Preview failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Backup & restore"
        sub={`${backups.length} backups · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB total`}
        actions={
          canManage ? (
            <Button variant="primary" icon="archive" loading={busy} onClick={() => void createBackup()}>
              Back up now
            </Button>
          ) : null
        }
      />

      <div className="stat-grid cols-3">
        <Stat label="Backups on record" value={backups.length} icon="archive" tone="primary" sub="Encrypted .dvbackup archives" />
        <Stat
          label="Last backup"
          value={backups[0] ? formatDateTime(backups[0].createdAt) : 'Never'}
          icon="clock"
          tone={backups.length ? 'ok' : 'warn'}
          sub={backups[0]?.filename}
        />
        <Stat
          label="Auto-backup"
          value={backupSettings?.autoEveryDays ? `every ${backupSettings.autoEveryDays}d` : 'off'}
          icon="refresh"
          tone={backupSettings?.autoEveryDays ? 'ok' : 'warn'}
          sub={backupSettings?.folder || 'Default location'}
        />
      </div>

      {canManage ? (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>Create a backup</h3>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Destination folder" style={{ flex: 1, minWidth: 260 }}>
              <Input readOnly value={folder ?? 'Default location (application data folder)'} />
            </Field>
            <Button icon="folder" onClick={() => void chooseFolder()}>
              Choose folder…
            </Button>
            <Button variant="primary" icon="archive" loading={busy} onClick={() => void createBackup()}>
              Back up now
            </Button>
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Backups are zip archives containing the database, settings and attachments, with a SHA-256 manifest.
            Restoring always takes a safety backup first.
          </p>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h3>Backup history</h3>
          <Button size="sm" icon="refresh" onClick={() => void list.refetch()}>
            Refresh
          </Button>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          {list.isLoading ? (
            <LoadingState />
          ) : backups.length === 0 ? (
            <EmptyState
              title="No backups yet"
              desc="Create your first backup now — before and after every major change. Backups include a verifiable SHA-256 manifest."
              icon="archive"
              action={
                canManage ? (
                  <Button variant="primary" icon="archive" loading={busy} onClick={() => void createBackup()}>
                    Back up now
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Schema / app</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDateTime(b.createdAt)}</td>
                    <td>
                      <div className="cell-main mono">{b.filename}</div>
                      <div className="cell-sub">{b.path}</div>
                    </td>
                    <td className="mono">{(b.size / (1024 * 1024)).toFixed(1)} MB</td>
                    <td>
                      v{b.schemaVersion} / {b.appVersion}
                    </td>
                    <td>
                      <Badge tone={b.status === 'ok' ? 'ok' : 'danger'}>{b.status}</Badge>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon="shield" loading={verifying === b.path} onClick={() => void verify(b.path)}>
                        Verify
                      </Button>
                      {canRestore ? (
                        <Button size="sm" variant="ghost" icon="undo" onClick={() => void openRestore(b.path)}>
                          Restore
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {canRestore ? (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>Restore from a file</h3>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <Field label=".dvbackup path" style={{ flex: 1 }}>
              <Input value={manualPath} onChange={(e) => setManualPath(e.target.value)} placeholder="C:\Backups\dentiva-2026-09-28.dvbackup" />
            </Field>
            <Button icon="folder" onClick={() => void chooseFolder()}>
              Choose folder…
            </Button>
            <Button icon="eye" disabled={!manualPath.trim()} onClick={() => void openRestore(manualPath.trim())}>
              Preview
            </Button>
          </div>
        </div>
      ) : null}

      <Modal open={preview != null} title="Restore preview" onClose={() => setPreview(null)} size="lg">
        {preview ? (
          <div className="col" style={{ gap: 12 }}>
            {!preview.data.valid ? (
              <div className="alert alert-danger">
                <Icon name="alert" size={16} />
                <div>
                  <strong>Archive failed validation:</strong> {preview.data.reason ?? 'unknown reason'}
                </div>
              </div>
            ) : (
              <>
                <div className="alert alert-warn">
                  <Icon name="alert" size={16} />
                  <div>
                    Restoring <strong>replaces all current data</strong> with this archive. A safety backup of the
                    current state is taken automatically. This cannot be undone except from that safety backup.
                  </div>
                </div>
                <dl className="kv">
                  <dt>Created</dt>
                  <dd>{formatDateTime(preview.data.manifest.createdAt)}</dd>
                  <dt>Clinic</dt>
                  <dd>{preview.data.manifest.clinicName ?? '—'}</dd>
                  <dt>App / schema</dt>
                  <dd>
                    {preview.data.manifest.appVersion} · schema v{preview.data.manifest.schemaVersion}
                  </dd>
                  <dt>Contents</dt>
                  <dd>
                    {Object.entries(preview.data.manifest.counts)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </dd>
                </dl>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <Button onClick={() => setPreview(null)}>Cancel</Button>
                  <Button
                    variant="danger"
                    icon="undo"
                    onClick={() => {
                      setRestore({ path: preview.path, preview: preview.data });
                      setPreview(null);
                    }}
                  >
                    Continue to restore…
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={restore != null}
        title="Restore backup"
        danger
        confirmLabel="Restore now"
        requirePassword
        requirePhrase="RESTORE"
        message={
          restore ? (
            <div className="col" style={{ gap: 8 }}>
              <div>
                You are about to <strong>replace all current data</strong> with the backup from{' '}
                {formatDateTime(restore.preview.manifest.createdAt)} ({Object.values(restore.preview.manifest.counts).reduce((a, b) => a + b, 0)} records).
              </div>
              <div className="tiny muted">Type RESTORE to confirm. The app will reload after the restore completes.</div>
            </div>
          ) : (
            ''
          )
        }
        onCancel={() => setRestore(null)}
        onConfirm={async ({ password, phrase }) => {
          if (!restore) return;
          try {
            const res = await api('restore.run', { path: restore.path, password, confirmPhrase: phrase });
            if (res.ok) {
              toast.push({
                kind: 'success',
                title: 'Restore complete',
                msg: res.safetyBackupPath ? `Safety backup: ${res.safetyBackupPath}` : undefined,
              });
              setTimeout(() => window.location.reload(), 1800);
            } else {
              toast.push({ kind: 'error', title: 'Restore failed', msg: res.reason });
            }
          } catch (e) {
            toast.push({ kind: 'error', title: 'Restore failed', msg: e instanceof Error ? e.message : undefined });
          }
          setRestore(null);
        }}
      />

      <Modal open={verifyResult != null} title="Verify backup" onClose={() => setVerifyResult(null)}>
        {verifyResult ? (
          <div className="col" style={{ gap: 10 }}>
            <div className={`alert ${verifyResult.valid ? 'alert-ok' : 'alert-danger'}`}>
              <Icon name={verifyResult.valid ? 'check' : 'alert'} size={16} />
              <div>
                {verifyResult.valid ? (
                  <>
                    <strong>Archive is valid.</strong> All file hashes match the manifest.
                  </>
                ) : (
                  <>
                    <strong>Verification failed:</strong> {verifyResult.reason ?? 'hash mismatch or unreadable archive'}
                  </>
                )}
              </div>
            </div>
            {verifyResult.manifest ? (
              <dl className="kv">
                <dt>Created</dt>
                <dd>{formatDateTime(verifyResult.manifest.createdAt)}</dd>
                <dt>Files</dt>
                <dd>{verifyResult.manifest.files.length}</dd>
                <dt>App</dt>
                <dd>{verifyResult.manifest.appVersion}</dd>
              </dl>
            ) : null}
            <p className="tiny mono" style={{ wordBreak: 'break-all' }}>
              {verifyResult.path}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
