// One-tap installer for Scriptable Price Watcher v0.9.0
const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
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

for (const name of FILES) {
  const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/") + `?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const text = await req.loadString();
  if (!text || text.length < 20) throw new Error("Could not download " + name);
  fm.writeString(fm.joinPath(dir, name), text);
}

const a = new Alert();
a.title = "Price Watcher v0.9.0 installed";
a.message = "Stock history, scarcity detection, size-aware recommendations, Deal Radar, retailer intelligence, automatic updates and daily briefing are installed. Open 'Price Watcher' and run it.";
a.addAction("OK");
await a.presentAlert();
Script.complete();