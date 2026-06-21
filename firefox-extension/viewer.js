(() => {
  "use strict";

  // ---- State ----
  let headers = [];      // column names
  let rows = [];         // array of string[]
  let rowText = [];      // lowercased joined row, for filtering
  let colNumeric = [];   // per-column: is this a numeric column?
  let ncols = 0;
  let sortCol = null;    // column index or null
  let sortDir = "asc";   // "asc" | "desc"

  const $ = (id) => document.getElementById(id);
  const toolbar = $("toolbar"), empty = $("empty"), tableWrap = $("tableWrap"), statusbar = $("statusbar");
  const theadEl = $("thead"), tbodyEl = $("tbody");
  const searchEl = $("search"), countEl = $("count"), statsEl = $("stats");
  const fileNameEl = $("fileName"), fileDimsEl = $("fileDims");
  const overlay = $("overlay"), fileInput = $("fileInput"), themeBtn = $("theme");

  let currentName = "table.csv";
  const colWidths = {};                       // col index -> px (only resized columns)
  const selCols = new Set();                  // fully-selected column indices
  const selRows = new Set();                  // fully-selected data-row indices
  const blocks = [];                          // committed cell rectangles: { rows:Set<dataIndex>, c0, c1 }
  let drag = null;                            // live drag rectangle (view-space) while selecting
  let activeCell = null;                      // { i, c } anchor cell for the outline
  let viewCache = [];                         // last rendered view (data indices, in view order)
  function clearSel() { selCols.clear(); selRows.clear(); blocks.length = 0; activeCell = null; }
  const colStyleEl = document.createElement("style");
  document.head.appendChild(colStyleEl);

  // ---- Theme: defaults to the system setting; a manual toggle is persisted ----
  const THEME_KEY = "dropcsv-theme";
  function setTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  function effectiveTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  try { const saved = localStorage.getItem(THEME_KEY); if (saved) setTheme(saved); } catch (e) {}
  themeBtn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  // ---- CSV parsing (RFC 4180: quotes, escaped "", embedded commas/newlines) ----
  function detectDelimiter(text) {
    const firstLine = text.slice(0, text.indexOf("\n") + 1 || text.length);
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let inQ = false;
    for (const c of firstLine) {
      if (c === '"') inQ = !inQ;
      else if (!inQ && c in counts) counts[c]++;
    }
    return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ",");
  }

  function parseCSV(text, delim) {
    const out = [];
    let row = [], field = "", inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        row.push(field); out.push(row); row = []; field = "";
        if (c === "\r" && text[i + 1] === "\n") i += 2; else i++;
        continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); out.push(row); }
    // drop fully-blank lines
    return out.filter((r) => !(r.length === 1 && r[0] === ""));
  }

  // ---- Numeric helpers ----
  function toNumber(s) {
    if (s == null) return NaN;
    const cleaned = s.trim().replace(/[$£€%\s]/g, "").replace(/,/g, "");
    if (cleaned === "" || cleaned === "-") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  // ---- Escape for innerHTML ----
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ---- Load ----
  function setData(name, text) {
    const delim = detectDelimiter(text);
    const parsed = parseCSV(text, delim);
    if (!parsed.length) return;

    ncols = parsed.reduce((m, r) => Math.max(m, r.length), 0);
    headers = parsed[0].slice();
    while (headers.length < ncols) headers.push("Column " + (headers.length + 1));

    rows = parsed.slice(1).map((r) => {
      const out = r.slice(0, ncols);
      while (out.length < ncols) out.push("");
      return out;
    });

    // Per-column numeric detection (≥80% of non-empty cells numeric).
    colNumeric = [];
    for (let c = 0; c < ncols; c++) {
      let nonEmpty = 0, numeric = 0;
      for (const r of rows) {
        const v = r[c];
        if (v != null && v.trim() !== "") { nonEmpty++; if (!Number.isNaN(toNumber(v))) numeric++; }
      }
      colNumeric[c] = nonEmpty > 0 && numeric / nonEmpty >= 0.8;
    }

    rowText = rows.map((r) => r.join("  ").toLowerCase());
    sortCol = null; sortDir = "asc";
    searchEl.value = "";
    selCols.clear(); selRows.clear();
    currentName = /\.(csv|tsv)$/i.test(name) ? name : (name || "table") + ".csv";
    for (const k in colWidths) delete colWidths[k];
    applyColWidths();

    fileNameEl.textContent = name;
    fileDimsEl.textContent = `${rows.length.toLocaleString()} rows · ${ncols} cols`;
    toolbar.classList.remove("hidden");
    statusbar.classList.remove("hidden");
    empty.classList.add("hidden");
    tableWrap.style.display = "block";

    buildHead();
    render();
    searchEl.focus();
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => setData(file.name, String(reader.result));
    reader.readAsText(file);
  }

  // ---- Head ----
  function buildHead() {
    let html = '<tr><th class="rownum" data-col="-1">#</th>';
    for (let c = 0; c < ncols; c++) {
      const cls = [colNumeric[c] && "num", selCols.has(c) && "selcol"].filter(Boolean).join(" ");
      const glyph = c === sortCol ? (sortDir === "asc" ? "▲" : "▼") : "▼";
      const active = c === sortCol ? " active" : "";
      html += `<th data-col="${c}"${cls ? ` class="${cls}"` : ""}>` +
              `<span class="hname">${esc(headers[c])}</span>` +
              `<span class="caret${active}">${glyph}</span>` +
              `<span class="resizer"></span></th>`;
    }
    theadEl.innerHTML = html + "</tr>";
  }

  // Is cell (data-row i, column c, view-position k) part of the current selection?
  function cellSelected(i, c, k) {
    if (selCols.has(c) || selRows.has(i)) return true;
    for (const b of blocks) if (b.rows.has(i) && c >= b.c0 && c <= b.c1) return true;
    if (drag) {
      const k0 = Math.min(drag.anchorK, drag.curK), k1 = Math.max(drag.anchorK, drag.curK);
      const c0 = Math.min(drag.anchorC, drag.curC), c1 = Math.max(drag.anchorC, drag.curC);
      if (k >= k0 && k <= k1 && c >= c0 && c <= c1) return true;
    }
    return false;
  }

  // Stats over the selected cells, intersected with the current view.
  function updateStatus(view) {
    countEl.textContent = view.length === rows.length
      ? `${rows.length.toLocaleString()} rows`
      : `${view.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`;
    if (!selCols.size && !selRows.size && !blocks.length && !drag) { statsEl.textContent = ""; return; }
    let count = 0, numCount = 0, sum = 0, min = Infinity, max = -Infinity;
    const uniq = new Set();
    for (let k = 0; k < view.length; k++) {
      const i = view[k], r = rows[i];
      for (let c = 0; c < ncols; c++) {
        if (!cellSelected(i, c, k)) continue;
        const v = r[c];
        if (v == null || v.trim() === "") continue;
        count++; uniq.add(v);
        const n = toNumber(v);
        if (!Number.isNaN(n)) { numCount++; sum += n; if (n < min) min = n; if (n > max) max = n; }
      }
    }
    const fmt = (x) => x.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const parts = [];
    if (numCount > 0) parts.push(`Sum ${fmt(sum)}`, `Avg ${fmt(sum / numCount)}`, `Min ${fmt(min)}`, `Max ${fmt(max)}`);
    parts.push(`Count ${count.toLocaleString()}`, `Unique ${uniq.size.toLocaleString()}`);
    if (numCount > 0 && numCount < count) parts.push(`Numeric ${numCount.toLocaleString()}`);
    statsEl.textContent = parts.join("   ·   ");
  }

  // ---- View (filter + sort) ----
  function applyView() {
    const q = searchEl.value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const view = [];
    for (let i = 0; i < rows.length; i++) {
      if (!terms.length || terms.every((t) => rowText[i].includes(t))) view.push(i);
    }
    if (sortCol != null) {
      const dir = sortDir === "asc" ? 1 : -1;
      const numeric = colNumeric[sortCol];
      view.sort((a, b) => {
        const x = rows[a][sortCol] ?? "", y = rows[b][sortCol] ?? "";
        if (numeric) {
          const nx = toNumber(x), ny = toNumber(y);
          const xe = Number.isNaN(nx), ye = Number.isNaN(ny);
          if (xe && ye) return 0; if (xe) return 1; if (ye) return -1; // blanks last
          return (nx - ny) * dir;
        }
        return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) * dir;
      });
    }
    return view;
  }

  function render() {
    const view = applyView();
    viewCache = view;
    buildHead();
    const parts = new Array(view.length);
    for (let k = 0; k < view.length; k++) {
      const i = view[k], r = rows[i], rowSel = selRows.has(i);
      let cells = `<td class="rownum${rowSel ? " sel" : ""}">${i + 1}</td>`;
      for (let c = 0; c < ncols; c++) {
        const sel = cellSelected(i, c, k);
        const active = activeCell && activeCell.i === i && activeCell.c === c;
        const cls = [colNumeric[c] && "num", sel && "sel", active && "active"].filter(Boolean).join(" ");
        cells += `<td${cls ? ` class="${cls}"` : ""} data-c="${c}">${esc(r[c] ?? "")}</td>`;
      }
      parts[k] = `<tr data-row="${i}" data-k="${k}">${cells}</tr>`;
    }
    tbodyEl.innerHTML = parts.join("");
    updateStatus(view);
  }

  // ---- Events ----
  // Header: caret cycles sort (asc → desc → off); clicking the name selects the column
  // (Cmd/Ctrl-click adds to the selection for multi-column stats).
  theadEl.addEventListener("click", (e) => {
    if (e.target.closest(".resizer")) return;
    const th = e.target.closest("th");
    if (!th) return;
    const c = Number(th.dataset.col);
    if (c < 0) return; // # gutter header
    if (e.target.closest(".caret")) {
      if (sortCol !== c) { sortCol = c; sortDir = "asc"; }
      else if (sortDir === "asc") sortDir = "desc";
      else { sortCol = null; sortDir = "asc"; }
    } else {
      if (!(e.metaKey || e.ctrlKey)) clearSel();
      if (selCols.has(c)) selCols.delete(c); else selCols.add(c);
    }
    render();
  });

  // Click the row-number gutter to select a row (Cmd/Ctrl-click for multiple).
  tbodyEl.addEventListener("click", (e) => {
    const td = e.target.closest("td.rownum");
    if (!td) return;
    const i = Number(td.closest("tr").dataset.row);
    if (!(e.metaKey || e.ctrlKey)) clearSel();
    if (selRows.has(i)) selRows.delete(i); else selRows.add(i);
    render();
  });

  // Cell selection: click a cell, or drag a rectangle; Shift extends, Cmd/Ctrl adds a block.
  function cellCoords(t) {
    const td = t && t.closest && t.closest("td[data-c]");
    if (!td) return null;
    const tr = td.closest("tr");
    return { k: Number(tr.dataset.k), c: Number(td.dataset.c), i: Number(tr.dataset.row) };
  }
  function commitDrag() {
    if (!drag) return;
    const k0 = Math.min(drag.anchorK, drag.curK), k1 = Math.max(drag.anchorK, drag.curK);
    const c0 = Math.min(drag.anchorC, drag.curC), c1 = Math.max(drag.anchorC, drag.curC);
    const rowSet = new Set();
    for (let k = k0; k <= k1; k++) rowSet.add(viewCache[k]);
    blocks.push({ rows: rowSet, c0, c1 });
    drag = null;
    render();
  }
  tbodyEl.addEventListener("mousedown", (e) => {
    const cc = cellCoords(e.target);
    if (!cc) return;                 // gutter / outside → leave to the row-select click handler
    e.preventDefault();              // suppress native text selection during a drag
    if (e.shiftKey && activeCell) {
      const aK = viewCache.indexOf(activeCell.i);
      drag = { anchorK: aK < 0 ? cc.k : aK, anchorC: activeCell.c, curK: cc.k, curC: cc.c };
      commitDrag();
    } else {
      if (!(e.metaKey || e.ctrlKey)) clearSel();
      activeCell = { i: cc.i, c: cc.c };
      drag = { anchorK: cc.k, anchorC: cc.c, curK: cc.k, curC: cc.c };
      render();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const cc = cellCoords(e.target);
    if (!cc || (cc.k === drag.curK && cc.c === drag.curC)) return;
    drag.curK = cc.k; drag.curC = cc.c;
    render();
  });
  window.addEventListener("mouseup", () => { if (drag) commitDrag(); });

  // Click empty space (outside cells, headers, and controls) to clear the selection.
  document.addEventListener("click", (e) => {
    if (!selCols.size && !selRows.size && !blocks.length) return;
    if (e.target.closest("th, td, .search, .icon-btn, .file-meta")) return;
    clearSel(); render();
  });

  let rafPending = false;
  searchEl.addEventListener("input", () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  });

  $("fileMeta").addEventListener("click", () => fileInput.click());
  empty.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) readFile(fileInput.files[0]); });

  // ---- Column resizing (drag the right edge of a header) ----
  function applyColWidths() {
    let css = "";
    for (const c in colWidths) {
      const n = Number(c) + 2; // rownum is nth-child(1), so data col c is nth-child(c+2)
      css += `thead th:nth-child(${n}),tbody td:nth-child(${n}){width:${colWidths[c]}px;min-width:${colWidths[c]}px;max-width:${colWidths[c]}px}`;
    }
    colStyleEl.textContent = css;
  }
  let resizing = null;
  theadEl.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".resizer");
    if (!handle) return;
    e.preventDefault();
    const th = handle.closest("th");
    resizing = { c: Number(th.dataset.col), startX: e.clientX, startW: th.getBoundingClientRect().width };
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    colWidths[resizing.c] = Math.max(48, Math.round(resizing.startW + (e.clientX - resizing.startX)));
    applyColWidths();
  });
  window.addEventListener("mouseup", () => { if (resizing) { resizing = null; document.body.style.userSelect = ""; } });

  // ---- Download the current view (filtered + sorted) as CSV ----
  function csvCell(s) { s = String(s ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCSV() {
    const view = applyView();
    const lines = [headers.map(csvCell).join(",")];
    for (const i of view) lines.push(rows[i].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = currentName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  $("download").addEventListener("click", exportCSV);

  // ---- Copy the current selection to the clipboard as TSV (bounding box, view order) ----
  function tsvCell(s) { s = String(s ?? ""); return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function selectionToTSV() {
    if (!selCols.size && !selRows.size && !blocks.length) return null;
    const view = viewCache;
    let cMin = Infinity, cMax = -Infinity;
    for (let k = 0; k < view.length; k++) {
      const i = view[k];
      for (let c = 0; c < ncols; c++) if (cellSelected(i, c, k)) { if (c < cMin) cMin = c; if (c > cMax) cMax = c; }
    }
    if (cMin > cMax) return null;
    const lines = [];
    for (let k = 0; k < view.length; k++) {
      const i = view[k]; let any = false; const cells = [];
      for (let c = cMin; c <= cMax; c++) { const s = cellSelected(i, c, k); if (s) any = true; cells.push(s ? rows[i][c] : ""); }
      if (any) lines.push(cells.map(tsvCell).join("\t"));
    }
    return lines.join("\n");
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        return;
      }
    } catch (e) {}
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    } catch (e) {}
  }

  // Drag & drop (anywhere on the page)
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); if (++dragDepth === 1) overlay.classList.add("show"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove("show"); } });
  window.addEventListener("drop", (e) => {
    e.preventDefault(); dragDepth = 0; overlay.classList.remove("show");
    const f = e.dataTransfer.files[0];
    if (f) { readFile(f); return; }
    const txt = e.dataTransfer.getData("text/plain");
    if (txt) setData("(dropped text)", txt);
  });

  // Paste tabular data straight in
  window.addEventListener("paste", (e) => {
    if (document.activeElement === searchEl) return;
    const txt = e.clipboardData?.getData("text/plain");
    if (txt && txt.includes("\n")) { e.preventDefault(); setData("(pasted)", txt); }
  });

  // Keyboard: "/" focuses filter, Esc clears/blurs
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchEl) { e.preventDefault(); searchEl.focus(); searchEl.select(); }
    else if (e.key === "Escape") {
      if (document.activeElement === searchEl) {
        if (searchEl.value) { searchEl.value = ""; render(); } else searchEl.blur();
      } else if (selCols.size || selRows.size || blocks.length) {
        clearSel(); render();
      }
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C") && document.activeElement !== searchEl) {
      const tsv = selectionToTSV();
      if (tsv != null) { e.preventDefault(); copyText(tsv); }
    }
  });

  // ---- Auto-load: ?id= (file dropped on a page, text passed via background) or
  //      ?src= (direct .csv URL — works for web URLs, blocked for file://). Drag/paste stay as fallback.
  function showLoadError(name) {
    empty.querySelector("h1").textContent = "Couldn’t open " + name + " automatically";
    empty.querySelector("p").innerHTML = "Firefox blocked reading it directly — <b>drag the file here</b> instead.";
  }

  const params = new URLSearchParams(location.search);
  const dropId = params.get("id"), srcUrl = params.get("src");
  if (dropId) {
    browser.runtime.sendMessage({ type: "get", id: dropId })
      .then((data) => {
        if (data && data.text != null) { document.title = data.name || "data"; setData(data.name || "data", data.text); }
        else showLoadError("the dropped file");
      })
      .catch(() => showLoadError("the dropped file"));
  } else if (srcUrl) {
    const srcName = decodeURIComponent(srcUrl.split(/[?#]/)[0].split("/").pop()) || "data";
    document.title = srcName;
    fetch(srcUrl)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then((text) => setData(srcName, text))
      .catch(() => showLoadError(srcName));
  }
})();
