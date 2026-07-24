// One-tap installer for Scriptable Price Watcher v0.9.2
const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const VERSION = "0.9.2";
const FILES = [
  "Price Watcher.js",
  "PW_App.js",
  "PW_Storage.js",
  "PW_Scraper.js",
  "PW_Analytics.js",
  "PW_Radar.js",
  "PW_RetailerIntel.js",
  "PW_StockIntel.js",
  "PW_Updater.js",
  "PW_Briefing.js"
];
const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();

function patchApp(text) {
  return text
    .replace('const APP_VERSION = "0.9.0";', `const APP_VERSION = "${VERSION}";`)
    .replace('a.addTextField("https://…", Pasteboard.pasteString() || "");', 'a.addTextField("https://…", "");')
    .replace('const url = a.textFieldValue(0).replace(/[\\u200B-\\u200D\\uFEFF]/g, "").trim();', 'const field = index => String(a.textFieldValue(index) || "");\n  const url = field(0).replace(/[\\u200B-\\u200D\\uFEFF]/g, "").trim();')
    .replace('const targetText = a.textFieldValue(1).trim().replace(",", ".");', 'const targetText = field(1).trim().replace(",", ".");')
    .replace('const trackedSize = a.textFieldValue(3).replace(/^UK\\s*/i, "").trim();', 'const collection = field(2).trim();\n  const trackedSize = field(3).replace(/^UK\\s*/i, "").trim();')
    .replace('favourite: false, collection: a.textFieldValue(2).trim(), trackedSize,', 'favourite: false, collection, trackedSize,')
    .replace('const text = a.textFieldValue(0).trim().replace(",", ".");', 'const text = String(a.textFieldValue(0) || "").trim().replace(",", ".");')
    .replace('item.collection = a.textFieldValue(0).trim(); return true;', 'item.collection = String(a.textFieldValue(0) || "").trim(); return true;')
    .replace('item.trackedSize = a.textFieldValue(0).replace(/^UK\\s*/i, "").trim();', 'item.trackedSize = String(a.textFieldValue(0) || "").replace(/^UK\\s*/i, "").trim();');
}

for (const name of FILES) {
  const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/") + `?t=${Date.now()}`);
  req.timeoutInterval = 30;
  let text = await req.loadString();
  if (!text || text.length < 20) throw new Error("Could not download " + name);
  if (name === "PW_App.js") text = patchApp(text);
  fm.writeString(fm.joinPath(dir, name), text);
}

fm.writeString(fm.joinPath(dir, "PW_Manifest.json"), JSON.stringify({
  version: VERSION,
  installedAt: new Date().toISOString(),
  files: FILES
}, null, 2));

const a = new Alert();
a.title = `Price Watcher v${VERSION} installed`;
a.message = "The Add Product form has been fixed. Empty optional fields are now safe and the URL box opens blank. Your products and price history have been kept.";
a.addAction("OK");
await a.presentAlert();
Script.complete();