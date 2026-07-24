const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const REQUIRED = [
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

async function ensureFile(name) {
  const path = fm.joinPath(dir, name);
  if (fm.fileExists(path)) return;
  const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/") + `?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const text = await req.loadString();
  if (!text || text.length < 20) throw new Error("Could not download " + name);
  fm.writeString(path, text);
}

for (const name of REQUIRED) await ensureFile(name);

if (!config.runsInWidget) {
  try {
    const Updater = importModule("PW_Updater");
    await Updater.promptIfAvailable();
  } catch (e) {
    console.log("Update check skipped: " + String(e.message || e));
  }
}

const App = importModule("PW_App");

if (!config.runsInWidget) {
  try {
    const Briefing = importModule("PW_Briefing");
    await Briefing.show();
  } catch (e) {
    console.log("Briefing skipped: " + String(e.message || e));
  }
}

await App.run();
Script.complete();