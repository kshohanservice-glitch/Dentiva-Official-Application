import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, useApi, useAppState } from '../lib/api';
import { Button, Icon, useToast, EmptyState, LoadingState, Badge } from './ui';
import { formatDate } from '@shared/format';
import type { GlobalSearchResult, NotificationDto } from '@shared/contract';

interface NavDef {
  section: string;
  items: { to: string; label: string; icon: string; perm?: string | string[]; end?: boolean }[];
}

const NAV: NavDef[] = [
  {
    section: 'PRACTICE',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/patients', label: 'Patients', icon: 'users', perm: 'patient.view' },
      { to: '/appointments', label: 'Appointments', icon: 'calendar', perm: 'appointment.view' },
      { to: '/queue', label: 'Queue', icon: 'list', perm: 'queue.manage' },
    ],
  },
  {
    section: 'CLINICAL',
    items: [
      { to: '/treatments', label: 'Treatments', icon: 'stethoscope', perm: 'clinical.view' },
      { to: '/prescriptions', label: 'Prescriptions', icon: 'file', perm: 'prescription.view' },
      { to: '/visits', label: 'Visits', icon: 'clipboard', perm: 'clinical.view' },
    ],
  },
  {
    section: 'BILLING',
    items: [
      { to: '/invoices', label: 'Invoices', icon: 'receipt', perm: 'invoice.view' },
      { to: '/payments', label: 'Payments', icon: 'money', perm: 'payment.view' },
      { to: '/inventory', label: 'Inventory', icon: 'package', perm: 'inventory.view' },
      { to: '/accounting', label: 'Accounting', icon: 'wallet', perm: 'accounting.view' },
    ],
  },
  {
    section: 'ADMINISTRATION',
    items: [
      { to: '/staff', label: 'Staff & Users', icon: 'user', perm: ['staff.view', 'user.manage'] },
      { to: '/backup', label: 'Backup & Restore', icon: 'database', perm: 'backup.create' },
      { to: '/settings', label: 'Settings', icon: 'settings', perm: 'settings.view' },
      { to: '/audit', label: 'Audit Log', icon: 'shield', perm: 'audit.view' },
      { to: '/about', label: 'About', icon: 'info' },
    ],
  },
];

function hasPerm(perms: string[], perm?: string | string[]): boolean {
  if (!perm) return true;
  if (Array.isArray(perm)) return perm.some((p) => perms.includes(p));
  return perms.includes(perm);
}

/* ------------------------------ global palette ------------------------------ */
function GlobalPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api('search.global', { q: q.trim(), limit: 12 });
        setResults(res);
        setSel(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [q]);

  const go = (r: GlobalSearchResult) => {
    navigate(r.route);
    onClose();
  };

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette">
        <input
          autoFocus
          placeholder="Search patients, invoices, prescriptions, inventory…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') setSel((s) => Math.min(results.length - 1, s + 1));
            if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
            if (e.key === 'Enter' && results[sel]) go(results[sel]);
          }}
        />
        <div className="palette-results">
          {q.trim().length < 2 ? (
            <div className="state-block" style={{ padding: 24 }}>
              <p className="muted">Type at least 2 characters to search across the clinic database.</p>
            </div>
          ) : loading ? (
            <LoadingState label="Searching…" />
          ) : results.length === 0 ? (
            <div className="state-block" style={{ padding: 24 }}>
              <p className="muted">No results found for “{q}”.</p>
            </div>
          ) : (
            results.map((r, i) => (
              <button key={`${r.category}-${r.id}-${i}`} className={`palette-item ${i === sel ? 'sel' : ''}`} onClick={() => go(r)}>
                <span className="palette-cat">{r.category}</span>
                <span>
                  <div className="pi-title">{r.title}</div>
                  {r.subtitle ? <div className="pi-sub">{r.subtitle}</div> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ notifications ------------------------------ */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useApi('notifications.list', { unreadOnly: false }, { staleTime: 5_000, refetchInterval: 45_000 });
  const items = qc.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const markAll = async () => {
    await api('notifications.markRead', {});
    await qc.refetch();
  };

  const sevIcon = (s: NotificationDto['severity']) =>
    s === 'critical' ? 'alert' : s === 'warning' ? 'alert' : s === 'success' ? 'check' : 'info';
  const sevBg = (s: NotificationDto['severity']) =>
    s === 'critical'
      ? 'var(--c-danger-soft)'
      : s === 'warning'
        ? 'var(--c-warn-soft)'
        : s === 'success'
          ? 'var(--c-ok-soft)'
          : 'var(--c-info-soft)';

  return (
    <>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Icon name="bell" size={17} />
        {unread > 0 ? <span className="dot">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel" ref={panelRef}>
          <div className="np-head">
            <Icon name="bell" size={15} /> Notifications
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => void markAll()}>
              Mark all read
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="chevronR"
              onClick={() => {
                navigate('/notifications');
                setOpen(false);
              }}
            />
          </div>
          <div className="notif-list">
            {qc.isLoading ? (
              <LoadingState />
            ) : items.length === 0 ? (
              <EmptyState title="All caught up" desc="No notifications right now." icon="bell" />
            ) : (
              items.slice(0, 30).map((n) => (
                <div
                  key={n.id}
                  className={`notif ${n.readAt ? '' : 'unread'}`}
                  onClick={async () => {
                    if (!n.readAt) await api('notifications.markRead', { ids: [n.id] });
                    if (n.route) navigate(n.route);
                    await qc.refetch();
                  }}
                >
                  <div className="n-icon" style={{ background: sevBg(n.severity) }}>
                    <Icon name={sevIcon(n.severity)} size={14} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="n-title">{n.title}</div>
                    <div className="n-body">{n.body}</div>
                    <div className="n-time">{formatDate(n.createdAt, 'short')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/* --------------------------------- shell --------------------------------- */
export function Shell({ children }: { children: React.ReactNode }) {
  const { state, refresh } = useAppState();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dp.sidebar') === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const perms = state.user?.permissions ?? [];
  const profileRef = useRef<HTMLDivElement>(null);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem('dp.sidebar', c ? '0' : '1');
      return !c;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === 'Escape') setPaletteOpen(false);
      if (inField) return;
      if (e.key === 'F5') {
        e.preventDefault();
        void refresh();
        toast.push({ kind: 'info', title: 'Refreshed' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (perms.includes('patient.create')) navigate('/patients/new');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void api('auth.lock').then(() => refresh());
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        // let page-level handlers intercept; only prevent browser print
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, perms, refresh, toast]);

  useEffect(() => {
    if (!profileMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [profileMenu]);

  const logout = async () => {
    await api('auth.logout');
    await refresh();
  };

  const user = state.user;
  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Icon name="tooth" size={17} />
          </div>
          <div className="brand-text">
            <div className="brand-name">Dentiva Pro</div>
            <div className="brand-sub">CLINICAL SUITE</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((sec) => {
            const visible = sec.items.filter((it) => hasPerm(perms, it.perm));
            if (!visible.length) return null;
            return (
              <div className="nav-section" key={sec.section}>
                <div className="nav-section-title">{sec.section}</div>
                {visible.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    title={collapsed ? it.label : undefined}
                  >
                    <span className="nav-icon">
                      <Icon name={it.icon} size={16} />
                    </span>
                    <span className="nav-label">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {collapsed ? 'v' : `v${state.appVersion} · build ${state.buildNumber}`}
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
            <Icon name="list" size={17} />
          </button>
          <div className="clinic-name">{state.clinicName || 'Dentiva Pro'}</div>
          <div className="today">{formatDate(new Date().toISOString().slice(0, 10), 'long')}</div>
          <div className="spacer" />
          <button className="global-search-btn" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={14} />
            Search anything…
            <kbd>Ctrl K</kbd>
          </button>
          <NotificationBell />
          <button className="icon-btn" title="Lock screen (Ctrl+L)" onClick={() => void api('auth.lock').then(() => refresh())}>
            <Icon name="lock" size={16} />
          </button>
          <div ref={profileRef} style={{ position: 'relative' }}>
            <div
              className="user-chip"
              onClick={() => setProfileMenu((o) => !o)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setProfileMenu((o) => !o)}
            >
              <div className="avatar">{initials}</div>
              <div style={{ textAlign: 'left' }}>
                <div className="u-name">{user?.displayName || user?.username}</div>
                <div className="u-role">{user?.roleName}</div>
              </div>
              <Icon name="chevronD" size={13} />
            </div>
            {profileMenu ? (
              <div className="dropdown" style={{ top: 'calc(100% + 8px)', right: 0 }}>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setProfileMenu(false);
                    navigate('/settings?tab=profile');
                  }}
                >
                  <Icon name="user" size={14} /> My profile
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setProfileMenu(false);
                    navigate('/about');
                  }}
                >
                  <Icon name="info" size={14} /> About
                </button>
                <div className="dropdown-sep" />
                <button className="dropdown-item danger" onClick={() => void logout()}>
                  <Icon name="logOut" size={14} /> Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="page-scroll">{children}</main>
      </div>

      {paletteOpen ? <GlobalPalette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}

export { Badge, useApi };
