/**
 * Tradeit.gg market automation.
 *
 * Opens (or reuses) https://tradeit.gg/csgo/trade and drives the site-inventory
 * UI to add a specific skin (by market name + float) to the cart.
 *
 * Important DOM note: Tradeit duplicates `id="siteInventory-search"` on both a
 * wrapper div and the real <input>. Always query the input explicitly.
 */

const TRADEIT_TRADE_URL = 'https://tradeit.gg/csgo/trade';

// ─── Public types ────────────────────────────────────────────────────────────

export interface AddToCartParams {
  /** Full market hash name, e.g. `"AWP | Redline (Field-Tested)"`. */
  name: string;
  /** Exact float of the desired skin (matched to 4 decimal places). */
  float: number;
}

export interface AddToCartResult {
  success: boolean;
  error?: string;
}

// ─── Tab helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves as soon as the tab reports complete once, or immediately if it is
 * already complete. Never blocks the workflow for long — the injected script
 * owns UI readiness.
 */
function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(done, timeoutMs);

    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === 'complete') done();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') done();
    }).catch(() => done());
  });
}

/**
 * Ensure a tradeit.gg/csgo/trade tab exists and return its id.
 * Does not soft-lock on SPA hydration — that is handled in-page.
 */
async function ensureTradeitTab(): Promise<number> {
  const tabs = await chrome.tabs.query({});
  const tradeTab = tabs.find((t) => t.url?.includes('tradeit.gg/csgo/trade'));
  if (tradeTab?.id) return tradeTab.id;

  const anyTradeit = tabs.find((t) => t.url?.includes('tradeit.gg'));
  if (anyTradeit?.id) {
    const pending = waitForTabComplete(anyTradeit.id);
    await chrome.tabs.update(anyTradeit.id, { url: TRADEIT_TRADE_URL });
    await pending;
    return anyTradeit.id;
  }

  const created = await chrome.tabs.create({ url: TRADEIT_TRADE_URL, active: false });
  if (!created.id) throw new Error('Failed to create Tradeit tab.');
  await waitForTabComplete(created.id);
  return created.id;
}

// ─── Public handler ──────────────────────────────────────────────────────────

async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

/**
 * Focus Tradeit (browsers throttle background tabs), run the cart automation,
 * then restore the caller's tab.
 */
export async function handleAddToCart(
  params: AddToCartParams,
): Promise<AddToCartResult> {
  // Capture before we steal focus for Tradeit.
  const [callerTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const callerTabId = callerTab?.id;

  let tradeitTabId: number | undefined;

  try {
    if (!params?.name || typeof params.name !== 'string') {
      return { success: false, error: 'Missing skin name.' };
    }
    if (typeof params.float !== 'number' || !Number.isFinite(params.float)) {
      return { success: false, error: 'Missing or invalid float.' };
    }

    tradeitTabId = await ensureTradeitTab();

    // Background tabs are throttled / "sleeping" — focus so Vue timers &
    // layout run, then give the page a brief settle.
    await focusTab(tradeitTabId);
    await new Promise((r) => setTimeout(r, 400));

    const results = await chrome.scripting.executeScript({
      target: { tabId: tradeitTabId },
      world: 'MAIN',
      func: addToCartInPage,
      args: [params.name, params.float],
    });

    const result = results?.[0]?.result as AddToCartResult | null;
    if (!result) {
      return { success: false, error: 'No response from Tradeit add-to-cart script.' };
    }
    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[CSTRADEUP] handleAddToCart error:', errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    if (
      callerTabId != null &&
      callerTabId !== tradeitTabId
    ) {
      try {
        await focusTab(callerTabId);
      } catch {
        /* caller tab may have been closed */
      }
    }
  }
}

// ─── Injected page function ──────────────────────────────────────────────────

/**
 * Runs inside tradeit.gg MAIN world.
 *
 * Workflow: find site search input → type name → set float range → wait for
 * results → unstack if needed → click matching float item / add-to-cart.
 */
async function addToCartInPage(
  name: string,
  floatValue: number,
): Promise<{ success: boolean; error?: string }> {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const waitFor = async <T>(
    fn: () => T | null | undefined | false,
    timeoutMs: number,
    label: string,
    intervalMs = 200,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const value = fn();
        if (value) return value as T;
      } catch {
        /* keep polling */
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };

  const setInputValue = async (input: HTMLInputElement, value: string) => {
    input.focus();
    await sleep(40);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await sleep(20);
    input.value = value;
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: value,
        inputType: 'insertText',
      }),
    );
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(20);
  };

  const clickElement = (el: Element) => {
    const target = el as HTMLElement;
    const rect = target.getBoundingClientRect();
    const opts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: Math.max(0, rect.left + Math.min(rect.width / 2, 20)),
      clientY: Math.max(0, rect.top + Math.min(rect.height / 2, 20)),
      button: 0,
    };
    target.dispatchEvent(new MouseEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
  };

  const clickItemCell = (cell: Element) => {
    clickElement(cell.firstElementChild ?? cell);
  };

  const formatFloat4 = (n: number) => (Math.round(n * 10000) / 10000).toFixed(4);

  const parseDisplayedFloat = (text: string): number | null => {
    const match = text.replace(/\u00a0/g, ' ').match(/(\d+\.\d{2,})/);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const floatsMatch = (a: number, b: number) => formatFloat4(a) === formatFloat4(b);

  /**
   * Tradeit puts `id="siteInventory-search"` on BOTH a wrapper div and the
   * real input. Prefer the input via aria / tag / descendant query.
   */
  const findSiteSearchInput = (): HTMLInputElement | null => {
    const byAria = document.querySelector(
      'input[aria-labelledby="siteInventory-search-label"]',
    );
    if (byAria instanceof HTMLInputElement) return byAria;

    const byTagId = document.querySelector('input#siteInventory-search');
    if (byTagId instanceof HTMLInputElement) return byTagId;

    const wrap = document.getElementById('siteInventory-search');
    const nested = wrap?.querySelector('input.v-field__input, input[type="text"]');
    if (nested instanceof HTMLInputElement) return nested;

    // Last resort: "Search inventory" that is NOT the user-inventory field.
    const candidates = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[placeholder="Search inventory"]',
      ),
    );
    const siteSide = candidates.find(
      (el) => el.id !== 'userInventory-search' &&
        el.getAttribute('aria-labelledby') !== 'userInventory-search-label',
    );
    return siteSide ?? null;
  };

  const getSiteInventoryRoot = (): Element | null => {
    return (
      document.getElementById('siteInventoryContainer') ||
      document.querySelector('#siteInventory-search')?.closest('.inventory, .inventory-wrapper, .v-col, section, main') ||
      document.querySelector('.grid-items')?.parentElement ||
      null
    );
  };

  const getResultCells = (): Element[] => {
    const root = getSiteInventoryRoot() ?? document;
    return Array.from(
      root.querySelectorAll('.item-cell.item.item-md.rounded.gray-700'),
    );
  };

  const isInventoryLoading = (): boolean => {
    const root = getSiteInventoryRoot();
    if (!root) return false;
    return !!root.querySelector(
      '.v-progress-circular, .v-progress-linear[aria-hidden="false"], [role="progressbar"]:not([aria-hidden="true"])',
    );
  };

  const diagnoseDom = (): string => {
    const wrap = document.getElementById('siteInventory-search');
    const inputs = document.querySelectorAll('input[placeholder="Search inventory"]').length;
    const cells = document.querySelectorAll('.item-cell').length;
    return `url=${location.href}; wrapTag=${wrap?.tagName ?? 'none'}; searchInputs=${inputs}; itemCells=${cells}`;
  };

  try {
    const rounded = Math.round(floatValue * 10000) / 10000;
    const from = Number((rounded - 0.0001).toFixed(4));
    const to = Number((rounded + 0.0001).toFixed(4));

    // ── 0. Site inventory search input ──────────────────────────────────────
    let searchInput: HTMLInputElement;
    try {
      searchInput = await waitFor(
        findSiteSearchInput,
        30_000,
        'site inventory search input',
      );
    } catch (e: any) {
      return {
        success: false,
        error: `${e?.message ?? e} (${diagnoseDom()})`,
      };
    }

    // ── 1. Search by skin name ──────────────────────────────────────────────
    await setInputValue(searchInput, name);
    searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }),
    );
    searchInput.dispatchEvent(
      new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }),
    );
    await sleep(700);

    // ── 2. Float From / To (near site search) ───────────────────────────────
    const findFloatInputs = (): { from: HTMLInputElement; to: HTMLInputElement } | null => {
      let node: HTMLElement | null = searchInput;
      for (let depth = 0; depth < 16 && node; depth++) {
        const fromEl = node.querySelector('input[type="number"][placeholder="From"]');
        const toEl = node.querySelector('input[type="number"][placeholder="To"]');
        if (fromEl instanceof HTMLInputElement && toEl instanceof HTMLInputElement) {
          return { from: fromEl, to: toEl };
        }
        node = node.parentElement;
      }
      return null;
    };

    if (!findFloatInputs()) {
      const floatToggle = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], .v-chip, .v-btn'),
      ).find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'float' || text.startsWith('float');
      });
      if (floatToggle) {
        clickElement(floatToggle);
        await sleep(400);
      }
    }

    const floatInputs = await waitFor(findFloatInputs, 15_000, 'float From/To inputs');
    await setInputValue(floatInputs.from, String(from));
    await setInputValue(floatInputs.to, String(to));

    // ── 3. Wait for filtered results ────────────────────────────────────────
    await sleep(800);
    await waitFor(
      () => (!isInventoryLoading() && getResultCells().length > 0 ? true : null),
      40_000,
      `inventory results for "${name}" (${from}–${to})`,
    );

    // ── 4. Unstack if exact float not visible ───────────────────────────────
    const findUnstackedMatch = (): Element | null => {
      for (const cell of getResultCells()) {
        const displayed = parseDisplayedFloat(
          cell.querySelector('.indicators')?.textContent ?? '',
        );
        if (displayed != null && floatsMatch(displayed, rounded)) return cell;
      }
      return null;
    };

    let match = findUnstackedMatch();

    if (!match) {
      const stacked =
        getResultCells().find(
          (cell) =>
            !!cell.querySelector('button[title="unstack"]') ||
            !!cell.querySelector('.count'),
        ) ?? getResultCells()[0];

      if (!stacked) {
        return {
          success: false,
          error: `No Tradeit results found for "${name}" in float range ${from}–${to}.`,
        };
      }

      clickItemCell(stacked);

      match = await waitFor(
        () => (isInventoryLoading() ? null : findUnstackedMatch()),
        40_000,
        `unstacked item with float ${formatFloat4(rounded)}`,
      );
    }

    // ── 5. Add to cart ──────────────────────────────────────────────────────
    const cartBtn = match.querySelector('button[title="add to cart"]');
    if (cartBtn instanceof HTMLElement) clickElement(cartBtn);
    else clickItemCell(match);

    await sleep(250);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: `${e?.message ?? String(e)} (${diagnoseDom()})` };
  }
}
