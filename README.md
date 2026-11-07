# Aukro.cz MCP Server (`aukro-mcp`)

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6C5CE7)](https://modelcontextprotocol.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange.svg)](LICENSE)

An unofficial **Model Context Protocol (MCP)** server for **[Aukro.cz](https://aukro.cz)** — the largest Czech online auction and marketplace platform.

`aukro-mcp` works **out-of-the-box without credentials** for marketplace discovery, historical sold-price research, category exploration, offer inspection, bidding history analysis, and seller due diligence—while seamlessly upgrading to **full buyer & seller account automation** when authenticated via browser session cookies, OAuth2 Bearer/refresh tokens, or interactive browser login.

> [!NOTE]
> **Non-Commercial License & Disclaimer:** This project is released under the [CC BY-NC 4.0](LICENSE) license for personal, educational, and non-commercial research use only. It is an independent community project and is not affiliated with or endorsed by Aukro s.r.o.

---

## Highlights

- **Zero-Config Anonymous Mode** — Search active and completed/archived (`finished: true`) auctions, inspect category trees and filter attributes, batch-fetch up to 20 full offer details concurrently, poll up to 50 live auction prices in a single request, view complete bid histories, and audit seller profiles (including IČO/DIČ company registration and negative feedback breakdowns) without logging in.
- **Full Buyer & Seller Account Capabilities** — Manage watchlists (`Sledované nabídky`), favorite sellers, saved searches, Buy Now shopping carts (`Košík`), proxy auction bids (`příhoz` with `dryRun` pre-checks), price proposals (`Nabídnout cenu`), seller inventory (`offers-v2`), listing templates, and buyer/seller messaging (`Moje zprávy`).
- **Cloudflare Turnstile–Friendly Authentication** — Supports runtime credential switching (`aukro_set_credentials`), automatic OAuth2 token refresh, and a native interactive browser login (`aukro_login_interactive`) that launches your local Chrome/Brave/Edge/Chromium without DOM automation hooks so Cloudflare Turnstile passes cleanly.
- **Token-Efficient Responses** — Strips HATEOAS noise, normalizes HTML descriptions into clean text, computes domestic shipping summaries (`totalPriceWithCheapestShipping`), and supports multi-query parallel deduplication (`queries`) in a single tool call.
- **Dual Transport Support** — Runs over **stdio** (for Cursor, Claude Desktop, Windsurf, VS Code, etc.) or **Streamable HTTP** (`--http --port 3000`).

---

## Quick Start

### Prerequisites

- **Node.js 20+** (`node --version`)
- **npm** (included with Node.js)

### Installation & Build

```bash
git clone https://github.com/mich41v4294/aukro-mcp.git
cd aukro-mcp
npm install
npm run build
```

---

## Client Configuration

### Cursor (`~/.cursor/mcp.json`) / Claude Desktop (`claude_desktop_config.json`)

Add the following entry to your MCP client configuration file (replace `/absolute/path/to/aukro-mcp` with your local checkout path):

```json
{
  "mcpServers": {
    "aukro": {
      "command": "node",
      "args": ["/absolute/path/to/aukro-mcp/dist/index.js"],
      "env": {
        "AUKRO_CURRENCY": "CZK",
        "AUKRO_LANGUAGE": "cs-CZ"
      }
    }
  }
}
```

### Streamable HTTP Transport (Optional)

To run `aukro-mcp` as a standalone HTTP server instead of stdio:

```bash
node dist/index.js --http --port 3000
```

- **MCP Endpoint:** `http://127.0.0.1:3000/mcp`
- **Health Check:** `http://127.0.0.1:3000/health`

---

## Authentication (Optional)

All 10 public discovery, search, offer, category, and seller inspection tools work **anonymously with zero configuration**.

To unlock buyer and seller account tools (watchlist, bidding, cart, messages, selling), you can authenticate in any of three ways:

### Method 1: Interactive Browser Login (`aukro_login_interactive`)

Ask your AI assistant to run `aukro_login_interactive`. The server will:
1. Launch a local Chrome, Brave, Edge, or Chromium window at `https://aukro.cz/prihlaseni` using an isolated profile directory (`~/.config/aukro-mcp/chrome-login-profile`) without Playwright/webdriver instrumentation so Cloudflare Turnstile passes without error `600010`.
2. Poll browser cookies once you log in, verify the session against `/users/actualStatistics`, and automatically save your session to `~/.config/aukro-mcp/credentials.json` (permissions `0600`).

### Method 2: Set Session Cookies or OAuth2 Tokens at Runtime (`aukro_set_credentials`)

Copy your `SESSION` cookie (or full `Cookie` request header) from browser DevTools on `https://aukro.cz` and pass it to `aukro_set_credentials`:

```json
{
  "sessionCookie": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "persist": true
}
```

Or pass an OAuth2 `accessToken` and `refreshToken` (automatically refreshed before expiration).

### Method 3: Environment Variables

Pass credentials via the `env` block in your MCP config or a local environment setup (see [`.env.example`](.env.example)):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AUKRO_COOKIES` | — | Full `Cookie` header string from browser DevTools on `aukro.cz` |
| `AUKRO_SESSION` | — | Value of the `SESSION` cookie from `https://aukro.cz` |
| `AUKRO_XSRF_TOKEN` | — | Optional `XSRF-TOKEN` cookie value (sent as `X-XSRF-TOKEN` on mutating requests) |
| `AUKRO_TOKEN` | *(auto UUID)* | Optional `aukro-token` tracking UUID |
| `AUKRO_ACCESS_TOKEN` | — | OAuth2 Bearer JWT `access_token` |
| `AUKRO_REFRESH_TOKEN` | — | OAuth2 `refresh_token` (auto-refreshes via mobile OAuth2 client) |
| `AUKRO_CURRENCY` | `CZK` | Marketplace currency (`CZK`, `EUR`, `PLN`, `HUF`, `RON`) |
| `AUKRO_LANGUAGE` | `cs-CZ` | Marketplace locale header (`X-Accept-Language`) |
| `AUKRO_SUBBRAND` | `BAZAAR` | Subbrand scope (`BAZAAR`, `ANTIQUE`, `NOT_SPECIFIED`) |
| `AUKRO_CREDENTIALS_FILE` | `~/.config/aukro-mcp/credentials.json` | Path where runtime credentials are persisted (`0600`) |
| `CHROME_PATH` | *(auto-detected)* | Optional custom path to Chrome/Brave/Edge/Chromium binary for `aukro_login_interactive` |

---

## Available MCP Tools (25 Tools)

### 1. Public Marketplace Discovery & Research (Works Anonymously)

| Tool | Description |
| :--- | :--- |
| `aukro_search_offers` | Search active or completed/archived (`finished: true`) offers. Supports single `query` or parallel deduplicated `queries` (up to 10), `excludeWords`, `excludeCategoryIds`, `searchInDescription`, `categoryId` / `categorySeoUrl`, `priceMin` / `priceMax`, `priceDeliveryIncluded`, `offerType` (`ALL`, `AUCTION`, `BUY_NOW`, `HOT_AUCTION`), `conditions` (`NEW`, `UNPACKED`, `LIKE_NEW`, `USED`, `REPAIRED`, `REFURBISHED`, `DAMAGED`, `FOR_PARTS`), dynamic `attributeFilters`, `sellerId` / `sellerNames`, shipping/payment flags (`withShipping`, `freeShipping`, `paymentViaAukro`, `cashOnDelivery`, `personalPickup`, `aukroPlus`), geolocation (`postCode` + `distanceKm`), `endingWithin`, and curated feeds (`ENDING_SOON`, `FROM_1_CZK`, `UP_TO_300_CZK`, `NEW_OFFERS`, `POPULAR`, `PRICE_HITS`, `PREMIUM`, `CHARITY`, `OUTLET`). |
| `aukro_autocomplete` | Instant search suggestions for items, categories, and landing pages (`mode: "ALL"`), seller username prefix lookup (`mode: "USERS"`), or trending popular searches (`mode: "POPULAR"`). |
| `aukro_get_categories` | Browse all 22 root categories with live active item counts, inspect a specific `categoryId` (details, breadcrumbs, and direct subcategories), or search categories by keyword (`searchQuery`) using fast suggest+facet lookup (~120ms) or full 4,000+ node recursive tree scan (`fullTreeScan: true`). |
| `aukro_get_category_attributes` | Retrieve filterable/exposable parameters and allowed option keys for a `categoryId`. Use the returned `attributeId` and `allowedValues[].key` values in `aukro_search_offers`'s `attributeFilters`. |
| `aukro_get_offer_detail` | Fetch complete details for a single offer (`offerId`) or up to 20 offers in parallel (`offerIds`), including archived listings. Returns unified price, next minimum bid, Buy Now price, `shippingSummary` (`canShipToCz`, `cheapestShipping`, `totalPriceWithCheapestShipping`, `personalPickupAvailable`), plain-text description (plus optional raw HTML), attribute table, high-res image URLs, shipping & payment methods, buyer protection fees, and seller summary. |
| `aukro_get_offers_status_batch` | Lightweight batch poll for up to 50 offer IDs (`state`, `price`, `nextBidMinAmount`, `biddersCount`, `highestBidderAnonymizedLogin`, `endingTime`). |
| `aukro_get_offer_bids_and_similar` | Complete public bidding history (active + canceled bids, timestamps, amounts, anonymized bidder ratings) plus optional similar offers (`includeSimilarOffers`) and seller category offers (`includeSellerCategoryOffers`). |
| `aukro_get_user_profile` | Resolve any seller/user by `username` or `userId`. Returns registration date, last login, positive feedback %, 4-criteria star averages, negative feedback reason breakdown, vacation/absence status, free shipping threshold, and company registration details (IČO, DIČ, contact info, warranty/complaint rules, return policy). |
| `aukro_get_user_feedback` | Paginated feedback comments filtered by direction (`ALL_RECEIVED`, `FROM_BUYERS`, `FROM_SELLERS`, `SENT`) and sentiment (`ALL`, `POS`, `NEU`, `NEG`), including seller replies. |
| `aukro_get_seller_leaderboard` | Top sellers rankings (`favourite_count:DESC` or `popularity_growth:DESC`), optionally scoped by root `categoryId` or `subbrand`. |

### 2. Authentication & Session Management

| Tool | Description |
| :--- | :--- |
| `aukro_auth_status` | Check current auth mode (`anonymous`, `cookie`, `oauth_bearer`) and verify active login status against `/users/actualStatistics`. |
| `aukro_set_credentials` | Supply or update `cookieHeader`, `sessionCookie`, `xsrfToken`, `accessToken`, or `refreshToken` at runtime without restarting the MCP server. |
| `aukro_login_interactive` | Launch a local browser window to log in on `aukro.cz` and automatically capture and persist authenticated session cookies. |
| `aukro_logout` | Clear stored credentials from memory and disk, returning the server to anonymous mode. |

### 3. Authenticated Buyer, Watchlist, Bidding & Cart

| Tool | Description |
| :--- | :--- |
| `aukro_my_account` | Fetch the authenticated user's profile statistics, personal/company settings, addresses, 2FA status, and billing account balance. |
| `aukro_watchlist` | List (`LIST`), add (`ADD`), or remove (`REMOVE`) watched offers (`Sledované nabídky`). |
| `aukro_favourites` | List, add, or remove favorite sellers (`LIST_SELLERS`, `ADD_SELLER`, `REMOVE_SELLERS`) and saved searches (`LIST_SEARCHES`, `REMOVE_SEARCHES`). |
| `aukro_my_bids_and_purchases` | Inspect active auctions you are bidding on (`ACTIVE_BIDS` with winning/losing state), lost auctions (`LOST_AUCTIONS`), won/purchased items (`PURCHASED`), or order transactions with payment/shipment tracking (`TRANSACTIONS`). |
| `aukro_place_bid` | Place a maximum proxy bid (`příhoz`) on an auction, or run a safe pre-check (`dryRun: true`) to verify live price, minimum next bid, and account bidder restrictions without placing a bid. Supports 2FA SMS code via `tfvCode`. |
| `aukro_bargain_offer` | Check bargaining eligibility/constraints (`action: "CHECK"`) or propose a best-price offer to the seller (`action: "PROPOSE"` / `Nabídnout cenu`). |
| `aukro_cart` | View Buy Now shopping cart (`VIEW`), add items (`ADD`), update quantity (`UPDATE_QUANTITY`), remove items (`REMOVE`), or preview checkout shipping/payment options (`CHECKOUT_OPTIONS`). |

### 4. Authenticated Seller & Messaging

| Tool | Description |
| :--- | :--- |
| `aukro_my_sales` | List your seller listings (`ACTIVE`, `SOLD`, `NOT_SOLD`, `SCHEDULED`) or active sale transactions (`TRANSACTIONS`). |
| `aukro_manage_offer` | Manage listings via the v2 Offers API: prepare edit payload (`PREPARE_EDIT`), validate form (`VALIDATE`), calculate listing fees (`FEE_PREVIEW`), create offer (`CREATE`), modify offer (`MODIFY`), terminate single/bulk offers (`TERMINATE`), or re-expose ended offers (`REEXPOSE`). |
| `aukro_offer_templates` | List (`LIST`) and inspect (`GET`) saved seller offer templates/drafts. |
| `aukro_messages` | Manage `Moje zprávy` conversations: list threads and unread count (`LIST`), search threads (`SEARCH`), read thread message history (`READ_THREAD`), reply (`REPLY`), or ask a seller a question about an offer (`ASK_ITEM_QUESTION`). |

---

## MCP Resources & Guided Prompts

### Resources

- **`aukro://categories/root`** — Top-level Aukro.cz marketplace categories with IDs, SEO slugs, and active item counts.
- **`aukro://registry/shipping`** — Dictionary of Aukro.cz prepaid and cash-on-delivery shipping methods, carrier services, and item quantity units.
- **`aukro://registry/conditions`** — Mapping of item condition codes (`NEW`, `UNPACKED`, `LIKE_NEW`, `USED`, `REPAIRED`, `REFURBISHED`, `DAMAGED`, `FOR_PARTS`) to Attribute ID `48` (`Stav zboží`).

### Prompts

- **`aukro_estimate_market_price`** (`itemQuery`, optional `condition`) — Guides the assistant through comparing recently completed/archived auctions (`finished: true`) against current active listings to determine fair market value.
- **`aukro_seller_due_diligence`** (`username`) — Audits a seller's registration age, positive feedback percentage, 4-criteria star ratings, negative feedback comments and seller replies, IČO/DIČ company identifiers, and return/warranty policies.

---

## Project Structure

```text
aukro-mcp/
├── src/
│   ├── index.ts              # CLI entrypoint (stdio & Streamable HTTP transports)
│   ├── server.ts             # McpServer factory & capability registration
│   ├── config.ts             # Environment & runtime configuration loader
│   ├── client/
│   │   ├── auth.ts           # Cookie, OAuth2 PKCE refresh & interactive browser login manager
│   │   ├── cache.ts          # Bounded in-memory TTL cache
│   │   └── http.ts           # Aukro API HTTP client with retry & anonymous token init
│   ├── resources/
│   │   └── index.ts          # MCP resources & guided workflow prompts
│   ├── tools/
│   │   ├── search.ts         # Offer search (active/archived) & autocomplete
│   │   ├── categories.ts     # Category hierarchy, search & filterable attributes
│   │   ├── offers.ts         # Single/batch offer detail, live status poll & bid history
│   │   ├── users.ts          # Seller profile, ratings, feedback & leaderboard
│   │   ├── auth.ts           # Auth status, runtime credentials, interactive login & logout
│   │   ├── buyer.ts          # Account info, watchlist, favourites & bids/purchases
│   │   ├── bidding-cart.ts   # Auction bidding (with dryRun), bargaining & Buy Now cart
│   │   └── seller.ts         # Seller inventory, offers-v2 management, templates & messages
│   └── utils/
│       └── formatters.ts     # Token-compact response formatters & HTML stripping
├── tests/
│   └── aukro.test.ts         # Unit & live public API integration test suite
├── .env.example              # Example environment configuration
├── LICENSE                   # CC BY-NC 4.0 Non-Commercial License
├── package.json
└── tsconfig.json
```

---

## Development & Testing

```bash
# Run in development mode (via tsx)
npm run dev

# Type-check without emitting files
npm run typecheck

# Compile TypeScript to dist/
npm run build

# Run unit and integration tests (Vitest)
npm test
```

---

## License

Copyright © 2026 [mich41v4294](https://github.com/mich41v4294).

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License ([CC BY-NC 4.0](LICENSE))**.

- **Permitted:** Personal use, educational use, academic/price research, and non-commercial open-source contributions (with attribution).
- **Prohibited without prior written permission:** Commercial use, paid/monetized hosting (SaaS/API), or commercial arbitrage/scraping operations.

See the [LICENSE](LICENSE) file for the full license text and terms.
