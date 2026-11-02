// Screenshots for docs/integration-report.md (backend-spec 15.6), taken only when VT_SHOTS_DIR is
// set (`make walkthrough`). Synthetic seed data only.
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.VT_SHOTS_DIR;
  if (!dir || !process.env.VT_E2E_REAL_API) return;
  await page.screenshot({ path: join(dir, `${name}.png`) });
}
