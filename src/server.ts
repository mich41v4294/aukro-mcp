import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type AukroConfig } from "./config.js";
import { AuthManager } from "./client/auth.js";
import { AukroHttpClient } from "./client/http.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerOfferTools } from "./tools/offers.js";
import { registerUserTools } from "./tools/users.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerBuyerTools } from "./tools/buyer.js";
import { registerBiddingAndCartTools } from "./tools/bidding-cart.js";
import { registerSellerTools } from "./tools/seller.js";
import { registerResourcesAndPrompts } from "./resources/index.js";

export interface AukroMcpContext {
  server: McpServer;
  config: AukroConfig;
  auth: AuthManager;
  client: AukroHttpClient;
}

export function createAukroMcpServer(customConfig?: Partial<AukroConfig>): AukroMcpContext {
  const baseConfig = loadConfig();
  const config: AukroConfig = {
    ...baseConfig,
    ...customConfig,
    initialCredentials: {
      ...baseConfig.initialCredentials,
      ...customConfig?.initialCredentials,
    },
  };

  const auth = new AuthManager(config);
  const client = new AukroHttpClient(config, auth);

  const server = new McpServer(
    {
      name: "aukro-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  registerSearchTools(server, client);
  registerCategoryTools(server, client);
  registerOfferTools(server, client);
  registerUserTools(server, client);
  registerAuthTools(server, client);
  registerBuyerTools(server, client);
  registerBiddingAndCartTools(server, client);
  registerSellerTools(server, client);
  registerResourcesAndPrompts(server, client);

  return { server, config, auth, client };
}
