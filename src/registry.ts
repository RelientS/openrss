/**
 * Route registry — auto-discovers route modules from src/routes/<namespace>/
 * and registers them as Hono routes.
 */

import { Hono } from 'hono';
import type { Route, Namespace, Data } from './types.js';
import { getBrowserPage } from './browser/session.js';
import { logger } from './utils/logger.js';

interface RouteModule {
  route: Route;
}

interface NamespaceModule {
  namespace: Namespace;
}

export interface RegisteredNamespace {
  namespace: Namespace;
  routes: Route[];
}

const namespaces = new Map<string, RegisteredNamespace>();

export function registerNamespace(key: string, ns: Namespace) {
  if (!namespaces.has(key)) {
    namespaces.set(key, { namespace: ns, routes: [] });
  }
}

export function registerRoute(nsKey: string, route: Route) {
  const ns = namespaces.get(nsKey);
  if (ns) {
    ns.routes.push(route);
    logger.debug(`Registered route: /${nsKey}${route.path}`);
  }
}

export function getNamespaces(): Map<string, RegisteredNamespace> {
  return namespaces;
}

/**
 * Mount all registered routes onto a Hono app.
 */
export function mountRoutes(app: Hono) {
  for (const [nsKey, ns] of namespaces) {
    const sub = new Hono();

    for (const route of ns.routes) {
      sub.get(route.path, async (ctx) => {
        try {
          let page;
          if (route.strategy !== 'public') {
            page = await getBrowserPage(nsKey);
          }

          const data: Data = await route.handler(ctx, page);

          if (page) {
            await page.close().catch(() => {});
          }

          if (!data.item?.length && !data.allowEmpty) {
            ctx.status(404);
            return ctx.json({ error: 'No items found', route: route.name });
          }

          ctx.set('data', data);
        } catch (err: any) {
          logger.error(`Route /${nsKey}${route.path} error:`, err.message);
          ctx.status(500);
          return ctx.json({ error: err.message });
        }
      });
    }

    app.route(`/${nsKey}`, sub);
  }

  logger.info(`Mounted ${namespaces.size} namespaces, ${[...namespaces.values()].reduce((n, ns) => n + ns.routes.length, 0)} routes`);
}

/**
 * Manually load route modules. In production this would be auto-discovered.
 */
export async function loadRoutes(modules: Array<{ nsKey: string; namespace: Namespace; routes: Route[] }>) {
  for (const mod of modules) {
    registerNamespace(mod.nsKey, mod.namespace);
    for (const route of mod.routes) {
      registerRoute(mod.nsKey, route);
    }
  }
}
