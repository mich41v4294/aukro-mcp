import type { AukroConfig } from "../config.js";
import type { AuthManager } from "./auth.js";
import { TtlCache } from "./cache.js";

export class AukroApiError extends Error {
  public readonly status: number;
  public readonly path: string;
  public readonly errorBody: unknown;
  public readonly isAuthError: boolean;
  public readonly requiresTwoFactor: boolean;

  constructor(params: {
    message: string;
    status: number;
    path: string;
    errorBody?: unknown;
  }) {
    super(params.message);
    this.name = "AukroApiError";
    this.status = params.status;
    this.path = params.path;
    this.errorBody = params.errorBody;
    this.isAuthError = params.status === 401 || params.status === 403;
    this.requiresTwoFactor = params.status === 417;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | Array<string | number> | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  currency?: string;
  subbrand?: string;
  requireAuth?: boolean;
  cacheTtlMs?: number;
  cacheKey?: string;
}

export class AukroHttpClient {
  public readonly config: AukroConfig;
  public readonly auth: AuthManager;
  public readonly cache: TtlCache;
  private tokenInitialized = false;

  constructor(config: AukroConfig, auth: AuthManager, cache = new TtlCache(300)) {
    this.config = config;
    this.auth = auth;
    this.cache = cache;
  }

  /**
   * Lazily initializes an official anonymous `aukro-token` from the gateway if needed.
   */
  public async initAnonymousTokenIfNeeded(): Promise<void> {
    if (this.tokenInitialized || this.auth.hasCredentials()) return;
    this.tokenInitialized = true;
    try {
      const url = `${this.config.baseUrl}/token/generate?userAgent=${encodeURIComponent(
        this.config.userAgent
      )}`;
      const headers = await this.auth.buildRequestHeaders("GET");
      const res = await fetch(url, { method: "GET", headers });
      this.auth.captureResponseCookies(res.headers);
      if (res.ok) {
        const text = await res.text();
        if (text) {
          const parsed = JSON.parse(text) as { token?: string };
          if (parsed.token) {
            this.auth.setCredentials({ aukroToken: parsed.token, persist: false });
          }
        }
      }
    } catch {
      // Fallback to locally generated UUIDv4 token already in AuthManager
    }
  }

  public buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | Array<string | number> | undefined | null>
  ): string {
    const cleanPath = path.startsWith("http")
      ? path
      : `${this.config.baseUrl}/${path.replace(/^\/+/, "")}`;

    if (!query) return cleanPath;

    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          searchParams.append(key, String(item));
        }
      } else {
        searchParams.set(key, String(val));
      }
    }

    const qs = searchParams.toString();
    if (!qs) return cleanPath;
    return `${cleanPath}${cleanPath.includes("?") ? "&" : "?"}${qs}`;
  }

  public async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";

    if (options.requireAuth && !this.auth.hasCredentials()) {
      throw new AukroApiError({
        status: 401,
        path,
        message:
          "Authentication required for this action. The server is currently running in anonymous mode. Supply credentials via `aukro_set_credentials` (using a browser `SESSION` cookie or OAuth2 `accessToken`/`refreshToken`), run `aukro_login_interactive`, or set `AUKRO_COOKIES` / `AUKRO_SESSION` / `AUKRO_ACCESS_TOKEN` environment variables.",
      });
    }

    const url = this.buildUrl(path, options.query);
    const cacheKey = options.cacheKey ?? (method === "GET" ? url : undefined);

    if (options.cacheTtlMs && cacheKey) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const extraHeaders: Record<string, string> = { ...options.headers };
    if (options.currency) {
      extraHeaders["X-Accept-Currency"] = options.currency.toUpperCase();
    }
    if (options.subbrand) {
      extraHeaders["X-Accept-Subbrand"] = options.subbrand.toUpperCase();
    }
    if (options.body !== undefined) {
      extraHeaders["Content-Type"] = "application/json";
    }

    const maxAttempts = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const headers = await this.auth.buildRequestHeaders(method, extraHeaders);
      const res = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      this.auth.captureResponseCookies(res.headers);

      if (res.status === 401 && attempt === 1 && this.auth.getAuthMode() === "oauth_bearer") {
        const refreshed = await this.auth.refreshOAuthToken();
        if (refreshed) {
          continue;
        }
      }

      if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }

      const rawText = await res.text();
      let parsedBody: unknown = undefined;
      if (rawText) {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          parsedBody = rawText;
        }
      }

      if (!res.ok) {
        const detail = extractErrorDetail(parsedBody);
        const authHint =
          res.status === 401 || res.status === 403
            ? " (Check authentication status with `aukro_auth_status` or supply fresh credentials via `aukro_set_credentials`.)"
            : res.status === 417
              ? " (Two-factor SMS verification required: retry with the 4-digit SMS code in `tfvCode`.)"
              : "";

        throw new AukroApiError({
          status: res.status,
          path,
          errorBody: parsedBody,
          message: `Aukro API ${method} ${path} failed with HTTP ${res.status}${
            detail ? `: ${detail}` : ""
          }${authHint}`,
        });
      }

      const result = (parsedBody ?? {}) as T;
      if (options.cacheTtlMs && cacheKey) {
        this.cache.set(cacheKey, result, options.cacheTtlMs);
      }
      return result;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Request to ${path} failed after ${maxAttempts} attempts`);
  }
}

function extractErrorDetail(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 300);
  if (typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const msg =
      obj.userMessage ??
      obj.errorMessage ??
      obj.message ??
      obj.error_description ??
      obj.error ??
      obj.code;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(obj).slice(0, 300);
    } catch {
      return "";
    }
  }
  return "";
}
