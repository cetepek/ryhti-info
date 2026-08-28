// WFS client for the same GeoServer that backs the OGC API - Features endpoint
// in api.js. This exists for exactly one reason: it can return CSV, and the
// OGC API endpoint cannot.
//
// Why that matters. The "total gross floor area per municipality" figure is a
// SUM, and a sum estimated from a 30-permit sample of a heavily right-skewed
// distribution is hopeless — the estimate swings by 2-3x depending on whether
// the sample happens to catch one large building. The only real fix is to stop
// sampling and add up every row.
//
// GeoJSON makes that unaffordable at ~1730 bytes/row. The same rows as CSV cost
// ~215 bytes/row — 8x less — because CSV writes the column names once instead
// of per feature. That turns "add up every row" from ~17MB into ~2MB for a full
// year across the candidate municipalities, which is *less* traffic than the
// 34 GeoJSON sample requests it replaces.
//
// Measured against this host (2026-08):
//   * outputFormat=csv is advertised in GetCapabilities and works.
//   * Access-Control-Allow-Origin: * is present, so the browser can call it.
//   * startIndex paging returns no duplicates and no gaps, and row order is
//     deterministic across identical requests, so an unsorted sweep is safe.
//   * The server caps any single response at 10000 rows regardless of `count`,
//     so a sweep has to page.
//   * propertyName trims the column list but will not drop the FID, geometry,
//     or main_purpose columns. ~215 bytes/row is the floor, not a target to
//     tune further.

import { proxyEnabled } from "./api.js?v=2026-08-28a";

const DIRECT_WFS = "https://paikkatiedot.ymparisto.fi/geoserver/ryhti_permit/ows";
const TYPE_NAME = "ryhti_permit:open_permit_building";

/** The server's hard per-response row cap. Asking for more is silently capped. */
export const MAX_ROWS_PER_PAGE = 10000;

export function wfsBase() {
  // Same localhost-only gate as the OGC client — see proxyEnabled() in api.js.
  if (proxyEnabled()) return "/ows";
  if (window.RYHTI_WFS_BASE) return window.RYHTI_WFS_BASE;
  return DIRECT_WFS;
}

function wfsURL(params) {
  const url = new URL(wfsBase(), window.location.href);
  const search = {
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: TYPE_NAME,
    ...params,
  };
  for (const [key, value] of Object.entries(search)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchText(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "text/csv, application/xml" } });
  if (!response.ok) throw new Error(`WFS palautti virheen ${response.status}.`);
  return response.text();
}

/**
 * How many rows a filter matches, without transferring any of them.
 * resultType=hits returns a tiny XML envelope carrying numberMatched.
 */
export async function fetchHits(cqlFilter, signal) {
  const xml = await fetchText(wfsURL({ resultType: "hits", cql_filter: cqlFilter }), signal);
  const match = /numberMatched="(\d+)"/.exec(xml);
  if (!match) throw new Error("WFS-vastauksesta ei löytynyt numberMatched-arvoa.");
  return Number(match[1]);
}

/**
 * Minimal CSV reader. Sufficient for this server's output, which quotes fields
 * containing commas with `"` and escapes an embedded quote by doubling it.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Fetches one page of rows.
 *
 * Pages are independent and safe to fetch in parallel: row order for a given
 * filter is deterministic across identical requests on this server (verified),
 * so a fixed startIndex always addresses the same slice. Paging was checked for
 * duplicates and gaps across page boundaries and showed neither.
 *
 * @param {string} cqlFilter
 * @param {object} options
 * @param {string[]} [options.columns]   propertyName list (a hint; extra columns may arrive)
 * @param {number}   options.startIndex
 * @param {number}   [options.count]
 * @param {AbortSignal} [options.signal]
 */
export async function fetchPage(cqlFilter, { columns, startIndex, count = MAX_ROWS_PER_PAGE, signal } = {}) {
  const text = await fetchText(
    wfsURL({
      outputFormat: "csv",
      count,
      startIndex,
      propertyName: columns ? columns.join(",") : null,
      cql_filter: cqlFilter,
    }),
    signal
  );
  return parseCSV(text);
}

/** How many pages a sweep of `expected` rows will cost. */
export function pageCount(expected) {
  return Math.max(1, Math.ceil(expected / MAX_ROWS_PER_PAGE));
}
