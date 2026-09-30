import { contextBridge, ipcRenderer } from 'electron';
import type { ApiInput, ApiMethod, ApiOutput, AppEvent } from '../shared/contract';
import { API_METHODS } from '../shared/contract';

/**
 * Minimal, validated preload bridge. The renderer only gets `invoke` for
 * allow-listed methods and an event subscription — no filesystem, no Node,
 * no arbitrary IPC.
 */

const ALLOWED = new Set<string>(API_METHODS);

type Unsub = () => void;

const listeners = new Set<(e: AppEvent) => void>();

ipcRenderer.on('dp:event', (_e, payload: AppEvent) => {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      /* listener errors must not break the bridge */
    }
  }
});

const bridge = {
  invoke<M extends ApiMethod>(method: M, payload?: ApiInput<M>): Promise<ApiOutput<M>> {
    if (!ALLOWED.has(method)) {
      return Promise.reject(new Error('Method not allowed: ' + method));
    }
    return ipcRenderer.invoke('dp:invoke', method, payload).then((res: unknown) => {
      const r = res as { result?: unknown; error?: { code: string; message: string } };
      if (r && typeof r === 'object' && 'error' in r && r.error) {
        const err = new Error(r.error.message) as Error & { code: string };
        err.code = r.error.code;
        throw err;
      }
      return r?.result as ApiOutput<M>;
    });
  },
  onEvent(cb: (e: AppEvent) => void): Unsub {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export type DentivaBridge = typeof bridge;

contextBridge.exposeInMainWorld('dentiva', bridge);
