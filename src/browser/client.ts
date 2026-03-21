/**
 * HTTP client for talking to the OpenRSS daemon.
 */

import { config } from '../config.js';
import type { BrowserCommand, BrowserResponse } from './types.js';

const BASE_URL = `http://127.0.0.1:${config.daemonPort}`;

export async function sendCommand(
  action: string,
  params: Record<string, unknown> = {},
  workspace?: string
): Promise<BrowserResponse> {
  const body: Omit<BrowserCommand, 'id'> = { action, params, workspace };

  const resp = await fetch(`${BASE_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Daemon returned ${resp.status}: ${await resp.text()}`);
  }

  return resp.json() as Promise<BrowserResponse>;
}

export async function checkExtensionConnected(): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE_URL}/status`);
    const data = await resp.json() as { extension: boolean };
    return data.extension;
  } catch {
    return false;
  }
}
