// Dependency-free chart rendering. Two forms only, each chosen for its job:
//
//  * Column chart (SVG) for permits-over-time — a trend across ordered years
//    needs a real value axis and gridlines.
//  * Bar rows (HTML/CSS) for the purpose and municipality rankings — these
//    carry long Finnish category names, and laying them out as HTML keeps the
//    labels at true font size and wrapping natively, which scaled SVG text
//    does not.
//
// Every chart here is a single series, so none carries a legend: the chart's
// own title names what is plotted. Values are direct-labelled instead.

const numberFI = new Intl.NumberFormat("fi-FI");

export const formatNumber = (value) =>
  value === null || value === undefined || !Number.isFinite(value) ? "–" : numberFI.format(Math.round(value));

/**
 * One shared tooltip node for the whole page, created on first use.
 *
 * Tooltips here enhance and never gate: every value they show is also reachable
 * from a direct label, an axis tick, or the table view under each chart. That
 * is why the column chart can afford to leave most values to the axis — the
 * tooltip and the table carry the exact figures.
 */
function chartTooltip() {
  let tip = document.getElementById("chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chart-tooltip";
    tip.className = "chart-tooltip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

/**
 * Value leads, label follows — the reader already knows which category they are
 * pointing at and wants the number, so the number is the strong element.
 *
 * Labels are API-derived strings, so they go in via textContent, never innerHTML.
 */
function showTooltip(anchor, value, label) {
  const tip = chartTooltip();
  tip.textContent = "";
  const v = document.createElement("strong");
  v.className = "chart-tooltip-value";
  v.textContent = value;
  const l = document.createElement("span");
  l.className = "chart-tooltip-label";
  l.textContent = label;
  tip.append(v, l);
  tip.hidden = false;

  const box = anchor.getBoundingClientRect();
  const tipBox = tip.getBoundingClientRect();
  // Centred over the mark, flipped below it when there is no room above, and
  // clamped so it never leaves the viewport on a narrow screen.
  const left = Math.min(
    Math.max(box.left + box.width / 2 - tipBox.width / 2, 8),
    window.innerWidth - tipBox.width - 8
  );
  const above = box.top - tipBox.height - 10;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(above > 8 ? above : box.bottom + 10)}px`;
}

function hideTooltip() {
  const tip = document.getElementById("chart-tooltip");
  if (tip) tip.hidden = true;
}

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/**
 * "Nice" axis maximum and step, so gridlines land on round numbers rather than
 * on whatever the data maximum happens to be.
 */
function niceScale(max, targetTicks = 4) {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, step: 1 };
  const rawStep = max / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return { max: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

/**
 * Column chart for a year series.
 * @param {HTMLElement} container
 * @param {Array<{year:number,count:number}>} data
 */
export function renderColumnChart(container, data) {
  container.innerHTML = "";
  if (!data || data.length === 0) {
    container.appendChild(emptyNote("Ei tietoja valituilla rajauksilla."));
    return;
  }

  const width = Math.max(container.clientWidth || 640, 320);
  const height = 280;
  // Left padding fits a fully grouped tick label ("300 000") at the axis font
  // size; bottom fits an unrotated year label. Sized against the widest real
  // values, not guessed.
  const pad = { top: 16, right: 8, bottom: 32, left: 68 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const maxCount = Math.max(...data.map((d) => d.count), 0);
  const { max: axisMax, step } = niceScale(maxCount);

  const svg = svgEl("svg", {
    width: "100%",
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Lupien määrä vuosittain, ${data[0].year}–${data[data.length - 1].year}`,
  });

  // Gridlines + y ticks, drawn first so marks sit above them.
  for (let value = 0; value <= axisMax + 1e-9; value += step) {
    const y = pad.top + plotHeight - (value / axisMax) * plotHeight;
    svg.appendChild(
      svgEl("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: value === 0 ? "axis-line" : "grid-line" })
    );
    const label = svgEl("text", { x: pad.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end" });
    label.textContent = formatNumber(value);
    svg.appendChild(label);
  }

  // A 2px surface gap between adjacent bars, per the mark spec.
  const slot = plotWidth / data.length;
  const barWidth = Math.max(Math.min(slot - 2, 24), 4);
  const radius = Math.min(4, barWidth / 2);

  // Exactly one direct label, on the tallest column. Labelling every column
  // would be noise the axis already carries; labelling the extreme is the one
  // value a reader looks for without hovering.
  const peakIndex = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);

  data.forEach((d, index) => {
    const x = pad.left + slot * index + (slot - barWidth) / 2;
    const barHeight = axisMax === 0 ? 0 : (d.count / axisMax) * plotHeight;
    const y = pad.top + plotHeight - barHeight;

    if (barHeight > 0) {
      // Rounded data-end only; the baseline end stays square so the bar reads
      // as anchored to zero rather than floating.
      svg.appendChild(svgEl("path", { d: roundedTopBar(x, y, barWidth, barHeight, radius), class: "bar-mark" }));
    }

    if (index === peakIndex && barHeight > 0) {
      const peak = svgEl("text", {
        x: x + barWidth / 2,
        y: y - 7,
        class: "peak-label",
        "text-anchor": "middle",
      });
      peak.textContent = formatNumber(d.count);
      svg.appendChild(peak);
    }

    const yearLabel = svgEl("text", {
      x: x + barWidth / 2,
      y: height - pad.bottom + 18,
      class: "axis-label",
      "text-anchor": "middle",
    });
    // Two-digit years when the slots are too narrow for four — a truncated or
    // overlapping label is worse than a shortened one.
    yearLabel.textContent = slot < 34 ? `'${String(d.year).slice(2)}` : String(d.year);
    svg.appendChild(yearLabel);

    // A full-height transparent hit target, so hovering anywhere in the
    // column's slot works — not just on a short bar. It is focusable too, so a
    // keyboard reader gets the same readout as a pointer.
    const hit = svgEl("rect", {
      x: pad.left + slot * index,
      y: pad.top,
      width: slot,
      height: plotHeight,
      class: "hit-target",
      tabindex: "0",
      role: "img",
      "aria-label": `${d.year}: ${formatNumber(d.count)} lupaa`,
    });
    const show = () => showTooltip(hit, `${formatNumber(d.count)} lupaa`, String(d.year));
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hideTooltip);
    hit.addEventListener("blur", hideTooltip);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

function roundedTopBar(x, y, width, height, radius) {
  const r = Math.min(radius, height);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    "Z",
  ].join(" ");
}

/**
 * Horizontal bar rows.
 * @param {HTMLElement} container
 * @param {Array<{label:string,value:number,valueLabel?:string,note?:string}>} rows
 * @param {object} [options]
 * @param {"blue"|"orange"} [options.hue="blue"]  second concurrent sequential context takes orange
 */
export function renderBarRows(container, rows, options = {}) {
  const { hue = "blue" } = options;
  container.innerHTML = "";
  if (!rows || rows.length === 0) {
    container.appendChild(emptyNote("Ei tietoja valituilla rajauksilla."));
    return;
  }

  const max = Math.max(...rows.map((r) => r.value), 0);
  const list = document.createElement("ul");
  list.className = `bar-rows hue-${hue}`;

  for (const row of rows) {
    const item = document.createElement("li");
    item.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-row-label";
    label.textContent = row.label;
    label.title = row.label;

    const track = document.createElement("span");
    track.className = "bar-row-track";
    const fill = document.createElement("span");
    fill.className = "bar-row-fill";
    fill.style.width = max > 0 ? `${Math.max((row.value / max) * 100, row.value > 0 ? 1.5 : 0)}%` : "0%";
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-row-value";
    value.textContent = row.valueLabel ?? formatNumber(row.value);

    item.append(label, track, value);
    if (row.note) {
      const note = document.createElement("span");
      note.className = "bar-row-note";
      note.textContent = row.note;
      item.appendChild(note);
    }
    list.appendChild(item);
  }
  container.appendChild(list);
}

/**
 * The table twin every chart carries.
 *
 * This is the WCAG-clean path to the same numbers: no hover, no color, no
 * geometry. It is why the charts can label selectively rather than printing a
 * number on every mark — nothing is only reachable by pointing at it.
 *
 * @param {HTMLElement} container
 * @param {string[]} columns  header cells, in order
 * @param {Array<Array<string>>} rows  already-formatted cell text
 */
export function renderTable(container, columns, rows) {
  container.innerHTML = "";
  if (!rows || rows.length === 0) return;

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const name of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = name;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (const cells of rows) {
    const tr = document.createElement("tr");
    cells.forEach((cell, i) => {
      // First column is the category name; make it the row header so a screen
      // reader announces which row a value belongs to.
      const node = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) node.scope = "row";
      node.textContent = cell;
      tr.appendChild(node);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  container.appendChild(table);
}

function emptyNote(text) {
  const p = document.createElement("p");
  p.className = "empty-note";
  p.textContent = text;
  return p;
}
