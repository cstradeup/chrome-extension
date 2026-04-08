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
 * Derives Steam's own exchange rate by fetching a known item's render data
 * from a steamcommunity.com tab (MAIN world). Finds a USD-denominated
 * listing and computes `rate = converted_price / price`.
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
 * Fetches the render data for a known reference item and finds a
 * USD-denominated listing (currencyid 2001).  Returns the exchange rate
 * (`converted_price / price`) and the user's wallet currency id.
 *
 * Steam's listing data shape:
 * ```
 * {
 *   listinginfo: {
 *     "<id>": {
 *       price: number,              // seller amount in seller's currency
 *       fee: number,                // fee in seller's currency
 *       currencyid: number,         // 2000 + seller's currency id
 *       converted_price: number,    // seller amount in buyer's currency
 *       converted_fee: number,
 *       converted_currencyid: number // 2000 + buyer's currency id
 *     }
 *   }
 * }
 * ```
 */
async function deriveExchangeRate(): Promise<
  { success: true; rate: number; currency: number } |
  { success: false; error: string }
> {
  try {
    const RATE_REFERENCE_ITEM = 'M4A1-S%20%7C%20Black%20Lotus%20%28Field-Tested%29'; // M4A1-S | Black Lotus

    // First check if the user already uses USD
    const wallet = (window as any).g_rgWalletInfo;
    if (wallet && Number(wallet.wallet_currency) === 1) {
      return { success: true, rate: 1, currency: 1 };
    }

    const url =
      `https://steamcommunity.com/market/listings/730/${RATE_REFERENCE_ITEM}/render/` +
      '?query=&start=0&count=100&language=english&currency=3';

    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) {
      return { success: false, error: `Render API returned HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const listings = data?.listinginfo;
    if (!listings || typeof listings !== 'object') {
      return { success: false, error: 'No listing info in render response.' };
    }

    // Find a listing whose seller currency is USD (currencyid 2001)
    for (const id of Object.keys(listings)) {
      const l = listings[id];
      if (Number(l.currencyid) !== 2001) continue;    // not a USD seller
      if (!l.price || l.price <= 0) continue;          // skip zero-price
      if (!l.converted_price || l.converted_price <= 0) continue;

      const rate = l.converted_price / l.price;
      const currency = Number(l.converted_currencyid) - 2000;

      return { success: true, rate, currency };
    }

    return {
      success: false,
      error: 'No USD-denominated listing found for exchange-rate derivation.',
    };
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
