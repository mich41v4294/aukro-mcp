import { randomUUID, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AukroConfig } from "../config.js";

export type AuthMode = "anonymous" | "cookie" | "oauth_bearer";

export interface StoredCredentials {
  cookies?: Record<string, string>;
  sessionCookie?: string;
  xsrfToken?: string;
  aukroToken?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  username?: string;
  password?: string;
  updatedAt?: string;
}

export interface SetCredentialsInput {
  cookieHeader?: string;
  sessionCookie?: string;
  xsrfToken?: string;
  aukroToken?: string;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  password?: string;
  persist?: boolean;
}

export function parseCookieString(rawCookieHeader: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of rawCookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (name) {
      map[name] = val;
    }
  }
  return map;
}

export function decodeJwtExpiration(jwt: string): number | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return undefined;
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {
    // Ignore malformed JWT
  }
  return undefined;
}

export function generatePkceChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export class AuthManager {
  private readonly config: AukroConfig;
  private cookies: Record<string, string> = {};
  private accessToken?: string;
  private refreshToken?: string;
  private accessTokenExpiresAt?: number;
  private aukroToken: string;
  private username?: string;
  private password?: string;
  private refreshPromise?: Promise<boolean>;

  constructor(config: AukroConfig) {
    this.config = config;
    this.aukroToken = randomUUID();
    this.loadFromDisk();
    this.applyInitialConfigCredentials();
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.config.credentialsFile)) return;
      const raw = readFileSync(this.config.credentialsFile, "utf8");
      const parsed = JSON.parse(raw) as StoredCredentials;
      if (parsed.cookies && typeof parsed.cookies === "object") {
        this.cookies = { ...this.cookies, ...parsed.cookies };
      }
      if (parsed.sessionCookie) {
        this.cookies["SESSION"] = parsed.sessionCookie;
      }
      if (parsed.xsrfToken) {
        this.cookies["XSRF-TOKEN"] = parsed.xsrfToken;
      }
      if (parsed.aukroToken) {
        this.aukroToken = parsed.aukroToken;
        this.cookies["aukro-token"] = parsed.aukroToken;
      }
      if (parsed.accessToken) {
        this.accessToken = parsed.accessToken;
        this.accessTokenExpiresAt =
          parsed.accessTokenExpiresAt ?? decodeJwtExpiration(parsed.accessToken);
      }
      if (parsed.refreshToken) {
        this.refreshToken = parsed.refreshToken;
      }
      if (parsed.username) {
        this.username = parsed.username;
      }
    } catch (err) {
      console.error("[aukro-mcp] Failed to read credentials file:", err);
    }
  }

  private applyInitialConfigCredentials(): void {
    const init = this.config.initialCredentials;
    if (init.cookies) {
      const parsed = parseCookieString(init.cookies);
      this.cookies = { ...this.cookies, ...parsed };
      if (parsed["aukro-token"]) {
        this.aukroToken = parsed["aukro-token"];
      }
    }
    if (init.sessionCookie) {
      this.cookies["SESSION"] = init.sessionCookie;
    }
    if (init.xsrfToken) {
      this.cookies["XSRF-TOKEN"] = init.xsrfToken;
    }
    if (init.aukroToken) {
      this.aukroToken = init.aukroToken;
      this.cookies["aukro-token"] = init.aukroToken;
    }
    if (init.accessToken) {
      this.accessToken = init.accessToken;
      this.accessTokenExpiresAt = decodeJwtExpiration(init.accessToken);
    }
    if (init.refreshToken) {
      this.refreshToken = init.refreshToken;
    }
    if (init.username) {
      this.username = init.username;
    }
    if (init.password) {
      this.password = init.password;
    }
    this.cookies["aukro-token"] = this.aukroToken;
  }

  public saveToDisk(): void {
    try {
      const dir = dirname(this.config.credentialsFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const payload: StoredCredentials = {
        cookies: this.cookies,
        sessionCookie: this.cookies["SESSION"],
        xsrfToken: this.cookies["XSRF-TOKEN"],
        aukroToken: this.aukroToken,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        accessTokenExpiresAt: this.accessTokenExpiresAt,
        username: this.username,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.config.credentialsFile, JSON.stringify(payload, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (err) {
      console.error("[aukro-mcp] Failed to save credentials file:", err);
    }
  }

  public setCredentials(input: SetCredentialsInput): void {
    if (input.cookieHeader) {
      const parsed = parseCookieString(input.cookieHeader);
      this.cookies = { ...this.cookies, ...parsed };
      if (parsed["aukro-token"]) {
        this.aukroToken = parsed["aukro-token"];
      }
    }
    if (input.sessionCookie !== undefined) {
      if (input.sessionCookie) {
        this.cookies["SESSION"] = input.sessionCookie;
      } else {
        delete this.cookies["SESSION"];
      }
    }
    if (input.xsrfToken !== undefined) {
      if (input.xsrfToken) {
        this.cookies["XSRF-TOKEN"] = input.xsrfToken;
      } else {
        delete this.cookies["XSRF-TOKEN"];
      }
    }
    if (input.aukroToken) {
      this.aukroToken = input.aukroToken;
    }
    this.cookies["aukro-token"] = this.aukroToken;

    if (input.accessToken !== undefined) {
      this.accessToken = input.accessToken || undefined;
      this.accessTokenExpiresAt = input.accessToken
        ? decodeJwtExpiration(input.accessToken)
        : undefined;
    }
    if (input.refreshToken !== undefined) {
      this.refreshToken = input.refreshToken || undefined;
    }
    if (input.username !== undefined) {
      this.username = input.username || undefined;
    }
    if (input.password !== undefined) {
      this.password = input.password || undefined;
    }

    if (input.persist !== false) {
      this.saveToDisk();
    }
  }

  public clearCredentials(removeDiskFile = true): void {
    this.cookies = { "aukro-token": this.aukroToken };
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.accessTokenExpiresAt = undefined;
    if (removeDiskFile) {
      try {
        if (existsSync(this.config.credentialsFile)) {
          unlinkSync(this.config.credentialsFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  public getAuthMode(): AuthMode {
    if (this.accessToken || this.refreshToken) {
      return "oauth_bearer";
    }
    if (this.cookies["SESSION"]) {
      return "cookie";
    }
    return "anonymous";
  }

  public hasCredentials(): boolean {
    return this.getAuthMode() !== "anonymous";
  }

  public getAukroToken(): string {
    return this.aukroToken;
  }

  public getCredentialsSummary(): {
    mode: AuthMode;
    hasSessionCookie: boolean;
    hasXsrfToken: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    accessTokenExpiresAt?: string;
    hasStoredUsername: boolean;
    aukroToken: string;
  } {
    return {
      mode: this.getAuthMode(),
      hasSessionCookie: Boolean(this.cookies["SESSION"]),
      hasXsrfToken: Boolean(this.cookies["XSRF-TOKEN"]),
      hasAccessToken: Boolean(this.accessToken),
      hasRefreshToken: Boolean(this.refreshToken),
      accessTokenExpiresAt: this.accessTokenExpiresAt
        ? new Date(this.accessTokenExpiresAt).toISOString()
        : undefined,
      hasStoredUsername: Boolean(this.username),
      aukroToken: this.aukroToken,
    };
  }

  public captureResponseCookies(headers: Headers): void {
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")!]
          : [];

    for (const cookieStr of setCookies) {
      const firstSegment = cookieStr.split(";")[0]?.trim();
      if (!firstSegment) continue;
      const eqIdx = firstSegment.indexOf("=");
      if (eqIdx <= 0) continue;
      const name = firstSegment.slice(0, eqIdx).trim();
      const val = firstSegment.slice(eqIdx + 1).trim();
      if (name && val) {
        this.cookies[name] = val;
        if (name === "aukro-token") {
          this.aukroToken = val;
        }
      }
    }
  }

  public async ensureFreshToken(): Promise<void> {
    if (!this.refreshToken) return;
    const now = Date.now();
    const isExpiredOrMissing =
      !this.accessToken ||
      (this.accessTokenExpiresAt !== undefined && now + 30_000 >= this.accessTokenExpiresAt);

    if (isExpiredOrMissing) {
      await this.refreshOAuthToken();
    }
  }

  public async refreshOAuthToken(): Promise<boolean> {
    if (!this.refreshToken) return false;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const tokenUrl = `${this.config.authUrl}/oauth2/token`;
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.refreshToken!,
          client_id: this.config.oauthClientId,
        });

        const res = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": this.config.userAgent,
          },
          body: body.toString(),
        });

        if (!res.ok) {
          console.error(`[aukro-mcp] OAuth2 token refresh failed with HTTP ${res.status}`);
          return false;
        }

        const data = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };

        if (data.access_token) {
          this.accessToken = data.access_token;
          this.accessTokenExpiresAt =
            decodeJwtExpiration(data.access_token) ??
            (data.expires_in ? Date.now() + data.expires_in * 1000 : undefined);
        }
        if (data.refresh_token) {
          this.refreshToken = data.refresh_token;
        }
        this.saveToDisk();
        return Boolean(data.access_token);
      } catch (err) {
        console.error("[aukro-mcp] Error refreshing OAuth2 token:", err);
        return false;
      } finally {
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }

  public async buildRequestHeaders(
    method: string,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, string>> {
    await this.ensureFreshToken();

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
      "X-Accept-Language": this.config.language,
      "X-Accept-Currency": this.config.currency,
      "X-Accept-Subbrand": this.config.subbrand,
      "x-aukro-client": "platform-frontend",
      "x-aukro-client-version": this.config.clientVersion,
      "X-Aukro-Platform-Type": "WEB",
      "X-Aukro-Token": this.aukroToken,
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const cookiePairs = Object.entries(this.cookies)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}=${v}`);

    if (cookiePairs.length > 0) {
      headers["Cookie"] = cookiePairs.join("; ");
    }

    const upperMethod = method.toUpperCase();
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(upperMethod) &&
      this.cookies["XSRF-TOKEN"]
    ) {
      headers["X-XSRF-TOKEN"] = this.cookies["XSRF-TOKEN"];
    }

    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }

    return headers;
  }

  /**
   * Launches a real browser window without Playwright/CDP page instrumentation so Cloudflare Turnstile
   * passes cleanly without error 600010, then reads cookies at the browser process level via
   * `Storage.getCookies` and verifies authentication against `/users/actualStatistics`.
   */
  public async loginInteractive(options?: {
    username?: string;
    password?: string;
    timeoutSeconds?: number;
  }): Promise<{
    success: boolean;
    message: string;
    mode?: AuthMode;
    username?: string;
    userId?: number;
  }> {
    const timeoutMs = (options?.timeoutSeconds ?? 240) * 1000;
    const chromeCandidates = [
      process.env.CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/brave-browser",
      "/snap/bin/chromium",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ].filter((p): p is string => Boolean(p && existsSync(p)));

    const chromeBinary = chromeCandidates[0];
    if (!chromeBinary) {
      return {
        success: false,
        message:
          "Could not find a local Chrome/Brave/Edge installation for interactive login. Please authenticate using `aukro_set_credentials` with your browser `SESSION` cookie.",
      };
    }

    const profileDir = join(dirname(this.config.credentialsFile), "chrome-login-profile");
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    }

    const debugPort = 19220 + Math.floor(Math.random() * 500);
    const loginStartUrl = `${this.config.webUrl}/prihlaseni`;

    const chromeProc = spawn(
      chromeBinary,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        loginStartUrl,
      ],
      {
        stdio: "ignore",
        detached: false,
      }
    );

    const readBrowserCookiesViaCdp = async (wsUrl: string): Promise<Record<string, string>> => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({}), 3000);
        try {
          const ws = new WebSocket(wsUrl);
          ws.addEventListener("open", () => {
            ws.send(JSON.stringify({ id: 1, method: "Storage.getCookies" }));
          });
          ws.addEventListener("message", (ev) => {
            clearTimeout(timer);
            try {
              const parsed = JSON.parse(String(ev.data)) as {
                result?: { cookies?: Array<{ name: string; value: string; domain: string }> };
              };
              const map: Record<string, string> = {};
              for (const c of parsed.result?.cookies ?? []) {
                if (c.domain.includes("aukro.cz")) {
                  map[c.name] = c.value;
                }
              }
              ws.close();
              resolve(map);
            } catch {
              ws.close();
              resolve({});
            }
          });
          ws.addEventListener("error", () => {
            clearTimeout(timer);
            resolve({});
          });
        } catch {
          clearTimeout(timer);
          resolve({});
        }
      });
    };

    try {
      // Wait for Chrome's DevTools HTTP endpoint to come up
      let wsDebuggerUrl: string | undefined;
      let browserUserAgent = this.config.userAgent;
      for (let i = 0; i < 25; i++) {
        try {
          const verRes = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
          if (verRes.ok) {
            const ver = (await verRes.json()) as {
              webSocketDebuggerUrl?: string;
              "User-Agent"?: string;
            };
            wsDebuggerUrl = ver.webSocketDebuggerUrl;
            if (ver["User-Agent"]) {
              browserUserAgent = ver["User-Agent"].replace("HeadlessChrome/", "Chrome/");
              this.config.userAgent = browserUserAgent;
            }
            if (wsDebuggerUrl) break;
          }
        } catch {
          // Wait for Chrome startup
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      if (!wsDebuggerUrl) {
        chromeProc.kill();
        return {
          success: false,
          message: "Failed to connect to Chrome DevTools endpoint for cookie capture.",
        };
      }

      const deadline = Date.now() + timeoutMs;
      let authenticatedUser: { userId?: number; username?: string } | undefined;

      while (Date.now() < deadline) {
        if (chromeProc.exitCode !== null) {
          break;
        }

        const cookieMap = await readBrowserCookiesViaCdp(wsDebuggerUrl);
        if (cookieMap["SESSION"]) {
          const cookieHeader = Object.entries(cookieMap)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");

          try {
            const checkRes = await fetch(`${this.config.baseUrl}/users/actualStatistics`, {
              headers: {
                Accept: "application/json",
                Cookie: cookieHeader,
                "User-Agent": browserUserAgent,
                "X-Accept-Language": this.config.language,
                "X-Accept-Currency": this.config.currency,
                "x-aukro-client": "platform-frontend",
                "X-Aukro-Platform-Type": "WEB",
                "X-Aukro-Token": cookieMap["aukro-token"] ?? this.aukroToken,
              },
            });

            this.captureResponseCookies(checkRes.headers);

            if (checkRes.ok) {
              const stats = (await checkRes.json()) as { userId?: number; username?: string };
              if (stats && stats.userId) {
                authenticatedUser = stats;
                const finalCookies = await readBrowserCookiesViaCdp(wsDebuggerUrl);
                const mergedCookieHeader = Object.entries({ ...cookieMap, ...finalCookies })
                  .map(([k, v]) => `${k}=${v}`)
                  .join("; ");
                this.setCredentials({
                  cookieHeader: mergedCookieHeader,
                  persist: true,
                });
                break;
              }
            }
          } catch {
            // Ignore transient network errors while polling
          }
        }

        await new Promise((r) => setTimeout(r, 2000));
      }

      try {
        chromeProc.kill();
      } catch {
        // Ignore
      }

      if (authenticatedUser) {
        return {
          success: true,
          message: `Successfully logged in to Aukro.cz as ${authenticatedUser.username} (userId: ${authenticatedUser.userId}). Session cookies captured and saved to ${this.config.credentialsFile}.`,
          mode: this.getAuthMode(),
          username: authenticatedUser.username,
          userId: authenticatedUser.userId,
        };
      }

      return {
        success: false,
        message:
          "Interactive login window closed or timed out before authentication completed.",
      };
    } catch (err) {
      try {
        chromeProc.kill();
      } catch {
        // Ignore
      }
      return {
        success: false,
        message: `Interactive browser login failed: ${err instanceof Error ? err.message : String(err)}.`,
      };
    }
  }
}
