// Test stand-in for `virtual:pwa-register/react` (see vite.config.ts): no update waiting.
// Tests that need an update use vi.mock on the virtual module.
import { useState } from 'react';
import type { useRegisterSW as real } from 'virtual:pwa-register/react';

export const useRegisterSW: typeof real = () => ({
  needRefresh: useState(false),
  offlineReady: useState(false),
  updateServiceWorker: async () => undefined,
});
