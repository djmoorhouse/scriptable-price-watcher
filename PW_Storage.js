const fm = FileManager.iCloud();
const dir = fm.joinPath(fm.documentsDirectory(), "PriceWatcher");
const file = fm.joinPath(dir, "products.json");

async function ensure() {
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  if (fm.fileExists(file) && fm.isFileStoredIniCloud(file) && !fm.isFileDownloaded(file)) {
    await fm.downloadFileFromiCloud(file);
  }
}

async function load() {
  await ensure();
  if (!fm.fileExists(file)) return [];
  try {
    const data = JSON.parse(fm.readString(file));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function save(items) {
  await ensure();
  fm.writeString(file, JSON.stringify(items, null, 2));
}

module.exports = { load, save };
