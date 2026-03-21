/** Abstraction over a browser page, backed by Chrome Extension bridge or CDP */
export interface IPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  evaluate<T = unknown>(script: string): Promise<T>;
  evaluateFunction<T = unknown>(fn: string, ...args: unknown[]): Promise<T>;
  getCookies(domain: string): Promise<Array<{ name: string; value: string }>>;
  waitForSelector(selector: string, timeout?: number): Promise<void>;
  /** Install a fetch/XHR interceptor for URLs matching the pattern */
  installInterceptor(urlPattern: string): Promise<void>;
  /** Get all intercepted request/response bodies */
  getInterceptedRequests(): Promise<Array<{ url: string; body: unknown }>>;
  close(): Promise<void>;
}

export interface BrowserCommand {
  id: string;
  action: string;
  params: Record<string, unknown>;
  workspace?: string;
}

export interface BrowserResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
