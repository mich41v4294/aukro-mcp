#!/usr/bin/env node
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAukroMcpServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http");
  const portArgIdx = args.indexOf("--port");
  const port =
    portArgIdx !== -1 && args[portArgIdx + 1]
      ? Number(args[portArgIdx + 1])
      : Number(process.env.PORT ?? 3000);

  if (useHttp) {
    const httpServer = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "aukro-mcp" }));
        return;
      }

      if (req.url?.startsWith("/mcp")) {
        const { server } = createAukroMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on("close", () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found. Use /mcp or /health" }));
    });

    httpServer.listen(port, () => {
      console.error(`[aukro-mcp] Streamable HTTP MCP server listening on http://127.0.0.1:${port}/mcp`);
    });
    return;
  }

  const { server, client } = createAukroMcpServer();
  // Non-blocking anonymous token initialization in background
  void client.initAnonymousTokenIfNeeded();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[aukro-mcp] Fatal startup error:", err);
  process.exit(1);
});
