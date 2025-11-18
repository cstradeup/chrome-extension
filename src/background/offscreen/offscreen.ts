import {
  initThreads,
  notarizeSteamRequestAndSendToBackend,
} from "./notarize/notarize";

async function loadInventoryHistory() {
  await fetch(
    "https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=start"
  );
  try {
    await notarizeSteamRequestAndSendToBackend();
  } catch (e) {
    await fetch(
      "https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=error&msg=" +
        encodeURIComponent((e as Error).message)
    );
  }
}

chrome.runtime.onMessage.addListener(async (message) => {
  try {
    await fetch(
      "https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=addListener"
    );
    await initThreads();
    await fetch(
      "https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=initThreads"
    );
    if (message.target === "offscreen") {
      switch (message.type) {
        case "load-inventory-history":
          await loadInventoryHistory();
          break;
      }
    }
  } catch (e) {
    await fetch(
      "https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=listener-error&msg=" +
        encodeURIComponent((e as Error).message)
    );
  }
});
