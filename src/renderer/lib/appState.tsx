import { createContext, useContext } from 'react';
import type { AppState } from '@shared/contract';

export interface AppStateCtx {
  state: AppState;
  refresh: () => Promise<void>;
}

export const AppCtx = createContext<AppStateCtx | null>(null);

export function useAppState(): AppStateCtx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('AppState missing');
  return ctx;
}

export function usePermissions(): string[] {
  return useAppState().state.user?.permissions ?? [];
}
