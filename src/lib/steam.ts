import { APP_ID } from "./consts";

export function findSteamID() {
  try {
    // 1) If the URL contains /profiles/<steamid>
    const m = location.pathname.match(/\/profiles\/([0-9]{15,20})/);
    if (m) return m[1];

    // 2) Try og:url meta tag (often normalized to /profiles/)
    const og = document.querySelector('meta[property="og:url"]')?.textContent

    if (og) {
      const mm = og.match(/\/profiles\/([0-9]{15,20})/);
      if (mm) return mm[1];
    }

    // 3) Try to find g_steamID or other JS vars in the page html
    const html = document.documentElement.innerHTML;
    let mm2 = html.match(/g_steamID = "([0-9]{15,20})"/);
    if (mm2) return mm2[1];
    mm2 = html.match(/"steamid":"([0-9]{15,20})"/);
    if (mm2) return mm2[1];

    // 4) Try to find the inventory link with '/profiles/<id>/inventory'
    const anchors = Array.from(document.querySelectorAll('a[href*="/inventory"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      const mm = href && href.match(/\/profiles\/([0-9]{15,20})/);
      if (mm) return mm[1];
    }
  } catch (err) {
    console.warn('findSteamID error', err);
  }
  return null;
}

export async function findSteamTab(url:string = `https://steamcommunity.com/my/inventory/#${APP_ID}`): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});


  let steamTab = tabs.find(tab => 
    tab.url && 
    tab.url.includes(url)
  );
  
  if (steamTab && steamTab.id) {
    // Found exact inventory tab, just activate and reload
    await chrome.tabs.update(steamTab.id, { active: true });
    // await chrome.tabs.reload(steamTab.id);
    
    // Wait for reload to complete
    return new Promise((resolve) => {
      const checkTab = setInterval(async () => {

        if (!steamTab || !steamTab.id) return;

        const tab = await chrome.tabs.get(steamTab.id);
        if (tab.status === 'complete') {
          clearInterval(checkTab);
          resolve(tab);
        }
      }, 100);
    });
  }

  
} 

export async function findOrCreateSteamTab(url:string = `https://steamcommunity.com/my/inventory/#${APP_ID}`): Promise<chrome.tabs.Tab> {
  // First, try to find an existing Steam inventory tab for this game
  const foundTab = await findSteamTab(url)
    if(foundTab) {
        return foundTab
    }

  const tabs = await chrome.tabs.query({});

  // Check for any Steam Community tab
  const steamTab = tabs.find(tab => tab.url && tab.url.includes('steamcommunity.com'));
  
  if (steamTab && steamTab.id) {
    // Navigate existing Steam tab to inventory
    await chrome.tabs.update(steamTab.id, { 
      active: true,
      url: url
    });
    
    // Wait for navigation to complete
    return new Promise((resolve) => {
      const checkTab = setInterval(async () => {

        if (!steamTab || !steamTab.id) return;

        const tab = await chrome.tabs.get(steamTab.id);
        if (tab.status === 'complete') {
          clearInterval(checkTab);
          resolve(tab);
        }
      }, 100);
    });
  }
  
  // No Steam tab found, create a new one
  const newTab = await chrome.tabs.create({
    url: url,
    active: true
  });
  
  // Wait for the tab to load
  return new Promise((resolve) => {
    const checkTab = setInterval(async () => {

      if(!newTab || !newTab.id) return;

      const tab = await chrome.tabs.get(newTab.id);
      if (tab.status === 'complete') {
        clearInterval(checkTab);
        resolve(tab);
      }
    }, 100);
  });
}

export function getProfileUrlPart(): string | null {
  try {
    const parts = location.pathname.split("/").filter(Boolean);

    // Expected: ["id", "xxx", ...] or ["profiles", "123", ...]
    if ((parts[0] === "id" || parts[0] === "profiles") && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }

    return null; // Not a valid profile URL
  } catch {
    return null; // Invalid URL format
  }
}
