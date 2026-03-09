export interface SteamAccountAge {
  memberSince: Date
  ageYears: number
}

export async function getAccountAge(
  steamId: string,
  token: string
): Promise<SteamAccountAge | null> {
  const url = `https://steamcommunity.com/profiles/${steamId}/badges/1`

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "text/html",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "steamLoginSecure=" + encodeURIComponent(token),
    },
    
  })

  if (!res.ok) {
    return null
  }

  const html = await res.text()

  const doc = new DOMParser().parseFromString(html, "text/html")

  // This selector is stable and specific to badge pages
  const memberText =
    doc.querySelector(".badge_description")?.textContent ||
    doc.querySelector(".badge_info_description")?.textContent

  if (!memberText) {
    return null
  }

  const match = memberText.match(/Member since (.+)/i)
  if (!match) {
    return null
  }

  const memberSince = new Date(match[1])
  if (isNaN(memberSince.getTime())) {
    return null
  }

  const ageYears = Math.floor(
    (Date.now() - memberSince.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  )

  return { memberSince, ageYears }
}
