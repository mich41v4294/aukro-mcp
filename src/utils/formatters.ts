import { AukroApiError } from "../client/http.js";

export interface MoneyDto {
  amount?: number;
  currency?: string;
}

export function formatMoney(money?: MoneyDto | null): string | null {
  if (!money || typeof money.amount !== "number") return null;
  return `${money.amount} ${money.currency ?? "CZK"}`;
}

export function buildOfferUrl(seoUrl?: string, itemId?: number | string): string | null {
  if (!itemId) return null;
  if (seoUrl) {
    return `https://aukro.cz/${seoUrl}-${itemId}`;
  }
  return `https://aukro.cz/nabidka/${itemId}`;
}

export function stripHtmlToText(html?: string | null, maxLength = 4000): string {
  if (!html) return "";
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}… [truncated]`;
}

export function compactSearchItem(raw: Record<string, unknown>): Record<string, unknown> {
  const itemId = raw.itemId ?? raw.id;
  const seoUrl = typeof raw.seoUrl === "string" ? raw.seoUrl : undefined;
  const price = raw.price as MoneyDto | undefined;
  const priceWithShipping = (raw.priceWithShipping ?? raw.priceWithDelivery) as
    | MoneyDto
    | undefined;
  const buyNowPrice = raw.buyNowPrice as MoneyDto | undefined;
  const seller = raw.seller as Record<string, unknown> | undefined;

  const attributes: Record<string, unknown> = {};
  if (Array.isArray(raw.attributes)) {
    for (const a of raw.attributes as Array<Record<string, unknown>>) {
      const k = typeof a.attributeName === "string" ? a.attributeName : String(a.attributeId ?? "");
      if (k && a.attributeValue !== undefined) {
        attributes[k] = a.attributeValue;
      }
    }
  }

  const categoryTrail = Array.isArray(raw.categoryPath)
    ? (raw.categoryPath as Array<Record<string, unknown>>)
    : [];
  const leafCategory = categoryTrail[categoryTrail.length - 1];

  const compacted: Record<string, unknown> = {
    itemId,
    name: raw.itemName ?? raw.name,
    url: buildOfferUrl(seoUrl, itemId as number),
    state: raw.itemState ?? raw.state,
    type:
      raw.auction && raw.buyNowActive
        ? "AUCTION_AND_BUY_NOW"
        : raw.auction
          ? "AUCTION"
          : "BUY_NOW",
    price: price?.amount ?? null,
    currency: price?.currency ?? "CZK",
    priceWithShipping: priceWithShipping?.amount ?? null,
  };

  if (buyNowPrice && typeof buyNowPrice.amount === "number" && buyNowPrice.amount > 0) {
    compacted.buyNowPrice = buyNowPrice.amount;
  }
  if (raw.quantity && raw.quantity !== 1) {
    compacted.quantity = raw.quantity;
  }
  const bidders = Number(raw.buyersCountRelative ?? raw.biddersCount ?? 0);
  if (bidders > 0) compacted.biddersCount = bidders;
  const watchers = Number(raw.watchersCount ?? 0);
  if (watchers > 0) compacted.watchersCount = watchers;

  compacted.endingTime = raw.endingTime;
  if (raw.location) compacted.location = raw.location;
  if (raw.freeShipping) compacted.freeShipping = true;
  if (raw.paymentViaAukro) compacted.paymentViaAukro = true;
  if (raw.personalPickup) compacted.personalPickup = true;
  if (raw.aukroPlus) compacted.aukroPlus = true;

  const imageUrl =
    raw.titleImageUrl ?? (raw.titleImage as Record<string, unknown> | undefined)?.url;
  if (imageUrl) compacted.imageUrl = imageUrl;

  if (seller) {
    compacted.seller = {
      userId: seller.userId,
      username: seller.showName ?? raw.sellerLogin,
      company: Boolean(seller.companyAccount),
      rating: seller.rating,
      positivePercent:
        typeof seller.positiveFeedbackPercentage === "number"
          ? seller.positiveFeedbackPercentage <= 1
            ? Number((seller.positiveFeedbackPercentage * 100).toFixed(2))
            : Number(seller.positiveFeedbackPercentage.toFixed(2))
          : null,
    };
  } else if (raw.sellerLogin) {
    compacted.seller = { username: raw.sellerLogin };
  }

  if (leafCategory) {
    compacted.category = {
      id: leafCategory.id,
      path: categoryTrail.map((c) => c.name).join(" > "),
    };
  }
  if (Object.keys(attributes).length > 0) {
    compacted.attributes = attributes;
  }

  return compacted;
}

export function compactOfferDetail(
  raw: Record<string, unknown>,
  options?: {
    includeHtmlDescription?: boolean;
    includeInternationalShipping?: boolean;
    maxDescriptionLength?: number;
  }
): Record<string, unknown> {
  const itemId = (raw.itemId ?? raw.id) as number | undefined;
  const seoUrl = typeof raw.seoUrl === "string" ? raw.seoUrl : undefined;
  const price = raw.price as MoneyDto | undefined;
  const nextBidMinAmount = raw.nextBidMinAmount as MoneyDto | undefined;
  const buyNowPrice = raw.buyNowPrice as MoneyDto | undefined;
  const seller = raw.seller as Record<string, unknown> | undefined;

  const imagesObj = raw.images as Record<string, unknown> | undefined;
  const largeImages = Array.isArray(imagesObj?.large)
    ? (imagesObj.large as Array<Record<string, unknown>>).map((img) => img.url)
    : Array.isArray(raw.itemImages)
      ? (raw.itemImages as Array<Record<string, unknown>>)
          .map((img) => {
            const sizes = img.sizes as Record<string, { url?: string }> | undefined;
            return sizes?.LARGE?.url ?? sizes?.ORIGINAL?.url ?? sizes?.MEDIUM?.url;
          })
          .filter(Boolean)
      : [];

  const allShippingOptions = Array.isArray(raw.shippingOptions)
    ? (raw.shippingOptions as Array<Record<string, unknown>>).map((s) => ({
        methodId: s.shippingMethodId,
        code: s.shippingMethodCode,
        name: s.shippingMethodName,
        price: (s.firstPackagePrice as MoneyDto | undefined)?.amount ?? 0,
        nextPackagePrice: (s.nextPackagePrice as MoneyDto | undefined)?.amount ?? 0,
        freeOfCharge: Boolean(s.freeOfCharge),
        paymentBefore: Boolean(s.paymentBefore),
        aukroShipping: Boolean(s.aukroShipping),
        countryTo: String(s.countryTo ?? "CZ"),
      }))
    : [];

  const domesticShippingOptions = allShippingOptions.filter(
    (s) => s.countryTo === "CZ" || !s.countryTo
  );
  const internationalCountries = Array.from(
    new Set(
      allShippingOptions
        .map((s) => s.countryTo)
        .filter((c) => Boolean(c) && c !== "CZ")
    )
  );
  const shippingOptions = options?.includeInternationalShipping
    ? allShippingOptions
    : domesticShippingOptions.length > 0
      ? domesticShippingOptions
      : allShippingOptions;

  const carrierOptions = domesticShippingOptions.filter(
    (s) => !String(s.code ?? "").startsWith("PERSONAL_")
  );
  const personalPickupAvailable = allShippingOptions.some((s) =>
    String(s.code ?? "").startsWith("PERSONAL_")
  );
  const cheapestShipping =
    carrierOptions.length > 0 ? Math.min(...carrierOptions.map((s) => s.price)) : null;

  const attributes = Array.isArray(raw.attributes)
    ? (raw.attributes as Array<Record<string, unknown>>).map((a) => {
        const entry: Record<string, unknown> = {
          attributeId: a.attributeId,
          key: a.attributeKey,
          name: a.attributeName,
          value: a.attributeValue,
        };
        if (a.attributeValueAdditionalDescription) {
          entry.detail = a.attributeValueAdditionalDescription;
        }
        return entry;
      })
    : [];

  const category = Array.isArray(raw.category)
    ? (raw.category as Array<Record<string, unknown>>).map((c) => ({
        id: c.id,
        name: c.name,
        seoUrl: c.seoUrl,
        level: c.level,
      }))
    : [];

  const maxDescLen = options?.maxDescriptionLength ?? 2500;
  const rawStripped =
    typeof raw.descriptionStripped === "string" && raw.descriptionStripped.trim()
      ? raw.descriptionStripped
          .replace(/[ \t]+/g, " ")
          .replace(/\n\s*\n+/g, "\n\n")
          .trim()
      : stripHtmlToText(raw.descriptionInHtml as string | undefined, maxDescLen);
  const descriptionText =
    rawStripped.length <= maxDescLen
      ? rawStripped
      : `${rawStripped.slice(0, maxDescLen)}… [truncated]`;

  const rawPriceAmount =
    price && typeof price.amount === "number" && price.amount > 0 ? price.amount : null;
  const rawBuyNowAmount =
    buyNowPrice && typeof buyNowPrice.amount === "number" && buyNowPrice.amount > 0
      ? buyNowPrice.amount
      : null;
  const effectivePrice = rawPriceAmount ?? rawBuyNowAmount;
  const effectiveCurrency = price?.currency ?? buyNowPrice?.currency ?? "CZK";

  const result: Record<string, unknown> = {
    itemId,
    name: raw.name,
    url: buildOfferUrl(seoUrl, itemId),
    state: raw.state,
    itemArchived: raw.itemArchived,
    itemType: raw.itemType,
    price: effectivePrice,
    currency: effectiveCurrency,
    priceFormatted:
      effectivePrice !== null ? `${effectivePrice} ${effectiveCurrency}` : null,
    nextBidMinAmount: nextBidMinAmount?.amount ?? null,
    buyNowActive: Boolean(raw.buyNowActive),
    buyNowPrice: rawBuyNowAmount,
    shippingSummary: {
      canShipToCz: carrierOptions.length > 0,
      cheapestShipping: cheapestShipping,
      totalPriceWithCheapestShipping:
        effectivePrice !== null && cheapestShipping !== null
          ? effectivePrice + cheapestShipping
          : null,
      personalPickupAvailable,
      ...(internationalCountries.length > 0
        ? { internationalCountriesAvailable: internationalCountries }
        : {}),
    },
    bestOfferEnabled: Boolean(raw.bestOfferEnabled ?? raw.bargainingAvailable),
    biddersCount: raw.biddersCount ?? 0,
    highestBidderAnonymizedLogin: raw.highestBidderAnonymizedLogin ?? null,
    highestBidderId: raw.highestBidderId ?? null,
    quantity: raw.quantity,
    startingQuantity: raw.startingQuantity,
    soldQuantity: raw.soldQuantity,
    unit: raw.itemQuantityTypeEnum,
    displayedCount: raw.displayedCount,
    watchingUserCount: raw.watchingUserCount,
    startingTime: raw.startingTime,
    endingTime: raw.endingTime,
    endingTimeText: raw.endingTimeText,
    location: raw.itemLocation,
    postCode: raw.postCode,
    availablePaymentTypes: raw.availablePaymentTypes,
    offerPaymentOptions: raw.offerPaymentOptions,
    buyerProtectionFeeInfo: raw.buyerProtectionFeeInfo,
    shippingOptions,
    attributes,
    category,
    images: largeImages,
    description: descriptionText,
    seller: seller
      ? {
          userId: seller.userId,
          username: seller.showName,
          companyAccount: seller.companyAccount,
          aukroPlus: seller.aukroPlus,
          location: seller.location,
          rating: seller.rating,
          starType: seller.starType,
          positiveFeedbackPercent:
            typeof seller.positiveFeedbackPercentage === "number"
              ? seller.positiveFeedbackPercentage <= 1
                ? Number((seller.positiveFeedbackPercentage * 100).toFixed(2))
                : Number(seller.positiveFeedbackPercentage.toFixed(2))
              : null,
          feedbackUniqueUserCount: seller.feedbackUniqueUserCount,
          favouritedByCount: seller.favouritedByCount,
        }
      : undefined,
  };

  if (options?.includeHtmlDescription) {
    result.descriptionInHtml = raw.descriptionInHtml;
  }

  return result;
}

/**
 * Extracts a single clean image URL from Aukro's multi-size `titlePhoto` or `image` objects.
 */
export function extractImageUrl(photoObj: unknown): string | null {
  if (!photoObj || typeof photoObj !== "object") return null;
  const obj = photoObj as Record<string, unknown>;
  if (typeof obj.url === "string") return obj.url;
  const sizes = obj.sizes as Record<string, { url?: string }> | undefined;
  if (sizes && typeof sizes === "object") {
    return (
      sizes.LARGE?.url ??
      sizes.MEDIUM?.url ??
      sizes.ORIGINAL?.url ??
      sizes.MEDIUM_PREVIEW?.url ??
      sizes.SMALL?.url ??
      null
    );
  }
  return null;
}

/**
 * Recursively strips HATEOAS `links` arrays and collapses multi-size `titlePhoto` objects
 * without removing any domain data.
 */
export function pruneApiNoise<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneApiNoise(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k === "links" && Array.isArray(v)) {
        continue;
      }
      if (k === "titlePhoto" && v && typeof v === "object") {
        out.imageUrl = extractImageUrl(v);
        continue;
      }
      out[k] = pruneApiNoise(v);
    }
    return out as T;
  }
  return value;
}

export function compactWatchedOffer(raw: Record<string, unknown>): Record<string, unknown> {
  const itemId = (raw.itemId ?? raw.id) as number | undefined;
  const seoUrl = typeof raw.seoUrl === "string" ? raw.seoUrl : undefined;
  const price = raw.price as MoneyDto | undefined;
  const buyNowPrice = raw.buyNowPrice as MoneyDto | undefined;

  return pruneApiNoise({
    itemId,
    name: raw.itemName ?? raw.name,
    url: buildOfferUrl(seoUrl, itemId),
    type: raw.itemTypeEnum ?? raw.itemType,
    state: raw.state ?? "ACTIVE",
    price: price?.amount ?? null,
    currency: price?.currency ?? "CZK",
    buyNowActive: Boolean(raw.buyNowActive),
    buyNowPrice:
      buyNowPrice && typeof buyNowPrice.amount === "number" && buyNowPrice.amount > 0
        ? buyNowPrice.amount
        : null,
    endingTime: raw.endingTime ?? raw.endTime,
    timeToEnd: raw.timeToEnd,
    leftItems: raw.leftItems,
    soldItems: raw.soldItems,
    watchersCount: raw.watchersCount,
    reminds: raw.reminds,
    imageUrl: extractImageUrl(raw.image ?? raw.titlePhoto),
    seller: raw.seller,
  });
}

export function compactSellerOffer(raw: Record<string, unknown>): Record<string, unknown> {
  const itemId = (raw.id ?? raw.itemId) as number | undefined;
  const seoUrl = typeof raw.seoUrl === "string" ? raw.seoUrl : undefined;
  const price = raw.price as MoneyDto | undefined;
  const startingPrice = raw.startingPrice as MoneyDto | undefined;
  const buyNowPrice = raw.buyNowPrice as MoneyDto | undefined;

  return pruneApiNoise({
    itemId,
    name: raw.name ?? raw.itemName,
    url: buildOfferUrl(seoUrl, itemId),
    state: raw.itemState ?? raw.state,
    type: raw.itemType,
    price: price?.amount ?? null,
    startingPrice: startingPrice?.amount ?? null,
    buyNowActive: Boolean(raw.buyNowActive),
    buyNowPrice:
      buyNowPrice && typeof buyNowPrice.amount === "number" && buyNowPrice.amount > 0
        ? buyNowPrice.amount
        : null,
    currency: price?.currency ?? startingPrice?.currency ?? "CZK",
    quantity: raw.itemQuantity,
    soldQuantity: raw.itemSoldQuantity,
    startQuantity: raw.itemStartQuantity,
    unit: raw.itemQuantityType,
    bidderCount: raw.bidderCount ?? 0,
    watchersCount: raw.watchersCount ?? 0,
    showCount: raw.showCount ?? 0,
    startingTime: raw.startingTime,
    endingTime: raw.endingTime,
    dealId: raw.dealId,
    dealTransactionId: raw.dealTransactionId,
    pva: raw.pva,
    pvaStatus: raw.pvaStatus,
    paymentOnline: raw.paymentOnline,
    reExposureActive: raw.reExposureActive,
    reExposureType: raw.reExposureType,
    biddingBuyerRating: raw.biddingBuyerRating,
    stepper: raw.stepper,
    imageUrl: extractImageUrl(raw.titlePhoto ?? raw.image),
  });
}

export function compactMyAccount(params: {
  actualStats: Record<string, unknown>;
  profileStats: Record<string, unknown> | null;
  myData: Record<string, unknown> | null;
  balance: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { actualStats, profileStats, myData, balance } = params;
  return pruneApiNoise({
    user: actualStats,
    profileStatistics: profileStats,
    billingBalance: balance,
    accountData: myData
      ? {
          userId: myData.userId,
          twoFactorVerificationEnabled: myData.twoFactorVerificationEnabled,
          twoFactorVerificationEnforcedForUser: myData.twoFactorVerificationEnforcedForUser,
          initialUserDetailsSet: myData.initialUserDetailsSet,
          hasPersonalDataFilled: myData.hasPersonalDataFilled,
          userBlocked: myData.userBlocked,
          accountType: myData.userAccountTypeDataDto,
          email: myData.userEmailDataDto,
          phone: myData.userPhoneDataDto,
          personalData: myData.userPersonalDataDto,
          companyData: myData.userCompanyDataDto,
          preferences: myData.userPreferencesDataDto,
        }
      : null,
  });
}

export function mcpJsonResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function mcpErrorResult(err: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  if (err instanceof AukroApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: err.message,
              status: err.status,
              path: err.path,
              isAuthError: err.isAuthError,
              requiresTwoFactor: err.requiresTwoFactor,
              details: err.errorBody,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        ),
      },
    ],
  };
}
