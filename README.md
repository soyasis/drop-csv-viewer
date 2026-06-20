<p align="center">
  <img src="firefox-extension/icon.svg" alt="CSV Table Viewer logo" width="96" height="96">
</p>

# firefox-csv-viewer

Preview local CSV/TSV files as a clean, searchable, sortable table — without opening
Excel or Numbers.

Two ways to use it:

- **`viewer.html`** — a standalone single-file viewer. Open it in any browser and drag a
  CSV onto it. Zero install, works offline, nothing leaves your machine.
- **`firefox-extension/`** — a Firefox / Zen extension: drag a `.csv` / `.tsv` onto any
  page and it opens as a table in a new tab. See
  [firefox-extension/README.md](firefox-extension/README.md) for install & signing.

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
