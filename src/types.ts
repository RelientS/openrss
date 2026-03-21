import type { Context } from 'hono';
import type { IPage } from './browser/types.js';

export interface DataItem {
  title: string;
  description?: string;
  link?: string;
  pubDate?: Date | string | number;
  guid?: string;
  author?: string;
  category?: string[];
}

export interface Data {
  title: string;
  link?: string;
  description?: string;
  language?: string;
  image?: string;
  item?: DataItem[];
  allowEmpty?: boolean;
}

export interface Route {
  path: string;
  name: string;
  example: string;
  /** 'public' = no browser, 'cookie' = needs login session, 'intercept' = capture API calls */
  strategy: 'public' | 'cookie' | 'intercept';
  parameters?: Record<string, string>;
  handler: (ctx: Context, page?: IPage) => Promise<Data>;
}

export interface Namespace {
  name: string;
  url?: string;
  description?: string;
}
