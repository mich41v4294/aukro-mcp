import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAukroMcpServer } from "../src/server.js";
import { parseCookieString, decodeJwtExpiration } from "../src/client/auth.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Auth utilities & cookie parsing", () => {
  it("parses raw Cookie header strings accurately", () => {
    const parsed = parseCookieString(
      "SESSION=abc-123; aukro-token=uuid-456; XSRF-TOKEN=xsrf-789"
    );
    expect(parsed).toEqual({
      SESSION: "abc-123",
      "aukro-token": "uuid-456",
      "XSRF-TOKEN": "xsrf-789",
    });
  });

  it("decodes JWT expiration timestamps", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp: 1900000000 })).toString("base64url");
    const token = `${header}.${payload}.sig`;
    expect(decodeJwtExpiration(token)).toBe(1900000000 * 1000);
  });
});

describe("Aukro MCP Server (In-Memory Transport + Live Public API)", () => {
  async function setupConnectedClient() {
    const tempCredFile = join(tmpdir(), `aukro-mcp-test-${Date.now()}-${Math.random()}.json`);
    const ctx = createAukroMcpServer({
      credentialsFile: tempCredFile,
      initialCredentials: {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "aukro-test-client", version: "1.0.0" });
    await Promise.all([
      ctx.server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);
    return { mcpClient, ctx };
  }

  it("registers all expected public and authenticated tools, resources, and prompts", async () => {
    const { mcpClient } = await setupConnectedClient();

    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "aukro_search_offers",
        "aukro_autocomplete",
        "aukro_get_categories",
        "aukro_get_category_attributes",
        "aukro_get_offer_detail",
        "aukro_get_offers_status_batch",
        "aukro_get_offer_bids_and_similar",
        "aukro_get_user_profile",
        "aukro_get_user_feedback",
        "aukro_get_seller_leaderboard",
        "aukro_auth_status",
        "aukro_set_credentials",
        "aukro_login_interactive",
        "aukro_logout",
        "aukro_my_account",
        "aukro_watchlist",
        "aukro_favourites",
        "aukro_my_bids_and_purchases",
        "aukro_place_bid",
        "aukro_bargain_offer",
        "aukro_cart",
        "aukro_my_sales",
        "aukro_manage_offer",
        "aukro_offer_templates",
        "aukro_messages",
      ])
    );

    const resourcesList = await mcpClient.listResources();
    expect(resourcesList.resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        "aukro://categories/root",
        "aukro://registry/shipping",
        "aukro://registry/conditions",
      ])
    );

    const promptsList = await mcpClient.listPrompts();
    expect(promptsList.prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(["aukro_estimate_market_price", "aukro_seller_due_diligence"])
    );
  });

  it("reports anonymous mode in aukro_auth_status and returns clear guidance when calling auth tools anonymously", async () => {
    const { mcpClient } = await setupConnectedClient();

    const statusRes = await mcpClient.callTool({
      name: "aukro_auth_status",
      arguments: {},
    });
    const statusData = JSON.parse(
      (statusRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(statusData.authenticated).toBe(false);
    expect(statusData.mode).toBe("anonymous");

    const accountRes = await mcpClient.callTool({
      name: "aukro_my_account",
      arguments: {},
    });
    expect(accountRes.isError).toBe(true);
    const errData = JSON.parse(
      (accountRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(errData.status).toBe(401);
    expect(errData.error).toContain("anonymous mode");
  });

  it("searches active and archived offers anonymously on live aukro.cz and fetches offer details", async () => {
    const { mcpClient } = await setupConnectedClient();

    // 1. Search active offers for "iphone" (tests searchRedirectDisabled: true!)
    const searchRes = await mcpClient.callTool({
      name: "aukro_search_offers",
      arguments: {
        query: "iphone",
        pageSize: 3,
        sort: "price:ASC",
      },
    });
    expect(searchRes.isError).toBeFalsy();
    const searchData = JSON.parse(
      (searchRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(Array.isArray(searchData.items)).toBe(true);
    expect(searchData.items.length).toBeGreaterThan(0);

    const firstOfferId = searchData.items[0].itemId as number;
    expect(typeof firstOfferId).toBe("number");

    // 2. Fetch full offer detail for the first result
    const detailRes = await mcpClient.callTool({
      name: "aukro_get_offer_detail",
      arguments: {
        offerId: firstOfferId,
      },
    });
    expect(detailRes.isError).toBeFalsy();
    const detailData = JSON.parse(
      (detailRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(detailData.itemId).toBe(firstOfferId);
    expect(typeof detailData.name).toBe("string");

    // 3. Batch poll status
    const batchRes = await mcpClient.callTool({
      name: "aukro_get_offers_status_batch",
      arguments: {
        offerIds: [firstOfferId],
      },
    });
    expect(batchRes.isError).toBeFalsy();
    const batchData = JSON.parse(
      (batchRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(batchData.count).toBe(1);
    expect(batchData.offers[0].itemId).toBe(firstOfferId);

    // 4. Search archived/finished listings
    const archiveRes = await mcpClient.callTool({
      name: "aukro_search_offers",
      arguments: {
        query: "lego",
        finished: true,
        pageSize: 2,
      },
    });
    expect(archiveRes.isError).toBeFalsy();
    const archiveData = JSON.parse(
      (archiveRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(archiveData.items.length).toBeGreaterThan(0);
    expect(archiveData.items[0].state).toBe("ENDED");
  }, 25000);

  it("fetches categories, category attributes, and seller profiles anonymously", async () => {
    const { mcpClient } = await setupConnectedClient();

    // 1. Root categories
    const catRes = await mcpClient.callTool({
      name: "aukro_get_categories",
      arguments: {},
    });
    expect(catRes.isError).toBeFalsy();
    const catData = JSON.parse(
      (catRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(catData.rootCategoriesCount).toBeGreaterThan(10);

    // 2. Category detail & attributes for iPhone (107152)
    const subcatRes = await mcpClient.callTool({
      name: "aukro_get_categories",
      arguments: { categoryId: 107152 },
    });
    expect(subcatRes.isError).toBeFalsy();
    const subcatData = JSON.parse(
      (subcatRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(subcatData.category?.id).toBe(107152);

    const attrRes = await mcpClient.callTool({
      name: "aukro_get_category_attributes",
      arguments: { categoryId: 107152 },
    });
    expect(attrRes.isError).toBeFalsy();
    const attrData = JSON.parse(
      (attrRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(attrData.attributesCount).toBeGreaterThan(0);

    // 3. Seller profile lookup (Alza_prodej)
    const userRes = await mcpClient.callTool({
      name: "aukro_get_user_profile",
      arguments: { username: "Alza_prodej" },
    });
    expect(userRes.isError).toBeFalsy();
    const userData = JSON.parse(
      (userRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(userData.userId).toBe(100143591);
    expect(userData.companyAccount).toBe(true);
    expect(userData.sellerInfo?.companyIdentifiers?.regNumber).toBe("27082440");

    // 4. Seller feedback & leaderboard
    const feedbackRes = await mcpClient.callTool({
      name: "aukro_get_user_feedback",
      arguments: { userId: 100143591, sentiment: "POS", pageSize: 2 },
    });
    expect(feedbackRes.isError).toBeFalsy();
    const feedbackData = JSON.parse(
      (feedbackRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(feedbackData.feedbacksCount).toBeGreaterThan(0);

    const leaderboardRes = await mcpClient.callTool({
      name: "aukro_get_seller_leaderboard",
      arguments: { sortBy: "favourite_count:DESC", pageSize: 2 },
    });
    expect(leaderboardRes.isError).toBeFalsy();
    const leaderboardData = JSON.parse(
      (leaderboardRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(Array.isArray(leaderboardData.sellers)).toBe(true);
    expect(leaderboardData.sellers.length).toBe(2);
  }, 25000);

  it("supports autocomplete, resources, and runtime credential switching", async () => {
    const { mcpClient } = await setupConnectedClient();

    const suggestRes = await mcpClient.callTool({
      name: "aukro_autocomplete",
      arguments: { mode: "USERS", text: "Alza" },
    });
    expect(suggestRes.isError).toBeFalsy();
    const suggestData = JSON.parse(
      (suggestRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(Array.isArray(suggestData.users)).toBe(true);

    const condResource = await mcpClient.readResource({
      uri: "aukro://registry/conditions",
    });
    const condJson = JSON.parse(condResource.contents[0].text as string);
    expect(condJson.attributeId).toBe(48);

    // Runtime credential setting & logout
    const setCredRes = await mcpClient.callTool({
      name: "aukro_set_credentials",
      arguments: {
        cookieHeader: "SESSION=dummy-session-token; XSRF-TOKEN=dummy-xsrf",
        persist: true,
      },
    });
    const setCredData = JSON.parse(
      (setCredRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(setCredData.mode).toBe("cookie");
    expect(setCredData.hasSessionCookie).toBe(true);
    expect(setCredData.hasXsrfToken).toBe(true);

    const logoutRes = await mcpClient.callTool({
      name: "aukro_logout",
      arguments: { removeDiskFile: true },
    });
    const logoutData = JSON.parse(
      (logoutRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(logoutData.mode).toBe("anonymous");
  }, 25000);
});
