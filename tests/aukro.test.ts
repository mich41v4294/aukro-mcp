import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
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

describe("Aukro MCP Server (In-Memory Transport + Deterministic Mock API)", () => {
  let mockServer: Server;
  let mockBaseUrl: string;
  const lastRequests: Array<{ method: string; url: string; headers: Record<string, unknown>; body: unknown }> = [];

  beforeAll(async () => {
    mockServer = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let parsedBody: unknown = undefined;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      const urlObj = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = urlObj.pathname;
      lastRequests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body: parsedBody,
      });

      const sendJson = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };

      if (pathname === "/backend-web/api/token/generate") {
        return sendJson(200, { token: "mock-anon-token-uuid" });
      }

      if (pathname === "/backend-web/api/offers/searchItemsCommon") {
        const body = (parsedBody ?? {}) as Record<string, unknown>;
        const isFinished = Boolean(body.finished);
        return sendJson(200, {
          page: { size: 20, totalElements: 1, totalPages: 1, number: 0 },
          minPrice: 100,
          maxPrice: 15000,
          content: [
            {
              itemId: isFinished ? 9000001 : 7140475083,
              itemName: isFinished ? "LEGO Technic Archive Set" : "Apple iPhone 13 128GB",
              seoUrl: isFinished ? "lego-technic-archive-set" : "apple-iphone-13-128gb",
              itemState: isFinished ? "ENDED" : "ACTIVE",
              auction: true,
              buyNowActive: !isFinished,
              price: { amount: isFinished ? 1250 : 8990, currency: "CZK" },
              priceWithShipping: { amount: isFinished ? 1329 : 9069, currency: "CZK" },
              buyNowPrice: isFinished ? undefined : { amount: 9990, currency: "CZK" },
              biddersCount: 4,
              watchersCount: 12,
              endingTime: "2026-12-01T18:00:00Z",
              freeShipping: false,
              paymentViaAukro: true,
              seller: {
                userId: 100143591,
                showName: "Alza_prodej",
                companyAccount: true,
                rating: 45200,
                positiveFeedbackPercentage: 0.994,
              },
              categoryPath: [
                { id: 100000, name: "Mobily a GPS" },
                { id: 107152, name: "Mobilní telefony Apple iPhone" },
              ],
            },
          ],
        });
      }

      if (pathname === "/backend-web/api/offers/7140475083/offerDetail") {
        return sendJson(200, {
          itemId: 7140475083,
          name: "Apple iPhone 13 128GB",
          seoUrl: "apple-iphone-13-128gb",
          state: "ACTIVE",
          itemArchived: false,
          itemType: "AUCTION",
          price: { amount: 8990, currency: "CZK" },
          nextBidMinAmount: { amount: 9090, currency: "CZK" },
          buyNowActive: true,
          buyNowPrice: { amount: 9990, currency: "CZK" },
          biddersCount: 4,
          endingTime: "2026-12-01T18:00:00Z",
          descriptionInHtml: "<p>Plně funkční <b>iPhone 13 128GB</b> v pěkném stavu.</p>",
          shippingOptions: [
            {
              shippingMethodId: 10,
              shippingMethodCode: "ZASILKOVNA",
              shippingMethodName: "Zásilkovna",
              firstPackagePrice: { amount: 79, currency: "CZK" },
              countryTo: "CZ",
              paymentBefore: true,
              aukroShipping: true,
            },
          ],
          attributes: [
            { attributeId: 48, attributeName: "Stav zboží", attributeValue: "Použité" },
          ],
          seller: {
            userId: 100143591,
            showName: "Alza_prodej",
            companyAccount: true,
            positiveFeedbackPercentage: 99.4,
          },
        });
      }

      if (pathname === "/backend-web/api/offers/bulk/offerDetail/short") {
        return sendJson(200, [
          {
            itemId: 7140475083,
            state: "ACTIVE",
            price: { amount: 8990, currency: "CZK" },
            nextBidMinAmount: { amount: 9090, currency: "CZK" },
            buyNowActive: true,
            biddersCount: 4,
            endingTime: "2026-12-01T18:00:00Z",
          },
        ]);
      }

      if (pathname === "/backend-web/api/categories/aggregations/root") {
        return sendJson(
          200,
          Array.from({ length: 15 }, (_, idx) => ({
            id: 1000 + idx,
            name: `Category ${idx + 1}`,
            seoUrl: `category-${idx + 1}`,
            count: 5000,
          }))
        );
      }

      if (pathname === "/backend-web/api/categories/categories/107152") {
        if (urlObj.searchParams.get("onlyExposable") !== "true") {
          return sendJson(500, { message: "NullPointerException without onlyExposable=true" });
        }
        return sendJson(200, {
          id: 107152,
          name: "Mobilní telefony Apple iPhone",
          shortName: "Apple iPhone",
          seoUrl: "mobilni-telefony-apple-iphone",
          parentId: 100000,
          leaf: true,
          active: true,
          buyersProtectionAvailable: true,
        });
      }

      if (pathname === "/backend-web/api/categories/categories/107152/subcategoriesWithItemsCount") {
        return sendJson(200, []);
      }

      if (pathname === "/backend-web/api/categories/breadcrumbs/107152") {
        return sendJson(200, {
          treePath: [
            { id: 100000, name: "Mobily a GPS", seoUrl: "mobily-a-gps", leaf: false },
            { id: 107152, name: "Apple iPhone", seoUrl: "apple-iphone", leaf: true },
          ],
        });
      }

      if (pathname === "/backend-web/api/categories/categories/107152/attributes") {
        return sendJson(200, [
          {
            id: 48,
            name: "Stav zboží",
            type: "LIST",
            mandatory: true,
            listAllowedValues: [
              { name: "1", description: "Nové" },
              { name: "2", description: "Použité" },
            ],
          },
        ]);
      }

      if (pathname === "/backend-web/api/users/profile/all") {
        return sendJson(200, {
          userId: 100143591,
          userName: "Alza_prodej",
          companyAccount: true,
          aukroPlus: true,
          positiveFeedbackPercentage: 99.4,
        });
      }

      if (pathname === "/backend-web/api/users/100143591/sellerInfo") {
        return sendJson(200, {
          companyIdentifiers: {
            companyName: "Alza.cz a.s.",
            regNumber: "27082440",
            taxNumber: "CZ27082440",
          },
          contactInfo: "Jankovcova 1522/53, Praha 7",
        });
      }

      if (
        pathname === "/backend-web/api/users/100143591/absence" ||
        pathname === "/backend-web/api/users/100143591/shippingPriceLists/freeLimit"
      ) {
        return sendJson(200, {});
      }

      if (pathname === "/backend-web/api/users/100143591/profile/feedback/allReceived") {
        return sendJson(200, {
          page: { size: 2, totalElements: 1, totalPages: 1, number: 0 },
          content: [
            {
              id: 555,
              date: "2026-11-01T12:00:00Z",
              feedbackType: "POS",
              receiver: "SELLER",
              description: "Rychlé dodání, doporučuji!",
            },
          ],
        });
      }

      if (pathname === "/backend-web/api/favourites/leaderboard") {
        if (!urlObj.searchParams.get("sort")) {
          return sendJson(500, { message: "Missing sort parameter" });
        }
        return sendJson(200, {
          page: { size: 2, totalElements: 2, totalPages: 1, number: 0 },
          content: [
            { rank: 1, userId: 100143591, showName: "Alza_prodej", favouriteCount: 9500 },
            { rank: 2, userId: 200200200, showName: "Mince_Numismatika", favouriteCount: 8200 },
          ],
        });
      }

      if (pathname === "/backend-web/api/users/suggest/showName") {
        return sendJson(200, [
          { userId: 100143591, showName: "Alza_prodej" },
        ]);
      }

      if (pathname === "/backend-web/api/users/actualStatistics") {
        const cookieHeader = String(req.headers.cookie ?? "");
        if (cookieHeader.includes("SESSION=valid-session")) {
          return sendJson(200, {
            userId: 999888,
            username: "test_buyer",
            currency: "CZK",
            registrationDomainCode: "CZ",
            accountTypeEnum: "PERSONAL",
            emailVerified: true,
          });
        }
        return sendJson(401, { message: "Unauthorized" });
      }

      if (pathname === "/backend-web/api/users/me/watching") {
        if (urlObj.searchParams.get("itemTypeFilter") !== "BOTH") {
          return sendJson(200, { page: { totalElements: 0 }, content: [] });
        }
        return sendJson(200, {
          page: { size: 20, totalElements: 1, totalPages: 1, number: 0 },
          content: [
            {
              itemId: 7140475083,
              itemName: "Apple iPhone 13 128GB",
              seoUrl: "apple-iphone-13-128gb",
              state: "ACTIVE",
              price: { amount: 8990, currency: "CZK" },
            },
          ],
        });
      }

      return sendJson(404, { error: `Unhandled mock path: ${pathname}` });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = mockServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    mockBaseUrl = `http://127.0.0.1:${port}/backend-web/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  async function setupConnectedClient() {
    const tempCredFile = join(tmpdir(), `aukro-mcp-test-${Date.now()}-${Math.random()}.json`);
    const ctx = createAukroMcpServer({
      baseUrl: mockBaseUrl,
      webUrl: mockBaseUrl.replace("/backend-web/api", ""),
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

  it("searches active and archived offers anonymously and fetches offer details", async () => {
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
    expect(firstOfferId).toBe(7140475083);

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
    expect(detailData.name).toBe("Apple iPhone 13 128GB");
    expect(detailData.shippingSummary?.canShipToCz).toBe(true);
    expect(detailData.shippingSummary?.totalPriceWithCheapestShipping).toBe(9069);

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
  });

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
  });

  it("supports autocomplete, resources, runtime credential switching, and watchlist", async () => {
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

    // Runtime credential setting & verification
    const setCredRes = await mcpClient.callTool({
      name: "aukro_set_credentials",
      arguments: {
        cookieHeader: "SESSION=valid-session; XSRF-TOKEN=dummy-xsrf",
        persist: true,
      },
    });
    const setCredData = JSON.parse(
      (setCredRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(setCredData.mode).toBe("cookie");
    expect(setCredData.authenticated).toBe(true);
    expect(setCredData.user?.username).toBe("test_buyer");
    expect(setCredData.hasSessionCookie).toBe(true);
    expect(setCredData.hasXsrfToken).toBe(true);

    // Authenticated watchlist call (verifies itemTypeFilter=BOTH translation)
    const watchRes = await mcpClient.callTool({
      name: "aukro_watchlist",
      arguments: { action: "LIST" },
    });
    expect(watchRes.isError).toBeFalsy();
    const watchData = JSON.parse(
      (watchRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(watchData.itemsCount).toBe(1);

    const logoutRes = await mcpClient.callTool({
      name: "aukro_logout",
      arguments: { removeDiskFile: true },
    });
    const logoutData = JSON.parse(
      (logoutRes.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(logoutData.mode).toBe("anonymous");
  });
});
