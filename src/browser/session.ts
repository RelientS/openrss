/**
 * Browser session management.
 * Provides pages to route handlers that need browser access.
 */

import { BridgePage } from './page.js';
import { checkExtensionConnected } from './client.js';
import type { IPage } from './types.js';
import { logger } from '../utils/logger.js';

export async function getBrowserPage(workspace: string): Promise<IPage> {
  const connected = await checkExtensionConnected();
  if (!connected) {
    throw new Error(
      'Chrome Extension is not connected. ' +
      'Please: 1) Open Chrome  2) Load the OpenRSS extension from extension/ directory  ' +
      '3) The extension will auto-connect to the daemon'
    );
  }

  logger.debug(`Creating browser page for workspace: ${workspace}`);
  return new BridgePage(workspace);
}

export async function withBrowserPage<T>(
  workspace: string,
  fn: (page: IPage) => Promise<T>
): Promise<T> {
  const page = await getBrowserPage(workspace);
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}
