
export function timeDifference(current: number, previous: number) {

  if (previous == 0) {
    return 'never'
  }

  if (current == previous) {
    return "just now"
  }

  var msPerMinute = 60 * 1000;
  var msPerHour = msPerMinute * 60;
  var msPerDay = msPerHour * 24;
  var msPerMonth = msPerDay * 30;
  var msPerYear = msPerDay * 365;

  var elapsed = current - previous;

  if (elapsed < msPerMinute) {
        return Math.round(elapsed/1000) + ' seconds ago';   
  }

  else if (elapsed < msPerHour) {
        return Math.round(elapsed/msPerMinute) + ' minutes ago';   
  }

  else if (elapsed < msPerDay ) {
        return Math.round(elapsed/msPerHour ) + ' hours ago';   
  }

  else if (elapsed < msPerMonth) {
      return 'approximately ' + Math.round(elapsed/msPerDay) + ' days ago';   
  }

  else if (elapsed < msPerYear) {
      return 'approximately ' + Math.round(elapsed/msPerMonth) + ' months ago';   
  }

  else {
      return 'approximately ' + Math.round(elapsed/msPerYear ) + ' years ago';   
  }

}

export function getCookie(cname: string) {
  const name = cname + "=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
  }
  return null;
}

export async function isRunningOffscreen() {
  const existingContexts = await chrome.runtime.getContexts({});

  console.log('existingContexts', existingContexts);

  const offscreenDocument = existingContexts.find(
    (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
  );

  return offscreenDocument !== undefined;
}