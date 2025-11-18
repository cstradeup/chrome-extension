import { InventoryResponse } from "../lib/app";
import { ActionPostApi } from "../lib/comms/runtime";
import { APP_ID } from "../lib/consts";
import { findSteamID } from "../lib/steam";


const INVENTORY_PATH_SEGMENT = '/inventory/';
const LANGUAGE_QUERY = '?l=english';
const JSON_SEGMENT = '/json/';
const windowProxy:any = window

function getContextIdFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr, location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

function isSteamInventoryUrl(urlStr: string): boolean {
  return (
    urlStr.includes(INVENTORY_PATH_SEGMENT) &&
    urlStr.includes(LANGUAGE_QUERY) &&
    !urlStr.includes(JSON_SEGMENT)
  );
}

function setIntercept(): void {
  // ---------- Fetch interceptor ----------
  const originalFetch = windowProxy.fetch.bind(windowProxy);

  windowProxy.fetch = async function (input: URL | RequestInfo, init?: RequestInit): Promise<Response> {
    let urlStr: string;
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof Request) {
      urlStr = input.url;
    } else {
      urlStr = String(input);
    }

    try {
      if (isSteamInventoryUrl(urlStr)) {
        const contextId = getContextIdFromUrl(urlStr);
        
        if (contextId != null) {
          const contextAppId = `${APP_ID}:${contextId}`
          // Ensure typed access to the store
          const store: Record<string, InventoryResponse> = windowProxy.__steamInventoryData ?? (windowProxy.__steamInventoryData = {});
          if (!store[contextAppId]) {
            const response = await originalFetch(input, init);
            try {
              const cloned = response.clone();
              cloned.json()
                .then((data: InventoryResponse) => {
                  if (data && data.success) {
                    // store by contextId
                    const s: Record<string, InventoryResponse> = windowProxy.__steamInventoryData ?? (windowProxy.__steamInventoryData = {});
                    s[contextAppId] = data;
                    console.log('[Steam Crawler] Inventory data intercepted (fetch):', data.total_inventory_count ?? 'unknown', 'items');
                  }
                })
                .catch((err: any) => {
                  console.debug('[Steam Crawler] Failed to parse inventory response (fetch):', err);
                });
            } catch (err) {
              console.debug('[Steam Crawler] Error handling intercepted fetch response:', err);
            }
            return response;
          }
        }
      }
    } catch (err) {
      console.debug('[Steam Crawler] fetch interceptor error:', err);
    }

    return originalFetch(input, init);
  };

  // ---------- XHR interceptor ----------
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  function patchedOpen(this: XMLHttpRequest, method: string, url?: string | URL | null, ...rest: any[]) {
    try {
      if (typeof url === 'string') {
        (this as any)._intercepted_url = url;
      } else if (url instanceof URL) {
        (this as any)._intercepted_url = url.toString();
      } else {
        (this as any)._intercepted_url = undefined;
      }
    } catch {
      // ignore
    }
    return originalXHROpen.apply(this, arguments as any);
  }

  function patchedSend(this: XMLHttpRequest, ..._args: any[]) {
    try {
      const urlOnInstance = (this as any)._intercepted_url;
      if (typeof urlOnInstance === 'string' && isSteamInventoryUrl(urlOnInstance)) {
        const contextId = getContextIdFromUrl(urlOnInstance);
        if (contextId != null) {
          const contextAppId = `${APP_ID}:${contextId}`
          const store: Record<string, InventoryResponse> = windowProxy.__steamInventoryData ?? (windowProxy.__steamInventoryData = {});
          if (!store[contextAppId]) {
            this.addEventListener('load', function () {
              try {
                const text = (this as XMLHttpRequest).responseText;
                if (!text) return;
                const parsed = JSON.parse(text) as InventoryResponse;
                if (parsed && parsed.success) {
                  const s: Record<string, InventoryResponse> = windowProxy.__steamInventoryData ?? (windowProxy.__steamInventoryData = {});
                  s[contextAppId] = parsed;
                  console.log('[Steam Crawler] Inventory data intercepted (XHR):', parsed.total_inventory_count ?? 'unknown', 'items');
                }
              } catch (err) {
                console.debug('[Steam Crawler] Failed to parse XHR inventory response:', err);
              }
            }, { once: true });
          }
        }
      }
    } catch (err) {
      console.debug('[Steam Crawler] XHR send interceptor error:', err);
    }

    return originalXHRSend.apply(this, arguments as any);
  }

  XMLHttpRequest.prototype.open = patchedOpen as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = patchedSend as typeof XMLHttpRequest.prototype.send;

  console.debug('[Steam Crawler] Interceptors installed');
}

// Auto-install
setIntercept();


setTimeout(() => {
  if(windowProxy.__steamInventoryData){
    const steamId = findSteamID()

    if (steamId){
      console.log("Calling the content_script from interceptor to user: ", steamId, " inventory contexts: ", windowProxy.__steamInventoryData)
      
      ActionPostApi(steamId, windowProxy.__steamInventoryData)
    }
  }
}, 2000)