// Background script.
// (1) Receives dropped-CSV text from the content script and opens it as a table in a
//     new tab — passing the text in memory, since the viewer can't read file:// itself.
// (2) Redirects direct .csv/.tsv navigations (blank tab drop, clicked link, typed URL)
//     to the viewer as a fallback.
const browser = globalThis.browser ?? globalThis.chrome; // Firefox / Chrome API shim
const pending = new Map();
let seq = 0;

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "csv") {
    const id = String(++seq);
    pending.set(id, { name: msg.name, text: msg.text });
    browser.tabs.create({ url: browser.runtime.getURL("viewer.html") + "?id=" + id });
    return; // no response needed
  }
  if (msg && msg.type === "get") {
    const data = pending.get(msg.id) || null;
    pending.delete(msg.id); // one-shot
    return Promise.resolve(data); // async reply to the viewer
  }
});

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // top-level navigations only
  const path = details.url.split(/[?#]/)[0].toLowerCase();
  if (!path.endsWith(".csv") && !path.endsWith(".tsv")) return;
  browser.tabs.update(details.tabId, {
    url: browser.runtime.getURL("viewer.html") + "?src=" + encodeURIComponent(details.url),
  });
});
