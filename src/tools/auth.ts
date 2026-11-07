import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { mcpErrorResult, mcpJsonResult } from "../utils/formatters.js";

export function registerAuthTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_auth_status",
    {
      title: "Check Aukro Authentication Status",
      description:
        "Check whether the MCP server is currently running in anonymous mode, cookie session mode, or OAuth2 Bearer token mode, and verify against Aukro.cz's `/users/actualStatistics` endpoint whether the session is actively logged in.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const summary = client.auth.getCredentialsSummary();
        if (!client.auth.hasCredentials()) {
          return mcpJsonResult({
            authenticated: false,
            ...summary,
            note: "Running in anonymous mode. All public tools (search, archive search, categories, offer detail, bid history, seller profile & feedback) work without credentials. To enable buyer/seller account tools, call `aukro_set_credentials` or `aukro_login_interactive`.",
          });
        }

        try {
          const stats = await client.request<Record<string, unknown>>(
            "/users/actualStatistics",
            {
              method: "GET",
              cacheTtlMs: 60_000,
            }
          );
          const authenticated = Boolean(stats && stats.userId);
          return mcpJsonResult({
            authenticated,
            ...summary,
            user: authenticated
              ? {
                  userId: stats.userId,
                  username: stats.username,
                  currency: stats.currency,
                  domain: stats.registrationDomainCode,
                  accountType: stats.accountTypeEnum,
                  emailVerified: stats.emailVerified,
                }
              : null,
          });
        } catch (err) {
          return mcpJsonResult({
            authenticated: false,
            ...summary,
            verificationError: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_set_credentials",
    {
      title: "Configure Aukro Session Cookies or OAuth2 Tokens",
      description:
        "Supply or update Aukro.cz authentication credentials at runtime without restarting the MCP server. Supports: (1) full `cookieHeader` copied from browser DevTools, (2) individual `sessionCookie` (`SESSION` cookie value from `aukro.cz`), (3) OAuth2 `accessToken` and/or `refreshToken`, and (4) optional `username`/`password` for interactive login pre-filling. Immediately verifies the credentials against Aukro.cz.",
      inputSchema: {
        cookieHeader: z
          .string()
          .optional()
          .describe(
            "Full `Cookie` header string copied from browser DevTools on aukro.cz (e.g. 'SESSION=...; aukro-token=...; XSRF-TOKEN=...')"
          ),
        sessionCookie: z
          .string()
          .optional()
          .describe("Value of the `SESSION` cookie from https://aukro.cz"),
        xsrfToken: z
          .string()
          .optional()
          .describe("Optional value of the `XSRF-TOKEN` cookie"),
        aukroToken: z
          .string()
          .optional()
          .describe("Optional value of the `aukro-token` UUID cookie"),
        accessToken: z
          .string()
          .optional()
          .describe("OAuth2 Bearer JWT `access_token`"),
        refreshToken: z
          .string()
          .optional()
          .describe(
            "OAuth2 `refresh_token` (enables automatic passwordless/captchaless token renewal)"
          ),
        username: z
          .string()
          .optional()
          .describe("Optional username/email to store for `aukro_login_interactive`"),
        password: z
          .string()
          .optional()
          .describe("Optional password to store in memory for `aukro_login_interactive`"),
        persist: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "When true, saves cookies/tokens to ~/.config/aukro-mcp/credentials.json (0600 permissions)"
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        client.cache.clear();
        client.auth.setCredentials(args);

        let verifiedUser: Record<string, unknown> | null = null;
        let verificationError: string | undefined;

        if (client.auth.hasCredentials()) {
          try {
            const stats = await client.request<Record<string, unknown>>(
              "/users/actualStatistics",
              {
                method: "GET",
                cacheTtlMs: 60_000,
              }
            );
            if (stats && stats.userId) {
              verifiedUser = {
                userId: stats.userId,
                username: stats.username,
                currency: stats.currency,
                accountType: stats.accountTypeEnum,
                emailVerified: stats.emailVerified,
              };
            }
          } catch (err) {
            verificationError = err instanceof Error ? err.message : String(err);
          }
        }

        return mcpJsonResult({
          updated: true,
          authenticated: Boolean(verifiedUser),
          ...client.auth.getCredentialsSummary(),
          user: verifiedUser,
          verificationError,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_login_interactive",
    {
      title: "Interactive Browser Login to Aukro.cz",
      description:
        "Launch a visible browser window to Aukro.cz's login page so you can pass Cloudflare Turnstile (or 2FA / social login), optionally pre-filling `username` and `password`. Automatically captures and saves the authenticated `SESSION` cookie once login succeeds.",
      inputSchema: {
        username: z
          .string()
          .optional()
          .describe("Optional Aukro email or username to pre-fill in the login form"),
        password: z
          .string()
          .optional()
          .describe("Optional password to pre-fill in the login form"),
        timeoutSeconds: z
          .number()
          .int()
          .min(30)
          .max(600)
          .optional()
          .default(180)
          .describe("Maximum time in seconds to wait for login completion in the browser"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        client.cache.clear();
        const res = await client.auth.loginInteractive(args);
        if (!res.success) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          };
        }
        return mcpJsonResult(res);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_logout",
    {
      title: "Clear Stored Aukro Credentials",
      description:
        "Clear all stored Aukro session cookies and OAuth2 tokens from memory and disk, returning the MCP server to anonymous mode.",
      inputSchema: {
        removeDiskFile: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true, deletes the saved credentials file on disk"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        client.cache.clear();
        client.auth.clearCredentials(args.removeDiskFile);
        return mcpJsonResult({
          loggedOut: true,
          ...client.auth.getCredentialsSummary(),
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
