const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const REMOTE_MANIFEST = "manifest.json";
const LOCAL_MANIFEST = "PW_Manifest.json";
const INSTALLER_VERSION = "1.0.0";

function compareVersions(a, b) {
  const left = String(a || "0").split(".").map(Number);
  const right = String(b || "0").split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] || 0, y = right[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function downloadText(name) {
  const req = new Request(BASE + encodeURIComponent(name).replace(/%2F/g, "/") + `?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const text = await req.loadString();
  if (!text || text.length < 2) throw new Error(`Could not download ${name}`);
  return text;
}

function localManifest(fm, dir) {
  const path = fm.joinPath(dir, LOCAL_MANIFEST);
  if (!fm.fileExists(path)) return { version: "0.0.0", files: [] };
  try { return JSON.parse(fm.readString(path)); }
  catch (_) { return { version: "0.0.0", files: [] }; }
}

async function remoteManifest() {
  const manifest = JSON.parse(await downloadText(REMOTE_MANIFEST));
  if (!manifest.version || !Array.isArray(manifest.files)) throw new Error("Invalid update manifest");
  if (compareVersions(INSTALLER_VERSION, manifest.minimumInstallerVersion || "0.0.0") < 0) {
    throw new Error("The updater itself is too old. Run Install Price Watcher once to upgrade it.");
  }
  return manifest;
}

async function check() {
  const fm = FileManager.iCloud();
  const dir = fm.documentsDirectory();
  const local = localManifest(fm, dir);
  const remote = await remoteManifest();
  return {
    available: compareVersions(remote.version, local.version) > 0,
    localVersion: local.version || "0.0.0",
    remoteVersion: remote.version,
    releaseNotes: Array.isArray(remote.releaseNotes) ? remote.releaseNotes : [],
    manifest: remote
  };
}

async function install(manifest) {
  const fm = FileManager.iCloud();
  const dir = fm.documentsDirectory();
  const staging = [];

  for (const name of manifest.files) {
    if (name === "manifest.json") continue;
    const text = await downloadText(name);
    staging.push({ name, text });
  }

  for (const file of staging) {
    fm.writeString(fm.joinPath(dir, file.name), file.text);
  }

  fm.writeString(fm.joinPath(dir, LOCAL_MANIFEST), JSON.stringify({
    version: manifest.version,
    installedAt: new Date().toISOString(),
    files: manifest.files
  }, null, 2));

  return staging.length;
}

async function promptIfAvailable() {
  let result;
  try { result = await check(); }
  catch (e) { return { checked: false, updated: false, error: String(e.message || e) }; }
  if (!result.available) return { checked: true, updated: false, ...result };

  const a = new Alert();
  a.title = `Price Watcher ${result.remoteVersion} available`;
  const notes = result.releaseNotes.length ? `\n\n${result.releaseNotes.map(x => `• ${x}`).join("\n")}` : "";
  a.message = `Installed: ${result.localVersion}${notes}\n\nYour watched products and price history will be kept.`;
  a.addAction("Update now");
  a.addCancelAction("Later");
  if (await a.presentAlert() === -1) return { checked: true, updated: false, ...result };

  const count = await install(result.manifest);
  const done = new Alert();
  done.title = `Updated to ${result.remoteVersion}`;
  done.message = `${count} app files were updated. Price Watcher will now continue.`;
  done.addAction("Continue");
  await done.presentAlert();
  return { checked: true, updated: true, ...result };
}

module.exports = { check, install, promptIfAvailable, compareVersions };