import { getProfileUrlPart } from "../lib/steam";
import { updateProfilePart } from "../lib/storage/reducer/steam";
import { ActionPostApi } from "../lib/comms/runtime";
import { InventoryResponse } from "../lib/app";

const CHANNEL = '__CSTRADEUP_INVENTORY__';  // must match intercept.ts

// ---------- listen for MAIN-world relay ----------

interface InterceptedInventoryMessage {
  channel: typeof CHANNEL;
  type: 'INTERCEPTED_INVENTORY';
  steamId: string;
  contextAppId: string;
  data: InventoryResponse;
}

function isInterceptedInventoryMsg(d: any): d is InterceptedInventoryMessage {
  return (
    d != null &&
    d.channel === CHANNEL &&
    d.type === 'INTERCEPTED_INVENTORY' &&
    typeof d.steamId === 'string' &&
    typeof d.contextAppId === 'string' &&
    d.data != null
  );
}

// Accumulate intercepted contexts so we can batch-post once idle
const pendingContexts: Record<string, InventoryResponse> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSteamId: string | null = null;

function scheduleBatchFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  // Wait 1.5 s after last intercept before posting — gives Steam time to
  // finish loading all inventory contexts (e.g. context 2 + context 16).
  flushTimer = setTimeout(flushPending, 1500);
}

async function flushPending(): Promise<void> {
  flushTimer = null;
  if (!pendingSteamId || Object.keys(pendingContexts).length === 0) return;

  const payload = { ...pendingContexts };
  const steamId = pendingSteamId;

  try {
    await ActionPostApi(steamId, payload);
  } catch (err) {
    console.error('[CSTRADEUP] Failed to relay inventory data:', err);
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only accept messages from the same page (same origin)
  if (event.source !== window) return;

  const msg = event.data;
  if (!isInterceptedInventoryMsg(msg)) return;

  pendingSteamId = msg.steamId;
  pendingContexts[msg.contextAppId] = msg.data;
  
  scheduleBatchFlush();
});

// ---------- save profile part on load ----------

(async function () {
  if (!isInventoryPage()) return;

  const profilePart = getProfileUrlPart();
  await updateProfilePart(profilePart);
})();

function isInventoryPage() {
  return location.pathname.includes('/inventory') || location.href.includes('/inventory/');
}
