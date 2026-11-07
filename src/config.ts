import { homedir } from "node:os";
import { join } from "node:path";

export interface AukroConfig {
  baseUrl: string;
  webUrl: string;
  authUrl: string;
  currency: "CZK" | "EUR" | "PLN" | "HUF" | "RON";
  language: string;
  subbrand: "BAZAAR" | "ANTIQUE" | "NOT_SPECIFIED";
  credentialsFile: string;
  userAgent: string;
  clientVersion: string;
  oauthClientId: string;
  initialCredentials: {
    cookies?: string;
    sessionCookie?: string;
    xsrfToken?: string;
    aukroToken?: string;
    accessToken?: string;
    refreshToken?: string;
    username?: string;
    password?: string;
  };
}

export function loadConfig(): AukroConfig {
  const webUrl = (process.env.AUKRO_WEB_URL ?? "https://aukro.cz").replace(/\/+$/, "");
  const baseUrl = (process.env.AUKRO_BASE_URL ?? `${webUrl}/backend-web/api`).replace(/\/+$/, "");
  const authUrl = (process.env.AUKRO_AUTH_URL ?? `${webUrl}/auth`).replace(/\/+$/, "");

  const currencyRaw = (process.env.AUKRO_CURRENCY ?? "CZK").toUpperCase();
  const currency = (["CZK", "EUR", "PLN", "HUF", "RON"].includes(currencyRaw)
    ? currencyRaw
    : "CZK") as AukroConfig["currency"];

  // Important: Aukro rejects underscore (e.g. cs_CZ returns 400 Bad Request), so normalize to hyphen.
  const language = (process.env.AUKRO_LANGUAGE ?? "cs-CZ").replace("_", "-");

  const subbrandRaw = (process.env.AUKRO_SUBBRAND ?? "BAZAAR").toUpperCase();
  const subbrand = (["BAZAAR", "ANTIQUE", "NOT_SPECIFIED"].includes(subbrandRaw)
    ? subbrandRaw
    : "BAZAAR") as AukroConfig["subbrand"];

  const credentialsFile =
    process.env.AUKRO_CREDENTIALS_FILE ??
    join(homedir(), ".config", "aukro-mcp", "credentials.json");

  return {
    baseUrl,
    webUrl,
    authUrl,
    currency,
    language,
    subbrand,
    credentialsFile,
    userAgent:
      process.env.AUKRO_USER_AGENT ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    clientVersion: process.env.AUKRO_CLIENT_VERSION ?? "2026-11-04-r1",
    oauthClientId:
      process.env.AUKRO_OAUTH_CLIENT_ID ?? "aukro-backend-web-mobile-app-android",
    initialCredentials: {
      cookies: process.env.AUKRO_COOKIES,
      sessionCookie: process.env.AUKRO_SESSION,
      xsrfToken: process.env.AUKRO_XSRF_TOKEN,
      aukroToken: process.env.AUKRO_TOKEN,
      accessToken: process.env.AUKRO_ACCESS_TOKEN,
      refreshToken: process.env.AUKRO_REFRESH_TOKEN,
      username: process.env.AUKRO_USERNAME,
      password: process.env.AUKRO_PASSWORD,
    },
  };
}
