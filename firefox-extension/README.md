# Drop CSV Viewer — Firefox extension

Drag a `.csv` / `.tsv` onto any open web page → it opens as a searchable, sortable
table in a new tab. No network, no data leaves your machine.

Type-to-filter, click headers to sort, drag a header's right edge to resize a column,
and use the ⤓ button to download the current view (filter + sort applied) as CSV.

## How it works

Firefox treats `.csv` as a *download*, not a viewable page, and extensions can't read
a `file://` path by URL (`fetch` is blocked). The one thing that *does* work is reading
a **dropped `File`** via the File API — so:

1. `dropviewer.js` (content script on every page) catches a `.csv`/`.tsv` drop, reads
   the file's bytes, and sends the text to the background.
2. `background.js` opens `viewer.html` in a new tab and hands it the text in memory.
3. `viewer.html` / `viewer.js` renders the table.

Fallback: dropping on a blank new tab, or opening a `.csv` link/URL directly, can't be
caught by a content script, so the background **redirects** to the viewer, which shows a
"drag the file here" prompt (web `https://…csv` URLs it can still fetch and render).

```
manifest.json   – MV2
dropviewer.js   – drop interceptor (reads the File, the part that actually works)
background.js    – new-tab opener + navigation redirect fallback
viewer.html      – table UI (shell + styles)
viewer.js        – parsing / sort / filter / resize / CSV export + ?id= / ?src= load
icon.svg         – extension icon (emerald droplet logo)
```

## Behaviour & caveats

- **Intercepts CSV drops on all sites.** Dragging a `.csv` into a web app's upload box
  will open the table instead of uploading. Disable the extension when you need that.
  (Drops onto text inputs are left alone; non-CSV files are never touched.)
- **Blank new tab:** a drop there falls back to the 2-step prompt (no content script on
  `about:` pages). Drop onto any real page for the one-drag experience.
- Built for small files (≤ ~5k rows) — renders every row, no virtualization.

## Try it now (no signing)

1. Remove any older build first: `about:addons` → Drop CSV Viewer → Remove.
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
3. Open any normal web page, drag `../sample.csv` onto it → a new tab opens with the table.

⚠️ Temporary add-ons vanish on restart — sign it for a permanent install.

## Permanent install (signing)

Version is **1.3.0** (bump `"version"` again if you change anything — AMO won't re-sign
the same version).

```bash
npm i -g web-ext
cd firefox-extension
web-ext run                       # dev: scratch Firefox with the extension loaded
web-ext sign --channel=unlisted \ # keys: https://addons.mozilla.org/developers/addon/api/key/
  --api-key=YOUR_KEY --api-secret=YOUR_SECRET
```

Install the signed `.xpi` from `web-ext-artifacts/` (it replaces the older build).
**Dev Edition / Nightly / ESR:** set `xpinstall.signatures.required = false` in
`about:config` and install the unsigned `.xpi` directly.
