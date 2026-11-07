import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { CONDITION_TO_ATTRIBUTE_VALUE } from "../tools/search.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerResourcesAndPrompts(
  server: McpServer,
  client: AukroHttpClient
): void {
  server.registerResource(
    "aukro-root-categories",
    "aukro://categories/root",
    {
      title: "Aukro.cz Root Categories",
      description: "Top-level Aukro.cz marketplace categories with IDs, SEO slugs, and item counts",
      mimeType: "application/json",
    },
    async (uri) => {
      const rootCategories = await client.request("/categories/aggregations/root", {
        method: "GET",
        cacheTtlMs: 30 * 60 * 1000,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rootCategories, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "aukro-shipping-registry",
    "aukro://registry/shipping",
    {
      title: "Aukro.cz Shipping & Payment Registry",
      description:
        "Complete dictionary of Aukro.cz prepaid and cash-on-delivery shipping methods, carrier services, and quantity units",
      mimeType: "application/json",
    },
    async (uri) => {
      const registry = await client.request<Record<string, unknown>>("/registry/detail", {
        method: "GET",
        cacheTtlMs: DAY_MS,
      });
      const compactMethod = (m: Record<string, unknown>) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        aukroShipping: m.aukroShipping,
        countryFrom: m.countryFrom,
        countryTo: m.countryTo,
        presetPrice: (m.firstItemPricePreset as { amount?: number } | undefined)?.amount ?? 0,
      });
      const compacted = {
        paymentBefore: Array.isArray(registry.paymentBefore)
          ? (registry.paymentBefore as Array<Record<string, unknown>>).map(compactMethod)
          : [],
        paymentOnDelivery: Array.isArray(registry.paymentOnDelivery)
          ? (registry.paymentOnDelivery as Array<Record<string, unknown>>).map(compactMethod)
          : [],
        itemQuantity: registry.itemQuantity ?? [],
        shippingServices: Array.isArray(registry.shippingServices)
          ? (registry.shippingServices as Array<Record<string, unknown>>).map((s) => ({
              id: s.id,
              code: s.code,
              name: s.name,
            }))
          : [],
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(compacted, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "aukro-item-conditions",
    "aukro://registry/conditions",
    {
      title: "Aukro.cz Item Condition Attribute Codes",
      description:
        "Mapping of Aukro item condition enum names to Attribute ID 48 ('Stav zboží') values",
      mimeType: "application/json",
    },
    async (uri) => {
      const payload = {
        attributeId: 48,
        attributeName: "Stav zboží",
        conditions: [
          { code: "NEW", attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.NEW, label: "Nové" },
          {
            code: "UNPACKED",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.UNPACKED,
            label: "Rozbaleno",
          },
          {
            code: "LIKE_NEW",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.LIKE_NEW,
            label: "Zánovní",
          },
          { code: "USED", attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.USED, label: "Použité" },
          {
            code: "REPAIRED",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.REPAIRED,
            label: "Opravené",
          },
          {
            code: "REFURBISHED",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.REFURBISHED,
            label: "Repasované",
          },
          {
            code: "DAMAGED",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.DAMAGED,
            label: "Poškozeno",
          },
          {
            code: "FOR_PARTS",
            attributeValue: CONDITION_TO_ATTRIBUTE_VALUE.FOR_PARTS,
            label: "Nefunkční / na díly",
          },
        ],
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "aukro_estimate_market_price",
    {
      title: "Estimate Fair Market Value on Aukro.cz",
      description:
        "Compare active offers and completed/archived listings on Aukro.cz to estimate the fair market price of an item",
      argsSchema: {
        itemQuery: z.string().describe("Item name or model (e.g. 'iPhone 13 128GB')"),
        condition: z
          .string()
          .optional()
          .describe("Optional condition filter (e.g. 'USED', 'NEW')"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Estimate the fair market price for "${args.itemQuery}"${
              args.condition ? ` (condition: ${args.condition})` : ""
            } on Aukro.cz by performing these steps:
1. Call \`aukro_search_offers\` with \`query: "${args.itemQuery}"\`, \`finished: true\`, and \`sort: "endingTime:ASC"\` (or \`bidderCount:DESC\`) to inspect recently ended/archived listings and see what prices items actually finished at (especially auctions with \`biddersCount > 0\`).
2. Call \`aukro_search_offers\` with \`query: "${args.itemQuery}"\`, \`finished: false\`, and \`sort: "price:ASC"\` to check current active Buy Now and auction prices.
3. Summarize the typical sold price range, lowest currently available Buy Now offer, and most promising active auctions.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "aukro_seller_due_diligence",
    {
      title: "Seller Trust & Due Diligence Report",
      description:
        "Evaluate an Aukro.cz seller's reliability, ratings, negative reviews, company registration (IČO/DIČ), and return policy",
      argsSchema: {
        username: z.string().describe("Aukro seller username"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Perform a thorough due diligence check on Aukro.cz seller "${args.username}":
1. Call \`aukro_get_user_profile\` with \`username: "${args.username}"\` and \`includeSellerTerms: true\` to inspect their registration age, positive feedback percentage, 4-criteria star ratings, negative feedback reason counts, IČO/DIČ company identifiers, and return/warranty policies.
2. Call \`aukro_get_user_feedback\` with \`username: "${args.username}"\`, \`sentiment: "NEG"\`, and \`pageSize: 10\` to inspect recent negative feedback comments and how the seller responded (\`sellerReply\`).
3. Call \`aukro_search_offers\` with \`sellerNames: ["${args.username}"]\` and \`pageSize: 10\` to review their current inventory.
4. Provide a structured trust assessment and any red flags to watch out for.`,
          },
        },
      ],
    })
  );
}
