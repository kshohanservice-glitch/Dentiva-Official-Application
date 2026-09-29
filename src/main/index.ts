import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { setUserDataDir, ensureDirs, paths } from './paths';
import { configureLogging, logger } from './logger';
import { initDatabase, closeDatabase, currentDb, lastRecovery } from './db/database';
import { seedSystemData } from './db/seeds';
import { registerIpc, emitEvent } from './ipc/register';
import { getSession, touchActivity, lockSession } from './services/auth';
import { getAllSettings, getSecuritySettings, cleanupRemovedSettings, applyFormatConfigFromSettings } from './services/settings';
import { generateSystemNotifications, setNotificationEmitter, notify } from './services/notifications';
import { createBackup } from './services/backup';
import { systemActor } from './services/auth';
import { BUILD_NUMBER, APP_VERSION } from './version';

/**
 * Dentiva Pro — Electron main process.
 * Security: context isolation, sandboxed renderer, no node integration,
 * deny-all navigation/popups, strict CSP, narrow validated IPC.
 *
 * Startup observability (FD-005): logging + user-data are configured before
 * ANY other work; every failure path (bootstrap crash, corrupt database,
 * renderer crash, zombie single-instance lock) is logged AND surfaced to the
 * user with the log file location, so "installed but won't run" is diagnosable.
 */

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;
let autoLockTimer: NodeJS.Timeout | null = null;
let backupTimer: NodeJS.Timeout | null = null;
let notifyTimer: NodeJS.Timeout | null = null;
let fatalDialogShown = false;

/** Configure user-data + logging as early as possible (before any DB work). */
function earlyInit(): void {
  try {
    // DENTIVA_USER_DATA_DIR is a support/debug override (used by the CI E2E
    // fixture); the default stays the platform-standard userData path.
    const dir = process.env.DENTIVA_USER_DATA_DIR || app.getPath('userData');
    setUserDataDir(dir);
  } catch {
    /* tests / pre-ready: default paths module fallback applies */
  }
  try {
    configureLogging(paths().logs);
  } catch {
    /* logger keeps its safe default directory */
  }
}

function logFilePath(): string {
  try {
    const d = new Date().toISOString().slice(0, 10);
    return path.join(paths().logs, `dentiva-${d}.log`);
  } catch {
    return '(log location unavailable)';
  }
}

function showFatal(message: string, title = 'Dentiva Pro could not start'): void {
  logger.error(`FATAL: ${message}`);
  if (fatalDialogShown || isDev) return; // never stack dialogs
  fatalDialogShown = true;
  try {
    dialog.showErrorBox(title, `${message}\n\nDiagnostic log: ${logFilePath()}`);
  } catch {
    /* dialog itself failed — nothing more we can do */
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600, // short laptops: content scrolls (see .auth-screen), never clipped
    show: false,
    title: 'Dentiva Pro',
    backgroundColor: '#f6f8fb',
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Deny all window.open / external navigation; open http links in OS browser only
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    const allowed = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  // Renderer crash → log + tell the user + reload (FD-005)
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('Renderer process gone', { reason: details.reason, exitCode: details.exitCode });
    const win = mainWindow;
    try {
      if (win && !win.isDestroyed()) {
        dialog.showErrorBox(
          'Dentiva Pro — view reloaded',
          `The app view crashed and was reloaded (reason: ${details.reason}). Your data is safe.\n\nDiagnostic log: ${logFilePath()}`,
        );
        void win.reload();
      }
    } catch {
      /* best effort */
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
  }

  mainWindow.on('focus', () => touchActivity());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoLock(): void {
  if (autoLockTimer) clearInterval(autoLockTimer);
  autoLockTimer = setInterval(() => {
    try {
      const s = getSession();
      if (!s || s.locked) return;
      const security = getSecuritySettings();
      const minutes = security.autoLockMinutes;
      if (!minutes || minutes <= 0) {
        if (!security.allowDisableAutoLock) {
          // policy disallows disabling — enforce default 10 minutes
          if (Date.now() - s.lastActivityAt > 10 * 60_000) doLock();
        }
        return;
      }
      if (Date.now() - s.lastActivityAt > minutes * 60_000) doLock();
    } catch (err) {
      logger.error('Auto-lock check failed', { err: String(err) });
    }
  }, 15_000);
}

function doLock(): void {
  lockSession();
  emitEvent({ type: 'locked' });
}

function setupScheduledBackup(): void {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(
    async () => {
      try {
        const settings = getAllSettings().backup as Record<string, unknown>;
        const every = Number(settings.autoEveryDays ?? 0);
        if (!every) return;
        const last = settings.lastSuccessAt ? new Date(String(settings.lastSuccessAt)).getTime() : 0;
        if (Date.now() - last >= every * 86_400_000) {
          const result = await createBackup(systemActor(), undefined, 'scheduled automatic backup');
          emitEvent({
            type: 'backup-completed',
            ok: result.ok,
            detail: result.ok ? String(result.path) : String(result.reason),
          });
          if (result.ok) {
            notify({
              type: 'backup_success',
              severity: 'success',
              title: 'Automatic backup completed',
              body: path.basename(String(result.path)),
              route: '/backup',
            });
          } else {
            notify({
              type: 'backup_failed',
              severity: 'critical',
              title: 'Automatic backup failed',
              body: String(result.reason),
              route: '/backup',
            });
          }
        }
      } catch (err) {
        logger.error('Scheduled backup failed', { err: String(err) });
      }
    },
    60 * 60_000,
  );
}

function setupNotificationsLoop(): void {
  if (notifyTimer) clearInterval(notifyTimer);
  generateSystemNotifications();
  notifyTimer = setInterval(() => generateSystemNotifications(), 10 * 60_000);
}

function bootstrap(): void {
  earlyInit();
  ensureDirs();
  logger.info(`Dentiva Pro ${APP_VERSION} (build ${BUILD_NUMBER}) starting`);

  initDatabase(paths().db);
  seedSystemData(currentDb());
  cleanupRemovedSettings();
  applyFormatConfigFromSettings();

  // Corrupt-DB recovery happened on this boot → tell the user (FD-005).
  if (lastRecovery) {
    logger.error(`Startup recovered from corrupt database: ${lastRecovery.reason}`);
    try {
      const moved = lastRecovery.quarantined.join('\n');
      dialog.showErrorBox(
        'Dentiva Pro — previous data protected',
        `The previous database could not be verified and was moved aside (it was NOT deleted):\n` +
          `${moved || lastRecovery.from}\n\n` +
          `A fresh database was created. Open Backup & Restore and restore your most recent ` +
          `backup to bring your clinic data back.\n\nDiagnostic log: ${logFilePath()}`,
      );
    } catch {
      /* best effort */
    }
  }

  setNotificationEmitter((notification, unreadCount) => {
    emitEvent({ type: 'notification', notification, unreadCount });
  });

  registerIpc();
  createWindow();
  setupAutoLock();
  setupScheduledBackup();
  setupNotificationsLoop();

  // touch activity on every successful invoke (handled in dispatch) + here as fallback
  app.on('browser-window-focus', () => touchActivity());
}

earlyInit();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // A previous instance (possibly a zombie) holds the lock. Say so — a silent
  // quit looked exactly like "the app won't start" (FD-005).
  showFatal(
    'Dentiva Pro appears to be already running. If you do not see its window, ' +
      'check the task tray, or end any “Dentiva Pro” process in Task Manager and try again.',
    'Dentiva Pro is already running',
  );
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(() => {
      try {
        bootstrap();
      } catch (err) {
        showFatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
        app.quit();
      }
    })
    .catch((err) => {
      showFatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (autoLockTimer) clearInterval(autoLockTimer);
    if (backupTimer) clearInterval(backupTimer);
    if (notifyTimer) clearInterval(notifyTimer);
    closeDatabase();
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err: err.stack ?? String(err) });
    showFatal(`An unexpected error stopped part of the application: ${err.message}`, 'Dentiva Pro error');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { err: String(reason) });
    showFatal(`An unexpected error occurred: ${String(reason)}`, 'Dentiva Pro error');
  });
}
