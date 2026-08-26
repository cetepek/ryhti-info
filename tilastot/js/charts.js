// Dependency-free chart rendering. Each form is here because a specific job
// needs it, not for variety:
//
//  * Column chart (SVG) for permits-over-time — a trend across ordered years
//    needs a real value axis and gridlines.
//  * Bar rows (HTML/CSS) for the purpose and municipality rankings — these
//    carry long Finnish category names, and laying them out as HTML keeps the
//    labels at true font size and wrapping natively, which scaled SVG text
//    does not.
//  * Line chart for median size over time. Counts and square metres are two
//    measures on wildly different scales; they get two charts rather than one
//    chart with two y-axes, which is unreadable and invites false correlation.
//  * Diverging columns for year-over-year change — the reader's job there is
//    the SIGN first (grew or shrank) and only then the magnitude, which is
//    exactly what a diverging scale around a zero baseline encodes.
//  * Donut for the purpose split — the one genuinely part-to-whole dataset on
//    the page, since the seven purposes partition the classified permits. The
//    municipality rankings are NOT part-to-whole: they are a capped 34-
//    candidate subset that sums to no meaningful total, so they stay bars.
//
// Every chart but the donut is a single series and carries no legend: the
// chart's own title names what is plotted, and values are direct-labelled. The
// donut has seven, so it ships a legend AND written names — three of the seven
// light-mode slot colors sit below 3:1 on the card surface, so color is never
// what carries identity.

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
 * @param {Array<{label:string,value:number,valueLabel?:string,shareLabel?:string,note?:string}>} rows
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
  const hasShare = rows.some((r) => r.shareLabel);
  const list = document.createElement("ul");
  list.className = `bar-rows hue-${hue}${hasShare ? " has-share" : ""}`;

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

    if (hasShare) {
      const share = document.createElement("span");
      share.className = "bar-row-share";
      // Every row gets the cell once any row has one, so the value column stays
      // aligned down the list instead of jumping where a share is missing.
      share.textContent = row.shareLabel ?? "";
      item.appendChild(share);
    }

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

/* ------------------------------------------------------------------ *
 * Donut — the purpose split
 * ------------------------------------------------------------------ */

/**
 * Ring geometry. Angles run clockwise from 12 o'clock, which is where a reader
 * expects a part-to-whole ring to start.
 *
 * A slice covering the entire ring cannot be drawn as one arc — the start and
 * end points coincide and the renderer collapses it to nothing — so a full
 * sweep is emitted as two half arcs instead.
 */
function donutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const full = endAngle - startAngle >= Math.PI * 2 - 1e-6;
  if (full) {
    const mid = startAngle + Math.PI;
    return `${donutSlicePath(cx, cy, rOuter, rInner, startAngle, mid)} ${donutSlicePath(cx, cy, rOuter, rInner, mid, endAngle)}`;
  }
  const point = (r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = point(rOuter, startAngle);
  const [x2, y2] = point(rOuter, endAngle);
  const [x3, y3] = point(rInner, endAngle);
  const [x4, y4] = point(rInner, startAngle);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * Part-to-whole ring plus its legend.
 *
 * Segments are drawn in the order given and MUST be given in a fixed category
 * order, never sorted by value: `slot` follows the entity, so a filter that
 * changes which purpose is largest must not repaint the ring. The caller owns
 * that ordering; this function only draws it.
 *
 * @param {HTMLElement} container
 * @param {Array<{label:string,value:number,slot:number}>} segments  fixed order, slot 1-7
 * @param {object} [options]
 * @param {string} [options.centerLabel]   caption under the figure in the hole
 * @param {string} [options.unitLabel]     noun for the tooltip ("lupaa")
 * @param {boolean} [options.legendValues] print counts and shares in the legend.
 *   Off where the ring sits above bar rows carrying the same numbers — there the
 *   legend is a color key and nothing more, and repeating the figures twice in
 *   one card would be noise rather than redundancy that earns its place.
 * @param {number|null} [options.emphasisSlot] hold this slot at full strength and
 *   mute the rest. Used when a filter elsewhere on the page has singled out one
 *   category, so the ring shows where that category sits inside the whole.
 */
export function renderDonutChart(container, segments, options = {}) {
  const {
    centerLabel = "yhteensä",
    unitLabel = "lupaa",
    legendValues = true,
    emphasisSlot = null,
  } = options;
  container.innerHTML = "";

  const drawable = (segments ?? []).filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = drawable.reduce((sum, s) => sum + s.value, 0);
  if (drawable.length === 0 || total <= 0) {
    container.appendChild(emptyNote("Ei tietoja valituilla rajauksilla."));
    return;
  }

  const share = (value) => value / total;
  // One decimal below 10%, none above: "0.4 %" is a real distinction between the
  // small purposes, while "62.4 %" implies precision the reader cannot use.
  const shareLabel = (value) => {
    const pct = share(value) * 100;
    return `${pct.toLocaleString("fi-FI", { minimumFractionDigits: pct < 10 ? 1 : 0, maximumFractionDigits: pct < 10 ? 1 : 0 })} %`;
  };

  const wrapper = document.createElement("div");
  wrapper.className = "donut-chart";

  const size = 210;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 95;
  const rInner = 58;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${size} ${size}`,
    class: "donut-figure",
    role: "img",
    "aria-label": `Lupien jakauma käyttötarkoituksittain, yhteensä ${formatNumber(total)} ${unitLabel}`,
  });

  const slices = [];
  let angle = -Math.PI / 2;
  for (const segment of drawable) {
    const sweep = share(segment.value) * Math.PI * 2;
    const muted = emphasisSlot !== null && segment.slot !== emphasisSlot;
    const path = svgEl("path", {
      d: donutSlicePath(cx, cy, rOuter, rInner, angle, angle + sweep),
      class: `donut-slice slot-${segment.slot}${muted ? " is-muted" : ""}`,
      tabindex: "0",
      role: "img",
      "aria-label": `${segment.label}: ${formatNumber(segment.value)} ${unitLabel}, ${shareLabel(segment.value)}`,
    });

    // Hover emphasis is applied here rather than by a CSS :hover on the <svg>
    // root. A ring segment's own centre point lies in the hole, and the root
    // svg's box covers the four corners outside the ring — so a selector hung
    // off the root fires in places the reader is not pointing at anything, and
    // misses where they are. Driving it from the slice's own pointer events is
    // the only version that tracks what is actually under the cursor.
    const enter = () => {
      for (const other of slices) other.classList.toggle("is-dimmed", other !== path);
      path.classList.add("is-hot");
      showTooltip(path, `${formatNumber(segment.value)} ${unitLabel} · ${shareLabel(segment.value)}`, segment.label);
    };
    const leave = () => {
      for (const other of slices) other.classList.remove("is-dimmed", "is-hot");
      hideTooltip();
    };
    path.addEventListener("pointerenter", enter);
    path.addEventListener("focus", enter);
    path.addEventListener("pointerleave", leave);
    path.addEventListener("blur", leave);

    slices.push(path);
    svg.appendChild(path);
    angle += sweep;
  }

  // The hole is not decoration — it carries the whole the slices are parts of,
  // which is the one number a ring cannot encode in its own geometry.
  const centerValue = svgEl("text", { x: cx, y: cy + 2, class: "donut-center-value" });
  centerValue.textContent = formatNumber(total);
  const centerCaption = svgEl("text", { x: cx, y: cy + 20, class: "donut-center-label" });
  centerCaption.textContent = centerLabel;
  svg.append(centerValue, centerCaption);

  const legend = document.createElement("ul");
  legend.className = `donut-legend${legendValues ? "" : " key-only"}`;
  for (const segment of segments ?? []) {
    const item = document.createElement("li");
    const muted = emphasisSlot !== null && segment.slot !== emphasisSlot;
    item.className = `legend-item${muted ? " is-muted" : ""}`;

    const swatch = document.createElement("span");
    swatch.className = `legend-swatch swatch-${segment.slot}`;

    const label = document.createElement("span");
    label.className = "legend-label";
    label.textContent = segment.label;

    item.append(swatch, label);

    if (legendValues) {
      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = formatNumber(segment.value);

      const pct = document.createElement("span");
      pct.className = "legend-share";
      pct.textContent = segment.value > 0 ? shareLabel(segment.value) : "–";
      item.append(value, pct);
    }

    legend.appendChild(item);
  }

  wrapper.append(svg, legend);
  container.appendChild(wrapper);
}

/* ------------------------------------------------------------------ *
 * Line — median size over time
 * ------------------------------------------------------------------ */

/**
 * Single-series line over an ordered year axis.
 *
 * The y axis does NOT start at zero here, and that is deliberate: these are
 * medians that move within a narrow band, and a zero baseline would flatten a
 * decade of real movement into a straight line. The caller is expected to say
 * so in the card's note — a truncated axis is only honest when it is declared.
 *
 * Missing years are gaps, not zeroes: a year with no size data in its sample is
 * an absence of measurement, and joining across it would draw a trend that was
 * never observed.
 *
 * @param {HTMLElement} container
 * @param {Array<{year:number,value:number|null}>} data
 * @param {object} [options]
 * @param {string} [options.unit="m²"]
 */
export function renderLineChart(container, data, options = {}) {
  const { unit = "m²" } = options;
  container.innerHTML = "";

  const points = (data ?? []).filter((d) => Number.isFinite(d.value));
  if (points.length === 0) {
    container.appendChild(emptyNote("Ei kerrosalatietoja valituilla rajauksilla."));
    return;
  }

  const width = Math.max(container.clientWidth || 640, 320);
  const height = 240;
  // Unlike the column charts, a line's last point sits ON the right edge of the
  // plot and its year label is centred there — so the right padding has to hold
  // half a label, not just a margin.
  const pad = { top: 18, right: 24, bottom: 32, left: 68 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const values = points.map((d) => d.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // A padded band around the data, snapped out to round numbers so the ticks
  // read as figures rather than as whatever the extremes happened to be.
  const span = dataMax - dataMin || Math.max(dataMax * 0.1, 1);
  const { step } = niceScale(span, 4);
  const axisMin = Math.max(0, Math.floor((dataMin - span * 0.15) / step) * step);
  const axisMax = Math.ceil((dataMax + span * 0.15) / step) * step;
  const range = axisMax - axisMin || 1;

  const xAt = (index) => pad.left + (data.length === 1 ? plotWidth / 2 : (plotWidth / (data.length - 1)) * index);
  const yAt = (value) => pad.top + plotHeight - ((value - axisMin) / range) * plotHeight;

  const svg = svgEl("svg", {
    width: "100%",
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Mediaanikerrosala vuosittain, ${data[0].year}–${data[data.length - 1].year}`,
  });

  for (let value = axisMin; value <= axisMax + 1e-9; value += step) {
    const y = yAt(value);
    svg.appendChild(
      svgEl("line", {
        x1: pad.left,
        y1: y,
        x2: width - pad.right,
        y2: y,
        class: value === axisMin ? "axis-line" : "grid-line",
      })
    );
    const label = svgEl("text", { x: pad.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end" });
    label.textContent = formatNumber(value);
    svg.appendChild(label);
  }

  // One path per unbroken run, so a missing year leaves a gap instead of a
  // straight line through data that does not exist.
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      svg.appendChild(svgEl("path", { d: run.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" "), class: "line-mark" }));
    }
    run = [];
  };
  data.forEach((d, index) => {
    if (Number.isFinite(d.value)) run.push([xAt(index), yAt(d.value)]);
    else flush();
  });
  flush();

  // Dots on every observed year — with twelve points they read as the sample
  // marks they are, and a lone unbroken year would otherwise draw nothing at all.
  data.forEach((d, index) => {
    if (!Number.isFinite(d.value)) return;
    svg.appendChild(svgEl("circle", { cx: xAt(index), cy: yAt(d.value), r: 4, class: "line-dot" }));
  });

  const slot = plotWidth / Math.max(data.length, 1);
  data.forEach((d, index) => {
    const x = xAt(index);
    const yearLabel = svgEl("text", { x, y: height - pad.bottom + 18, class: "axis-label", "text-anchor": "middle" });
    yearLabel.textContent = slot < 34 ? `'${String(d.year).slice(2)}` : String(d.year);
    svg.appendChild(yearLabel);

    const hit = svgEl("rect", {
      x: x - slot / 2,
      y: pad.top,
      width: slot,
      height: plotHeight,
      class: "hit-target",
      tabindex: "0",
      role: "img",
      "aria-label": Number.isFinite(d.value)
        ? `${d.year}: ${formatNumber(d.value)} ${unit}`
        : `${d.year}: ei kerrosalatietoja`,
    });
    let crosshair = null;
    const show = () => {
      if (Number.isFinite(d.value)) {
        crosshair = svgEl("line", { x1: x, y1: pad.top, x2: x, y2: pad.top + plotHeight, class: "crosshair" });
        svg.insertBefore(crosshair, svg.firstChild.nextSibling);
      }
      showTooltip(hit, Number.isFinite(d.value) ? `${formatNumber(d.value)} ${unit}` : "Ei tietoja", String(d.year));
    };
    const hide = () => {
      crosshair?.remove();
      crosshair = null;
      hideTooltip();
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/* ------------------------------------------------------------------ *
 * Diverging columns — year-over-year change
 * ------------------------------------------------------------------ */

/**
 * Change against the previous year, as a signed percentage.
 *
 * Diverging rather than sequential because the first thing the reader needs is
 * the sign. Blue up, red down, with the zero line as the neutral midpoint — no
 * hue sits at zero, so "no change" never looks like a category.
 *
 * The two arms share one step size, so a gridline means the same distance above
 * and below zero and the arms stay directly comparable.
 *
 * @param {HTMLElement} container
 * @param {Array<{year:number,delta:number|null}>} data  delta as a fraction (0.12 = +12 %)
 */
export function renderDivergingColumnChart(container, data) {
  container.innerHTML = "";
  const points = (data ?? []).filter((d) => Number.isFinite(d.delta));
  if (points.length === 0) {
    container.appendChild(emptyNote("Ei vertailukelpoisia vuosia valituilla rajauksilla."));
    return;
  }

  const width = Math.max(container.clientWidth || 640, 320);
  const height = 240;
  const pad = { top: 18, right: 12, bottom: 32, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const deltas = points.map((d) => d.delta * 100);
  const largest = Math.max(Math.max(...deltas, 0), Math.abs(Math.min(...deltas, 0)));
  const { step } = niceScale(largest, 3);
  // 12 % headroom before the round-up, so the extreme bar never ends flush
  // against the top or bottom rule and its direct label always has room to sit
  // outside the bar rather than on top of it.
  const axisTop = Math.max(Math.ceil((Math.max(...deltas, 0) * 1.12) / step) * step, step);
  const axisBottom = Math.min(Math.floor((Math.min(...deltas, 0) * 1.12) / step) * step, -step);
  const range = axisTop - axisBottom;

  const yAt = (percent) => pad.top + plotHeight - ((percent - axisBottom) / range) * plotHeight;

  const svg = svgEl("svg", {
    width: "100%",
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Lupamäärän muutos edellisvuoteen verrattuna, ${data[0].year}–${data[data.length - 1].year}`,
  });

  for (let value = axisBottom; value <= axisTop + 1e-9; value += step) {
    const y = yAt(value);
    const isZero = Math.abs(value) < 1e-9;
    svg.appendChild(
      svgEl("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: isZero ? "zero-line" : "grid-line" })
    );
    const label = svgEl("text", { x: pad.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end" });
    label.textContent = formatAxisPercent(value, step);
    svg.appendChild(label);
  }

  const slot = plotWidth / data.length;
  const barWidth = Math.max(Math.min(slot - 2, 24), 4);
  const radius = Math.min(4, barWidth / 2);
  const zeroY = yAt(0);

  // Direct-label the single largest swing in either direction — the one value a
  // reader looks for before hovering anything.
  const extremeIndex = data.reduce(
    (best, d, i) => (Number.isFinite(d.delta) && (best === -1 || Math.abs(d.delta) > Math.abs(data[best].delta)) ? i : best),
    -1
  );

  data.forEach((d, index) => {
    const x = pad.left + slot * index + (slot - barWidth) / 2;
    const hasValue = Number.isFinite(d.delta);
    const percent = hasValue ? d.delta * 100 : 0;
    const y = yAt(percent);
    const barHeight = Math.abs(y - zeroY);

    if (hasValue && barHeight > 0.5) {
      const grows = percent >= 0;
      // Rounded at the data end, square at the zero line — the same anchoring
      // rule as the count chart, mirrored for bars that hang downward.
      const path = grows
        ? roundedTopBar(x, y, barWidth, barHeight, radius)
        : roundedBottomBar(x, zeroY, barWidth, barHeight, radius);
      svg.appendChild(svgEl("path", { d: path, class: grows ? "bar-mark-positive" : "bar-mark-negative" }));
    }

    if (hasValue && index === extremeIndex && barHeight > 0.5) {
      const grows = percent >= 0;
      // Outside the bar's data end by default, but flipped to the inside when
      // that would put it past the edge of the plot — the biggest swing is
      // exactly the bar most likely to reach it.
      const outside = grows ? y - 7 : y + 15;
      const inside = grows ? y + 15 : y - 7;
      const fits = outside >= pad.top + 4 && outside <= pad.top + plotHeight - 2;
      const label = svgEl("text", {
        x: x + barWidth / 2,
        y: fits ? outside : inside,
        class: "delta-label",
        "text-anchor": "middle",
      });
      label.textContent = formatPercentDelta(d.delta);
      svg.appendChild(label);
    }

    const yearLabel = svgEl("text", {
      x: x + barWidth / 2,
      // Year labels stay on the bottom rule rather than riding the zero line,
      // so they never collide with a downward bar.
      y: height - pad.bottom + 18,
      class: "axis-label",
      "text-anchor": "middle",
    });
    yearLabel.textContent = slot < 34 ? `'${String(d.year).slice(2)}` : String(d.year);
    svg.appendChild(yearLabel);

    const hit = svgEl("rect", {
      x: pad.left + slot * index,
      y: pad.top,
      width: slot,
      height: plotHeight,
      class: "hit-target",
      tabindex: "0",
      role: "img",
      "aria-label": hasValue
        ? `${d.year}: ${formatPercentDelta(d.delta)} edellisvuoteen verrattuna`
        : `${d.year}: ei vertailuvuotta`,
    });
    const show = () =>
      showTooltip(hit, hasValue ? formatPercentDelta(d.delta) : "Ei vertailuvuotta", String(d.year));
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hideTooltip);
    hit.addEventListener("blur", hideTooltip);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/**
 * One percent tick, at the precision its own step actually resolves.
 *
 * Rounding every tick to a whole percent breaks as soon as the step is
 * fractional — a half-percent step renders as "-1 %, -1 %, -0 %, 0 %, +1 %,
 * +1 %", with duplicate labels and a negative zero. That is the normal case
 * whenever the largest year-over-year change is only a few percent, which is
 * exactly what a single stable municipality looks like.
 */
function formatAxisPercent(value, step) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  // Number() collapses a negative zero produced by rounding, so a tick just
  // below the zero line cannot render as "-0 %".
  const rounded = Number(value.toFixed(decimals)) || 0;
  const text = rounded.toLocaleString("fi-FI", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${rounded > 0 ? "+" : ""}${text} %`;
}

/** Signed percentage, always carrying its sign so a rise never reads as a level. */
export function formatPercentDelta(delta) {
  if (!Number.isFinite(delta)) return "–";
  const pct = delta * 100;
  const rounded = Math.abs(pct) < 10 ? pct.toFixed(1) : String(Math.round(pct));
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${rounded.replace("-", "").replace(".", ",")} %`;
}

function roundedBottomBar(x, top, width, height, radius) {
  const r = Math.min(radius, height);
  return [
    `M ${x} ${top}`,
    `L ${x} ${top + height - r}`,
    `Q ${x} ${top + height} ${x + r} ${top + height}`,
    `L ${x + width - r} ${top + height}`,
    `Q ${x + width} ${top + height} ${x + width} ${top + height - r}`,
    `L ${x + width} ${top}`,
    "Z",
  ].join(" ");
}
