import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AukroApiError, type AukroHttpClient } from "../client/http.js";
import {
  compactMyAccount,
  compactWatchedOffer,
  mcpErrorResult,
  mcpJsonResult,
  pruneApiNoise,
} from "../utils/formatters.js";

export function registerBuyerTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_my_account",
    {
      title: "Get My Aukro Account, Profile Stats & Billing Balance",
      description:
        "Retrieve the currently authenticated user's profile statistics, personal/company settings, addresses, and billing account balance. Requires authentication.",
      inputSchema: {
        includePersonalData: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true, fetches personal/company account settings and addresses (`/users/me/myData`)"),
        includeBilling: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true, fetches current billing account balance (`/billing/account/balance`)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const [actualStats, profileStats, myData, balance] = await Promise.all([
          client.request<Record<string, unknown>>("/users/actualStatistics", {
            method: "GET",
            requireAuth: true,
            cacheTtlMs: 60_000,
          }),
          client
            .request<Record<string, unknown>>("/users/userProfileStatistics", {
              method: "GET",
              requireAuth: true,
              cacheTtlMs: 60_000,
            })
            .catch(() => null),
          args.includePersonalData
            ? client
                .request<Record<string, unknown>>("/users/me/myData", {
                  method: "GET",
                  query: { withCompanyData: true },
                  requireAuth: true,
                })
                .catch(() => null)
            : Promise.resolve(null),
          args.includeBilling
            ? client
                .request<Record<string, unknown>>("/billing/account/balance", {
                  method: "GET",
                  requireAuth: true,
                })
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        return mcpJsonResult(
          compactMyAccount({
            actualStats,
            profileStats,
            myData,
            balance,
          })
        );
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_watchlist",
    {
      title: "Manage Watched Offers (Sledované nabídky)",
      description:
        "List watched offers (`action: 'LIST'`), add an offer to your watchlist (`action: 'ADD'`), or remove one or more offers from your watchlist (`action: 'REMOVE'`). Requires authentication.",
      inputSchema: {
        action: z
          .enum(["LIST", "ADD", "REMOVE"])
          .optional()
          .default("LIST")
          .describe("Action to perform on watchlist"),
        offerId: z
          .number()
          .int()
          .optional()
          .describe("Offer ID to add (required when `action: 'ADD'`)"),
        offerIds: z
          .array(z.number().int())
          .optional()
          .describe("Offer IDs to remove (required when `action: 'REMOVE'`)"),
        itemStateFilter: z
          .enum(["ACTIVE", "ENDED"])
          .optional()
          .default("ACTIVE")
          .describe("Filter watched items by state (for `LIST`)"),
        itemTypeFilter: z
          .enum(["ALL", "BOTH", "BIDDING", "BUYNOW"])
          .optional()
          .default("ALL")
          .describe("Filter watched items by offer type (for `LIST`)"),
        categoryIdFilter: z
          .number()
          .int()
          .optional()
          .describe("Optional category ID filter (for `LIST`)"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Items per page"),
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
        if (args.action === "ADD") {
          if (args.offerId === undefined) {
            return mcpErrorResult(new Error("`offerId` is required when `action` is 'ADD'."));
          }
          try {
            await client.request(`/offers/${args.offerId}/watch`, {
              method: "POST",
              requireAuth: true,
            });
            return mcpJsonResult({
              added: true,
              alreadyWatched: false,
              offerId: args.offerId,
            });
          } catch (err) {
            if (
              err instanceof AukroApiError &&
              err.status === 409 &&
              err.message.includes("duplicity")
            ) {
              return mcpJsonResult({
                added: true,
                alreadyWatched: true,
                offerId: args.offerId,
              });
            }
            throw err;
          }
        }

        if (args.action === "REMOVE") {
          const ids =
            args.offerIds && args.offerIds.length > 0
              ? args.offerIds
              : args.offerId !== undefined
                ? [args.offerId]
                : [];
          if (ids.length === 0) {
            return mcpErrorResult(
              new Error("Provide `offerIds` (or `offerId`) when `action` is 'REMOVE'.")
            );
          }
          await client.request("/users/me/watching", {
            method: "DELETE",
            query: { watchedItemIds: ids },
            requireAuth: true,
          });
          return mcpJsonResult({
            removed: true,
            offerIds: ids,
          });
        }

        // Important: Aukro's /users/me/watching requires itemTypeFilter=BOTH (not ALL, and omitting it returns empty content!)
        const backendItemType =
          args.itemTypeFilter === "ALL" ? "BOTH" : args.itemTypeFilter;

        const watched = await client.request<Record<string, unknown>>("/users/me/watching", {
          method: "GET",
          query: {
            itemStateFilter: args.itemStateFilter,
            itemTypeFilter: backendItemType,
            categoryIdFilter: args.categoryIdFilter,
            sort: "endingTime:ASC",
            page: args.page,
            size: args.pageSize,
          },
          requireAuth: true,
        });

        const items = Array.isArray(watched.content)
          ? (watched.content as Array<Record<string, unknown>>).map(compactWatchedOffer)
          : [];

        return mcpJsonResult({
          page: watched.page,
          itemsCount: items.length,
          items,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_favourites",
    {
      title: "Manage Favorite Sellers & Saved Searches",
      description:
        "List, add, or remove favorite sellers (`LIST_SELLERS`, `ADD_SELLER`, `REMOVE_SELLERS`) and saved searches (`LIST_SEARCHES`, `REMOVE_SEARCHES`). Requires authentication.",
      inputSchema: {
        action: z
          .enum([
            "LIST_SELLERS",
            "ADD_SELLER",
            "REMOVE_SELLERS",
            "LIST_SEARCHES",
            "REMOVE_SEARCHES",
          ])
          .optional()
          .default("LIST_SELLERS")
          .describe("Operation to perform"),
        sellerId: z
          .number()
          .int()
          .optional()
          .describe("Numeric seller userId (for `ADD_SELLER`)"),
        sellerIds: z
          .array(z.number().int())
          .optional()
          .describe("Numeric seller userIds to remove (for `REMOVE_SELLERS`)"),
        searchIds: z
          .array(z.number().int())
          .optional()
          .describe("Saved search IDs to delete (for `REMOVE_SEARCHES`)"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Items per page"),
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
        switch (args.action) {
          case "LIST_SELLERS": {
            const res = await client.request<Record<string, unknown>>("/favourites/seller", {
              method: "GET",
              query: {
                page: args.page,
                size: args.pageSize,
                sort: "name:ASC",
              },
              requireAuth: true,
            });
            return mcpJsonResult(pruneApiNoise(res));
          }
          case "ADD_SELLER": {
            if (args.sellerId === undefined) {
              return mcpErrorResult(new Error("`sellerId` is required for `ADD_SELLER`."));
            }
            await client.request(`/favourites/seller/${args.sellerId}`, {
              method: "POST",
              requireAuth: true,
            });
            return mcpJsonResult({ added: true, sellerId: args.sellerId });
          }
          case "REMOVE_SELLERS": {
            const ids =
              args.sellerIds && args.sellerIds.length > 0
                ? args.sellerIds
                : args.sellerId !== undefined
                  ? [args.sellerId]
                  : [];
            if (ids.length === 0) {
              return mcpErrorResult(new Error("`sellerIds` is required for `REMOVE_SELLERS`."));
            }
            await client.request("/favourites/seller_V2", {
              method: "DELETE",
              query: {
                sellersToRemove: ids,
                automaticallyAddFavouriteSellerEnabled: false,
              },
              requireAuth: true,
            });
            return mcpJsonResult({ removed: true, sellerIds: ids });
          }
          case "LIST_SEARCHES": {
            const res = await client.request<Record<string, unknown>>("/favourites/search", {
              method: "GET",
              query: {
                page: args.page,
                size: args.pageSize,
                sort: "newItemsCount:DESC",
              },
              requireAuth: true,
            });
            return mcpJsonResult(pruneApiNoise(res));
          }
          case "REMOVE_SEARCHES": {
            if (!args.searchIds || args.searchIds.length === 0) {
              return mcpErrorResult(new Error("`searchIds` is required for `REMOVE_SEARCHES`."));
            }
            await client.request("/favourites/searchTEMP", {
              method: "DELETE",
              query: { searchesToRemove: args.searchIds },
              requireAuth: true,
            });
            return mcpJsonResult({ removed: true, searchIds: args.searchIds });
          }
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_my_bids_and_purchases",
    {
      title: "List My Active Bids, Won/Lost Auctions & Purchase Orders",
      description:
        "Inspect your buyer activity on Aukro.cz: active auctions you are bidding on with WINNING/LOOSING status (`view: 'ACTIVE_BIDS'`), lost auctions (`view: 'LOST_AUCTIONS'`), won auctions & Buy Now purchases (`view: 'PURCHASED'`), or purchase transactions/orders with payment and shipment tracking (`view: 'TRANSACTIONS'`). Requires authentication.",
      inputSchema: {
        view: z
          .enum(["ACTIVE_BIDS", "LOST_AUCTIONS", "PURCHASED", "TRANSACTIONS"])
          .optional()
          .default("ACTIVE_BIDS")
          .describe("Which buyer list to retrieve"),
        itemTypeFilter: z
          .enum(["BOTH", "BIDDING", "BUYNOW"])
          .optional()
          .default("BOTH")
          .describe("Offer type filter when `view` is 'PURCHASED'"),
        sellerLogin: z
          .string()
          .optional()
          .describe("Optional seller username filter when `view` is 'TRANSACTIONS'"),
        itemName: z
          .string()
          .optional()
          .describe("Optional item name filter when `view` is 'TRANSACTIONS'"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Items per page"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        switch (args.view) {
          case "ACTIVE_BIDS": {
            const res = await client.request<Record<string, unknown>>(
              "/offerPurchases/listBiddingOffers",
              {
                method: "GET",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  // Important: listBiddingOffers uses endingTime:ASC (endTime:ASC throws HTTP 500)
                  sort: "endingTime:ASC",
                },
                requireAuth: true,
              }
            );
            return mcpJsonResult(
              pruneApiNoise({
                view: args.view,
                page: res.page,
                items: res.content ?? [],
              })
            );
          }
          case "LOST_AUCTIONS": {
            const res = await client.request<Record<string, unknown>>(
              "/offerPurchases/listNotWinOffers",
              {
                method: "GET",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  sort: "endTime:DESC",
                },
                requireAuth: true,
              }
            );
            return mcpJsonResult(
              pruneApiNoise({
                view: args.view,
                page: res.page,
                items: res.content ?? [],
              })
            );
          }
          case "PURCHASED": {
            const res = await client.request<Record<string, unknown>>(
              "/offerPurchases/listPurchasedOffers",
              {
                method: "POST",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  itemTypeFilterEnum: args.itemTypeFilter,
                  sort: "dealTime:DESC",
                },
                body: {},
                requireAuth: true,
              }
            );
            return mcpJsonResult(
              pruneApiNoise({
                view: args.view,
                page: res.page,
                items: res.content ?? [],
              })
            );
          }
          case "TRANSACTIONS": {
            const body: Record<string, unknown> = {};
            if (args.sellerLogin) body.sellerLogin = args.sellerLogin;
            if (args.itemName) body.itemName = args.itemName;

            const res = await client.request<Record<string, unknown>>(
              "/purchase-transactions/active",
              {
                method: "POST",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  sort: "created:DESC",
                },
                body,
                requireAuth: true,
              }
            );
            return mcpJsonResult(
              pruneApiNoise({
                view: args.view,
                transactions: res,
              })
            );
          }
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
