const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const REQUIRED = ["PW_App.js", "PW_Storage.js", "PW_Scraper.js", "PW_Analytics.js"];

for (const name of REQUIRED) {
  const path = fm.joinPath(dir, name);
  if (!fm.fileExists(path)) {
    const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/"));
    req.timeoutInterval = 30;
    const text = await req.loadString();
    if (!text || text.length < 20) throw new Error("Could not download " + name);
    fm.writeString(path, text);
  }
}

const App = importModule("PW_App");
await App.run();
Script.complete();
