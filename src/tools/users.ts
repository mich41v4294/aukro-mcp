import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { mcpErrorResult, mcpJsonResult } from "../utils/formatters.js";

export function registerUserTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_get_user_profile",
    {
      title: "Get Seller / User Profile, Ratings Breakdown & Business Info",
      description:
        "Inspect an Aukro.cz seller or user by `username` or numeric `userId`. Returns registration date, last login, rating score, positive feedback percentage, 4-criteria star averages, detailed negative feedback reason counts, vacation/absence status, free shipping threshold, and (for sellers) company registration details (IČO, DIČ, contact info, warranty/complaint rules, and return policy).",
      inputSchema: {
        username: z
          .string()
          .optional()
          .describe("Aukro username (e.g. 'Alza_prodej' or 'Mobilovka')"),
        userId: z
          .number()
          .int()
          .optional()
          .describe("Numeric user ID (provide either `username` or `userId`)"),
        includeSellerTerms: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true, fetches company identifiers (IČO/DIČ) and return/complaint policies"),
        includeFullLegalText: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, returns full untruncated legal/complaint/return texts (by default truncated to 500 chars for token efficiency)"),
        includeNegativeReasonBreakdown: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, fetches detailed negative rating sub-reason breakdown"),
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
        if (!args.username && args.userId === undefined) {
          return mcpErrorResult(
            new Error("Provide either `username` or `userId` to look up a user profile.")
          );
        }

        let resolvedUserId = args.userId;
        let byUsernameProfile: Record<string, unknown> | null = null;

        if (args.username) {
          byUsernameProfile = await client.request<Record<string, unknown>>(
            "/users/profile/all",
            {
              method: "GET",
              query: { username: args.username },
              cacheTtlMs: 5 * 60 * 1000,
            }
          );
          if (typeof byUsernameProfile.userId === "number") {
            resolvedUserId = byUsernameProfile.userId;
            client.cache.set(`username_id:${args.username.toLowerCase()}`, resolvedUserId, 15 * 60 * 1000);
          }
        }

        if (resolvedUserId === undefined) {
          return mcpErrorResult(new Error(`Could not resolve user ID for ${args.username}`));
        }

        const needDetailedById = !byUsernameProfile || args.includeNegativeReasonBreakdown;

        const FIVE_MIN_MS = 5 * 60 * 1000;
        const [detailedProfile, sellerInfo, absenceInfo, freeDeliveryLimit] =
          await Promise.all([
            needDetailedById
              ? client
                  .request<Record<string, unknown>>(`/users/${resolvedUserId}/profile`, {
                    method: "GET",
                    cacheTtlMs: FIVE_MIN_MS,
                  })
                  .catch(() => null)
              : Promise.resolve(null),
            args.includeSellerTerms
              ? client
                  .request<Record<string, unknown>>(`/users/${resolvedUserId}/sellerInfo`, {
                    method: "GET",
                    cacheTtlMs: FIVE_MIN_MS,
                  })
                  .catch(() => null)
              : Promise.resolve(null),
            client
              .request<Record<string, unknown>>(`/users/${resolvedUserId}/absence`, {
                method: "GET",
                cacheTtlMs: FIVE_MIN_MS,
              })
              .catch(() => null),
            client
              .request<Record<string, unknown>>(
                `/users/${resolvedUserId}/shippingPriceLists/freeLimit`,
                {
                  method: "GET",
                  cacheTtlMs: FIVE_MIN_MS,
                }
              )
              .catch(() => null),
          ]);

        const base = detailedProfile ?? byUsernameProfile ?? {};
        const clip = (val: unknown) => {
          if (typeof val !== "string") return val;
          if (args.includeFullLegalText || val.length <= 500) return val;
          return `${val.slice(0, 500)}… [truncated, pass includeFullLegalText: true for full text]`;
        };

        return mcpJsonResult({
          userId: resolvedUserId,
          userName: base.userName ?? byUsernameProfile?.userName,
          profileUrl:
            base.userName || byUsernameProfile?.userName
              ? `https://aukro.cz/uzivatel/${base.userName ?? byUsernameProfile?.userName}`
              : null,
          userDomain: base.userDomain ?? byUsernameProfile?.userDomain,
          accountActivated: base.accountActivated,
          companyAccount: base.companyAccount,
          aukroPlus: base.aukroPlus,
          favouritedByCount: base.favouritedByCount ?? byUsernameProfile?.favouritedByCount,
          registrationDate: base.registrationDate,
          lastLoginTime: base.lastLoginTime ?? byUsernameProfile?.lastLoginTime,
          positiveFeedbackPercentage: base.positiveFeedbackPercentage,
          userRating: base.userRatingDto ?? byUsernameProfile?.userRatingDto,
          feedbackOverviewStatistics:
            base.feedbackProfileOverviewStatistics ??
            byUsernameProfile?.feedbackProfileOverviewStatistics,
          feedbackRatingSummary: args.includeNegativeReasonBreakdown
            ? detailedProfile?.feedbackRatingSummaryDto ??
              byUsernameProfile?.feedbackRatingSummary
            : byUsernameProfile?.feedbackRatingSummary ??
              detailedProfile?.feedbackRatingSummaryDto,
          absence:
            absenceInfo && Object.keys(absenceInfo).length > 0 ? absenceInfo : null,
          freeDeliveryLimit,
          sellerInfo: sellerInfo
            ? {
                companyIdentifiers: sellerInfo.companyIdentifiers,
                contactInfo: clip(sellerInfo.contactInfo),
                details: clip(sellerInfo.details),
                complaintRules: clip(sellerInfo.complaintRules),
                rulesForTerminate: clip(sellerInfo.rulesForTerminate),
                otherInformation: clip(sellerInfo.otherInformation),
              }
            : null,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_get_user_feedback",
    {
      title: "Get User Ratings & Feedback Comments",
      description:
        "Retrieve paginated feedback comments and ratings for an Aukro user (by `userId` or `username`). Supports filtering by feedback direction (`ALL_RECEIVED`, `FROM_BUYERS`, `FROM_SELLERS`, `SENT`) and sentiment (`ALL`, `POS`, `NEU`, `NEG`).",
      inputSchema: {
        userId: z
          .number()
          .int()
          .optional()
          .describe("Numeric user ID (provide either `userId` or `username`)"),
        username: z
          .string()
          .optional()
          .describe("Username (automatically resolved to `userId` if `userId` is omitted)"),
        tab: z
          .enum(["ALL_RECEIVED", "FROM_BUYERS", "FROM_SELLERS", "SENT"])
          .optional()
          .default("ALL_RECEIVED")
          .describe("Feedback category tab"),
        sentiment: z
          .enum(["ALL", "POS", "NEU", "NEG"])
          .optional()
          .default("ALL")
          .describe("Filter by feedback sentiment: ALL, POS (positive), NEU (neutral), or NEG (negative)"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Number of feedback entries per page"),
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
        let userId = args.userId;
        if (userId === undefined) {
          if (!args.username) {
            return mcpErrorResult(new Error("Provide either `userId` or `username`."));
          }
          const cacheKey = `username_id:${args.username.toLowerCase()}`;
          const cachedId = client.cache.get<number>(cacheKey);
          if (cachedId !== undefined) {
            userId = cachedId;
          } else {
            const minimal = await client.request<{ userId?: number }>("/users/profile/minimal", {
              method: "GET",
              query: { username: args.username },
              cacheTtlMs: 15 * 60 * 1000,
            });
            userId = minimal.userId;
            if (typeof userId === "number") {
              client.cache.set(cacheKey, userId, 15 * 60 * 1000);
            }
          }
        }

        if (userId === undefined) {
          return mcpErrorResult(new Error("Could not resolve numeric userId."));
        }

        const endpointSuffixMap: Record<string, string> = {
          ALL_RECEIVED: "allReceived",
          FROM_BUYERS: "allReceivedFromBuyers",
          FROM_SELLERS: "allReceivedFromSellers",
          SENT: "allSend",
        };
        const suffix = endpointSuffixMap[args.tab] ?? "allReceived";

        const raw = await client.request<Record<string, unknown>>(
          `/users/${userId}/profile/feedback/${suffix}`,
          {
            method: "POST",
            query: {
              page: args.page,
              size: args.pageSize,
            },
            body: {
              feedbackTypeEnum: args.sentiment === "ALL" ? null : args.sentiment,
            },
          }
        );

        const content = Array.isArray(raw.content)
          ? (raw.content as Array<Record<string, unknown>>).map((f) => ({
              id: f.id,
              date: f.date,
              type: f.feedbackType,
              receiverRole: f.receiver,
              description: f.description,
              sellerReply: f.feedbacksCorrection,
              fromUser: f.fromUser,
              toUser: f.toUser,
              oppositeFeedback: f.oppositeFeedback,
            }))
          : [];

        return mcpJsonResult({
          userId,
          tab: args.tab,
          sentiment: args.sentiment,
          page: raw.page,
          feedbacksCount: content.length,
          feedbacks: content,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_get_seller_leaderboard",
    {
      title: "Get Aukro Top Sellers Leaderboard",
      description:
        "Fetch Aukro.cz seller rankings (`https://aukro.cz/zebricky`), sorted either by all-time favorite count (`favourite_count:DESC`) or monthly popularity growth (`popularity_growth:DESC`), optionally scoped to a root `categoryId` or `subbrand`.",
      inputSchema: {
        sortBy: z
          .enum(["favourite_count:DESC", "popularity_growth:DESC"])
          .optional()
          .default("favourite_count:DESC")
          .describe("Leaderboard ranking metric"),
        subbrand: z
          .enum(["BAZAAR", "ANTIQUE"])
          .optional()
          .describe("Optional subbrand filter"),
        categoryId: z
          .number()
          .int()
          .optional()
          .describe("Optional root category ID filter"),
        page: z.number().int().min(0).optional().default(0).describe("0-indexed page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("Number of sellers per page"),
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
        const body: Record<string, unknown> = {};
        if (args.subbrand) body.subbrand = args.subbrand;
        if (args.categoryId !== undefined) body.categoryId = args.categoryId;

        const raw = await client.request<Record<string, unknown>>("/favourites/leaderboard", {
          method: "POST",
          query: {
            page: args.page,
            size: args.pageSize,
            // Required by Aukro backend (omitting sort causes HTTP 500)
            sort: args.sortBy,
          },
          body,
        });

        const sellers = Array.isArray(raw.content)
          ? (raw.content as Array<Record<string, unknown>>).map((s) => {
              const cat = s.categoryPrimary as Record<string, unknown> | undefined;
              return {
                rank: s.rank,
                userId: s.userId,
                username: s.showName,
                profileUrl: s.showName ? `https://aukro.cz/uzivatel/${s.showName}` : null,
                favouriteCount: s.favouriteCount,
                feedbackPositivePercent: s.feedbackPositive,
                uniqueFeedbackCount: s.uniqueFeedback,
                activeItemCount: s.itemCount,
                primaryCategory: cat
                  ? {
                      id: cat.id,
                      name: cat.name ?? cat.shortName,
                      seoUrl: cat.seoUrl,
                    }
                  : null,
              };
            })
          : [];

        return mcpJsonResult({
          page: raw.page,
          sellers,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
