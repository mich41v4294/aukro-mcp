import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { compactSearchItem, mcpErrorResult, mcpJsonResult } from "../utils/formatters.js";

/**
 * Aukro Attribute ID 48 ("Stav zboží" / Item Condition) mapping.
 */
export const CONDITION_TO_ATTRIBUTE_VALUE: Record<string, string> = {
  NEW: "1", // Nové
  UNPACKED: "3", // Rozbaleno
  LIKE_NEW: "6", // Zánovní
  USED: "2", // Použité
  REPAIRED: "5", // Opravené
  REFURBISHED: "10", // Repasované
  DAMAGED: "14", // Poškozeno
  FOR_PARTS: "4", // Nefunkční / na díly
};

export function registerSearchTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_search_offers",
    {
      title: "Search Aukro.cz Offers (Active & Archived)",
      description:
        "Search active or completed/archived (`finished: true`) marketplace offers on Aukro.cz. Supports keyword search, category ID/SEO URL, price bounds, offer format (auction vs buy-now vs hot auction), item condition (`NEW`, `USED`, etc.), seller username/ID, shipping/payment filters, geolocation (`postCode` + `distanceKm`), dynamic category attribute filters, and curated feeds (`ENDING_SOON`, `FROM_1_CZK`, `UP_TO_300_CZK`, `NEW_OFFERS`, `POPULAR`, `PRICE_HITS`, `CHARITY`, `OUTLET`). Works anonymously without login.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Search keyword or phrase (or numeric offer ID)"),
        queries: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            "Multiple keyword query variants to execute in parallel and deduplicate by `itemId` (e.g. ['8GB', '8/128', '8/256', '12GB'])"
          ),
        excludeWords: z
          .array(z.string())
          .optional()
          .describe(
            "Case-insensitive words/substrings to exclude from returned offer titles (e.g. ['iphone', 'lumia', 'kryt'])"
          ),
        excludeCategoryIds: z
          .array(z.number().int())
          .optional()
          .describe("Leaf category IDs to exclude from results (e.g. [107152] to exclude iPhones)"),
        searchInDescription: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, searches inside offer descriptions as well as titles"),
        finished: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, searches completed/ended/archived listings (useful for checking historical sold prices)"
          ),
        categoryId: z
          .number()
          .int()
          .optional()
          .describe("Numeric category ID to filter by (from `aukro_get_categories`)"),
        categorySeoUrl: z
          .string()
          .optional()
          .describe("Category SEO slug (e.g. 'mobilni-telefony-apple')"),
        priceMin: z.number().optional().describe("Minimum price in selected currency"),
        priceMax: z.number().optional().describe("Maximum price in selected currency"),
        priceDeliveryIncluded: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, `priceMin` and `priceMax` are evaluated against the total price including shipping (`priceWithShipping`)"
          ),
        offerType: z
          .enum(["ALL", "AUCTION", "BUY_NOW", "HOT_AUCTION"])
          .optional()
          .default("ALL")
          .describe("Filter by listing type: ALL, AUCTION, BUY_NOW (Kup teď), or HOT_AUCTION (Žhavé aukce)"),
        conditions: z
          .array(
            z.enum([
              "NEW",
              "UNPACKED",
              "LIKE_NEW",
              "USED",
              "REPAIRED",
              "REFURBISHED",
              "DAMAGED",
              "FOR_PARTS",
            ])
          )
          .optional()
          .describe("Filter by item condition (Stav zboží)"),
        attributeFilters: z
          .array(
            z.object({
              attributeId: z.number().int().describe("Attribute ID from `aukro_get_category_attributes`"),
              values: z
                .array(z.string())
                .optional()
                .describe("Allowed option keys/values (as strings)"),
              gte: z.number().optional().describe("Minimum numeric value (>=)"),
              lte: z.number().optional().describe("Maximum numeric value (<=)"),
            })
          )
          .optional()
          .describe("Dynamic category parameter/attribute filters"),
        sellerId: z.number().int().optional().describe("Filter by numeric seller userId"),
        sellerNames: z
          .array(z.string())
          .optional()
          .describe("Filter by one or more seller usernames (e.g. ['Alza_prodej'])"),
        withShipping: z
          .boolean()
          .optional()
          .describe(
            "When true, only returns offers that can be shipped (excludes personal-pickup-only listings)"
          ),
        freeShipping: z.boolean().optional().describe("Only items with free shipping"),
        paymentViaAukro: z
          .boolean()
          .optional()
          .describe("Only items supporting secure Payment via Aukro (Platba přes Aukro / Buyer Protection)"),
        cashOnDelivery: z.boolean().optional().describe("Only items supporting cash on delivery (Dobírka)"),
        personalPickup: z.boolean().optional().describe("Only items allowing personal pickup (Osobní převzetí)"),
        aukroPlus: z.boolean().optional().describe("Only Aukro+ offers"),
        postCode: z
          .string()
          .optional()
          .describe("Czech postal code (PSČ, e.g. '110 00') for radius distance filtering"),
        distanceKm: z
          .number()
          .int()
          .optional()
          .describe("Maximum distance in kilometers from `postCode`"),
        destinationCountries: z
          .array(z.string())
          .optional()
          .describe("Shipping destination country codes (e.g. ['cz', 'sk'])"),
        endingWithin: z
          .string()
          .optional()
          .describe(
            "Relative time window before offer ends (e.g. '1h', '3h', '6h', '12h', '24h', '3d', '7d')"
          ),
        specialFeed: z
          .enum([
            "ENDING_SOON",
            "FROM_1_CZK",
            "UP_TO_300_CZK",
            "NEW_OFFERS",
            "POPULAR",
            "PRICE_HITS",
            "PREMIUM",
            "CHARITY",
            "OUTLET",
          ])
          .optional()
          .describe("Filter by curated Aukro special marketplace feed"),
        sort: z
          .enum([
            "relevance:DESC",
            "price:ASC",
            "price:DESC",
            "priceWithShipping:ASC",
            "priceWithShipping:DESC",
            "endingTime:ASC",
            "startingTime:DESC",
            "startingTime:ASC",
            "bidderCount:DESC",
            "bidderCount:ASC",
            "name:ASC",
            "name:DESC",
          ])
          .optional()
          .default("relevance:DESC")
          .describe("Sorting field and direction"),
        page: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("0-indexed page number (0 = first page)"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(180)
          .optional()
          .default(20)
          .describe("Number of offers per page (1..180, default 20)"),
        includeAggregations: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, includes category and attribute facet aggregations in the response"),
        currency: z
          .enum(["CZK", "EUR", "PLN", "HUF", "RON"])
          .optional()
          .describe("Override response currency (defaults to CZK)"),
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
        const buildFilterBody = (qText?: string): Record<string, unknown> => {
          const body: Record<string, unknown> = {
            // Crucial: prevent Aukro from returning empty content with a redirectUrl when text matches a category
            searchRedirectDisabled: true,
          };

          if (qText) body.text = qText;
          if (args.searchInDescription) body.searchAll = true;
          if (args.finished) body.finished = true;
          if (args.categoryId !== undefined) body.categoryId = args.categoryId;
          if (args.categorySeoUrl) body.categorySeoUrl = args.categorySeoUrl;
          if (args.priceMin !== undefined) body.priceMin = args.priceMin;
          if (args.priceMax !== undefined) body.priceMax = args.priceMax;
          if (args.priceDeliveryIncluded) body.priceDeliveryIncluded = true;

          if (args.offerType === "AUCTION") body.auction = true;
          else if (args.offerType === "BUY_NOW") body.buyNowActive = true;
          else if (args.offerType === "HOT_AUCTION") body.hotAuction = true;

          if (args.sellerId !== undefined) body.sellerId = args.sellerId;
          if (args.sellerNames && args.sellerNames.length > 0) body.sellersNames = args.sellerNames;
          if (args.withShipping) body.withShipping = true;
          if (args.freeShipping) body.freeShipping = true;
          if (args.paymentViaAukro) body.paymentViaAukro = true;
          if (args.cashOnDelivery) body.cashOnDelivery = true;
          if (args.personalPickup) body.personalPickup = true;
          if (args.aukroPlus) body.aukroPlus = true;
          if (args.postCode) body.postCode = args.postCode;
          if (args.distanceKm !== undefined) body.distance = args.distanceKm;
          if (args.destinationCountries && args.destinationCountries.length > 0) {
            body.destinationCountries = args.destinationCountries;
          }
          if (args.endingWithin) {
            body.endingBeforeRel = args.endingWithin;
          }

          if (args.specialFeed) {
            const flagMap: Record<string, string> = {
              ENDING_SOON: "specialFlagEndingSoon",
              FROM_1_CZK: "specialFlagBasicStartingPrice",
              UP_TO_300_CZK: "specialFlagThreeHundred",
              NEW_OFFERS: "specialFlagNewOffers",
              POPULAR: "specialFlagPopularOffers",
              PRICE_HITS: "specialFlagPriceHits",
              PREMIUM: "specialFlagPremiumOffers",
              CHARITY: "specialFlagCharityOffers",
              OUTLET: "specialFlagAukroOutlet",
            };
            const flagKey = flagMap[args.specialFeed];
            if (flagKey) body[flagKey] = true;
          }

          const filterList: Array<Record<string, unknown>> = [];
          if (args.conditions && args.conditions.length > 0) {
            const mappedValues = args.conditions
              .map((c) => CONDITION_TO_ATTRIBUTE_VALUE[c])
              .filter(Boolean);
            if (mappedValues.length > 0) {
              filterList.push({
                attributeId: 48,
                value: mappedValues,
              });
            }
          }
          if (args.attributeFilters && args.attributeFilters.length > 0) {
            for (const af of args.attributeFilters) {
              filterList.push({
                attributeId: af.attributeId,
                value: af.values,
                gte: af.gte ?? null,
                lte: af.lte ?? null,
              });
            }
          }
          if (filterList.length > 0) {
            body.filter = filterList;
          }
          return body;
        };

        const excludeLower = (args.excludeWords ?? [])
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean);
        const excludeCatSet = new Set(args.excludeCategoryIds ?? []);

        const applyPostFilters = (items: Array<Record<string, unknown>>) => {
          return items.filter((item) => {
            if (excludeLower.length > 0) {
              const title = String(item.name ?? "").toLowerCase();
              if (excludeLower.some((w) => title.includes(w))) return false;
            }
            if (excludeCatSet.size > 0) {
              const cat = item.category as { id?: number } | undefined;
              if (cat?.id !== undefined && excludeCatSet.has(Number(cat.id))) return false;
            }
            if (
              args.priceDeliveryIncluded &&
              args.priceMax !== undefined &&
              typeof item.priceWithShipping === "number" &&
              item.priceWithShipping > args.priceMax
            ) {
              return false;
            }
            return true;
          });
        };

        const queryList =
          args.queries && args.queries.length > 0
            ? args.queries
            : [args.query];

        if (queryList.length > 1) {
          const responses = await Promise.all(
            queryList.map((qText) =>
              client.request<Record<string, unknown>>("/offers/searchItemsCommon", {
                method: "POST",
                query: {
                  page: args.page,
                  size: args.pageSize,
                  sort: args.sort,
                },
                body: buildFilterBody(qText),
                currency: args.currency,
              })
            )
          );

          const dedupedMap = new Map<number, Record<string, unknown>>();
          for (const resp of responses) {
            if (Array.isArray(resp.content)) {
              for (const rawItem of resp.content as Array<Record<string, unknown>>) {
                const compacted = compactSearchItem(rawItem);
                const id = Number(compacted.itemId);
                if (!Number.isNaN(id) && !dedupedMap.has(id)) {
                  dedupedMap.set(id, compacted);
                }
              }
            }
          }

          let mergedItems = applyPostFilters(Array.from(dedupedMap.values()));

          if (args.sort.startsWith("priceWithShipping:")) {
            const dir = args.sort.endsWith(":ASC") ? 1 : -1;
            mergedItems.sort(
              (a, b) =>
                (Number(a.priceWithShipping ?? a.price ?? 0) -
                  Number(b.priceWithShipping ?? b.price ?? 0)) *
                dir
            );
          } else if (args.sort.startsWith("price:")) {
            const dir = args.sort.endsWith(":ASC") ? 1 : -1;
            mergedItems.sort(
              (a, b) => (Number(a.price ?? 0) - Number(b.price ?? 0)) * dir
            );
          } else if (args.sort === "endingTime:ASC") {
            mergedItems.sort((a, b) =>
              String(a.endingTime ?? "").localeCompare(String(b.endingTime ?? ""))
            );
          }

          return mcpJsonResult({
            queries: queryList,
            itemsCount: mergedItems.length,
            items: mergedItems,
          });
        }

        const raw = await client.request<Record<string, unknown>>("/offers/searchItemsCommon", {
          method: "POST",
          query: {
            page: args.page,
            size: args.pageSize,
            sort: args.sort,
          },
          body: buildFilterBody(queryList[0]),
          currency: args.currency,
        });

        const rawContent = Array.isArray(raw.content)
          ? (raw.content as Array<Record<string, unknown>>).map(compactSearchItem)
          : [];
        const content = applyPostFilters(rawContent);

        const result: Record<string, unknown> = {
          page: raw.page,
          minPrice: raw.minPrice,
          maxPrice: raw.maxPrice,
          currentCategory: raw.currentCategory
            ? {
                id: (raw.currentCategory as Record<string, unknown>).id,
                name: (raw.currentCategory as Record<string, unknown>).name,
                seoUrl: (raw.currentCategory as Record<string, unknown>).seoUrl,
              }
            : undefined,
          categoryPath: Array.isArray(raw.categoryPath)
            ? (raw.categoryPath as Array<Record<string, unknown>>).map((c) => ({
                id: c.id,
                name: c.name,
                seoUrl: c.seoUrl,
              }))
            : undefined,
          itemById: raw.itemById,
          redirectUrl: raw.redirectUrl,
          itemsCount: content.length,
          items: content,
        };

        if (args.includeAggregations) {
          result.aggregations = raw.aggregations;
        }

        return mcpJsonResult(result);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_autocomplete",
    {
      title: "Aukro Search Autocomplete, User Lookup & Popular Searches",
      description:
        "Get instant search suggestions on Aukro.cz for items, categories, and landing pages (`mode: 'ALL'`), autocomplete seller usernames (`mode: 'USERS'`), or list trending popular searches (`mode: 'POPULAR'`). Works anonymously.",
      inputSchema: {
        mode: z
          .enum(["ALL", "USERS", "POPULAR"])
          .optional()
          .default("ALL")
          .describe("Suggestion mode: ALL (items/categories/landing pages), USERS (seller username prefix), or POPULAR (trending searches)"),
        text: z
          .string()
          .optional()
          .describe("Query text prefix (required for ALL and USERS modes)"),
        categoryId: z
          .number()
          .int()
          .optional()
          .describe("Optional category ID scope for ALL mode"),
        subbrand: z
          .enum(["BAZAAR", "ANTIQUE"])
          .optional()
          .default("BAZAAR")
          .describe("Marketplace subbrand scope"),
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
        if (args.mode === "POPULAR") {
          const popular = await client.request("/suggest/popular-searches", {
            method: "GET",
            cacheTtlMs: 10 * 60 * 1000,
          });
          return mcpJsonResult(popular);
        }

        if (!args.text || !args.text.trim()) {
          return mcpErrorResult(new Error("Parameter `text` is required for ALL and USERS autocomplete modes."));
        }

        if (args.mode === "USERS") {
          const users = await client.request("/users/suggest/showName", {
            method: "GET",
            query: { text: args.text.trim() },
          });
          return mcpJsonResult({ users });
        }

        const suggest = await client.request("/suggest/all", {
          method: "POST",
          query: { subbrand: args.subbrand },
          body: {
            text: args.text.trim(),
            categoryId: args.categoryId ?? null,
            itemState: "ACTIVE",
            searchAll: false,
          },
        });
        return mcpJsonResult(suggest);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
