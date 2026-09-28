import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { setUserDataDir, ensureDirs, paths } from './paths';
import { configureLogging, logger } from './logger';
import { initDatabase, closeDatabase, currentDb } from './db/database';
import { seedSystemData } from './db/seeds';
import { registerIpc, emitEvent } from './ipc/register';
import { getSession, touchActivity, lockSession } from './services/auth';
import { getAllSettings, getSecuritySettings } from './services/settings';
import { generateSystemNotifications, setNotificationEmitter, notify } from './services/notifications';
import { createBackup } from './services/backup';
import { systemActor } from './services/auth';
import { BUILD_NUMBER, APP_VERSION } from './version';

/**
 * Dentiva Pro — Electron main process.
 * Security: context isolation, sandboxed renderer, no node integration,
 * deny-all navigation/popups, strict CSP, narrow validated IPC.
 */

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;
let autoLockTimer: NodeJS.Timeout | null = null;
let backupTimer: NodeJS.Timeout | null = null;
let notifyTimer: NodeJS.Timeout | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
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
  setUserDataDir(app.getPath('userData'));
  ensureDirs();
  configureLogging(paths().logs);
  logger.info(`Dentiva Pro ${APP_VERSION} (build ${BUILD_NUMBER}) starting`);

  initDatabase(paths().db);
  seedSystemData(currentDb());

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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch((err) => {
    logger.error('Bootstrap failed', { err: String(err) });
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
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { err: String(reason) });
  });
}
