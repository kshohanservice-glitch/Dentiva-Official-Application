/**
 * Vitest stub for the `electron` package.
 *
 * Unit/integration tests exercise services that import `electron` for
 * dialogs/windows at module scope. The runtime binary is only present on CI,
 * and tests must never open real windows anyway — so the renderer-side
 * modules get deterministic no-ops instead.
 */
export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined as string | undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
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
