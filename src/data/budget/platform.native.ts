import { createApplicationRuntime } from './application-runtime';
import { openNativeRuntimeStore } from './runtime-store.native';
import { migrateDatabase } from './migrations';

// No environment variable or route parameter can turn this into a v3 opener.
const application = createApplicationRuntime({ allowV3: false, autoUpgrade: false,
  initializeV2: migrateDatabase,
  now: () => new Date().toISOString(), store: () => openNativeRuntimeStore({ kind: 'user-v2-only' }) });
export function getApplicationRepository() { return application; }
export async function getBudgetRepository() { await application.initialize(); return application; }
