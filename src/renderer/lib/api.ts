import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ApiInput, ApiMethod, ApiOutput, AppEvent } from '@shared/contract';

export { useAppState, usePermissions, AppCtx, type AppStateCtx } from './appState';

/** Typed IPC client + query helpers. */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<M extends ApiMethod>(method: M, payload?: ApiInput<M>): Promise<ApiOutput<M>> {
  if (!window.dentiva) throw new ApiError('no_bridge', 'Application bridge is not available');
  try {
    return await window.dentiva.invoke(method, payload);
  } catch (err) {
    const e = err as Error & { code?: string };
    throw new ApiError(e.code ?? 'internal', e.message || 'Unexpected error');
  }
}

export function useApi<M extends ApiMethod>(
  method: M,
  payload?: ApiInput<M>,
  opts: { enabled?: boolean; refetchInterval?: number | false; staleTime?: number } = {},
) {
  return useQuery<ApiOutput<M>, ApiError>({
    queryKey: [method, payload ?? {}] as QueryKey,
    queryFn: () => api(method, payload),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
    staleTime: opts.staleTime ?? 15_000,
    retry: (count, err) => err?.code !== 'forbidden' && err?.code !== 'not_found' && count < 1,
  });
}

export function useApiMutation<M extends ApiMethod>(
  method: M,
  opts: { invalidate?: string[]; onSuccess?: (data: ApiOutput<M>) => void; onError?: (err: ApiError) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<ApiOutput<M>, ApiError, ApiInput<M>>({
    mutationFn: (payload) => api(method, payload),
    onSuccess: (data) => {
      if (opts.invalidate) {
        for (const key of opts.invalidate) void qc.invalidateQueries({ queryKey: [key] });
      }
      void qc.invalidateQueries();
      opts.onSuccess?.(data);
    },
    onError: (err) => opts.onError?.(err),
  });
}

export function useAppEvents(handler: (e: AppEvent) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    const unsub = window.dentiva?.onEvent((e) => ref.current(e));
    return () => unsub?.();
  }, []);
}

/** Permission check hook — UI-level convenience; server always re-checks. */
export function can(permissions: string[] | undefined, perm: string | string[]): boolean {
  if (!permissions) return false;
  if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));
  return permissions.includes(perm);
}
