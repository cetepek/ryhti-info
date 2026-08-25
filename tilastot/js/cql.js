// Ported from Ryhti/Core/Query/CQLFilterBuilder.swift.
// Every syntax shape here (equality, IN-list, range AND-chains) was verified
// live against paikkatiedot.ymparisto.fi by the iOS app's Phase 1 work — this
// is a faithful port of those verified shapes, not a fresh guess at CQL2.

import { purposeURI, actionTypeURI, statusURI } from "./codelists.js";

/**
 * Doubles every single quote — the standard SQL/CQL literal-escaping
 * convention. Applied to any value that could carry user input; every other
 * predicate value here comes from fixed code lists, never raw input.
 */
export function escapeCQLLiteral(raw) {
  return String(raw).replace(/'/g, "''");
}

/** decision_date is date-only ("yyyy-MM-dd"), unlike modified_timestamp_utc. */
export function isoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * An empty filter state must produce null, never an empty string — the API
 * client omits the `filter` parameter entirely in that case, which is what
 * "no filter, whole dataset" means to this server.
 *
 * @param {object} state
 * @param {string[]} [state.municipalities]  municipality_number codes, e.g. ["091"]
 * @param {{start: Date, end: Date}} [state.dateRange]  inclusive decision_date range
 * @param {string[]} [state.purposes]        BUILDING_PURPOSES codes, e.g. ["05"]
 * @param {string[]} [state.actionTypes]     CONSTRUCTION_ACTION_TYPES codes
 * @param {{min: number, max: number}} [state.floorAreaRange]
 * @param {{min: number, max: number}} [state.storeysRange]
 * @param {string} [state.status]            CONSTRUCTION_STATUSES code
 * @returns {string|null}
 */
export function buildCQLFilter(state = {}) {
  const predicates = [];

  const municipalities = state.municipalities ?? [];
  if (municipalities.length > 0) {
    // Sorted for a deterministic predicate string — which in turn keeps the
    // request URL (and any HTTP cache entry keyed on it) stable.
    const values = [...municipalities].sort().map((c) => `'${escapeCQLLiteral(c)}'`).join(",");
    predicates.push(`municipality_number IN (${values})`);
  }

  if (state.dateRange) {
    const lower = isoDate(state.dateRange.start);
    const upper = isoDate(state.dateRange.end);
    predicates.push(`decision_date >= '${lower}' AND decision_date <= '${upper}'`);
  }

  const actionTypes = state.actionTypes ?? [];
  if (actionTypes.length > 0) {
    const values = [...actionTypes].sort().map((c) => `'${actionTypeURI(c)}'`).join(",");
    predicates.push(`construction_action_type IN (${values})`);
  }

  const purposes = state.purposes ?? [];
  if (purposes.length > 0) {
    const values = [...purposes].sort().map((c) => `'${purposeURI(c)}'`).join(",");
    predicates.push(`main_purpose IN (${values})`);
  }

  if (state.floorAreaRange) {
    predicates.push(`floor_area >= ${state.floorAreaRange.min} AND floor_area <= ${state.floorAreaRange.max}`);
  }

  if (state.storeysRange) {
    predicates.push(`number_of_storeys >= ${state.storeysRange.min} AND number_of_storeys <= ${state.storeysRange.max}`);
  }

  if (state.status) {
    predicates.push(`status_of_construction_action = '${statusURI(state.status)}'`);
  }

  if (predicates.length === 0) return null;
  return predicates.join(" AND ");
}

/** Inclusive UTC calendar-year range, matching YearFilter.dateRange(for:). */
export function yearRange(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, 11, 31)),
  };
}
