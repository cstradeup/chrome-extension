
const loadInventory = async (...params: any[]) => {
    console.log("loadInventory one day...")
}

chrome.storage.local.get({
      lastUpdated: 0
}, ({lastUpdated}) => {
    // @ts-ignore
    window.cstradeup.lastUpdatedDate = lastUpdated;
});

// @ts-ignore
window.cstradeup = {
  loadInventory,
  isInstalled: true,
  lastUpdatedDate: undefined,
};
