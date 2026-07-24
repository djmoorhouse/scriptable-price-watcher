const BASE = "https://raw.githubusercontent.com/djmoorhouse/scriptable-price-watcher/main/";
const LOCAL_MANIFEST = "PW_Manifest.json";
const INSTALLER_VERSION = "1.0.0";

function compareVersions(a, b) {
  const left = String(a || "0").split(".").map(Number);
  const right = String(b || "0").split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] || 0, y = right[i] || 0;
   