/**
 * OpenRSS Chrome Extension — Background Service Worker
 *
 * Connects to the OpenRSS daemon via WebSocket and executes browser
 * automation commands using chrome.debugger API, reusing the user's
 * existing login sessions.
 */

const DAEMON_URL = 'ws://127.0.0.1:19826/ext';
const RECONNECT_BASE = 2000;
const RECONNECT_MAX = 60000;
const KEEPALIVE_INTERVAL = 25000;

let ws = null;
let reconnectDelay = RECONNECT_BASE;
let automationWindows = new Map(); // workspace -> windowId
let attachedTabs = new Map();     // tabId -> debugger attached
let interceptors = new Map();     // tabId -> { pattern, requests[] }

// ── WebSocket Connection ──

function connect() {
  if (ws && ws.readyState <= 1) return;

  try {
    ws = new WebSocket(DAEMON_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[OpenRSS] Connected to daemon');
    reconnectDelay = RECONNECT_BASE;
    ws.send(JSON.stringify({ type: 'hello', agent: 'openrss-extension' }));
  };

  ws.onmessage = async (event) => {
    try {
      const cmd = JSON.parse(event.data);
      const result = await handleCommand(cmd);
      ws.send(JSON.stringify({ id: cmd.id, success: true, data: result }));
    } catch (err) {
      const cmd = JSON.parse(event.data);
      ws.send(JSON.stringify({ id: cmd.id, success: false, error: err.message }));
    }
  };

  ws.onclose = () => {
    console.log('[OpenRSS] Disconnected from daemon');
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX);
    connect();
  }, reconnectDelay);
}

// Keepalive
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, KEEPALIVE_INTERVAL);

// ── Automation Window Management ──

async function getAutomationTab(workspace = 'default') {
  let winId = automationWindows.get(workspace);

  // Check if window still exists
  if (winId) {
    try {
      await chrome.windows.get(winId);
    } catch {
      automationWindows.delete(workspace);
      winId = undefined;
    }
  }

  if (!winId) {
    const win = await chrome.windows.create({
      url: 'about:blank',
      focused: false,
      width: 1280,
      height: 900,
      type: 'normal',
    });
    winId = win.id;
    automationWindows.set(workspace, winId);
  }

  // Get or create a tab in this window
  const tabs = await chrome.tabs.query({ windowId: winId });
  if (tabs.length > 0) return tabs[0].id;

  const tab = await chrome.tabs.create({ windowId: winId, url: 'about:blank' });
  return tab.id;
}

// ── CDP Helpers ──

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTabs.set(tabId, true);
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch { /* already detached */ }
  attachedTabs.delete(tabId);
  interceptors.delete(tabId);
}

async function cdpSend(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// ── Command Handlers ──

async function handleCommand(cmd) {
  const { action, params = {}, workspace } = cmd;

  switch (action) {
    case 'navigate': {
      const tabId = await getAutomationTab(workspace);
      await attachDebugger(tabId);
      await chrome.tabs.update(tabId, { url: params.url });
      // Wait for load
      await new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, params.timeout || 30000);
      });
      return { ok: true };
    }

    case 'evaluate': {
      const tabId = await getAutomationTab(workspace);
      await attachDebugger(tabId);
      const result = await cdpSend(tabId, 'Runtime.evaluate', {
        expression: params.script,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Evaluation failed');
      }
      return result.result?.value;
    }

    case 'evaluateFunction': {
      const tabId = await getAutomationTab(workspace);
      await attachDebugger(tabId);
      const args = (params.args || []).map(a => JSON.stringify(a)).join(',');
      const expression = `(${params.fn})(${args})`;
      const result = await cdpSend(tabId, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Evaluation failed');
      }
      return result.result?.value;
    }

    case 'getCookies': {
      const cookies = await chrome.cookies.getAll({ domain: params.domain });
      return cookies.map(c => ({ name: c.name, value: c.value }));
    }

    case 'waitForSelector': {
      const tabId = await getAutomationTab(workspace);
      await attachDebugger(tabId);
      const timeout = params.timeout || 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await cdpSend(tabId, 'Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(params.selector)})`,
          returnByValue: true,
        });
        if (result.result?.value) return { found: true };
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error(`Selector "${params.selector}" not found within ${timeout}ms`);
    }

    case 'installInterceptor': {
      const tabId = await getAutomationTab(workspace);
      await attachDebugger(tabId);

      // Enable network monitoring
      await cdpSend(tabId, 'Network.enable');

      const pattern = params.urlPattern;
      interceptors.set(tabId, { pattern, requests: [] });

      // Listen for responses via debugger event
      // We inject a fetch monkey-patch for more reliable interception
      await cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (function() {
            if (window.__openrss_intercepted) return;
            window.__openrss_intercepted = [];
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
              const resp = await origFetch.apply(this, args);
              const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
              if (url.includes(${JSON.stringify(pattern)})) {
                try {
                  const clone = resp.clone();
                  const body = await clone.json();
                  window.__openrss_intercepted.push({ url, body });
                } catch {}
              }
              return resp;
            };
            const origXHR = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              if (typeof url === 'string' && url.includes(${JSON.stringify(pattern)})) {
                this.addEventListener('load', function() {
                  try {
                    const body = JSON.parse(this.responseText);
                    window.__openrss_intercepted.push({ url, body });
                  } catch {}
                });
              }
              return origXHR.call(this, method, url, ...rest);
            };
          })()
        `,
        returnByValue: true,
      });
      return { ok: true };
    }

    case 'getInterceptedRequests': {
      const tabId = await getAutomationTab(workspace);
      const result = await cdpSend(tabId, 'Runtime.evaluate', {
        expression: 'JSON.parse(JSON.stringify(window.__openrss_intercepted || []))',
        returnByValue: true,
        awaitPromise: true,
      });
      return result.result?.value || [];
    }

    case 'close': {
      const tabId = await getAutomationTab(workspace);
      await detachDebugger(tabId);
      return { ok: true };
    }

    case 'ping':
      return { ok: true };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ── Tab cleanup ──

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  interceptors.delete(tabId);
});

// ── Start ──

connect();
console.log('[OpenRSS] Extension loaded');
