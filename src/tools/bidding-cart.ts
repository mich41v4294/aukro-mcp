import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { mcpErrorResult, mcpJsonResult, type MoneyDto } from "../utils/formatters.js";

export function registerBiddingAndCartTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_place_bid",
    {
      title: "Place Bid or Pre-Check Bidding on an Auction",
      description:
        "Place a maximum proxy bid (příhoz) on an Aukro.cz auction (`POST /offers/{offerId}/bid?fastBid=false`), or run a safe pre-check (`dryRun: true`) to verify current price, minimum next bid, and whether your account has any bidder restrictions on the item. Requires authentication.",
      inputSchema: {
        offerId: z.number().int().describe("Numeric auction offer ID"),
        amount: z
          .number()
          .positive()
          .describe("Maximum bid amount in the specified currency (e.g. 250)"),
        currency: z
          .enum(["CZK", "EUR"])
          .optional()
          .default("CZK")
          .describe("Bid currency (defaults to CZK)"),
        dryRun: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, checks live offer status, minimum required bid, and bidder restrictions WITHOUT placing an actual bid"
          ),
        tfvCode: z
          .string()
          .optional()
          .describe("Optional 4-digit SMS verification code (`X-Aukro-TFV-Code`) if requested by Aukro"),
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
        const [shortStatus, restrictions] = await Promise.all([
          client.request<Record<string, unknown>>(`/offers/${args.offerId}/offerDetail/short`, {
            method: "GET",
            currency: args.currency,
            requireAuth: true,
          }),
          client
            .request<Record<string, unknown>>(`/bids/${args.offerId}/checkBidderRestrictions`, {
              method: "GET",
              requireAuth: true,
            })
            .catch(() => null),
        ]);

        const currentPrice = (shortStatus.price as MoneyDto | undefined)?.amount ?? null;
        const minBid = (shortStatus.nextBidMinAmount as MoneyDto | undefined)?.amount ?? null;
        const state = shortStatus.state;

        if (state && state !== "ACTIVE") {
          return mcpErrorResult(
            new Error(`Offer ${args.offerId} is not active (current state: ${String(state)}).`)
          );
        }

        if (typeof minBid === "number" && args.amount < minBid) {
          return mcpErrorResult(
            new Error(
              `Bid amount ${args.amount} ${args.currency} is below the minimum required next bid of ${minBid} ${args.currency} (current price: ${currentPrice} ${args.currency}).`
            )
          );
        }

        if (args.dryRun) {
          return mcpJsonResult({
            dryRun: true,
            offerId: args.offerId,
            proposedBid: { amount: args.amount, currency: args.currency },
            currentPrice,
            nextBidMinAmount: minBid,
            biddersCount: shortStatus.biddersCount,
            endingTime: shortStatus.endingTime,
            restrictions,
            eligibleToBid: typeof minBid === "number" ? args.amount >= minBid : true,
          });
        }

        const extraHeaders: Record<string, string> = {};
        if (args.tfvCode) {
          extraHeaders["X-Aukro-TFV-Code"] = args.tfvCode;
        }

        const bidResponse = await client.request<Record<string, unknown>>(
          `/offers/${args.offerId}/bid`,
          {
            method: "POST",
            query: { fastBid: false },
            headers: extraHeaders,
            body: {
              amount: {
                amount: args.amount,
                currency: args.currency,
              },
              enableFastBidding: false,
              gaClientInformationDto: null,
            },
            requireAuth: true,
          }
        );

        return mcpJsonResult({
          offerId: args.offerId,
          submittedBid: { amount: args.amount, currency: args.currency },
          bidResponse,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_bargain_offer",
    {
      title: "Check or Submit a Best Price Offer (Nabídnout cenu)",
      description:
        "Check constraints for making a price offer on a listing with 'Nabídnout cenu' enabled (`action: 'CHECK'`), or submit a price proposal to the seller (`action: 'PROPOSE'`). Requires authentication.",
      inputSchema: {
        action: z
          .enum(["CHECK", "PROPOSE"])
          .optional()
          .default("CHECK")
          .describe("CHECK bargaining eligibility/constraints or PROPOSE a price offer"),
        offerId: z.number().int().describe("Numeric offer ID"),
        proposedPrice: z
          .number()
          .positive()
          .optional()
          .describe("Proposed price per item (required when `action: 'PROPOSE'`)"),
        quantity: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe("Quantity of items to buy"),
        currency: z
          .enum(["CZK", "EUR"])
          .optional()
          .default("CZK")
          .describe("Currency of proposed price"),
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
        if (args.action === "CHECK") {
          const info = await client.request<Record<string, unknown>>(
            `/bargaining/bargainingStartPageData/${args.offerId}`,
            {
              method: "GET",
              requireAuth: true,
            }
          );
          return mcpJsonResult(info);
        }

        if (args.proposedPrice === undefined) {
          return mcpErrorResult(
            new Error("`proposedPrice` is required when `action` is 'PROPOSE'.")
          );
        }

        const res = await client.request<Record<string, unknown>>("/bargaining", {
          method: "POST",
          body: {
            itemId: args.offerId,
            quantity: args.quantity,
            priceProposal: {
              amount: args.proposedPrice,
              currency: args.currency,
            },
          },
          requireAuth: true,
        });

        return mcpJsonResult(res);
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_cart",
    {
      title: "Inspect & Manage Buy Now Shopping Cart (Košík)",
      description:
        "View your Aukro Buy Now shopping cart (`action: 'VIEW'`), add an item to the cart (`action: 'ADD'`), update item quantity (`action: 'UPDATE_QUANTITY'`), remove a cart item (`action: 'REMOVE'`), or preview available checkout shipping and payment options (`action: 'CHECKOUT_OPTIONS'`). Requires authentication.",
      inputSchema: {
        action: z
          .enum(["VIEW", "ADD", "UPDATE_QUANTITY", "REMOVE", "CHECKOUT_OPTIONS"])
          .optional()
          .default("VIEW")
          .describe("Cart operation to execute"),
        offerId: z
          .number()
          .int()
          .optional()
          .describe("Numeric offer ID (`itemId`) for `ADD` or `UPDATE_QUANTITY`"),
        quantity: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe("Item quantity for `ADD` or `UPDATE_QUANTITY`"),
        cartItemId: z
          .number()
          .int()
          .optional()
          .describe("Cart entry ID (`cartItemId`, from `VIEW`) to remove for `REMOVE`"),
        cartItemIds: z
          .array(z.number().int())
          .optional()
          .describe("Array of `cartItemId`s to inspect shipping/payment options for `CHECKOUT_OPTIONS`"),
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
          case "VIEW": {
            const detail = await client.request<Record<string, unknown>>("/cart/detail", {
              method: "GET",
              requireAuth: true,
            });
            return mcpJsonResult(detail);
          }
          case "ADD":
          case "UPDATE_QUANTITY": {
            if (args.offerId === undefined) {
              return mcpErrorResult(
                new Error(`\`offerId\` is required for cart action '${args.action}'.`)
              );
            }
            const res = await client.request<Record<string, unknown>>("/cart/item", {
              method: "POST",
              body: {
                item: {
                  itemId: args.offerId,
                  itemQuantity: args.quantity,
                },
                update: args.action === "UPDATE_QUANTITY",
              },
              requireAuth: true,
            });
            return mcpJsonResult(res);
          }
          case "REMOVE": {
            if (args.cartItemId === undefined) {
              return mcpErrorResult(
                new Error(
                  "`cartItemId` (obtained from `aukro_cart` with `action: 'VIEW'`) is required for `REMOVE`."
                )
              );
            }
            const res = await client.request(`/cart/item/${args.cartItemId}`, {
              method: "DELETE",
              requireAuth: true,
            });
            return mcpJsonResult({ removed: true, cartItemId: args.cartItemId, response: res });
          }
          case "CHECKOUT_OPTIONS": {
            if (!args.cartItemIds || args.cartItemIds.length === 0) {
              return mcpErrorResult(
                new Error("`cartItemIds` is required for `CHECKOUT_OPTIONS`.")
              );
            }
            const res = await client.request<Record<string, unknown>>(
              "/cart/cartOptionsChoice",
              {
                method: "POST",
                query: { cartItemIds: args.cartItemIds },
                requireAuth: true,
              }
            );
            return mcpJsonResult(res);
          }
        }
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
