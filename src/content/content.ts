import {  getProfileUrlPart } from "../lib/steam";
import {  updateProfilePart } from "../lib/storage/reducer/steam";

// save profile part on load
(async function() {
  if(!isInventoryPage()) {
    return;
  }

  const profilePart = getProfileUrlPart()
  await updateProfilePart(profilePart);

})();


function isInventoryPage() {
  return location.pathname.includes('/inventory') || location.href.includes('/inventory/');
}
