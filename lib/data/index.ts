import { LocalStorageReportsRepository } from './local-storage-reports-repository';
import type { ReportsRepository } from './reports-repository';

export type { ReportsRepository } from './reports-repository';

let singleton: ReportsRepository | null = null;

/**
 * Single switch point for the repository implementation. UI code should
 * always go through this factory rather than importing a concrete
 * repository class -- swapping to Supabase later means changing only this
 * function.
 */
export function getReportsRepository(): ReportsRepository {
  if (!singleton) {
    singleton = new LocalStorageReportsRepository();
  }
  return singleton;
}
