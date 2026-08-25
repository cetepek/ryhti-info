// Browser-side client for the Ryhti open building-permit OGC API - Features
// endpoint. Mirrors Ryhti/Core/Networking/RyhtiAPIClient.swift.

const DIRECT_BASE =
  "https://paikkatiedot.ymparisto.fi/geoserver/ryhti_permit/ogc/features/v1/collections";

/**
 * Whether to route requests through the bundled server.js proxy.
 *
 * The proxy is a LOCAL DEVELOPMENT tool: it only exists because the upstream
 * host's CORS posture was unknown when this was written. It has since been
 * confirmed to send `Access-Control-Allow-Origin: *` on both endpoints, so the
 * direct path is the normal one.
 *
 * `?proxy=1` is therefore honoured only when the page is served from localhost.
 * On a static host (GitHub Pages) there is nothing behind `/api` or `/ows`, so
 * obeying the flag there would turn a working page into a wholesale failure —
 * and a stray copied URL carrying the flag is exactly how that would happen.
 */
export function proxyEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("proxy") !== "1") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function apiBase() {
  if (proxyEnabled()) return "/api/collections";
  if (window.RYHTI_API_BASE) return window.RYHTI_API_BASE;
  return DIRECT_BASE;
}

export class APIError extends Error {
  constructor(message, { status = null, cause = null, isNetwork = false } = {}) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.cause = cause;
    this.isNetwork = isNetwork;
  }
}

const PERMITS = "open_permit_building";

async function fetchJSON(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/geo+json, application/json" } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    // This used to name CORS as a possible cause, because the upstream host's
    // CORS posture was unknown. It is now confirmed to allow browser calls, so
    // a failure here is a connection problem — saying "or maybe CORS" would
    // just be noise pointing the reader at the wrong thing.
    throw new APIError("Yhteys rajapintaan epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.", {
      cause: error,
      isNetwork: true,
    });
  }
  if (!response.ok) {
    throw new APIError(`Rajapinta palautti virheen ${response.status}.`, { status: response.status });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new APIError("Rajapinnan vastausta ei voitu lukea.", { cause: error });
  }
}

function itemsURL(collection, params) {
  const url = new URL(`${apiBase()}/${collection}/items`, window.location.href);
  url.searchParams.set("f", "json");
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Exact match count for a filter. `limit=0` asks for no rows at all — the count
 * arrives in the FeatureCollection envelope's numberMatched, so this costs one
 * small response rather than paging the matches.
 */
export async function fetchCount(filter, signal) {
  const data = await fetchJSON(itemsURL(PERMITS, { limit: 0, filter }), signal);
  return data.numberMatched ?? 0;
}

/**
 * A bounded sample of matching permits, used for the median-based size and
 * storey statistics. Never call this without an explicit limit: omitting it
 * makes the server default to 10,000 rows (~17MB).
 */
export async function fetchSample(filter, limit, signal) {
  const data = await fetchJSON(itemsURL(PERMITS, { limit, filter }), signal);
  return (data.features ?? []).map(toPermit);
}

/** Maps one GeoJSON feature to the narrow shape the statistics actually use. */
function toPermit(feature) {
  const p = feature?.properties ?? {};
  return {
    id: feature?.id ?? null,
    municipalityNumber: p.municipality_number ?? null,
    mainPurpose: p.main_purpose ?? null,
    constructionActionType: p.construction_action_type ?? null,
    decisionDate: p.decision_date ?? null,
    floorArea: numberOrNull(p.floor_area),
    numberOfStoreys: numberOrNull(p.number_of_storeys),
    grossFloorArea: numberOrNull(p.gross_floor_area),
    statusOfConstructionAction: p.status_of_construction_action ?? null,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
