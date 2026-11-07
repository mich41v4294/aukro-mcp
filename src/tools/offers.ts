import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import {
  buildOfferUrl,
  compactOfferDetail,
  formatMoney,
  mcpErrorResult,
  mcpJsonResult,
  type MoneyDto,
} from "../utils/formatters.js";

export function registerOfferTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_get_offer_detail",
    {
      title: "Get Full Aukro Offer Detail (Single or Batch)",
      description:
        "Fetch complete details for one (`offerId`) or multiple (`offerIds`, up to 20 fetched concurrently) Aukro.cz offers (works for both active and ended/archived offers). Returns unified price, next minimum bid, Buy Now price, `shippingSummary` (`canShipToCz`, `cheapestShipping`, `totalPriceWithCheapestShipping`, `personalPickupAvailable`), plain-text description, attributes, image URLs, shipping options, payment methods, buyer protection fees, and seller profile summary.",
      inputSchema: {
        offerId: z
          .number()
          .int()
          .optional()
          .describe("Numeric offer / item ID (e.g. 7140475083)"),
        offerIds: z
          .array(z.number().int())
          .max(20)
          .optional()
          .describe("Batch of up to 20 numeric offer IDs to fetch in parallel"),
        includeHtmlDescription: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, also includes the raw `descriptionInHtml` field"),
        includeInternationalShipping: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, includes shipping options for all foreign destination countries (by default only domestic CZ options are listed in `shippingOptions`, while foreign country codes are listed in `shippingSummary.internationalCountriesAvailable`)"
          ),
        maxDescriptionLength: z
          .number()
          .int()
          .min(100)
          .max(20000)
          .optional()
          .describe("Maximum character length of plain-text description (defaults to 2500 for single offer, 1200 for batch)"),
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
        if (args.offerIds && args.offerIds.length > 0) {
          const maxLen = args.maxDescriptionLength ?? 1200;
          const results = await Promise.all(
            args.offerIds.map(async (id) => {
              try {
                const raw = await client.request<Record<string, unknown>>(
                  `/offers/${id}/offerDetail`,
                  {
                    method: "GET",
                    currency: args.currency,
                  }
                );
                return compactOfferDetail(raw, {
                  includeHtmlDescription: args.includeHtmlDescription,
                  includeInternationalShipping: args.includeInternationalShipping,
                  maxDescriptionLength: maxLen,
                });
              } catch (err) {
                return {
                  itemId: id,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            })
          );
          return mcpJsonResult({
            count: results.length,
            offers: results,
          });
        }

        if (args.offerId === undefined) {
          return mcpErrorResult(
            new Error("Provide either `offerId` or `offerIds` to fetch offer details.")
          );
        }

        const raw = await client.request<Record<string, unknown>>(
          `/offers/${args.offerId}/offerDetail`,
          {
            method: "GET",
            currency: args.currency,
          }
        );

        const compacted = compactOfferDetail(raw, {
          includeHtmlDescription: args.includeHtmlDescription,
          includeInternationalShipping: args.includeInternationalShipping,
          maxDescriptionLength: args.maxDescriptionLength ?? 2500,
        });
        return mcpJsonResult(compacted);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_get_offers_status_batch",
    {
      title: "Batch Poll Live Status of Multiple Offers",
      description:
        "Quickly poll live status (`state`, `price`, `nextBidMinAmount`, `biddersCount`, `highestBidderAnonymizedLogin`, `endingTime`) for up to 50 offer IDs in a single lightweight request.",
      inputSchema: {
        offerIds: z
          .array(z.number().int())
          .min(1)
          .max(50)
          .describe("List of numeric offer IDs to check"),
        currency: z
          .enum(["CZK", "EUR", "PLN", "HUF", "RON"])
          .optional()
          .describe("Override response currency"),
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
        const raw = await client.request<Array<Record<string, unknown>>>(
          "/offers/bulk/offerDetail/short",
          {
            method: "GET",
            query: {
              itemIds: args.offerIds.join(","),
            },
            currency: args.currency,
          }
        );

        const statuses = Array.isArray(raw)
          ? raw.map((item) => ({
              itemId: item.itemId,
              state: item.state,
              price: (item.price as MoneyDto | undefined)?.amount ?? null,
              currency: (item.price as MoneyDto | undefined)?.currency ?? "CZK",
              priceFormatted: formatMoney(item.price as MoneyDto | undefined),
              nextBidMinAmount:
                (item.nextBidMinAmount as MoneyDto | undefined)?.amount ?? null,
              buyNowActive: item.buyNowActive,
              biddersCount: item.biddersCount,
              highestBidderId: item.highestBidderId,
              highestBidderAnonymizedLogin: item.highestBidderAnonymizedLogin,
              endingTime: item.endingTime,
            }))
          : [];

        return mcpJsonResult({
          count: statuses.length,
          offers: statuses,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_get_offer_bids_and_similar",
    {
      title: "Get Offer Bidding History & Similar Offers",
      description:
        "Fetch the complete public bidding history (both active and canceled bids, timestamps, amounts, and anonymized bidder ratings) for an auction offer, and optionally fetch similar active offers or other offers from the same seller.",
      inputSchema: {
        offerId: z.number().int().describe("Numeric offer / item ID"),
        includeSimilarOffers: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, also fetches similar active offers"),
        includeSellerCategoryOffers: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, also fetches other offers from the same seller in the same category"),
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
        const [bidHistory, similarRaw, sellerCarouselRaw] = await Promise.all([
          client.request<Record<string, unknown>>(`/bids/${args.offerId}/bidHistory`, {
            method: "GET",
          }),
          args.includeSimilarOffers
            ? client
                .request<Record<string, unknown>>(`/offers/${args.offerId}/similar`, {
                  method: "GET",
                  query: { page: 0, size: 10 },
                })
                .catch(() => null)
            : Promise.resolve(null),
          args.includeSellerCategoryOffers
            ? client
                .request<Array<Record<string, unknown>>>(
                  "/offers/carousel-offers-seller-category",
                  {
                    method: "GET",
                    query: { itemId: args.offerId, currency: client.config.currency },
                  }
                )
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        const activeBids = Array.isArray(bidHistory.bidsHistory)
          ? (bidHistory.bidsHistory as Array<Record<string, unknown>>).map((b) => {
              const userRating = b.userRatingDto as Record<string, unknown> | undefined;
              const amount = b.amount as MoneyDto | undefined;
              return {
                amount: amount?.amount ?? null,
                currency: amount?.currency ?? "CZK",
                time: b.time,
                proxyAmountDate: b.proxyAmountDate,
                bidder: userRating
                  ? {
                      username: userRating.userName,
                      rating: userRating.rating,
                      starType: userRating.starType,
                      companyAccount: userRating.companyAccount,
                      aukroPlus: userRating.aukroPlus,
                    }
                  : undefined,
              };
            })
          : [];

        const result: Record<string, unknown> = {
          offerId: args.offerId,
          activeBidsCount: activeBids.length,
          bidsHistory: activeBids,
          bidsHistoryCanceled: bidHistory.bidsHistoryCanceled ?? [],
        };

        if (args.includeSimilarOffers && similarRaw) {
          const simContent = Array.isArray(similarRaw.content)
            ? (similarRaw.content as Array<Record<string, unknown>>).map((s) => ({
                itemId: s.id ?? s.itemId,
                name: s.name ?? s.itemName,
                url: buildOfferUrl(
                  s.seoUrl as string | undefined,
                  (s.id ?? s.itemId) as number | undefined
                ),
                price: (s.price as MoneyDto | undefined)?.amount ?? null,
                buyNowPrice: (s.buyNowPrice as MoneyDto | undefined)?.amount ?? null,
                endingTime: s.endingTime,
              }))
            : [];
          result.similarOffers = simContent;
        }

        if (args.includeSellerCategoryOffers && Array.isArray(sellerCarouselRaw)) {
          result.sellerCategoryOffers = sellerCarouselRaw.map((s) => ({
            itemId: s.id ?? s.itemId,
            name: s.name ?? s.itemName,
            url: buildOfferUrl(
              s.seoUrl as string | undefined,
              (s.id ?? s.itemId) as number | undefined
            ),
            price: (s.price as MoneyDto | undefined)?.amount ?? null,
            endingTime: s.endingTime,
          }));
        }

        return mcpJsonResult(result);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
