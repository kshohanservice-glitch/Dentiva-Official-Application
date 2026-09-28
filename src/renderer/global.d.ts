import type { ApiInput, ApiMethod, ApiOutput, AppEvent } from '@shared/contract';

export {};

declare global {
  interface Window {
    dentiva?: {
      invoke<M extends ApiMethod>(method: M, payload?: ApiInput<M>): Promise<ApiOutput<M>>;
      onEvent(cb: (e: AppEvent) => void): () => void;
    };
  }
}
