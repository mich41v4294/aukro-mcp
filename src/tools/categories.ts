import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AukroHttpClient } from "../client/http.js";
import { mcpErrorResult, mcpJsonResult } from "../utils/formatters.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function registerCategoryTools(server: McpServer, client: AukroHttpClient): void {
  server.registerTool(
    "aukro_get_categories",
    {
      title: "Browse Aukro Categories & Hierarchy",
      description:
        "Browse Aukro.cz marketplace categories. If `categoryId` is omitted, returns all 22 root categories with live active item counts. If `categoryId` is provided, returns category details, ancestor breadcrumbs, and direct subcategories with live item counts. Can also search category names across the entire recursive category tree using `searchQuery`.",
      inputSchema: {
        categoryId: z
          .number()
          .int()
          .optional()
          .describe("Numeric category ID to inspect (omit to list root categories)"),
        searchQuery: z
          .string()
          .optional()
          .describe(
            "Case-insensitive keyword to search categories (e.g. 'iphone', 'lego', 'mince'). Uses fast suggest + facet lookup (~120ms) by default."
          ),
        fullTreeScan: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true with `searchQuery`, downloads and scans the entire 4,000+ node category tree (`/categories/aggregations/all`, ~8s cold / <3ms cached) instead of fast suggest+facet lookup"
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(30)
          .describe("Max matching categories to return when `searchQuery` is provided"),
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
        if (args.searchQuery && args.searchQuery.trim()) {
          const queryText = args.searchQuery.trim();
          const needle = queryText.toLowerCase();

          // If the full tree is already warm in cache or explicitly requested via fullTreeScan, use it
          const cachedFullTree = client.cache.get<Array<Record<string, unknown>>>(
            client.buildUrl("/categories/aggregations/all")
          );

          if (!args.fullTreeScan && !cachedFullTree) {
            const [suggestRaw, facetRaw] = await Promise.all([
              client
                .request<Record<string, unknown>>("/suggest/all", {
                  method: "POST",
                  body: { text: queryText, itemState: "ACTIVE", searchAll: false },
                })
                .catch(() => null),
              client
                .request<Record<string, unknown>>("/offers/searchItemsCommon", {
                  method: "POST",
                  query: { page: 0, size: 1 },
                  body: { text: queryText, noContent: true, searchRedirectDisabled: true },
                })
                .catch(() => null),
            ]);

            const seen = new Map<
              number,
              { id: number; name: string; seoUrl?: string; count?: number; source: string }
            >();

            const suggestContent = Array.isArray(suggestRaw?.content)
              ? (suggestRaw.content as Array<Record<string, unknown>>)
              : [];
            const catGroup = suggestContent.find((g) => g.type === "CATEGORY");
            if (catGroup && Array.isArray(catGroup.elements)) {
              for (const el of catGroup.elements as Array<Record<string, unknown>>) {
                const id = Number(el.id);
                if (!Number.isNaN(id)) {
                  seen.set(id, {
                    id,
                    name: String(el.name ?? ""),
                    seoUrl: typeof el.seoUrl === "string" ? el.seoUrl : undefined,
                    count: typeof el.count === "number" ? el.count : undefined,
                    source: "suggest",
                  });
                }
              }
            }

            const facetAggs = Array.isArray(facetRaw?.aggregations)
              ? (facetRaw.aggregations as Array<Record<string, unknown>>)
              : [];
            const catAgg = facetAggs.find((a) => a.type === "category");
            if (catAgg && Array.isArray(catAgg.buckets)) {
              for (const b of catAgg.buckets as Array<Record<string, unknown>>) {
                const id = Number(b.value);
                const count = typeof b.count === "number" ? b.count : 0;
                const msg = String(b.message ?? "");
                const seo = typeof b.seoUrl === "string" ? b.seoUrl : undefined;
                if (
                  !Number.isNaN(id) &&
                  count > 0 &&
                  !seen.has(id) &&
                  (seen.size === 0 ||
                    msg.toLowerCase().includes(needle) ||
                    (seo && seo.toLowerCase().includes(needle)))
                ) {
                  seen.set(id, {
                    id,
                    name: msg,
                    seoUrl: seo,
                    count,
                    source: "search_facet",
                  });
                }
              }
            }

            const fastResults = Array.from(seen.values()).slice(0, args.maxResults);
            return mcpJsonResult({
              query: args.searchQuery,
              mode: "fast_suggest_and_facets",
              totalMatches: fastResults.length,
              categories: fastResults,
            });
          }

          const fullTree =
            cachedFullTree ??
            (await client.request<Array<Record<string, unknown>>>(
              "/categories/aggregations/all",
              {
                method: "GET",
                cacheTtlMs: ONE_HOUR_MS,
              }
            ));

          const matches: Array<{
            id: unknown;
            name: unknown;
            seoUrl: unknown;
            count: unknown;
            path: string;
            hasSubcategories: boolean;
          }> = [];

          const walk = (nodes: Array<Record<string, unknown>>, trail: string[]) => {
            for (const node of nodes) {
              const name = String(node.name ?? "");
              const seoUrl = String(node.seoUrl ?? "");
              const currentTrail = [...trail, name];
              const subcats = Array.isArray(node.subcategories)
                ? (node.subcategories as Array<Record<string, unknown>>)
                : [];

              if (
                name.toLowerCase().includes(needle) ||
                seoUrl.toLowerCase().includes(needle)
              ) {
                matches.push({
                  id: node.id,
                  name: node.name,
                  seoUrl: node.seoUrl,
                  count: node.count,
                  path: currentTrail.join(" > "),
                  hasSubcategories: subcats.length > 0,
                });
              }

              if (subcats.length > 0) {
                walk(subcats, currentTrail);
              }
            }
          };

          if (Array.isArray(fullTree)) {
            walk(fullTree, []);
          }

          matches.sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
          return mcpJsonResult({
            query: args.searchQuery,
            totalMatches: matches.length,
            categories: matches.slice(0, args.maxResults),
          });
        }

        if (args.categoryId !== undefined) {
          // Important quirk: /categories/categories/{id} requires ?onlyExposable=true (otherwise HTTP 500 NPE)
          const [detail, subcategories, breadcrumbs] = await Promise.all([
            client
              .request<Record<string, unknown>>(
                `/categories/categories/${args.categoryId}`,
                {
                  method: "GET",
                  query: { onlyExposable: true },
                  cacheTtlMs: ONE_HOUR_MS,
                }
              )
              .catch(() => null),
            client.request<Array<Record<string, unknown>>>(
              `/categories/categories/${args.categoryId}/subcategoriesWithItemsCount`,
              {
                method: "GET",
                cacheTtlMs: 10 * 60 * 1000,
              }
            ),
            client
              .request<Record<string, unknown>>(
                `/categories/breadcrumbs/${args.categoryId}`,
                {
                  method: "GET",
                  cacheTtlMs: ONE_HOUR_MS,
                }
              )
              .catch(() => null),
          ]);

          return mcpJsonResult({
            categoryId: args.categoryId,
            category: detail
              ? {
                  id: detail.id,
                  name: detail.name,
                  shortName: detail.shortName,
                  seoUrl: detail.seoUrl,
                  parentId: detail.parentId,
                  leaf: detail.leaf,
                  active: detail.active,
                  buyersProtectionAvailable: detail.buyersProtectionAvailable,
                  statusAdultContent: detail.statusAdultContent,
                  subbrands: detail.subbrands,
                }
              : null,
            breadcrumbs: Array.isArray(breadcrumbs?.treePath)
              ? (breadcrumbs.treePath as Array<Record<string, unknown>>).map((b) => ({
                  id: b.id ?? b.categoryId,
                  name: b.name ?? b.shortName,
                  seoUrl: b.seoUrl,
                  parentId: b.parentId,
                  leaf: b.leaf,
                }))
              : [],
            subcategories: Array.isArray(subcategories)
              ? subcategories.map((sc) => ({
                  id: sc.id,
                  name: sc.name ?? sc.shortName,
                  seoUrl: sc.seoUrl,
                  itemsCount: sc.itemsCount,
                  leaf: sc.leaf,
                }))
              : [],
          });
        }

        const rootCategories = await client.request<Array<Record<string, unknown>>>(
          "/categories/aggregations/root",
          {
            method: "GET",
            cacheTtlMs: 15 * 60 * 1000,
          }
        );

        return mcpJsonResult({
          rootCategoriesCount: Array.isArray(rootCategories) ? rootCategories.length : 0,
          rootCategories,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );

  server.registerTool(
    "aukro_get_category_attributes",
    {
      title: "Get Category Filter Attributes & Parameters",
      description:
        "Retrieve all filterable/exposable attributes (e.g. Condition / Stav zboží, Brand, Storage, Material) and their allowed option keys for a given `categoryId`. Use the returned `attributeId` and `allowedValues[].key` values in `aukro_search_offers`'s `attributeFilters` parameter.",
      inputSchema: {
        categoryId: z
          .number()
          .int()
          .describe("Numeric category ID (e.g. 107152 for iPhone)"),
        onlyImportant: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, returns only mandatory or important attributes"),
        searchQuery: z
          .string()
          .optional()
          .describe("Optional case-insensitive filter on attribute name (e.g. 'model', 'stav', 'kapacita')"),
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
          `/categories/categories/${args.categoryId}/attributes`,
          {
            method: "GET",
            cacheTtlMs: ONE_HOUR_MS,
          }
        );

        const needle = args.searchQuery?.trim().toLowerCase();
        const attributes = Array.isArray(raw)
          ? raw
              .filter((attr) => {
                if (args.onlyImportant && !attr.mandatory && !attr.important) {
                  return false;
                }
                if (needle && !String(attr.name ?? "").toLowerCase().includes(needle)) {
                  return false;
                }
                return true;
              })
              .map((attr) => {
                const allowed = Array.isArray(attr.listAllowedValues)
                  ? (attr.listAllowedValues as Array<Record<string, unknown>>).map((v) => {
                      const entry: Record<string, unknown> = {
                        key: v.name, // Note: `name` in listAllowedValues is the key used in searchItemsCommon filter!
                        label: v.description,
                      };
                      if (v.additionalDescription) {
                        entry.detail = v.additionalDescription;
                      }
                      return entry;
                    })
                  : undefined;

                const mapped: Record<string, unknown> = {
                  attributeId: attr.id,
                  name: attr.name,
                  type: attr.type ?? attr.itemAttributeTypeEnum,
                };
                if (attr.unit) mapped.unit = attr.unit;
                if (attr.mandatory) mapped.mandatory = true;
                if (attr.important) mapped.important = true;
                if (allowed && allowed.length > 0) mapped.allowedValues = allowed;
                return mapped;
              })
          : [];

        return mcpJsonResult({
          categoryId: args.categoryId,
          attributesCount: attributes.length,
          attributes,
        });
      } catch (err) {
        return mcpErrorResult(err);
      }
    }
  );
}
