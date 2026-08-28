import {
  loadStatistics,
  loadMonthlyComparison,
  loadRollingMonths,
  selectableYears,
  completeMonthCount,
  roundToTwoSignificantFigures,
} from "./stats.js?v=2026-08-28a";
import {
  renderColumnChart,
  renderBarRows,
  renderTable,
  renderDonutChart,
  renderLineChart,
  renderDivergingColumnChart,
  renderGroupedColumnChart,
  renderMonthSeriesChart,
  formatNumber,
  formatPercentDelta,
} from "./charts.js?v=2026-08-28a";
import { yearRange } from "./cql.js?v=2026-08-28a";
import { BUILDING_PURPOSES } from "./codelists.js?v=2026-08-28a";
import { MUNICIPALITY_NAMES } from "./municipalities.js?v=2026-08-28a";

const el = (id) => document.getElementById(id);

const ui = {
  year: el("year"),
  municipality: el("municipality"),
  purpose: el("purpose"),
  reload: el("reload"),
  status: el("status"),
  statusText: el("status-text"),
  progressFill: el("progress-fill"),
  error: el("error"),
  totalCount: el("total-count"),
  typicalArea: el("typical-area"),
  typicalAreaNote: el("typical-area-note"),
  typicalStoreys: el("typical-storeys"),
  typicalStoreysNote: el("typical-storeys-note"),
  chartYears: el("chart-years"),
  chartYoy: el("chart-yoy"),
  tableYears: el("table-years"),
  chartMedianArea: el("chart-median-area"),
  tableMedianArea: el("table-median-area"),
  chartPurposeSplit: el("chart-purpose-split"),
  purposeNote: el("purpose-note"),
  chartPurposes: el("chart-purposes"),
  chartActionTypes: el("chart-action-types"),
  tableActionTypes: el("table-action-types"),
  monthYearA: el("month-year-a"),
  monthYearB: el("month-year-b"),
  monthDetails: el("month-details"),
  monthStatus: el("month-status"),
  monthNote: el("month-note"),
  chartMonths: el("chart-months"),
  tableMonths: el("table-months"),
  rollingDetails: el("rolling-details"),
  rollingStatus: el("rolling-status"),
  chartRolling: el("chart-rolling"),
  tableRolling: el("table-rolling"),
  chartMuniCount: el("chart-muni-count"),
  chartMuniArea: el("chart-muni-area"),
  muniAreaNote: el("muni-area-note"),
  results: el("results"),
  tablePurposes: el("table-purposes"),
  tableMuniCount: el("table-muni-count"),
  tableMuniArea: el("table-muni-area"),
  scopeChips: el("scope-chips"),
};

/** The most recent successful result, kept so a resize can re-render the SVG. */
let lastResult = null;
/** Aborts an in-flight load when the filters change again before it finishes. */
let inFlight = null;
/**
 * Which filter state the rendered month comparison belongs to, and its own
 * in-flight request. The section is loaded on demand, so it can be showing a
 * slice the rest of the page has already moved on from — this is what tells
 * those two apart, rather than assuming they are in step.
 */
let monthKey = null;
let monthInFlight = null;
/** The rendered comparison, kept so a resize can re-lay-out its SVG. */
let lastMonths = null;
/** Same, for the rolling window, which has its own independent load. */
let rollingKey = null;
let rollingInFlight = null;
let lastRolling = null;
const MONTH_NAMES = [
  "tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu",
  "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu",
];
/** Axis labels: the chart has twelve slots and no room for full month names. */
const MONTH_NAMES_SHORT = [
  "tammi", "helmi", "maalis", "huhti", "touko", "kesä",
  "heinä", "elo", "syys", "loka", "marras", "joulu",
];

/** Identifies a filter slice, so a cached month render can be matched to it. */
function stateKey(state, extra = null) {
  return JSON.stringify({
    year: state.dateRange ? state.dateRange.start.getUTCFullYear() : null,
    municipalities: state.municipalities,
    purposes: state.purposes,
    extra,
  });
}

/**
 * Fills both year pickers, once.
 *
 * The card owns its own two years rather than following the page's Vuosi
 * filter. With an explicit picker for each side, a third year arriving from the
 * page filter would just be a third opinion about the same question — and it
 * would make "Kaikki vuodet" mean something the card cannot draw. The pickers
 * seed from the page's year on first load and are independent after that.
 */
function populateMonthYears(seedYear) {
  if (!ui.monthYearA || !ui.monthYearB) return;
  const years = [...selectableYears()].reverse();
  for (const select of [ui.monthYearA, ui.monthYearB]) {
    select.innerHTML = "";
    for (const year of years) select.appendChild(new Option(String(year), String(year)));
  }
  ui.monthYearA.value = String(seedYear);
  ui.monthYearB.value = String(seedYear - 1);
  syncMonthYearOptions();
}

/**
 * Keeps the two pickers from naming the same year.
 *
 * A year plotted against itself is two identical series and a row of zero
 * changes, so the option is disabled on the opposite control rather than left
 * selectable and then rejected — the constraint is visible before the click,
 * not explained after it.
 */
function syncMonthYearOptions() {
  if (!ui.monthYearA || !ui.monthYearB) return;
  for (const [select, other] of [[ui.monthYearA, ui.monthYearB], [ui.monthYearB, ui.monthYearA]]) {
    for (const option of select.options) option.disabled = option.value === other.value;
  }
}

function populateFilters() {
  const years = selectableYears();
  ui.year.appendChild(new Option("Kaikki vuodet", ""));
  for (const year of [...years].reverse()) ui.year.appendChild(new Option(String(year), String(year)));
  // Default to the most recent full year rather than the current one, which is
  // still partial and would read as a collapse in the year-over-year chart.
  ui.year.value = String(years[years.length - 2]);

  ui.municipality.appendChild(new Option("Koko Suomi", ""));
  const sorted = Object.entries(MUNICIPALITY_NAMES).sort((a, b) => a[1].localeCompare(b[1], "fi"));
  for (const [code, name] of sorted) ui.municipality.appendChild(new Option(name, code));

  ui.purpose.appendChild(new Option("Kaikki käyttötarkoitukset", ""));
  for (const p of BUILDING_PURPOSES) ui.purpose.appendChild(new Option(p.shortName, p.code));
}

function currentState() {
  const year = ui.year.value ? Number(ui.year.value) : null;
  const municipality = ui.municipality.value || null;
  const purpose = ui.purpose.value || null;
  return {
    dateRange: year === null ? null : yearRange(year),
    municipalities: municipality ? [municipality] : [],
    purposes: purpose ? [purpose] : [],
  };
}

function setBusy(isBusy) {
  ui.status.hidden = !isBusy;

  // The filters deliberately stay enabled while a load runs. A full load takes
  // several seconds, and refresh() already aborts the in-flight request when
  // the filters change again — so locking the controls would only make the page
  // feel stuck without preventing anything.
  //
  // Instead the results hold their previous render at reduced opacity: no
  // blanking to "–", no skeleton, no layout jump while the new slice arrives.
  ui.results.classList.toggle("is-refreshing", isBusy);
  ui.results.setAttribute("aria-busy", isBusy ? "true" : "false");

  if (isBusy) {
    ui.progressFill.style.width = "0%";
    ui.statusText.textContent = "Haetaan…";
  }
}

function showError(error) {
  ui.error.hidden = false;
  ui.error.innerHTML = "";

  const message = document.createElement("p");
  message.textContent = error?.message ?? "Tietojen haku epäonnistui.";
  ui.error.appendChild(message);
}

async function refresh() {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  ui.error.hidden = true;
  setBusy(true);

  const state = currentState();
  try {
    const result = await loadStatistics(state, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (controller.signal.aborted) return;
        ui.progressFill.style.width = `${Math.round((done / total) * 100)}%`;
        ui.statusText.textContent = `${done} / ${total}`;
      },
    });
    if (controller.signal.aborted) return;
    lastResult = result;
    render(result, state);
    refreshMonthSection(state);
    refreshRollingSection(state);
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) return;
    showError(error);
  } finally {
    if (inFlight === controller) {
      inFlight = null;
      setBusy(false);
    }
  }
}

/** "n = 24" style sample-size note, or an explicit "no data" when the sample was empty. */
function sampleNote(sampleSize) {
  return sampleSize > 0 ? `Mediaani, otos n = ${formatNumber(sampleSize)}` : "Ei kerrosalatietoja otoksessa";
}

/**
 * The active slice, as one chip per dimension.
 *
 * Every figure on the page is scoped by these three filters, and the page is
 * long enough that the filter row scrolls out of sight — so the scope travels
 * with the hero figure rather than living only in the controls.
 */
function renderScopeChips(state) {
  if (!ui.scopeChips) return;
  ui.scopeChips.innerHTML = "";
  const chips = [
    state.dateRange ? String(state.dateRange.start.getUTCFullYear()) : "Kaikki vuodet",
    state.municipalities.length ? MUNICIPALITY_NAMES[state.municipalities[0]] : "Koko Suomi",
    state.purposes.length
      ? BUILDING_PURPOSES.find((p) => p.code === state.purposes[0])?.shortName
      : "Kaikki käyttötarkoitukset",
  ];
  for (const text of chips.filter(Boolean)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = text;
    ui.scopeChips.appendChild(chip);
  }
}

/**
 * Ring slot for a building purpose, fixed by its CODE and never by its rank.
 *
 * This is the whole reason the mapping lives here rather than being computed
 * from the sorted breakdown: change the municipality filter and Pientalo may
 * stop being the biggest purpose, but it must keep its color. A ring that
 * repaints itself when the ordering shifts is unreadable across filters.
 *
 * The order of BUILDING_PURPOSES is also the ring order, and that order is
 * load-bearing: slots 1-7 (blue, orange, aqua, yellow, magenta, violet, green)
 * were validated so every adjacent pair — including green wrapping back to blue
 * where the ring closes — clears the colorblind and normal-vision separation
 * gates in both light and dark mode. Violet beside blue fails in dark, which is
 * why green and not violet closes the ring. Reordering this list re-opens that
 * question.
 */
const purposeSlot = (code) => BUILDING_PURPOSES.findIndex((p) => p.code === code) + 1;

/** Share of a whole, as a Finnish percentage. One decimal below 10 %, none above. */
function shareLabel(value, total) {
  if (!total || !Number.isFinite(value)) return "–";
  const pct = (value / total) * 100;
  const decimals = pct < 10 ? 1 : 0;
  return `${pct.toLocaleString("fi-FI", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}

/**
 * Year-over-year change in permit counts.
 *
 * Derived from the year buckets that are already loaded, so this costs no extra
 * request, and from the exact hit counts rather than any sample — these deltas
 * are as accurate as the counts they come from.
 *
 * Three cases yield null rather than a number, because in each of them a
 * percentage would be an artifact rather than a measurement:
 *
 *  * The first year in the window has no predecessor inside it.
 *  * A zero baseline has no meaningful percentage change — reporting it would
 *    mean printing an infinite rise.
 *  * The CURRENT year is still accumulating. Comparing a part-year against a
 *    full one manufactures a collapse of exactly the size of the remaining
 *    months, and on this page it would land on the tallest bar in the chart.
 *    The year filter already defaults away from the current year for the same
 *    reason; the twelve-year charts cannot, so the delta is withheld instead.
 */
function yearOverYear(buckets) {
  const currentYear = new Date().getUTCFullYear();
  return buckets.map((bucket, index) => {
    const previous = index === 0 ? null : buckets[index - 1];
    const comparable = previous !== null && previous.count > 0 && bucket.year !== currentYear;
    return {
      year: bucket.year,
      count: bucket.count,
      delta: comparable ? (bucket.count - previous.count) / previous.count : null,
    };
  });
}

function render(result, state) {
  ui.totalCount.textContent = result.totalCount === null ? "–" : formatNumber(result.totalCount);
  renderScopeChips(state);

  ui.typicalArea.textContent =
    result.typicalGrossFloorArea === null ? "–" : `${formatNumber(result.typicalGrossFloorArea)} m²`;
  ui.typicalAreaNote.textContent = sampleNote(result.typicalGrossFloorAreaSampleSize);

  ui.typicalStoreys.textContent =
    result.typicalStoreys === null ? "–" : formatNumber(result.typicalStoreys);
  ui.typicalStoreysNote.textContent =
    result.typicalStoreysSampleSize > 0
      ? `Mediaani, otos n = ${formatNumber(result.typicalStoreysSampleSize)}`
      : "Ei kerroslukutietoja otoksessa";

  renderColumnChart(ui.chartYears, result.yearBuckets);
  const deltas = yearOverYear(result.yearBuckets);
  renderDivergingColumnChart(ui.chartYoy, deltas);
  renderYearTable(result.yearBuckets, deltas);

  renderLineChart(
    ui.chartMedianArea,
    result.yearBuckets.map((b) => ({ year: b.year, value: b.medianGrossFloorArea }))
  );
  renderTable(
    ui.tableMedianArea,
    ["Vuosi", "Mediaanikerrosala", "Otoskoko"],
    result.yearBuckets.map((b) => [
      String(b.year),
      b.medianGrossFloorArea === null ? "–" : `${formatNumber(b.medianGrossFloorArea)} m²`,
      // The sample size travels with every sample-derived figure, so a thin year
      // is visible instead of hiding behind a confident-looking median.
      `n = ${formatNumber(b.grossFloorAreas.length)}`,
    ])
  );

  // The seven purposes partition the permits that carry a purpose code, so THEY
  // are the whole the shares are taken from — not the headline total, which also
  // counts permits with no purpose recorded. Dividing by the headline total would
  // quietly make every share too small.
  const classifiedTotal = result.purposeBreakdown.reduce((sum, p) => sum + p.count, 0);

  // Ring order = code order, so a slice keeps its color and its position under
  // every filter. The bar rows below stay sorted by count, which is the ranking
  // read; the ring is the shape read.
  // The breakdown deliberately ignores the purpose filter — each purpose is
  // counted with its own code, so the card always shows all seven. That is the
  // right behaviour (it shows where the filtered type sits inside the whole),
  // but it means this card's total is LARGER than the headline figure whenever a
  // purpose is selected. Emphasis plus an explicit note is what keeps that from
  // reading as a contradiction.
  const activePurpose = state.purposes[0] ?? null;

  renderDonutChart(
    ui.chartPurposeSplit,
    BUILDING_PURPOSES.map((purpose) => ({
      label: purpose.shortName,
      value: result.purposeBreakdown.find((p) => p.code === purpose.code)?.count ?? 0,
      slot: purposeSlot(purpose.code),
    })),
    {
      // Both captions sit directly under the count and have to read as one
      // phrase with it, which is the partitive singular a numeral governs.
      // The filtered one is also kept short: the hole is only ~105px wide at
      // the caption's baseline, and it just has to stop this number being read
      // as the filtered headline figure — the note above carries the rest.
      centerLabel: activePurpose ? "lupaa kaikkiaan" : "luokiteltua lupaa",
      unitLabel: "lupaa",
      legendValues: false,
      emphasisSlot: activePurpose ? purposeSlot(activePurpose) : null,
    }
  );

  // Short name on the chart (the official name wraps to three lines and pushes
  // the bars into a narrow column); the full official name in the table.
  renderBarRows(
    ui.chartPurposes,
    result.purposeBreakdown.map((p) => ({
      label: p.shortName ?? p.name,
      value: p.count,
      shareLabel: shareLabel(p.count, classifiedTotal),
    }))
  );
  renderTable(
    ui.tablePurposes,
    ["Käyttötarkoitus", "Lupia", "Osuus"],
    result.purposeBreakdown.map((p) => [
      p.name,
      formatNumber(p.count),
      shareLabel(p.count, classifiedTotal),
    ])
  );
  renderPurposeNote(result.totalCount, classifiedTotal, activePurpose);

  // Shares here are shares of the headline total, not of a classified subset:
  // every permit in this collection carries an action type, so there is no
  // unclassified remainder to exclude. Zero rows are dropped — five of the nine
  // codes describe demolition and landscape work that a building-permit feed
  // never contains, and empty rows would imply the filter excluded them.
  const actionTypes = result.actionTypeBreakdown.filter((a) => a.count > 0);
  renderBarRows(
    ui.chartActionTypes,
    actionTypes.map((a) => ({
      label: a.name,
      value: a.count,
      shareLabel: shareLabel(a.count, result.totalCount),
    }))
  );
  renderTable(
    ui.tableActionTypes,
    ["Toimenpide", "Lupia", "Osuus"],
    actionTypes.map((a) => [a.name, formatNumber(a.count), shareLabel(a.count, result.totalCount)])
  );

  renderBarRows(
    ui.chartMuniCount,
    result.topMunicipalitiesByCount.map((m) => ({ label: m.name, value: m.count }))
  );
  renderTable(
    ui.tableMuniCount,
    ["Kunta", "Lupia"],
    result.topMunicipalitiesByCount.map((m) => [m.name, formatNumber(m.count)])
  );

  renderBarRows(
    ui.chartMuniArea,
    result.topMunicipalitiesByFloorArea.map((m) => ({
      label: m.name,
      value: m.estimatedTotalGrossFloorArea,
      // An exact total is a real sum of every matching permit, so it is shown in
      // full. A sampled estimate is rounded to 2 significant figures: it does
      // not deserve more precision, and showing more would imply accuracy the
      // method cannot support.
      valueLabel: m.exact
        ? `${formatNumber(Math.round(m.estimatedTotalGrossFloorArea))} m²`
        : `~${formatNumber(roundToTwoSignificantFigures(m.estimatedTotalGrossFloorArea))} m²`,
      note: m.exact
        ? `tarkka summa · kerrosala ilmoitettu ${formatNumber(m.sampleSize)}/${formatNumber(m.count)} luvassa`
        : `arvio, otos n = ${formatNumber(m.sampleSize)}`,
    })),
    { hue: "orange" }
  );

  renderTable(
    ui.tableMuniArea,
    ["Kunta", "Kokonaiskerrosala", "Lupia", "Tarkkuus"],
    result.topMunicipalitiesByFloorArea.map((m) => [
      m.name,
      m.exact
        ? `${formatNumber(Math.round(m.estimatedTotalGrossFloorArea))} m²`
        : `~${formatNumber(roundToTwoSignificantFigures(m.estimatedTotalGrossFloorArea))} m²`,
      formatNumber(m.count),
      m.exact ? `tarkka (${formatNumber(m.sampleSize)} kerrosalatietoa)` : `arvio (otos n = ${formatNumber(m.sampleSize)})`,
    ])
  );

  // The caption has to track which method actually ran, or an exact figure gets
  // read as an estimate (and, worse, an estimate gets read as exact).
  if (result.municipalityDataIncomplete) {
    ui.muniAreaNote.textContent =
      "Kuntakohtaisia lukuja ei voitu laskea, koska osa hausta epäonnistui. " +
      "Puutteellisia summia ei näytetä, koska ne jäisivät todellista pienemmiksi. Yritä uudelleen.";
    return;
  }

  ui.muniAreaNote.textContent = result.municipalityFiguresAreExact
    ? "Kaikkien rajaukseen osuvien lupien kerrosalat on laskettu yhteen. " +
      "Rivillä näkyy, kuinka monessa luvassa kerrosala on ilmoitettu."
    : "Arvio: otoksen keskimääräinen kerrosala × lupien määrä. Rajaus on niin laaja, ettei " +
      "tarkkaa summaa lasketa, joten luku voi poiketa todellisesta jopa kaksinkertaisesti " +
      "kumpaan suuntaan tahansa.";
}

/**
 * Keeps the month section in step with the filters.
 *
 * The rendered comparison is invalidated on every load, but it is only re-fetched
 * when the section is actually open — that is the whole point of loading it on
 * demand. A closed section costs nothing until someone opens it.
 */
/**
 * Neither of these cards follows the year filter, so neither is invalidated by
 * it. The cached key is deliberately NOT cleared here: loadMonths compares it
 * and no-ops when the slice it already holds is still the right one, which is
 * what stops a year change from refiring 24 requests for the same twelve
 * months. A municipality or purpose change does alter the key, and refetches.
 */
function refreshMonthSection(state) {
  if (!ui.monthDetails?.open) return;
  loadMonths(state);
}

/**
 * The rolling window is independent of the year filter by design, so it is
 * invalidated only by the filters it actually respects.
 */
function refreshRollingSection(state) {
  if (!ui.rollingDetails?.open) return;
  loadRolling(state);
}

function setRollingStatus(text) {
  if (!ui.rollingStatus) return;
  ui.rollingStatus.hidden = text === null;
  ui.rollingStatus.textContent = text ?? "";
}

async function loadRolling(state) {
  // The year filter is deliberately excluded from the key: the window does not
  // follow it, so changing the year alone must not refetch the same 13 months.
  const key = stateKey({ ...state, dateRange: null });
  if (rollingKey === key) return;

  rollingInFlight?.abort();
  const controller = new AbortController();
  rollingInFlight = controller;

  setRollingStatus("Haetaan…");
  try {
    const result = await loadRollingMonths(state, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (controller.signal.aborted) return;
        setRollingStatus(`${done} / ${total}`);
      },
    });
    if (controller.signal.aborted) return;
    rollingKey = key;
    renderRolling(result);
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) return;
    setRollingStatus(error?.message ?? "Kuukausisarjan haku epäonnistui.");
  } finally {
    if (rollingInFlight === controller) rollingInFlight = null;
  }
}

function renderRolling(result) {
  lastRolling = result;
  setRollingStatus(null);
  const rows = result.months.map((m) => ({
    ...m,
    label: MONTH_NAMES_SHORT[m.month - 1],
  }));

  renderMonthSeriesChart(ui.chartRolling, rows);
  renderTable(
    ui.tableRolling,
    ["Kuukausi", "Lupia"],
    rows.map((m) => [
      `${MONTH_NAMES[m.month - 1]} ${m.year}${m.partial ? " (kesken)" : ""}`,
      formatNumber(m.count),
    ])
  );
}

function setMonthStatus(text) {
  if (!ui.monthStatus) return;
  ui.monthStatus.hidden = text === null;
  ui.monthStatus.textContent = text ?? "";
}

async function loadMonths(state) {
  const year = Number(ui.monthYearA.value);
  const compareYear = Number(ui.monthYearB.value);
  // The card's own years replace the page's, so the page year is not part of
  // the identity of what is rendered here.
  const key = stateKey({ ...state, dateRange: null }, `${year}:${compareYear}`);
  if (monthKey === key) return;

  monthInFlight?.abort();
  const controller = new AbortController();
  monthInFlight = controller;

  setMonthStatus("Haetaan…");
  try {
    const result = await loadMonthlyComparison(state, year, compareYear, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (controller.signal.aborted) return;
        setMonthStatus(`${done} / ${total}`);
      },
    });
    if (controller.signal.aborted) return;
    monthKey = key;
    renderMonths(result);
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) return;
    setMonthStatus(error?.message ?? "Kuukausivertailun haku epäonnistui.");
  } finally {
    if (monthInFlight === controller) monthInFlight = null;
  }
}

function renderMonths(result) {
  lastMonths = result;
  const { year, compareYear, months } = result;

  if (months.length === 0) {
    // Name the year that actually ran out of finished months — with a free
    // choice of comparison year it can be either side of the pair.
    const short = completeMonthCount(year) <= completeMonthCount(compareYear) ? year : compareYear;
    setMonthStatus(
      `Vuodelta ${short} ei ole vielä yhtään päättynyttä kuukautta, joten vertailtavaa ei ole.`
    );
    ui.chartMonths.innerHTML = "";
    ui.tableMonths.innerHTML = "";
    return;
  }

  setMonthStatus(null);
  renderGroupedColumnChart(
    ui.chartMonths,
    months.map((m) => ({
      label: MONTH_NAMES_SHORT[m.month - 1],
      current: m.current,
      previous: m.previous,
    })),
    { currentLabel: String(year), previousLabel: String(compareYear) }
  );

  renderTable(
    ui.tableMonths,
    ["Kuukausi", String(year), String(compareYear), "Muutos"],
    months.map((m) => [
      MONTH_NAMES[m.month - 1],
      formatNumber(m.current),
      formatNumber(m.previous),
      monthDeltaLabel(m.current, m.previous),
    ])
  );
}

/**
 * Percent change for one month, or a dash where it cannot be computed.
 *
 * A zero previous month has no percentage — growth from nothing is not 100 %,
 * it is undefined — so it prints as a dash rather than an invented figure.
 */
function monthDeltaLabel(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "–";
  return formatPercentDelta((current - previous) / previous);
}

function renderYearTable(buckets, deltas) {
  renderTable(
    ui.tableYears,
    ["Vuosi", "Lupia", "Muutos", "Mediaanikerrosala"],
    buckets.map((b, index) => [
      String(b.year),
      formatNumber(b.count),
      deltas[index].delta === null ? "–" : formatPercentDelta(deltas[index].delta),
      b.medianGrossFloorArea === null ? "–" : `${formatNumber(b.medianGrossFloorArea)} m²`,
    ])
  );
}

/**
 * Says what the donut's whole actually is.
 *
 * Two different things can make this card's figures disagree with the headline
 * total, and both have to be said out loud or the page looks broken:
 *
 *  * A permit with no purpose code is counted in the headline total and in no
 *    slice, so the seven purposes can add up to less than it.
 *  * With a purpose selected, the headline total is that ONE purpose while this
 *    card still shows all seven — so the card's total is the larger number. The
 *    unclassified arithmetic is meaningless in that case (it subtracts a whole
 *    from a part), which is why it is only computed with no purpose selected.
 */
function renderPurposeNote(totalCount, classifiedTotal, activePurpose) {
  if (!ui.purposeNote) return;
  const base = "Lupien määrä rakennuksen pääkäyttötarkoituksen mukaan.";

  if (activePurpose) {
    const name = BUILDING_PURPOSES.find((p) => p.code === activePurpose)?.shortName ?? "valittu tyyppi";
    // Finnish quotation marks are ”…” on both sides, not the English “…”.
    ui.purposeNote.textContent =
      `${base} Tämä kortti näyttää aina kaikki seitsemän käyttötarkoitusta, myös nyt, kun ` +
      `rajaus on ”${name}” — jotta näet, kuinka suuri sen osuus on koko aineistosta. ` +
      "Siksi kortin luvut ovat suurempia kuin sivun yläreunan lupamäärä, joka koskee vain " +
      "rajattua tyyppiä. Valittu käyttötarkoitus on korostettu kuviossa.";
    return;
  }

  const unclassified = totalCount === null ? 0 : totalCount - classifiedTotal;
  ui.purposeNote.textContent =
    unclassified > 0
      ? `${base} Osuudet lasketaan luokitelluista luvista: ${formatNumber(unclassified)} luvalta ` +
        "pääkäyttötarkoitus puuttuu, eivätkä ne ole mukana jakaumassa."
      : base;
}

// The time-axis SVG charts are laid out in real pixels, so they must be
// re-rendered when the container width changes; the HTML bar rows reflow on
// their own, and the donut scales with its viewBox.
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (!lastResult) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderColumnChart(ui.chartYears, lastResult.yearBuckets);
    renderDivergingColumnChart(ui.chartYoy, yearOverYear(lastResult.yearBuckets));
    renderLineChart(
      ui.chartMedianArea,
      lastResult.yearBuckets.map((b) => ({ year: b.year, value: b.medianGrossFloorArea }))
    );
    if (lastMonths) renderMonths(lastMonths);
    if (lastRolling) renderRolling(lastRolling);
  }, 150);
});

populateFilters();
populateMonthYears(Number(ui.year.value) || selectableYears()[selectableYears().length - 2]);
ui.reload.addEventListener("click", refresh);
// Opening the section is what pays for it. Closing it does not discard what was
// already fetched, so re-opening the same slice is free.
ui.monthDetails?.addEventListener("toggle", () => {
  // Read the controls, not the last rendered state: opening the section while a
  // dashboard load is still in flight is normal, and the controls already say
  // which slice the reader wants.
  if (ui.monthDetails.open) loadMonths(currentState());
});

ui.rollingDetails?.addEventListener("toggle", () => {
  if (ui.rollingDetails.open) loadRolling(currentState());
});

// Either year reloads only this card; the rest of the page is scoped by the main
// filters and is unaffected by them.
for (const select of [ui.monthYearA, ui.monthYearB]) {
  select?.addEventListener("change", () => {
    syncMonthYearOptions();
    if (ui.monthDetails?.open) loadMonths(currentState());
  });
}
for (const control of [ui.year, ui.municipality, ui.purpose]) {
  control.addEventListener("change", refresh);
}
refresh();
