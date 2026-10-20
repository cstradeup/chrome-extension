/**
 * Extracts the oldest inventory-history event timestamp from a Steam
 * AJAX `html` fragment.
 *
 * Steam's pagination `cursor.time` identifies a crawl boundary — on the
 * final (terminal) page it is the *request* cursor, i.e. roughly the
 * newest event on that page — so it is unsuitable as a "Crawled to"
 * display value.  Event dates live in the HTML itself:
 *
 *   <div class="tradehistoryrow">
 *     <div class="tradehistory_date">
 *       14 Apr, 2015
 *       <div class="tradehistory_timestamp">3:21pm</div>
 *     </div>
 *     …
 *   </div>
 *
 * Locale cookies force English + UTC before fetches, so we parse the
 * English short-month format Steam emits under those settings.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Matches "14 Apr, 2015" / "14 Apr 2015" (comma optional). */
const DATE_RE = /(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})/;

/** Matches "3:21pm" / "3:21 pm" / "12:05am". */
const TIME_RE = /(\d{1,2}):(\d{2})\s*(am|pm)/i;

/**
 * Parses a single English Steam history date (+ optional time) into a
 * Unix timestamp in seconds.  Returns `null` when the date cannot be
 * parsed.  Missing time defaults to 00:00:00 UTC — acceptable because
 * the UI surfaces calendar dates, not clock times.
 */
export function parseSteamHistoryDate(
  dateText: string,
  timeText?: string | null,
): number | null {
  const dateMatch = dateText.match(DATE_RE);
  if (!dateMatch) return null;

  const day = parseInt(dateMatch[1], 10);
  const month = MONTHS[dateMatch[2].toLowerCase()];
  const year = parseInt(dateMatch[3], 10);
  if (month === undefined || day < 1 || day > 31 || year < 2000) return null;

  let hours = 0;
  let minutes = 0;

  if (timeText) {
    const timeMatch = timeText.match(TIME_RE);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3].toLowerCase();

      if (meridiem === 'am' && hours === 12) hours = 0;
      else if (meridiem === 'pm' && hours < 12) hours += 12;
    }
  }

  const ms = Date.UTC(year, month, day, hours, minutes, 0);
  if (Number.isNaN(ms)) return null;

  return Math.floor(ms / 1000);
}

/**
 * Returns the oldest event Unix timestamp (seconds) found in Steam
 * inventory-history HTML, or `null` when no parseable events exist.
 *
 * Prefers DOMParser (available in the offscreen document).  Falls back
 * to a regex scan if the DOM is unavailable or yields nothing — useful
 * for resilience against minor markup drift.
 */
export function extractOldestEventUnix(html: string | null | undefined): number | null {
  if (!html || typeof html !== 'string' || html.length === 0) return null;

  const fromDom = extractViaDom(html);
  if (fromDom !== null) return fromDom;

  return extractViaRegex(html);
}

function extractViaDom(html: string): number | null {
  if (typeof DOMParser === 'undefined') return null;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('.tradehistoryrow'));
    if (!rows.length) return null;

    let oldest: number | null = null;

    for (const row of rows) {
      const dateEl = row.querySelector('.tradehistory_date');
      if (!dateEl) continue;

      // Date lives in a leading text node; the timestamp is a child div.
      const dateText = firstTextNode(dateEl) || dateEl.textContent || '';
      const timeText = row.querySelector('.tradehistory_timestamp')?.textContent ?? null;
      const unix = parseSteamHistoryDate(dateText, timeText);
      if (unix === null) continue;

      if (oldest === null || unix < oldest) oldest = unix;
    }

    return oldest;
  } catch {
    return null;
  }
}

/** First non-empty text-node content under `el` (skips element children). */
function firstTextNode(el: Element): string {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Regex fallback — finds each `tradehistory_date` region and reads the
 * date + nested `tradehistory_timestamp` from it.  Less precise than a
 * DOM walk but survives when DOMParser is missing.
 *
 * Steam nests the timestamp *inside* the date div:
 *   <div class="tradehistory_date">14 Apr, 2015
 *     <div class="tradehistory_timestamp">3:21pm</div>
 *   </div>
 * so we scan a bounded window after each date-class match rather than
 * stopping at the first `</div>` (which would be the timestamp close).
 */
function extractViaRegex(html: string): number | null {
  const startRe = /class=["']tradehistory_date["'][^>]*>/gi;
  let oldest: number | null = null;
  let start: RegExpExecArray | null;

  while ((start = startRe.exec(html)) !== null) {
    // Window large enough for date text + nested timestamp markup.
    const window = html.slice(start.index, start.index + 240);
    const dateMatch = window.match(DATE_RE);
    if (!dateMatch) continue;

    const timeMatch = window.match(TIME_RE);
    const unix = parseSteamHistoryDate(
      dateMatch[0],
      timeMatch ? timeMatch[0] : null,
    );
    if (unix === null) continue;

    if (oldest === null || unix < oldest) oldest = unix;
  }

  return oldest;
}

/**
 * Monotonic merge: keep the older of two optional Unix timestamps.
 * Used when folding a newly scraped page into persisted crawl state.
 */
export function olderUnix(
  a: number | null | undefined,
  b: number | null | undefined,
): number | undefined {
  const av = typeof a === 'number' && a > 0 ? a : undefined;
  const bv = typeof b === 'number' && b > 0 ? b : undefined;
  if (av === undefined) return bv;
  if (bv === undefined) return av;
  return Math.min(av, bv);
}
