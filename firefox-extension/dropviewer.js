// Drop CSV Viewer — drop interceptor (runs on every page).
// Catches a .csv/.tsv file dropped anywhere, reads it via the File API, and hands the
// text to the background script, which opens it as a table in a new tab. Reading a
// dropped File needs no file:// access — which is why this works where fetch() didn't.
(() => {
  "use strict";

  const isCsvFile = (f) => !!f && /\.(csv|tsv)$/i.test(f.name);
  const dragHasFile = (dt) => !!dt && Array.from(dt.types || []).includes("Files");

  // Mark the page as a drop target for file drags (else the browser navigates to the file).
  window.addEventListener("dragover", (e) => {
    if (dragHasFile(e.dataTransfer)) e.preventDefault();
  }, true);

  window.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!isCsvFile(f)) return; // not a CSV → leave the drop to the page / browser
    // Don't hijack drops onto text fields (a site's own upload/paste targets).
    if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable],[role="textbox"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const reader = new FileReader();
    reader.onload = () => browser.runtime.sendMessage({ type: "csv", name: f.name, text: String(reader.result) });
    reader.readAsText(f);
  }, true);
})();
