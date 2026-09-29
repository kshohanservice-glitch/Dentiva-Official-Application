/**
 * Vitest stub for the `electron` package.
 *
 * Unit/integration tests exercise services that import `electron` for
 * dialogs/windows at module scope. The runtime binary is only present on CI,
 * and tests must never open real windows anyway — so the renderer-side
 * modules get deterministic no-ops instead.
 */
/**
 * Test-controlled dialog results. Tests can override `saveResult` /
 * `openResult` to exercise the full service path (e.g. a confirmed save
 * dialog for CSV export) instead of the default "canceled" no-op.
 */
export const stubDialog = {
  saveResult: { canceled: true, filePath: undefined as string | undefined },
  openResult: { canceled: true, filePaths: [] as string[] },
  reset() {
    this.saveResult = { canceled: true, filePath: undefined };
    this.openResult = { canceled: true, filePaths: [] };
  },
};

export const dialog = {
  showSaveDialog: async () => stubDialog.saveResult,
  showOpenDialog: async () => stubDialog.openResult,
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
};

export class BrowserWindow {
  static getAllWindows(): unknown[] {
    return [];
  }
  static getFocusedWindow(): null {
    return null;
  }
}

export const app = {
  getPath: (name: string) => process.cwd() + '/' + name,
  getName: () => 'Dentiva Pro',
  getVersion: () => '0.0.0-test',
  isPackaged: false,
};

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
};

export const shell = { openPath: async () => undefined, showItemInFolder: () => undefined };
export const clipboard = { writeText: () => undefined, readText: () => '' };

export default { dialog, BrowserWindow, app, ipcMain, shell, clipboard };
