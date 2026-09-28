import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  EmptyState,
  Icon,
  LoadingState,
  PageHead,
  useToast,
} from '../components/ui';
import { formatDateTime } from '@shared/format';
import type { NotificationDto } from '@shared/contract';

/* ================================ ABOUT ================================ */

const DEPS: { name: string; purpose: string; license: string }[] = [
  { name: 'Electron', purpose: 'Desktop runtime (Chromium + Node)', license: 'MIT' },
  { name: 'React 18', purpose: 'UI framework', license: 'MIT' },
  { name: 'Vite', purpose: 'Renderer build', license: 'MIT' },
  { name: 'better-sqlite3', purpose: 'Embedded database', license: 'MIT' },
  { name: 'TanStack Query', purpose: 'Data fetching / cache', license: 'MIT' },
  { name: 'Zod', purpose: 'IPC input validation', license: 'MIT' },
  { name: '@noble/hashes', purpose: 'Argon2id password hashing (audited primitives)', license: 'CC0 / MIT' },
  { name: 'yazl / yauzl', purpose: 'Backup archive write/read', license: 'MIT' },
  { name: 'Inter (font)', purpose: 'Latin UI typeface', license: 'OFL 1.1' },
  { name: 'Noto Sans Bengali', purpose: 'Bengali Unicode typeface', license: 'OFL 1.1' },
];

export function AboutPage() {
  const { state } = useAppState();
  const year = new Date().getFullYear();

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="About" sub="Product & legal information" />

      <div className="card card-pad" style={{ textAlign: 'center', padding: 'var(--sp-6) var(--sp-5)' }}>
        <div className="logo-mark" style={{ width: 74, height: 74, margin: '0 auto 14px', display: 'flex' }}>
          <Icon name="tooth" size={38} />
        </div>
        <h1 style={{ fontSize: 'var(--fs-3xl)', margin: 0 }}>Dentiva Pro</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Offline-first dental clinic management for Bangladesh
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Badge tone="primary">v{state.appVersion}</Badge>
          <Badge tone="info">build {state.buildNumber}</Badge>
          <Badge tone="neutral">schema v{state.schemaVersion}</Badge>
          <Badge tone={state.activated ? 'ok' : 'warn'}>{state.activated ? 'activated' : 'not activated'}</Badge>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>Created by</h3>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div className="avatar" style={{ width: 46, height: 46, fontSize: 16 }}>
              SK
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>Shohan Khan</div>
              <a href="mailto:helloiamshohan@gmail.com" className="tiny" style={{ color: 'var(--c-primary)' }}>
                helloiamshohan@gmail.com
              </a>
            </div>
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Dentiva Pro runs entirely on this computer. No data leaves your clinic — no cloud accounts, no telemetry,
            no internet required after installation.
          </p>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>At a glance</h3>
          <ul className="col" style={{ gap: 6, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)' }}>
            <li>Patients, visits, odontogram (FDI), treatments & prescriptions</li>
            <li>A4 / A5 / thermal printing with PDF export</li>
            <li>Appointments, live queue board & reminders</li>
            <li>Invoices, partial payments, inventory, accounting & reports</li>
            <li>Role-based permissions enforced in the service layer</li>
            <li>Audit log, encrypted backups with SHA-256 verification</li>
            <li>Full Bengali Unicode support for content & prints</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Open-source components</h3>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Component</th>
                <th>Purpose</th>
                <th>License</th>
              </tr>
            </thead>
            <tbody>
              {DEPS.map((d) => (
                <tr key={d.name}>
                  <td className="cell-main">{d.name}</td>
                  <td>{d.purpose}</td>
                  <td>
                    <Badge tone="neutral">{d.license}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        © {year} Shohan Khan · Dentiva Pro v{state.appVersion} · All rights reserved · Built for dental clinics in
        Bangladesh 🇧🇩
      </p>
    </div>
  );
}

/* ================================ NOTIFICATIONS ================================ */

const SEVERITY_ICON: Record<NotificationDto['severity'], string> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  critical: 'alert',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const list = useApi('notifications.list', filter === 'unread' ? { unreadOnly: true } : undefined, { staleTime: 5000 });
  const items = list.data ?? [];

  const markAll = async () => {
    try {
      await api('notifications.markRead', {});
      toast.push({ kind: 'success', title: 'All notifications marked read' });
      void list.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Action failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  const open = async (n: NotificationDto) => {
    try {
      if (!n.readAt) await api('notifications.markRead', { ids: [n.id] });
    } catch {
      /* navigation still proceeds */
    }
    if (n.route) navigate(n.route);
    void list.refetch();
  };

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHead
        title="Notifications"
        sub={`${items.length} shown`}
        actions={
          <Button icon="check" onClick={() => void markAll()}>
            Mark all read
          </Button>
        }
      />
      <div className="toolbar">
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
        />
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="refresh" onClick={() => void list.refetch()}>
          Refresh
        </Button>
      </div>

      {list.isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'No unread notifications' : 'No notifications'}
          desc="Stock alerts, appointment reminders, backup results and unpaid invoice nudges appear here."
          icon="bell"
        />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {items.map((n) => (
            <div
              key={n.id}
              className="card card-pad"
              style={{
                padding: 'var(--sp-3) var(--sp-4)',
                borderLeft: `4px solid var(--c-${n.severity === 'critical' ? 'danger' : n.severity === 'warning' ? 'warn' : n.severity === 'success' ? 'ok' : 'info'})`,
                opacity: n.readAt ? 0.72 : 1,
                cursor: n.route ? 'pointer' : 'default',
              }}
              onClick={() => void open(n)}
            >
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span className={`icon-tile tone-${n.severity === 'critical' ? 'danger' : n.severity === 'warning' ? 'warn' : n.severity === 'success' ? 'ok' : 'info'}`} style={{ flexShrink: 0 }}>
                  <Icon name={SEVERITY_ICON[n.severity]} size={16} />
                </span>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{n.title}</strong>
                    {!n.readAt ? <Badge tone="primary">new</Badge> : null}
                  </div>
                  <div className="tiny" style={{ color: 'var(--c-text-2)', marginTop: 2 }}>
                    {n.body}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {formatDateTime(n.createdAt)}
                    {n.route ? ' · click to open' : ''}
                  </div>
                </div>
                {!n.readAt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="check"
                    title="Mark read"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api('notifications.markRead', { ids: [n.id] }).then(() => void list.refetch());
                    }}
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="x"
                  title="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    void api('notifications.dismiss', { id: n.id }).then(() => void list.refetch());
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
