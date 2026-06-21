<p align="center">
  <img src="firefox-extension/icon.svg" alt="Drop CSV Viewer logo" width="96" height="96">
</p>

# Drop CSV Viewer

Drag a CSV or TSV onto any Firefox tab and read it instantly as a sortable, filterable
table — no link to open, no upload, no Excel. Fully local and open source.

Two ways to use it:

- **`firefox-extension/`** — the Firefox / Zen extension: drag a `.csv` / `.tsv` onto any
  page and it opens as a table in a new tab. See
  [firefox-extension/README.md](firefox-extension/README.md) for install & signing.
- **`viewer.html`** — a standalone single-file viewer. Open it in any browser and drop a
  CSV on it. Zero install, works offline, nothing leaves your machine.

## Chrome / Chromium

The same code runs on Chrome via a one-line `browser`/`chrome` shim — only the MV3
manifest (`chrome/manifest.json`) and PNG icons differ. Build a loadable copy with:

```bash
bash build-chrome.sh        # → dist/chrome/
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `dist/chrome/`.

**Note:** for local `file://` CSVs, turn on **"Allow access to file URLs"** on the
extension's details page (Chrome blocks file access by default). Dropping a CSV onto a
normal web page works without it.

## Features

- Type-to-filter across all columns (press `/` to focus, `Esc` to clear)
- Click a header to sort (asc → desc → off); numeric columns detected and sorted as numbers
- Drag a header's right edge to resize columns; sticky header + first column
- Download the current view (filter + sort applied) back to CSV
- Light/dark via system theme

## Privacy

Everything runs locally in the browser. No network requests, no analytics — CSV data is
read via the File API / in-memory messaging and never leaves your machine. Built for small
files (≤ ~5k rows); every row is rendered, no virtualization.
