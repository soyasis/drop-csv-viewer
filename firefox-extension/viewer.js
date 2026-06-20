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
  const toolbar = $("toolbar"), empty = $("empty"), tableWrap = $("tableWrap");
  const theadEl = $("thead"), tbodyEl = $("tbody");
  const searchEl = $("search"), countEl = $("count");
  const fileNameEl = $("fileName"), fileDimsEl = $("fileDims");
  const overlay = $("overlay"), fileInput = $("fileInput");

  let currentName = "table.csv";
  const colWidths = {};                       // col index -> px (only resized columns)
  const colStyleEl = document.createElement("style");
  document.head.appendChild(colStyleEl);

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
    currentName = /\.(csv|tsv)$/i.test(name) ? name : (name || "table") + ".csv";
    for (const k in colWidths) delete colWidths[k];
    applyColWidths();

    fileNameEl.textContent = name;
    fileDimsEl.textContent = `${rows.length.toLocaleString()} rows · ${ncols} cols`;
    toolbar.classList.remove("hidden");
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
      html += `<th data-col="${c}"${colNumeric[c] ? ' class="num"' : ""}>` +
              `${esc(headers[c])}<span class="arrow" data-arrow="${c}"></span><span class="resizer"></span></th>`;
    }
    theadEl.innerHTML = html + "</tr>";
  }

  function updateArrows() {
    theadEl.querySelectorAll(".arrow").forEach((a) => {
      const c = Number(a.dataset.arrow);
      a.textContent = c === sortCol ? (sortDir === "asc" ? "▲" : "▼") : "";
    });
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
    const parts = new Array(view.length);
    for (let k = 0; k < view.length; k++) {
      const i = view[k], r = rows[i];
      let cells = `<td class="rownum">${i + 1}</td>`;
      for (let c = 0; c < ncols; c++) cells += `<td${colNumeric[c] ? ' class="num"' : ""}>${esc(r[c] ?? "")}</td>`;
      parts[k] = `<tr>${cells}</tr>`;
    }
    tbodyEl.innerHTML = parts.join("");
    updateArrows();
    countEl.textContent = view.length === rows.length
      ? `${rows.length.toLocaleString()} rows`
      : `${view.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`;
  }

  // ---- Events ----
  theadEl.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    if (e.target.closest(".resizer")) return; // resizing, not sorting
    const c = Number(th.dataset.col);
    if (c < 0) return; // rownum column
    if (sortCol !== c) { sortCol = c; sortDir = "asc"; }
    else if (sortDir === "asc") sortDir = "desc";
    else { sortCol = null; sortDir = "asc"; } // third click clears
    render();
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
    else if (e.key === "Escape" && document.activeElement === searchEl) {
      if (searchEl.value) { searchEl.value = ""; render(); } else searchEl.blur();
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
