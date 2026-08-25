import { loadStatistics, selectableYears, roundToTwoSignificantFigures } from "./stats.js";
import { renderColumnChart, renderBarRows, renderTable, formatNumber } from "./charts.js";
import { yearRange } from "./cql.js";
import { BUILDING_PURPOSES } from "./codelists.js";
import { MUNICIPALITY_NAMES } from "./municipalities.js";
import { APIError } from "./api.js";

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
  tableYears: el("table-years"),
  chartPurposes: el("chart-purposes"),
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
  const isNetwork = error instanceof APIError && error.isNetwork;
  ui.error.innerHTML = "";

  const message = document.createElement("p");
  message.textContent = error?.message ?? "Tietojen haku epäonnistui.";
  ui.error.appendChild(message);

  // The proxy hint is a local-development affordance and only works there, so
  // it is shown only there. On a static host it would point the reader at a
  // URL that cannot exist.
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
  if (isNetwork && isLocal) {
    const hint = document.createElement("p");
    hint.append("Paikallisesti voit myös kokeilla välityspalvelinta: ");
    const code = document.createElement("code");
    code.textContent = "node web/server.js";
    hint.append(code, " ja ");
    const url = document.createElement("code");
    url.textContent = "http://localhost:8000/?proxy=1";
    hint.append(url, ".");
    ui.error.appendChild(hint);
  }
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
  renderYearTable(result.yearBuckets);

  // Short name on the chart (the official name wraps to three lines and pushes
  // the bars into a narrow column); the full official name in the table.
  renderBarRows(
    ui.chartPurposes,
    result.purposeBreakdown.map((p) => ({ label: p.shortName ?? p.name, value: p.count }))
  );
  renderTable(
    ui.tablePurposes,
    ["Käyttötarkoitus", "Lupia"],
    result.purposeBreakdown.map((p) => [p.name, formatNumber(p.count)])
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
      "Vaillinaisia summia ei näytetä, koska ne näyttäisivät liian pieniltä. Yritä uudelleen.";
    return;
  }

  ui.muniAreaNote.textContent = result.municipalityFiguresAreExact
    ? "Kaikkien rajaukseen osuvien lupien kerrosalat on laskettu yhteen. " +
      "Rivillä näkyy, kuinka monessa luvassa kerrosala on ilmoitettu."
    : "Arvio: otoksen keskimääräinen kerrosala × lupien määrä. Rajaus on liian laaja " +
      "tarkkaan summaan, joten luku voi heittää kaksinkertaisesti kumpaankin suuntaan.";
}

function renderYearTable(buckets) {
  renderTable(
    ui.tableYears,
    ["Vuosi", "Lupia", "Mediaanikerrosala"],
    buckets.map((b) => [
      String(b.year),
      formatNumber(b.count),
      b.medianGrossFloorArea === null ? "–" : `${formatNumber(b.medianGrossFloorArea)} m²`,
    ])
  );
}

// The SVG column chart is laid out in real pixels, so it must be re-rendered
// when the container width changes; the HTML bar rows reflow on their own.
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (!lastResult) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderColumnChart(ui.chartYears, lastResult.yearBuckets), 150);
});

populateFilters();
ui.reload.addEventListener("click", refresh);
for (const control of [ui.year, ui.municipality, ui.purpose]) {
  control.addEventListener("change", refresh);
}
refresh();
