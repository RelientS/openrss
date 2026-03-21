/**
 * Direct CDP connection to Chrome — no extension needed.
 *
 * Reads Chrome's DevToolsActivePort file to find the debugging port,
 * connects via WebSocket, and implements IPage.
 *
 * This is the preferred strategy when running in Claude Code with
 * Chrome DevTools MCP, or when Chrome is launched with --remote-debugging-port.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import WebSocket from 'ws';
import type { IPage } from './types.js';
import { logger } from '../utils/logger.js';

// ── Chrome DevTools Port Discovery ──

function getDevToolsActivePortPath(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort');
    case 'linux':
      return join(home, '.config/google-chrome/DevToolsActivePort');
    case 'win32':
      return join(home, 'AppData/Local/Google/Chrome/User Data/DevToolsActivePort');
    default:
      return '';
  }
}

export function getChromeDebugPort(): number | null {
  const portFile = process.env.CHROME_DEVTOOLS_PORT_FILE || getDevToolsActivePortPath();
  if (!portFile || !existsSync(portFile)) return null;
  try {
    const content = readFileSync(portFile, 'utf-8').trim();
    const port = parseInt(content.split('\n')[0], 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

export async function getChromeTargets(port: number): Promise<Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string; type: string }>> {
  const resp = await fetch(`http://127.0.0.1:${port}/json`);
  return resp.json() as any;
}

// ── CDP Page Implementation ──

export class CDPPage implements IPage {
  private ws: WebSocket;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message));
          } else {
            p.resolve(msg.result);
          }
        }
      }
    });
  }

  static async connect(wsUrl: string): Promise<CDPPage> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        logger.info('CDP connected to Chrome');
        resolve(new CDPPage(ws));
      });
      ws.on('error', reject);
    });
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.enable');
    await this.send('Page.navigate', { url });
    // Wait for load event
    await new Promise<void>((resolve) => {
      const listener = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'Page.loadEventFired') {
          this.ws.off('message', listener);
          resolve();
        }
      };
      this.ws.on('message', listener);
      setTimeout(() => { this.ws.off('message', listener); resolve(); }, 30000);
    });
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Evaluation failed');
    }
    return result.result?.value as T;
  }

  async evaluateFunction<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
    const argsStr = args.map(a => JSON.stringify(a)).join(',');
    return this.evaluate(`(${fn})(${argsStr})`);
  }

  async getCookies(domain: string): Promise<Array<{ name: string; value: string }>> {
    const result = await this.send('Network.getCookies', { urls: [`https://${domain}`] });
    return (result.cookies || []).map((c: any) => ({ name: c.name, value: c.value }));
  }

  async waitForSelector(selector: string, timeout = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await this.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (found) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Selector "${selector}" not found within ${timeout}ms`);
  }

  async installInterceptor(urlPattern: string): Promise<void> {
    await this.evaluate(`
      (function() {
        if (!window.__openrss_intercepted) window.__openrss_intercepted = [];
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const resp = await origFetch.apply(this, args);
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          if (url.includes(${JSON.stringify(urlPattern)})) {
            try {
              const clone = resp.clone();
              const body = await clone.json();
              window.__openrss_intercepted.push({ url, body });
            } catch {}
          }
          return resp;
        };
      })()
    `);
  }

  async getInterceptedRequests(): Promise<Array<{ url: string; body: unknown }>> {
    return this.evaluate('JSON.parse(JSON.stringify(window.__openrss_intercepted || []))');
  }

  /** Capture all network requests (for API discovery) */
  async enableNetworkCapture(): Promise<void> {
    await this.send('Network.enable');
    await this.evaluate(`
      window.__openrss_network = [];
      const origFetch = window.__openrss_origFetch || window.fetch;
      window.__openrss_origFetch = origFetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const method = args[1]?.method || 'GET';
        const reqBody = args[1]?.body || null;
        const resp = await origFetch.apply(this, args);
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('json')) {
          try {
            const clone = resp.clone();
            const body = await clone.json();
            window.__openrss_network.push({ url, method, reqBody, contentType, body, isArray: Array.isArray(body), hasData: !!body.data });
          } catch {}
        }
        return resp;
      };
    `);
  }

  async getNetworkCapture(): Promise<Array<{ url: string; method: string; contentType: string; isArray: boolean; hasData: boolean }>> {
    return this.evaluate('JSON.parse(JSON.stringify((window.__openrss_network || []).map(r => ({ url: r.url, method: r.method, reqBody: r.reqBody, contentType: r.contentType, isArray: r.isArray, hasData: r.hasData, itemCount: Array.isArray(r.body) ? r.body.length : Array.isArray(r.body?.data) ? r.body.data.length : r.body?.data?.items?.length || r.body?.data?.list?.length || null }))))');
  }

  async close(): Promise<void> {
    this.ws.close();
  }
}

// ── Factory ──

/**
 * Connect to Chrome via CDP. Tries:
 * 1. CHROME_CDP_URL env var (explicit ws:// URL)
 * 2. Chrome DevToolsActivePort file
 */
export async function connectChromeCDP(targetUrl?: string): Promise<CDPPage> {
  // Option 1: Explicit URL
  const explicitUrl = process.env.CHROME_CDP_URL;
  if (explicitUrl) {
    return CDPPage.connect(explicitUrl);
  }

  // Option 2: DevToolsActivePort
  const port = getChromeDebugPort();
  if (!port) {
    throw new Error(
      'Cannot connect to Chrome. Either:\n' +
      '  1. Set CHROME_CDP_URL=ws://127.0.0.1:PORT/devtools/page/ID\n' +
      '  2. Launch Chrome with --remote-debugging-port=9222\n' +
      '  3. Chrome DevToolsActivePort not found\n' +
      '\n' +
      'In Claude Code, use Chrome DevTools MCP tools instead:\n' +
      '  mcp: navigate_page, evaluate_script, list_network_requests'
    );
  }

  const targets = await getChromeTargets(port);

  // Find matching target by URL, or use the first page
  let target;
  if (targetUrl) {
    target = targets.find(t => t.type === 'page' && t.url.includes(targetUrl));
  }
  if (!target) {
    target = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'));
  }
  if (!target) {
    throw new Error(`No suitable Chrome tab found. Available: ${targets.map(t => t.url).join(', ')}`);
  }

  logger.info(`CDP connecting to: ${target.title} (${target.url})`);
  return CDPPage.connect(target.webSocketDebuggerUrl);
}
