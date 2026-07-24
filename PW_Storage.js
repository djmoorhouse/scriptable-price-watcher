const fm = FileManager.iCloud();
const dir = fm.joinPath(fm.documentsDirectory(), "PriceWatcher");
const file = fm.joinPath(dir, "products.json");

const local = FileManager.local();
const cacheDir = local.joinPath(local.documentsDirectory(), "PriceWatcherCache");

async function ensure() {
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  if (fm.fileExists(file) && fm.isFileStoredIniCloud(file) && !fm.isFileDownloaded(file)) {
    await fm.downloadFileFromiCloud(file);
  }
  if (!local.fileExists(cacheDir)) local.createDirectory(cacheDir, true);
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

function cacheName(key) {
  return String(key || "image").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) + ".jpg";
}

async function loadCachedImage(key, url, maxAgeHours = 168) {
  if (!url) return null;
  await ensure();
  const path = local.joinPath(cacheDir, cacheName(key));
  if (local.fileExists(path)) {
    const modified = local.modificationDate(path);
    const fresh = modified && Date.now() - modified.getTime() < maxAgeHours * 3600000;
    if (fresh) {
      try { return local.readImage(path); } catch (_) {}
    }
  }
  try {
    const req = new Request(url);
    req.timeoutInterval = 20;
    const image = await req.loadImage();
    local.writeImage(path, image);
    return image;
  } catch (_) {
    if (local.fileExists(path)) {
      try { return local.readImage(path); } catch (_) {}
    }
    return null;
  }
}

function removeCachedImage(key) {
  if (!local.fileExists(cacheDir)) return;
  const path = local.joinPath(cacheDir, cacheName(key));
  if (local.fileExists(path)) local.remove(path);
}

module.exports = { load, save, loadCachedImage, removeCachedImage };
