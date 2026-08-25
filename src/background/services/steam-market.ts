import { BillingInfo, getBillingInfo, saveBillingInfo } from '../../lib/storage/reducer/billing';

/**
 * A cheap listing page used solely to scrape the user's pre-filled billing
 * info from the buy-now dialog.
 */
const BILLING_SCRAPE_URL =
  'https://steamcommunity.com/market/listings/730/P250%20%7C%20Sleet%20%28Factory%20New%29';

// ─── Public types ────────────────────────────────────────────────────────────

export interface BuyListingParams {
  listingId: string;
  /** Price in the smallest currency unit (e.g. cents) *without* fee. */
  subtotal: number;
  /** Marketplace fee in the smallest currency unit. */
  fee: number;
  /** subtotal + fee */
  total: number;
  /** Steam currency id (e.g. 3 = EUR). */
  currency: number;
}

export interface BuyListingResult {
  success: boolean;
  error?: string;
  wallet_info?: unknown;
  message?: string;
}

export interface FetchBillingResult {
  success: boolean;
  billing?: BillingInfo;
  error?: string;
}

export interface WalletInfo {
  wallet_currency: number;
  wallet_country: string;
  wallet_balance: string;
  wallet_fee: string;
  wallet_fee_minimum: string;
  wallet_fee_percent: string;
  wallet_publisher_fee_percent_default: string;
  wallet_fee_base: string;
  [key: string]: unknown;
}

export interface GetWalletInfoResult {
  success: boolean;
  wallet?: WalletInfo;
  error?: string;
}

export interface ConvertPriceParams {
  /** Seller-receives amount in USD cents. */
  subtotal: number;
  /** Marketplace fee in USD cents. */
  fee: number;
  /** subtotal + fee in USD cents. */
  total: number;
}

export interface ConvertedPrice {
  subtotal: number;
  fee: number;
  total: number;
  currency: number;
}

export interface ConvertPriceResult {
  success: boolean;
  price?: ConvertedPrice;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retrieves the `sessionid` cookie from the Steam Community domain.
 */
async function getSessionId(): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: 'https://steamcommunity.com',
    name: 'sessionid',
  });
  return cookie?.value ?? null;
}

/**
 * Waits until a tab reaches `status === 'complete'`, or throws on timeout.
 */
function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    function listener(id: number, info: { status?: string }) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Resolve immediately if the tab is already loaded
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

// ─── Billing scraper ─────────────────────────────────────────────────────────

/**
 * Runs inside the Steam market listing page context (via
 * `chrome.scripting.executeScript`).  Polls for the pre-filled billing
 * form values and resolves with the billing data or `null`.
 */
function extractBillingFromPage(): Promise<Record<string, string | number> | null> {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 20; // ~10 s

    function tryExtract() {
      const getValue = (id: string): string => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        return el?.value ?? '';
      };

      const firstName = getValue('first_name_buynow');

      if (firstName) {
        resolve({
          first_name: firstName,
          last_name: getValue('last_name_buynow'),
          billing_address: getValue('billing_address_buynow'),
          billing_address_two: getValue('billing_address_two_buynow'),
          billing_country: getValue('billing_country_buynow'),
          billing_city: getValue('billing_city_buynow'),
          billing_state: getValue('billing_state_buynow'),
          billing_postal_code: getValue('billing_postal_code_buynow'),
          save_my_address: 1,
        });
        return;
      }

      if (++attempts >= maxAttempts) {
        resolve(null);
        return;
      }

      setTimeout(tryExtract, 500);
    }

    tryExtract();
  });
}

/**
 * Opens (or reuses) a Steam market listing tab, scrapes the billing form,
 * persists the info and returns it.
 */
async function scrapeBillingInfo(): Promise<BillingInfo | null> {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find((t) =>
    t.url?.includes('steamcommunity.com/market/listings/'),
  );

  let tab: chrome.tabs.Tab;
  let createdTab = false;

  if (existingTab?.id) {
    tab = existingTab;
  } else {
    tab = await chrome.tabs.create({ url: BILLING_SCRAPE_URL, active: false });
    createdTab = true;
  }

  await waitForTabLoad(tab.id!);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractBillingFromPage,
    });

    const raw = results?.[0]?.result as Record<string, string | number> | null;

    if (raw && raw.first_name) {
      const billing: BillingInfo = {
        first_name: String(raw.first_name),
        last_name: String(raw.last_name),
        billing_address: String(raw.billing_address),
        billing_address_two: String(raw.billing_address_two),
        billing_country: String(raw.billing_country),
        billing_city: String(raw.billing_city),
        billing_state: String(raw.billing_state ?? ''),
        billing_postal_code: String(raw.billing_postal_code),
        save_my_address: Number(raw.save_my_address),
      };
      await saveBillingInfo(billing);
      return billing;
    }

    return null;
  } finally {
    if (createdTab) {
      try {
        await chrome.tabs.remove(tab.id!);
      } catch {
        /* tab may already be closed */
      }
    }
  }
}

/**
 * Ensures billing info is available — reads from storage first, scrapes on
 * demand if missing.
 */
async function ensureBillingInfo(): Promise<BillingInfo | null> {
  const stored = await getBillingInfo();
  if (stored?.first_name) return stored;
  return scrapeBillingInfo();
}

// ─── Public handlers ─────────────────────────────────────────────────────────

/**
 * Fetches (and persists) the user's billing info.
 * Can be called ahead of time so that `buyListing` is instant.
 */
export async function handleFetchBillingInfo(): Promise<FetchBillingResult> {
  try {
    const billing = await ensureBillingInfo();
    if (!billing) {
      return {
        success: false,
        error: 'Could not retrieve billing info. Please open a Steam market listing page while logged in.',
      };
    }
    return { success: true, billing };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[CSTRADEUP] handleFetchBillingInfo error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Reads the user's Steam wallet info (`g_rgWalletInfo`) from a
 * steamcommunity.com page.  This global JS variable is present on
 * virtually every authenticated Steam Community page and contains the
 * user's currency id, balance, fee structure, etc.
 */
export async function handleGetWalletInfo(): Promise<GetWalletInfoResult> {
  try {
    const tab = await getOrCreateSteamTab();
    await waitForTabLoad(tab.id!);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: extractWalletInfo,
    });

    const wallet = results?.[0]?.result as WalletInfo | null;

    if (!wallet || wallet.wallet_currency == null) {
      return {
        success: false,
        error: 'Could not read wallet info. Make sure you are logged in to Steam.',
      };
    }

    return { success: true, wallet };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[CSTRADEUP] handleGetWalletInfo error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Converts a USD price to the user's Steam wallet currency.
 *
 * Derives Steam's own exchange rate from a steamcommunity.com tab (MAIN world)
 * via the modern `QueryListingsForItem` market actions API (the legacy
 * `/render/` endpoint now returns HTML).
 *
 * If the user's wallet is already USD (currency 1), returns the input as-is.
 */
export async function handleConvertPrice(
  params: ConvertPriceParams,
): Promise<ConvertPriceResult> {
  try {
    const tab = await getOrCreateSteamTab();
    await waitForTabLoad(tab.id!);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: deriveExchangeRate,
    });

    const rateResult = results?.[0]?.result as
      | { success: true; rate: number; currency: number }
      | { success: false; error: string }
      | null;

    if (!rateResult) {
      return { success: false, error: 'No response from exchange-rate script.' };
    }

    if (!rateResult.success) {
      return { success: false, error: (rateResult as any).error };
    }

    const { rate, currency } = rateResult as { success: true; rate: number; currency: number };

    // Already USD — no conversion needed
    if (currency === 1) {
      return {
        success: true,
        price: {
          subtotal: params.subtotal,
          fee: params.fee,
          total: params.total,
          currency: 1,
        },
      };
    }

    const subtotal = Math.round(params.subtotal * rate);
    const fee = Math.round(params.fee * rate);

    return {
      success: true,
      price: {
        subtotal,
        fee,
        total: subtotal + fee,
        currency,
      },
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[CSTRADEUP] handleConvertPrice error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Buys a Steam Community Market listing.
 *
 * The POST is executed inside a steamcommunity.com tab via
 * `chrome.scripting.executeScript` so that the browser sets the correct
 * `Origin` and `Referer` headers automatically (they're forbidden headers
 * and can't be set from a service-worker fetch).
 *
 * 1. Ensures billing info is available (scrapes from a listing page if needed).
 * 2. Reads the session id cookie.
 * 3. Opens / reuses a Steam Community tab.
 * 4. Executes the buy POST inside that tab's page context.
 */
export async function handleBuyListing(params: BuyListingParams): Promise<BuyListingResult> {
  try {
    // 1. Billing info
    const billing = await ensureBillingInfo();
    if (!billing) {
      return {
        success: false,
        error: 'Could not retrieve billing info. Please open a Steam market listing page while logged in.',
      };
    }

    // 2. Session id (from cookie)
    const sessionId = await getSessionId();
    if (!sessionId) {
      return { success: false, error: 'Steam session not found. Please log in to Steam.' };
    }

    // 3. Build the serialised body ahead of time so we can pass it as a
    //    simple string arg into the injected function.
    const body = new URLSearchParams({
      sessionid: sessionId,
      currency: String(params.currency),
      subtotal: String(params.subtotal),
      fee: String(params.fee),
      total: String(params.total),
      quantity: '1',
      first_name: billing.first_name,
      last_name: billing.last_name,
      billing_address: billing.billing_address,
      billing_address_two: billing.billing_address_two,
      billing_country: billing.billing_country,
      billing_city: billing.billing_city,
      billing_state: billing.billing_state ?? '',
      billing_postal_code: billing.billing_postal_code,
      save_my_address: String(billing.save_my_address),
      tradefee_tax: '0',
      confirmation: '0',
    }).toString();

    const url = `https://steamcommunity.com/market/buylisting/${params.listingId}`;

    // 4. Get (or create) a Steam Community tab to run the request in.
    const tab = await getOrCreateSteamTab();
    await waitForTabLoad(tab.id!);

    // 5. Execute the POST inside the Steam tab's page context.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: postBuyListing,
      args: [url, body],
    });

    const result = results?.[0]?.result as BuyListingResult | null;

    if (!result) {
      return { success: false, error: 'No response from injected buy script.' };
    }

    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[CSTRADEUP] handleBuyListing error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ─── Injected page functions ─────────────────────────────────────────────────

/**
 * Runs inside a steamcommunity.com MAIN-world page context.
 * Reads the global `g_rgWalletInfo` object that Steam injects on every
 * authenticated page.
 */
function extractWalletInfo(): Record<string, unknown> | null {
  try {
    const w = (window as any).g_rgWalletInfo;
    if (w && typeof w === 'object' && w.wallet_currency != null) {
      return { ...w };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Runs inside a steamcommunity.com MAIN-world page context.
 *
 * Derives Steam's USD→wallet FX rate using the modern market actions API:
 * `GET /market/actions?q=QueryListingsForItem`.
 *
 * New listing shape (prices are already in the viewer's currency):
 * ```
 * {
 *   listingid, unPrice, unFee, eCurrency, strSubtotal, ...
 * }
 * ```
 *
 * Strategy (mirrors the old `converted_price / price` approach):
 * 1. Fetch authenticated listings (wallet / session currency).
 * 2. Prefer pairing the same `listingid` against a USD view
 *    (anonymous / IP-regional fetch when that yields eCurrency === 1).
 * 3. Fall back to `priceoverview?currency=1` as a USD price anchor.
 */
async function deriveExchangeRate(): Promise<
  { success: true; rate: number; currency: number } |
  { success: false; error: string }
> {
  /** Bucket group id for M4A1-S | Black Lotus (all wears). */
  const RATE_REFERENCE_BUCKET = 'G183C208E093004';
  /** Concrete wear used when anchoring against priceoverview. */
  const RATE_REFERENCE_HASH = 'M4A1-S | Black Lotus (Field-Tested)';

  type MarketListing = {
    listingid: string;
    unPrice: number;
    unFee: number;
    eCurrency: number;
    description?: { market_hash_name?: string };
  };

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const parseUsdCents = (priceStr: string): number | null => {
    // currency=1 always formats like "$5.14" / "$1,234.56"
    const cleaned = priceStr.replace(/[^0-9.,]/g, '');
    if (!cleaned) return null;
    const normalized = cleaned.includes(',') && cleaned.includes('.')
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(',', '');
    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount * 100);
  };

  const fetchListings = async (
    currencyHint: number,
    credentials: RequestCredentials,
  ): Promise<MarketListing[] | null> => {
    const qp = [
      {
        appid: 730,
        strItemName: RATE_REFERENCE_BUCKET,
        filters: { Exterior: ['WearCategory2'] }, // Field-Tested
        accessoryFilters: {},
        propertyFilters: {},
        price: { eCurrency: currencyHint },
        start: 0,
      },
    ];
    const url =
      'https://steamcommunity.com/market/actions?q=QueryListingsForItem&qp=' +
      encodeURIComponent(JSON.stringify(qp));

    const resp = await fetch(url, {
      credentials,
      headers: { 'x-valve-request-type': 'queryAction' },
    });
    if (!resp.ok) return null;

    const body = await resp.json();
    const listings = body?.data?.listings ?? body?.listings;
    return Array.isArray(listings) ? (listings as MarketListing[]) : null;
  };

  try {
    const wallet = (window as any).g_rgWalletInfo;
    const walletCurrency =
      wallet && wallet.wallet_currency != null
        ? Number(wallet.wallet_currency)
        : null;

    if (walletCurrency === 1) {
      return { success: true, rate: 1, currency: 1 };
    }

    const authListings = await fetchListings(walletCurrency ?? 1, 'include');
    if (!authListings || authListings.length === 0) {
      return {
        success: false,
        error: 'No listing info in QueryListingsForItem response.',
      };
    }

    const currency =
      walletCurrency ?? Number(authListings[0].eCurrency);
    if (!Number.isFinite(currency) || currency <= 0) {
      return { success: false, error: 'Could not determine wallet currency.' };
    }
    if (currency === 1) {
      return { success: true, rate: 1, currency: 1 };
    }

    const walletSamples = authListings.filter(
      (l) =>
        Number(l.eCurrency) === currency &&
        Number(l.unPrice) > 0 &&
        Number(l.unFee) >= 0,
    );
    if (walletSamples.length === 0) {
      return {
        success: false,
        error: 'No usable wallet-currency listings for exchange-rate derivation.',
      };
    }

    // ── Preferred: same listingid priced in USD vs wallet currency ──────────
    // Anonymous / IP-regional responses sometimes stay in USD even when the
    // authenticated session uses another wallet currency.
    try {
      const usdListings = await fetchListings(1, 'omit');
      if (usdListings && usdListings.length > 0) {
        const usdById = new Map<string, MarketListing>();
        for (const l of usdListings) {
          if (Number(l.eCurrency) === 1 && Number(l.unPrice) > 0) {
            usdById.set(String(l.listingid), l);
          }
        }

        const pairedRates: number[] = [];
        for (const walletListing of walletSamples) {
          const usdListing = usdById.get(String(walletListing.listingid));
          if (!usdListing) continue;
          pairedRates.push(walletListing.unPrice / usdListing.unPrice);
        }

        if (pairedRates.length > 0) {
          return { success: true, rate: median(pairedRates), currency };
        }
      }
    } catch {
      /* anonymous pairing is best-effort */
    }

    // ── Fallback: USD lowest ask via priceoverview ──────────────────────────
    const overviewUrl =
      'https://steamcommunity.com/market/priceoverview/' +
      `?appid=730&currency=1&market_hash_name=${encodeURIComponent(RATE_REFERENCE_HASH)}`;

    const overviewResp = await fetch(overviewUrl, { credentials: 'include' });
    if (!overviewResp.ok) {
      return {
        success: false,
        error: `USD priceoverview returned HTTP ${overviewResp.status}`,
      };
    }

    const overview = await overviewResp.json();
    const usdTotal = typeof overview?.lowest_price === 'string'
      ? parseUsdCents(overview.lowest_price)
      : null;
    if (!usdTotal) {
      return {
        success: false,
        error: 'Could not parse USD lowest_price from priceoverview.',
      };
    }

    // Compare buyer totals (unPrice + unFee) against USD lowest ask.
    // FX is linear, so this matches applying the rate to subtotal and fee.
    const ftSamples = walletSamples.filter(
      (l) => l.description?.market_hash_name === RATE_REFERENCE_HASH,
    );
    const totals = (ftSamples.length > 0 ? ftSamples : walletSamples)
      .map((l) => l.unPrice + l.unFee)
      .filter((t) => t > 0);

    if (totals.length === 0) {
      return {
        success: false,
        error: 'No positive wallet-currency totals for exchange-rate derivation.',
      };
    }

    const rate = Math.min(...totals) / usdTotal;
    if (!Number.isFinite(rate) || rate <= 0) {
      return { success: false, error: 'Derived exchange rate was invalid.' };
    }

    return { success: true, rate, currency };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
}

/**
 * Runs inside a steamcommunity.com MAIN-world page context.
 * The browser automatically attaches the correct Origin, Referer, and cookies.
 */
async function postBuyListing(
  url: string,
  body: string,
): Promise<{ success: boolean; error?: string; wallet_info?: unknown; message?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      credentials: 'include',
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Steam returned HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();

    if (data.wallet_info) {
      return { success: true, wallet_info: data.wallet_info };
    }

    if (data.message) {
      return { success: false, error: data.message, message: data.message };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
}

// ─── Steam tab helper ────────────────────────────────────────────────────────

/**
 * Finds an existing steamcommunity.com tab or creates a minimal one.
 */
async function getOrCreateSteamTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url?.includes('steamcommunity.com'));

  if (existing?.id) return existing;

  // Open the market page in the background — it's lightweight and guarantees
  // the correct domain context for the fetch.
  return chrome.tabs.create({
    url: 'https://steamcommunity.com/market/',
    active: false,
  });
}
