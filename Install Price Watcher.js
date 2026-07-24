// One-tap installer for Scriptable Price Watcher
const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const FILES = ["Price Watcher.js", "PW_Storage.js", "PW_Scraper.js"];
const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();

for (const name of FILES) {
  const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/"));
  req.timeoutInterval = 30;
  const text = await req.loadString();
  if (!text || text.length < 20) throw new Error("Could not download " + name);
  fm.writeString(fm.joinPath(dir, name), text);
}

const a = new Alert();
a.title = "Price Watcher installed";
a.message = "Open the new ‘Price Watcher’ script in Scriptable and run it.";
a.addAction("OK");
await a.presentAlert();
Script.complete();
