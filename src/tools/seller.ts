import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import {
  compactSellerOffer,
  mcpErrorResult,
  mcpJsonResult,
  pruneApiNoise,
} from "../utils/formatters.js";

export function registerSellerTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_my_sales",
    {
      title: "List My Seller Offers, Sold Items & Sale Transactions",
      description:
        "Inspect your seller inventory and orders on Aukro.cz: active listings (`view: 'ACTIVE'`), sold offers (`view: 'SOLD'`), ended unsold offers (`view: 'NOT_SOLD'`), scheduled offers (`view: 'SCHEDULED'`), or active sale transactions/orders (`view: 'TRANSACTIONS'`). Requires authentication.",
      inputSchema: {
        view: z
          .enum(["ACTIVE", "SOLD", "NOT_SOLD", "SCHEDULED", "TRANSACTIONS"])
          .optional()
          .default("ACTIVE")
          .describe("Seller view to fetch"),
        query: z
          .string()
          .optional()
          .describe("Optional text filter on your offers"),
        categoryId: z
          .number()
          .int()
          .optional()
          .describe("Optional category ID filter"),
        sort: z
          .string()
          .optional()
          .describe("Optional sort order (e.g. 'endingTime:ASC', 'startingTime:DESC')"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Number of items per page"),
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
        if (args.view === "TRANSACTIONS") {
          const body: Record<string, unknown> = {};
          if (args.query) body.text = args.query;
          const res = await client.request<Record<string, unknown>>(
            "/saleTransactions/listActiveTransactions",
            {
              method: "POST",
              query: {
                page: args.page,
                size: args.pageSize,
                sort: args.sort,
              },
              body,
              requireAuth: true,
            }
          );
          return mcpJsonResult(
            pruneApiNoise({
              view: args.view,
              page: res.page,
              transactions: res.content ?? res,
            })
          );
        }

        const endpointMap: Record<string, string> = {
          ACTIVE: "/offerSales/listActiveOffers",
          SOLD: "/offerSales/listSoldOffers",
          NOT_SOLD: "/offerSales/listNotSoldOffers",
          SCHEDULED: "/offerSales/listOffersToPublish",
        };
        const path = endpointMap[args.view] ?? "/offerSales/listActiveOffers";

        const filterBody: Record<string, unknown> = {};
        if (args.query) filterBody.text = args.query;
        if (args.categoryId !== undefined) filterBody.categoryId = args.categoryId;

        const res = await client.request<Record<string, unknown>>(path, {
          method: "POST",
          query: {
            page: args.page,
            size: args.pageSize,
            sort: args.sort,
          },
          body: filterBody,
          requireAuth: true,
        });

        const offers = Array.isArray(res.content)
          ? (res.content as Array<Record<string, unknown>>).map(compactSellerOffer)
          : [];

        return mcpJsonResult({
          view: args.view,
          page: res.page,
          offersCount: offers.length,
          offers,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_manage_offer",
    {
      title: "Create, Edit, Validate, Fee-Preview, Re-Expose or Terminate Seller Offers",
      description:
        "Manage your seller listings on Aukro.cz using the v2 Offers API: prepare edit payload from an existing offer (`PREPARE_EDIT`), validate an offer form (`VALIDATE`), calculate listing fees (`FEE_PREVIEW`), create a new offer (`CREATE`), modify an active offer (`MODIFY`), terminate an offer early (`TERMINATE`), or re-expose ended offers (`REEXPOSE`). Requires authentication.",
      inputSchema: {
        action: z
          .enum([
            "PREPARE_EDIT",
            "VALIDATE",
            "FEE_PREVIEW",
            "CREATE",
            "MODIFY",
            "TERMINATE",
            "REEXPOSE",
          ])
          .describe("Seller offer management action"),
        offerId: z
          .number()
          .int()
          .optional()
          .describe("Numeric offer ID (for `PREPARE_EDIT`, `MODIFY`, `TERMINATE`)"),
        offerIds: z
          .array(z.number().int())
          .optional()
          .describe("List of numeric offer IDs (for bulk `TERMINATE` or `REEXPOSE`)"),
        offerPayload: z
          .record(z.unknown())
          .optional()
          .describe(
            "Offer form payload (`createItemFormDto` / `modifyItemFormDto` / `feePreviewRequest`)"
          ),
        terminateReason: z
          .string()
          .optional()
          .describe("Optional reason when terminating an offer early"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        switch (args.action) {
          case "PREPARE_EDIT": {
            if (args.offerId === undefined) {
              return mcpErrorResult(new Error("`offerId` is required for `PREPARE_EDIT`."));
            }
            const res = await client.request(`/offers-v2/${args.offerId}/prepare-edit`, {
              method: "GET",
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "VALIDATE": {
            if (!args.offerPayload) {
              return mcpErrorResult(new Error("`offerPayload` is required for `VALIDATE`."));
            }
            const res = await client.request("/offers-v2/validations", {
              method: "POST",
              body: args.offerPayload,
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "FEE_PREVIEW": {
            if (!args.offerPayload) {
              return mcpErrorResult(new Error("`offerPayload` is required for `FEE_PREVIEW`."));
            }
            const res = await client.request("/offers-v2/fee-preview", {
              method: "POST",
              body: args.offerPayload,
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "CREATE": {
            if (!args.offerPayload) {
              return mcpErrorResult(new Error("`offerPayload` is required for `CREATE`."));
            }
            const res = await client.request("/offers-v2", {
              method: "POST",
              body: args.offerPayload,
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "MODIFY": {
            if (args.offerId === undefined || !args.offerPayload) {
              return mcpErrorResult(
                new Error("Both `offerId` and `offerPayload` are required for `MODIFY`.")
              );
            }
            const res = await client.request(`/offers-v2/${args.offerId}`, {
              method: "PATCH",
              body: args.offerPayload,
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "TERMINATE": {
            if (args.offerIds && args.offerIds.length > 0) {
              const res = await client.request("/offerSales/bulkTerminate", {
                method: "POST",
                body: { itemIds: args.offerIds },
                requireAuth: true,
              });
              return mcpJsonResult({ terminated: true, offerIds: args.offerIds, response: res });
            }
            if (args.offerId === undefined) {
              return mcpErrorResult(
                new Error("Provide `offerId` or `offerIds` for `TERMINATE`.")
              );
            }
            const res = await client.request(`/offers/${args.offerId}/terminate`, {
              method: "POST",
              body: args.terminateReason ? { reason: args.terminateReason } : {},
              requireAuth: true,
            });
            return mcpJsonResult({ terminated: true, offerId: args.offerId, response: res });
          }
          case "REEXPOSE": {
            const ids =
              args.offerIds && args.offerIds.length > 0
                ? args.offerIds
                : args.offerId !== undefined
                  ? [args.offerId]
                  : [];
            if (ids.length === 0 && !args.offerPayload) {
              return mcpErrorResult(
                new Error("Provide `offerIds` or `offerPayload` for `REEXPOSE`.")
              );
            }
            const body = args.offerPayload ?? { itemIds: ids };
            const res = await client.request("/offers/reexpose", {
              method: "POST",
              body,
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_offer_templates",
    {
      title: "List & Inspect Seller Offer Templates / Drafts",
      description:
        "List your saved seller offer templates (`action: 'LIST'`) or inspect a specific template by `templateId` (`action: 'GET'`). Requires authentication.",
      inputSchema: {
        action: z
          .enum(["LIST", "GET"])
          .optional()
          .default("LIST")
          .describe("Template operation"),
        templateId: z
          .number()
          .int()
          .optional()
          .describe("Template ID (required when `action: 'GET'`)"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Templates per page"),
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
        if (args.action === "GET") {
          if (args.templateId === undefined) {
            return mcpErrorResult(new Error("`templateId` is required when `action` is 'GET'."));
          }
          const res = await client.request(`/item-templates/${args.templateId}`, {
            method: "GET",
            requireAuth: true,
          });
          return mcpJsonResult(pruneApiNoise(res));
        }

        const res = await client.request("/item-templates/list-overview", {
          method: "GET",
          query: { page: args.page, size: args.pageSize },
          requireAuth: true,
        });
        return mcpJsonResult(pruneApiNoise(res));
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_messages",
    {
      title: "Read, Search & Send Aukro Messages (Moje zprávy)",
      description:
        "Manage buyer/seller conversations on Aukro.cz: list message threads and unread count (`LIST`), search conversations (`SEARCH`), read message history in a thread (`READ_THREAD`), reply to a thread (`REPLY`), or ask a seller a question about an offer (`ASK_ITEM_QUESTION`). Requires authentication.",
      inputSchema: {
        action: z
          .enum(["LIST", "SEARCH", "READ_THREAD", "REPLY", "ASK_ITEM_QUESTION"])
          .optional()
          .default("LIST")
          .describe("Messaging action"),
        extId: z
          .string()
          .optional()
          .describe("Conversation thread external ID (`extId`, for `READ_THREAD` and `REPLY`)"),
        searchTerm: z
          .string()
          .optional()
          .describe("Search query string (for `SEARCH`)"),
        messageBody: z
          .string()
          .optional()
          .describe("Message text content (for `REPLY` or `ASK_ITEM_QUESTION`)"),
        offerId: z
          .number()
          .int()
          .optional()
          .describe("Offer ID when asking a seller a question (`ASK_ITEM_QUESTION`)"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("Messages or threads per page"),
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
        switch (args.action) {
          case "LIST": {
            const [unreadIds, threadsRaw] = await Promise.all([
              client
                .request<string[]>("/conversation/unreadPrimeMessageExtIds", {
                  method: "GET",
                  requireAuth: true,
                })
                .catch(() => []),
              client.request<Record<string, unknown>>(
                "/conversation/message/communicationHistory/sliced",
                {
                  method: "GET",
                  query: { page: args.page, size: args.pageSize },
                  requireAuth: true,
                }
              ),
            ]);
            const innerConv = (threadsRaw.conversations ?? threadsRaw) as Record<
              string,
              unknown
            >;
            return mcpJsonResult(
              pruneApiNoise({
                unreadCount: Array.isArray(unreadIds) ? unreadIds.length : 0,
                unreadExtIds: unreadIds,
                page: innerConv.page,
                threads: innerConv.content ?? [],
              })
            );
          }
          case "SEARCH": {
            if (!args.searchTerm) {
              return mcpErrorResult(new Error("`searchTerm` is required for `SEARCH`."));
            }
            const res = await client.request(
              "/conversation/message/communicationHistory/search",
              {
                method: "GET",
                query: { term: args.searchTerm },
                requireAuth: true,
              }
            );
            return mcpJsonResult(pruneApiNoise({ matches: res }));
          }
          case "READ_THREAD": {
            if (!args.extId) {
              return mcpErrorResult(new Error("`extId` is required for `READ_THREAD`."));
            }
            const history = await client.request<Record<string, unknown>>(
              `/conversation/message/${encodeURIComponent(args.extId)}/communicationHistory`,
              {
                method: "GET",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  messagesOnly: false,
                },
                requireAuth: true,
              }
            );
            return mcpJsonResult(
              pruneApiNoise({
                extId: args.extId,
                ...history,
              })
            );
          }
          case "REPLY": {
            if (!args.extId || !args.messageBody) {
              return mcpErrorResult(
                new Error("Both `extId` and `messageBody` are required for `REPLY`.")
              );
            }
            const res = await client.request(
              `/conversation/message/${encodeURIComponent(args.extId)}/answer`,
              {
                method: "POST",
                body: {
                  attachmentIds: [],
                  body: args.messageBody,
                  messageType: "P2P",
                  topic: "ITEM",
                },
                requireAuth: true,
              }
            );
            return mcpJsonResult({ sent: true, extId: args.extId, response: res });
          }
          case "ASK_ITEM_QUESTION": {
            if (args.offerId === undefined || !args.messageBody) {
              return mcpErrorResult(
                new Error(
                  "Both `offerId` and `messageBody` are required for `ASK_ITEM_QUESTION`."
                )
              );
            }
            const res = await client.request("/offers/sendItemQuestion", {
              method: "POST",
              body: {
                itemId: args.offerId,
                question: args.messageBody,
              },
              requireAuth: true,
            });
            return mcpJsonResult({ sent: true, offerId: args.offerId, response: res });
          }
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
