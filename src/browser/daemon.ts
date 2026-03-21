/**
 * OpenRSS Daemon — Bridge between the HTTP server and the Chrome Extension.
 *
 * HTTP API:
 *   POST /command  — send a command to the extension, wait for response
 *   GET  /status   — check if extension is connected
 *
 * WebSocket:
 *   /ext           — Chrome Extension connects here
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { BrowserCommand, BrowserResponse } from './types.js';

let extensionSocket: WebSocket | null = null;
const pendingCommands = new Map<string, {
  resolve: (value: BrowserResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

let commandCounter = 0;

function nextId(): string {
  return `cmd_${++commandCounter}_${Date.now()}`;
}

// ── HTTP Server ──

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({
      extension: extensionSocket?.readyState === WebSocket.OPEN,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/command') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const cmd: Omit<BrowserCommand, 'id'> = JSON.parse(body);
        const result = await sendToExtension(cmd);
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── WebSocket Server ──

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ext') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  logger.info('Chrome Extension connected');
  extensionSocket = ws;

  ws.on('message', (data) => {
    try {
      const msg: BrowserResponse = JSON.parse(data.toString());

      // Ignore non-command responses (hello, ping, etc.)
      if (!msg.id) return;

      const pending = pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.id);
        pending.resolve(msg);
      }
    } catch (err) {
      logger.error('Failed to parse extension message:', err);
    }
  });

  ws.on('close', () => {
    logger.info('Chrome Extension disconnected');
    if (extensionSocket === ws) extensionSocket = null;

    // Reject all pending commands
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.resolve({ id, success: false, error: 'Extension disconnected' });
    }
    pendingCommands.clear();
  });
});

// ── Send command to extension ──

function sendToExtension(cmd: Omit<BrowserCommand, 'id'>, timeout = 60000): Promise<BrowserResponse> {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      reject(new Error('Chrome Extension is not connected. Please install the OpenRSS extension and open Chrome.'));
      return;
    }

    const id = nextId();
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      resolve({ id, success: false, error: 'Command timed out' });
    }, timeout);

    pendingCommands.set(id, { resolve, timer });
    extensionSocket.send(JSON.stringify({ id, ...cmd }));
  });
}

// ── Start ──

export function startDaemon(port?: number): Promise<void> {
  const p = port || config.daemonPort;
  return new Promise((resolve) => {
    server.listen(p, '127.0.0.1', () => {
      logger.info(`OpenRSS daemon listening on 127.0.0.1:${p}`);
      resolve();
    });
  });
}

export function isDaemonRunning(): boolean {
  return server.listening;
}

export function isExtensionConnected(): boolean {
  return extensionSocket?.readyState === WebSocket.OPEN;
}

// If run directly: start daemon standalone
if (process.argv[1]?.endsWith('daemon.ts') || process.argv[1]?.endsWith('daemon.js')) {
  startDaemon();
}
