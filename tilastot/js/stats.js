// Ported from Ryhti/Features/Statistics/StatisticsViewModel.swift.
// The methodology decisions here are load-bearing and were established against
// real data by the iOS app — they are not stylistic choices to "clean up":
//
//  * gross_floor_area, never floor_area, for size stats. floor_area is populated
//    for only ~1% of most building purposes; gross_floor_area is populated
//    84-99% across every purpose except office/production/utility (~20%).
//  * Median for "typical size", mean for a TOTAL. These are different questions
//    and they need different estimators. gross_floor_area is heavily right-
//    skewed, so the median is the honest answer to "how big is a typical
//    permit" — one large office block should not move it. But a sum is an
//    aggregation, not a central tendency: sum ~= mean x count, and median x
//    count understates the true total by roughly 5x on this data (measured
//    against full municipality populations for 2023 and 2025). Do not
//    "restore consistency" by pushing the median back onto the total.
//  * For an "all years" figure, pool every year's RAW sampled values and take a
//    single median. An average-of-medians is a fragile double-reduction.
//  * Sample sizes travel with every sample-derived number so a thin sample is
//    visible rather than hidden behind a confident-looking figure.

import { fetchCount, fetchSample } from "./api.js";
import { fetchHits, fetchPage, pageCount, MAX_ROWS_PER_PAGE } from "./wfs.js";
import { runLimited } from "./batcher.js";
import { buildCQLFilter, yearRange, monthRange } from "./cql.js";
import { BUILDING_PURPOSES, CONSTRUCTION_ACTION_TYPES } from "./codelists.js";
import { municipalityName } from "./municipalities.js";

/** How many permits each bucket samples for its median size/storey figures. */
const SAMPLE_LIMIT = 30;

/**
 * Above this many matching rows, the municipality section stops sweeping every
 * row for exact totals and falls back to the sampled estimate.
 *
 * Sized from measurement, not taste: a full year across the candidate
 * municipalities is ~10k rows (2025) to ~20k rows (2021, the peak), so every
 * single-year view sweeps exactly. "Kaikki vuodet" matches ~985k rows across
 * the same municipalities — ~210MB — which is why the fallback still exists.
 * At ~215 bytes/row, this budget caps a sweep at roughly 5MB.
 */
const EXACT_SWEEP_ROW_BUDGET = 25000;

/**
 * Finland's largest municipalities by population. A capped candidate list, NOT a
 * full 309-way sweep — sweeping every municipality would cost 618 requests per
 * load. Anything built from this list must be labelled in the UI as a ranking
 * among these candidates, never as a national rank.
 */
export const CANDIDATE_MUNICIPALITY_CODES = [
  "049", "091", "092", "106", "109", "167", "179", "186", "202", "205",
  "245", "257", "272", "285", "286", "297", "398", "405", "491", "543",
  "564", "609", "638", "680", "684", "694", "698", "734", "740", "743",
  "837", "853", "858", "905",
];

/** The selectable window: the current year and the 11 before it. */
export function selectableYears() {
  const current = new Date().getUTCFullYear();
  return Array.from({ length: 12 }, (_, i) => current - 11 + i);
}

export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Rounds to 2 significant figures — these estimates do not deserve more. */
export function roundToTwoSignificantFigures(value) {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, magnitude - 1);
  return Math.round(value / factor) * factor;
}

/**
 * Loads the whole dashboard for one filter state.
 *
 * Every query is issued through a single shared concurrency pool, so the
 * server's per-IP cap is respected across the whole load rather than per
 * section — sections cannot stack their individual caps on top of each other.
 *
 * @param {object} state          filter state (see cql.js buildCQLFilter)
 * @param {object} [options]
 * @param {(done:number,total:number)=>void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function loadStatistics(state, options = {}) {
  const { onProgress, signal } = options;
  const years = selectableYears();
  const baseFilter = buildCQLFilter(state);

  // One flat operation list — total, per-purpose, per-year, per-municipality.
  const operations = [];

  operations.push(async () => ({ kind: "total", count: await fetchCount(baseFilter, signal) }));

  for (const purpose of BUILDING_PURPOSES) {
    operations.push(async () => {
      const filter = buildCQLFilter({ ...state, purposes: [purpose.code] });
      return { kind: "purpose", purpose, count: await fetchCount(filter, signal) };
    });
  }

  // Every code is queried, including the five that are empty in this collection
  // today (demolition, townscape and landscape actions do not appear in a
  // BUILDING permit feed). Rendering drops the zero rows, so if the upstream
  // feed ever starts carrying them the card picks them up on its own rather
  // than silently hiding a category behind a hard-coded list of four.
  for (const actionType of CONSTRUCTION_ACTION_TYPES) {
    operations.push(async () => {
      const filter = buildCQLFilter({ ...state, actionTypes: [actionType.code] });
      return { kind: "actionType", actionType, count: await fetchCount(filter, signal) };
    });
  }

  for (const year of years) {
    operations.push(async () => {
      const filter = buildCQLFilter({ ...state, dateRange: yearRange(year) });
      // count-then-sample sequentially inside one operation, so a year costs one
      // pool slot rather than two.
      const count = await fetchCount(filter, signal);
      const sample = await fetchSample(filter, SAMPLE_LIMIT, signal);
      return {
        kind: "year",
        year,
        count,
        // No zero-sentinel to strip here: gross_floor_area is never exactly 0
        // when present (unlike floor_area, where 0 means "missing").
        grossFloorAreas: sample.map((p) => p.grossFloorArea).filter((v) => v !== null),
        storeys: sample.map((p) => p.numberOfStoreys).filter((v) => v !== null),
      };
    });
  }

  // The municipality strategy is decided BEFORE the operation list is built, so
  // the progress total is known up front and does not jump mid-load.
  const plan = await planMunicipalities(state, signal);

  if (plan.mode === "sweep") {
    // One sweep covers every candidate municipality at once: the exact per-
    // municipality count AND the exact floor-area total both fall out of the
    // same rows. That replaces 68 requests (34 counts + 34 samples) with one
    // hit count plus a handful of CSV pages.
    for (let page = 0; page < plan.pages; page++) {
      const startIndex = page * MAX_ROWS_PER_PAGE;
      operations.push(async () => {
        const rows = await fetchPage(plan.filter, {
          columns: ["municipality_number", "gross_floor_area"],
          startIndex,
          signal,
        });
        return { kind: "municipalitySweep", rows };
      });
    }
  } else {
    for (const code of CANDIDATE_MUNICIPALITY_CODES) {
      operations.push(async () => {
        const name = municipalityName(code);
        if (!name) return null;
        const filter = buildCQLFilter({ ...state, municipalities: [code] });
        const count = await fetchCount(filter, signal);
        const sample = await fetchSample(filter, SAMPLE_LIMIT, signal);
        const areas = sample.map((p) => p.grossFloorArea).filter((v) => v !== null);
        const meanArea = mean(areas);
        return {
          kind: "municipality",
          code,
          name,
          count,
          // Sample-based estimate of a SUM: (mean gross floor area among sampled
          // permits that had one) x total count. The mean is correct here and the
          // median is not — see the estimator note at the top of this file.
          estimatedTotalGrossFloorArea: meanArea === null ? null : meanArea * count,
          sampleSize: areas.length,
          exact: false,
        };
      });
    }
  }

  const { results, errors, failureCount } = await runLimited(operations, { maxConcurrency: 8, onProgress, signal });

  // A dashboard of dashes is indistinguishable from "this filter matches
  // nothing", so a wholesale failure has to be raised rather than rendered.
  // The likeliest cause by far is the API refusing browser calls (CORS) or
  // being unreachable — both of which fail every request identically.
  if (failureCount === operations.length) {
    throw errors.find(Boolean) ?? new Error("Tietojen haku epäonnistui.");
  }

  return assemble(results, state, years, plan);
}

/**
 * Decides how the municipality section will be built, and at what cost.
 *
 * Costs one `resultType=hits` request. If that request fails for any reason —
 * the WFS endpoint being unreachable, an unexpected response — the plan falls
 * back to sampling rather than failing the whole dashboard. The sampled path is
 * less accurate but it is not broken, and it only depends on the OGC API
 * endpoint that the rest of the page already uses.
 */
async function planMunicipalities(state, signal) {
  const filter = buildCQLFilter({ ...state, municipalities: CANDIDATE_MUNICIPALITY_CODES });
  try {
    const expected = await fetchHits(filter, signal);
    if (expected <= EXACT_SWEEP_ROW_BUDGET) {
      return { mode: "sweep", filter, expected, pages: pageCount(expected) };
    }
    return { mode: "sample", reason: "budget" };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return { mode: "sample", reason: "unavailable" };
  }
}

/** Folds swept CSV rows into per-municipality exact counts and exact totals. */
function aggregateSweep(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const code = row.municipality_number;
    if (!code) continue;
    const name = municipalityName(code);
    if (!name) continue;
    let entry = byCode.get(code);
    if (!entry) {
      entry = { kind: "municipality", code, name, count: 0, total: 0, withArea: 0, exact: true };
      byCode.set(code, entry);
    }
    entry.count++;
    // An empty cell means the permit has no gross_floor_area recorded, which is
    // not the same as zero — it contributes to the count but not the total.
    const raw = row.gross_floor_area;
    if (raw !== "" && raw !== undefined && raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        entry.total += value;
        entry.withArea++;
      }
    }
  }
  return [...byCode.values()].map((e) => ({
    kind: "municipality",
    code: e.code,
    name: e.name,
    count: e.count,
    estimatedTotalGrossFloorArea: e.withArea > 0 ? e.total : null,
    sampleSize: e.withArea,
    exact: true,
  }));
}

function assemble(results, state, years, plan) {
  const rows = results.filter(Boolean);
  const totalRow = rows.find((r) => r.kind === "total");

  const purposeBreakdown = rows
    .filter((r) => r.kind === "purpose")
    .map((r) => ({ code: r.purpose.code, name: r.purpose.name, shortName: r.purpose.shortName, count: r.count }))
    .sort((a, b) => b.count - a.count);

  // Unlike the purposes, these partition the scope exactly: every permit in this
  // collection carries a construction_action_type, so the counts sum to the
  // headline total and the shares are shares of the whole, not of a classified
  // subset.
  const actionTypeBreakdown = rows
    .filter((r) => r.kind === "actionType")
    .map((r) => ({ code: r.actionType.code, name: r.actionType.name, count: r.count }))
    .sort((a, b) => b.count - a.count);

  const yearBuckets = rows
    .filter((r) => r.kind === "year")
    .sort((a, b) => a.year - b.year)
    .map((r) => ({
      year: r.year,
      count: r.count,
      grossFloorAreas: r.grossFloorAreas,
      storeys: r.storeys,
      medianGrossFloorArea: median(r.grossFloorAreas),
      medianStoreys: median(r.storeys),
    }));

  // When exactly one year is in scope, the size tiles should describe THAT year
  // rather than a pooled multi-year figure. The matching bucket's sample is
  // already fetched, so this costs no extra query.
  const selectedYear = matchingYear(state.dateRange, years);
  const matching = selectedYear === null ? null : yearBuckets.find((b) => b.year === selectedYear);

  const pooledAreas = matching ? matching.grossFloorAreas : yearBuckets.flatMap((b) => b.grossFloorAreas);
  const pooledStoreys = matching ? matching.storeys : yearBuckets.flatMap((b) => b.storeys);

  // A sweep is only usable if EVERY page arrived. runLimited turns a failed
  // operation into a null slot and carries on, so a dropped page would
  // otherwise yield a short sum presented as a exact total — a silently wrong
  // number, which is worse than no number. Both municipality sections come from
  // these rows, so an incomplete sweep suppresses both rather than showing
  // undercounts.
  const sweepPages = rows.filter((r) => r.kind === "municipalitySweep");
  const sweptRows = sweepPages.flatMap((p) => p.rows);
  const sweepComplete =
    plan.mode === "sweep" &&
    sweepPages.length === plan.pages &&
    sweptRows.length === plan.expected;

  const municipalities = plan.mode === "sweep"
    ? (sweepComplete ? aggregateSweep(sweptRows) : [])
    : rows.filter((r) => r.kind === "municipality");

  return {
    totalCount: totalRow ? totalRow.count : null,
    typicalGrossFloorArea: median(pooledAreas),
    typicalGrossFloorAreaSampleSize: pooledAreas.length,
    typicalStoreys: median(pooledStoreys),
    typicalStoreysSampleSize: pooledStoreys.length,
    yearBuckets,
    purposeBreakdown,
    actionTypeBreakdown,
    municipalityFiguresAreExact: sweepComplete,
    municipalityDataIncomplete: plan.mode === "sweep" && !sweepComplete,
    topMunicipalitiesByCount: [...municipalities].sort((a, b) => b.count - a.count).slice(0, 10),
    topMunicipalitiesByFloorArea: municipalities
      .filter((m) => m.estimatedTotalGrossFloorArea !== null)
      .sort((a, b) => b.estimatedTotalGrossFloorArea - a.estimatedTotalGrossFloorArea)
      .slice(0, 10),
    selectedYear,
  };
}

/** How many of a year's months are finished. Past: 12. Future: 0. */
export function completeMonthCount(year, now = new Date()) {
  const currentYear = now.getUTCFullYear();
  if (year < currentYear) return 12;
  if (year > currentYear) return 0;
  // getUTCMonth() is 0-based, so it is already "the count of finished months".
  return now.getUTCMonth();
}

/**
 * The months that are finished in BOTH years, and therefore comparable.
 *
 * A running month is dropped outright rather than drawn short. Two thirds of an
 * August against a whole previous August is not a decline, but that is exactly
 * what it looks like on a bar chart. A partial bar cannot be fixed with a
 * caption, because the shape is read before the caption is.
 *
 * Both years have to be checked, not just the earlier one: with an arbitrary
 * comparison year the running year can be on either side of the pair, and
 * comparing a finished August against an unfinished one is the same lie in
 * whichever direction it points.
 */
export function comparableMonths(year, compareYear, now = new Date()) {
  const limit = Math.min(completeMonthCount(year, now), completeMonthCount(compareYear, now));
  return Array.from({ length: limit }, (_, i) => i + 1);
}

/**
 * The running month and the twelve before it, oldest first.
 *
 * A rolling window rather than a calendar year: it always ends at today, so it
 * answers "how are things now" without waiting for a year boundary. The final
 * entry is flagged partial — the caller must render it as different in kind,
 * not merely shorter.
 */
export function rollingMonths(now = new Date(), count = 13) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return Array.from({ length: count }, (_, i) => {
    const offset = count - 1 - i;
    // Date.UTC normalises a negative month index back into the previous year.
    const d = new Date(Date.UTC(year, month - 1 - offset, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, partial: offset === 0 };
  });
}

/**
 * Month-by-month counts for `year` against the same months a year earlier.
 *
 * Loaded on demand rather than with the rest of the dashboard: it costs up to 24
 * requests, which would roughly double the page's default load for a section
 * most readers never open. The other filters still apply — this compares the
 * same slice of the data the rest of the page is showing, one level finer.
 *
 * Counts are exact: they come from the API's match counter, never a sample.
 *
 * @param {object} state        filter state; its dateRange is replaced per month
 * @param {number} year         the primary year
 * @param {number} compareYear  the year it is measured against
 */
export async function loadMonthlyComparison(state, year, compareYear, options = {}) {
  const { onProgress, signal } = options;
  const months = comparableMonths(year, compareYear);
  if (months.length === 0) return { year, compareYear, months: [] };

  const operations = [];
  for (const month of months) {
    for (const subject of [year, compareYear]) {
      operations.push(async () => {
        const filter = buildCQLFilter({ ...state, dateRange: monthRange(subject, month) });
        return { month, subject, count: await fetchCount(filter, signal) };
      });
    }
  }

  const { results, errors, failureCount } = await runLimited(operations, {
    maxConcurrency: 8,
    onProgress,
    signal,
  });

  if (failureCount === operations.length) {
    throw errors.find(Boolean) ?? new Error("Kuukausivertailun haku epäonnistui.");
  }

  // A dropped request leaves null rather than zero. Zero and "we never found
  // out" are different readings of a bar, and only one of them is honest.
  const byMonth = new Map(months.map((month) => ({ month, current: null, previous: null })).map((m) => [m.month, m]));
  for (const row of results.filter(Boolean)) {
    const entry = byMonth.get(row.month);
    if (!entry) continue;
    if (row.subject === year) entry.current = row.count;
    else entry.previous = row.count;
  }

  return { year, compareYear, months: [...byMonth.values()] };
}

/**
 * Counts for the running month and the twelve before it.
 *
 * Deliberately ignores the page's year filter — a rolling window that snapped to
 * a calendar year would not be rolling. Every other filter still applies, so it
 * is the same slice of the data as the rest of the page, cut on a moving window
 * instead of a fixed one.
 */
export async function loadRollingMonths(state, options = {}) {
  const { onProgress, signal } = options;
  const window = rollingMonths();

  const operations = window.map(({ year, month }) => async () => {
    const filter = buildCQLFilter({ ...state, dateRange: monthRange(year, month) });
    return { year, month, count: await fetchCount(filter, signal) };
  });

  const { results, errors, failureCount } = await runLimited(operations, {
    maxConcurrency: 8,
    onProgress,
    signal,
  });

  if (failureCount === operations.length) {
    throw errors.find(Boolean) ?? new Error("Kuukausisarjan haku epäonnistui.");
  }

  const counts = new Map(results.filter(Boolean).map((r) => [`${r.year}-${r.month}`, r.count]));
  return {
    months: window.map((m) => ({
      ...m,
      // null, not zero: a dropped request and a genuinely empty month are
      // different readings of a bar.
      count: counts.has(`${m.year}-${m.month}`) ? counts.get(`${m.year}-${m.month}`) : null,
    })),
  };
}

/** Which calendar year, if any, a date range exactly represents. */
function matchingYear(dateRange, years) {
  if (!dateRange) return null;
  for (const year of years) {
    const range = yearRange(year);
    if (range.start.getTime() === dateRange.start.getTime() && range.end.getTime() === dateRange.end.getTime()) {
      return year;
    }
  }
  return null;
}
