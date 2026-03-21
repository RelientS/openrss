/**
 * IPage implementation backed by the daemon → extension bridge.
 */

import type { IPage } from './types.js';
import { sendCommand } from './client.js';

export class BridgePage implements IPage {
  constructor(private workspace: string) {}

  async goto(url: string, options?: { waitUntil?: string }): Promise<void> {
    const resp = await sendCommand('navigate', {
      url,
      timeout: 30000,
      ...options,
    }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'Navigation failed');
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    const resp = await sendCommand('evaluate', { script }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'Evaluate failed');
    return resp.data as T;
  }

  async evaluateFunction<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
    const resp = await sendCommand('evaluateFunction', { fn, args }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'EvaluateFunction failed');
    return resp.data as T;
  }

  async getCookies(domain: string): Promise<Array<{ name: string; value: string }>> {
    const resp = await sendCommand('getCookies', { domain }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'GetCookies failed');
    return resp.data as Array<{ name: string; value: string }>;
  }

  async waitForSelector(selector: string, timeout = 10000): Promise<void> {
    const resp = await sendCommand('waitForSelector', { selector, timeout }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'WaitForSelector failed');
  }

  async installInterceptor(urlPattern: string): Promise<void> {
    const resp = await sendCommand('installInterceptor', { urlPattern }, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'InstallInterceptor failed');
  }

  async getInterceptedRequests(): Promise<Array<{ url: string; body: unknown }>> {
    const resp = await sendCommand('getInterceptedRequests', {}, this.workspace);
    if (!resp.success) throw new Error(resp.error || 'GetInterceptedRequests failed');
    return resp.data as Array<{ url: string; body: unknown }>;
  }

  async close(): Promise<void> {
    await sendCommand('close', {}, this.workspace).catch(() => {});
  }
}
