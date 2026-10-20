import { Cursor } from "../lib/storage/reducer/cstradeup";

const CHANNEL = '__CSTRADEUP_API__';

// =============================================================================
// Message helpers
// =============================================================================

/** Monotonically increasing request id so we can match responses. */
let nextRequestId = 1;

interface ApiRequest {
  channel: typeof CHANNEL;
  direction: 'request';
  requestId: number;
  action: string;
  payload: unknown;
}

interface ApiResponse {
  channel: typeof CHANNEL;
  direction: 'response';
  requestId: number;
  payload: unknown;
}

function isApiResponse(d: unknown): d is ApiResponse {
  return (
    d != null &&
    typeof d === 'object' &&
    (d as any).channel === CHANNEL &&
    (d as any).direction === 'response' &&
    typeof (d as any).requestId === 'number'
  );
}

/**
 * Sends a request to the ISOLATED-world relay content script and waits for
 * the matching response.  Returns a Promise that resolves with the response
 * payload or rejects after a timeout.
 */
function sendToRelay<T = unknown>(action: string, payload: unknown, timeoutMs = 120_000): Promise<T> {
  const requestId = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(`[cstradeup] Relay timeout for action "${action}" (id=${requestId})`));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      const msg = event.data;
      if (!isApiResponse(msg) || msg.requestId !== requestId) return;

      clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(msg.payload as T);
    }

    window.addEventListener('message', handler);

    const request: ApiRequest = {
      channel: CHANNEL,
      direction: 'request',
      requestId,
      action,
      payload,
    };

    window.postMessage(request, '*');
  });
}

// =============================================================================
// Public API exposed to the website
// =============================================================================

type NotarizeResult = { success: boolean; crafted?: number; error?: string };
type SyncPortfolioResult = { success: boolean; error?: string };
type LoadInventoryResult = { success: boolean; error?: string };

/**
 * Starts inventory sync from the website (same flow as popup "Load Inventory").
 */
const loadInventory = async (): Promise<LoadInventoryResult> => {
  return sendToRelay<LoadInventoryResult>('LOAD_INVENTORY', null);
}

// Used by the website to claim trade up's cashback tickets.
const notarizeTradeupItems = async (cursorJson: string): Promise<NotarizeResult> => {
  const cursor: Cursor = JSON.parse(cursorJson);
  return sendToRelay<NotarizeResult>('NOTARIZE_CURSOR', cursor);
}

/**
 * Starts portfolio sync from the website (same flow as popup "Load Inventory History").
 */
const syncPortfolio = async (): Promise<SyncPortfolioResult> => {
  return sendToRelay<SyncPortfolioResult>('SYNC_PORTFOLIO', null);
}

// =============================================================================
// Provider types
// =============================================================================

/** Shared result shape every market provider returns from a buy operation. */
interface BuyResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Shared result shape for billing-info fetches. */
interface BillingResult {
  success: boolean;
  billing?: unknown;
  error?: string;
}

/** Shared result shape for wallet / currency info. */
interface WalletResult<TWallet = unknown> {
  success: boolean;
  wallet?: TWallet;
  error?: string;
}

/** Every market provider must expose at least these methods. */
interface MarketProvider<
  TBuyParams = unknown,
  TBuyResult extends BuyResult = BuyResult,
  TBillingResult extends BillingResult = BillingResult,
  TWalletResult extends WalletResult = WalletResult,
> {
  /** Purchase a listing on this provider's marketplace. */
  buyListing(params: TBuyParams): Promise<TBuyResult>;
  /** Pre-fetch & cache billing / payment info for faster future purchases. */
  fetchBillingInfo(): Promise<TBillingResult>;
  /** Retrieve the user's wallet / currency configuration. */
  getWalletInfo(): Promise<TWalletResult>;
}

// =============================================================================
// Steam provider
// =============================================================================

interface SteamBuyListingParams {
  listingId: string;
  subtotal: number;
  fee: number;
  total: number;
  currency: number;
}

interface SteamBuyResult extends BuyResult {
  wallet_info?: unknown;
  message?: string;
}

interface SteamWalletInfo {
  /** Steam currency id (e.g. 1 = USD, 2 = GBP, 3 = EUR). */
  wallet_currency: number;
  wallet_country: string;
  /** Balance in the smallest currency unit (e.g. cents). */
  wallet_balance: string;
  wallet_fee: string;
  wallet_fee_minimum: string;
  wallet_fee_percent: string;
  wallet_publisher_fee_percent_default: string;
  wallet_fee_base: string;
  [key: string]: unknown;
}

type SteamWalletResult = WalletResult<SteamWalletInfo>;

interface SteamQueryListingParams {
  /** Steam market bucket group id, e.g. `"G1807208B083004"`. */
  bucketGroupId: string;
  /** Item float; queries `float ± 0.0001` unless `floatMin` / `floatMax` are set. */
  float: number;
  floatMin?: number;
  floatMax?: number;
}

interface SteamQueriedListing {
  listingId: string;
  subtotal: number;
  fee: number;
  total: number;
  currency: number;
}

interface SteamQueryListingResult {
  success: boolean;
  listing?: SteamQueriedListing;
  error?: string;
}

const steam: MarketProvider<SteamBuyListingParams, SteamBuyResult, BillingResult, SteamWalletResult> & {
  /**
   * Look up a Steam listing by bucket group + float and return the cheapest
   * match priced in the user's wallet currency (includes `listingId` for buy).
   */
  queryListing(params: SteamQueryListingParams): Promise<SteamQueryListingResult>;
} = {
  buyListing: (params) =>
    sendToRelay<SteamBuyResult>('STEAM:BUY_LISTING', params),
  fetchBillingInfo: () =>
    sendToRelay<BillingResult>('STEAM:FETCH_BILLING_INFO', null),
  getWalletInfo: () =>
    sendToRelay<SteamWalletResult>('STEAM:GET_WALLET_INFO', null),
  queryListing: (params) =>
    sendToRelay<SteamQueryListingResult>('STEAM:QUERY_LISTING', params),
};

// =============================================================================
// Tradeit provider
// =============================================================================

interface TradeitAddToCartParams {
  /** Full market hash name, e.g. `"AWP | Redline (Field-Tested)"`. */
  name: string;
  /** Exact float of the desired skin (matched to 4 decimal places). */
  float: number;
}

interface TradeitAddToCartResult {
  success: boolean;
  error?: string;
}

/**
 * Tradeit.gg provider — drives the live trade page UI from the extension.
 * Currently exposes cart automation only.
 */
const tradeit = {
  /**
   * Open (or reuse) https://tradeit.gg/csgo/trade and add the skin matching
   * `name` + `float` to the site cart via UI automation.
   */
  addToCart: (params: TradeitAddToCartParams) =>
    sendToRelay<TradeitAddToCartResult>('TRADEIT:ADD_TO_CART', params, 180_000),
};

// =============================================================================
// Expose to page
// =============================================================================

// @ts-ignore
window.cstradeup = {
  loadInventory,
  syncPortfolio,
  notarizeTradeupItems,
  isInstalled: true,
  lastUpdatedDate: undefined,

  /** Market providers — each key is a provider id. */
  providers: {
    steam,
    tradeit,
  },
};
