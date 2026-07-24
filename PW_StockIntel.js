// Scriptable can return null for optional Alert text fields on some devices.
// Normalise those values so callers can safely use trim() and replace().
if (!globalThis.__PW_ALERT_TEXT_FIELD_PATCHED__) {
  const originalTextFieldValue = Alert.prototype.textFieldValue;
  Alert.prototype.textFieldValue = function(index) {
    const value = originalTextFieldValue.call(this, index);
    return value == null ? "" : String(value);
  };
  globalThis.__PW_ALERT_TEXT_FIELD_PATCHED__ = true;
}

function daysBetween(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function latest(history, predicate) {
  for (let i = history.length - 1; i >= 0; i--) if (predicate(history[i])) return history[i];
  return null;
}

function analyse(item) {
  const history = Array.isArray(item.stockHistory) ? item.stockHistory : [];
  const now = item.checkedAt || new Date().toISOString();
  const available = item.sizeAvailable === true;
  const soldOut = item.sizeAvailable === false;
  const lowStockQuantity = Number.isFinite(Number(item.lowStockQuantity)) ? Number(item.lowStockQuantity) : null;
  const availableSizeCount = Number(item.availableSizeCount || (item.availableSizes || []).length || 0);
  const totalSizeCount = Number(item.totalSizeCount || 0);

  const lastAvailable = latest(history, x => x.sizeAvailable === true);
  const lastSoldOut = latest(history, x => x.sizeAvailable === false);
  const lastChange = latest(history, (x, i) => i > 0 && x.sizeAvailable !== history[i - 1].sizeAvailable);
  const unavailableDays = soldOut && lastAvailable ? daysBetween(lastAvailable.date, now) : 0;
  const availableDays = available && lastSoldOut ? daysBetween(lastSoldOut.date, now) : 0;
  const restocks = history.reduce((count, x, i) => count + (i > 0 && history[i - 1].sizeAvailable === false && x.sizeAvailable === true ? 1 : 0), 0);
  const sellOuts = history.reduce((count, x, i) => count + (i > 0 && history[i - 1].sizeAvailable === true && x.sizeAvailable === false ? 1 : 0), 0);

  let risk = "unknown";
  let score = 0;
  const reasons = [];

  if (!item.trackedSize) return { status: "NOT TRACKED", risk, score, reasons, restocks, sellOuts, unavailableDays, availableDays };
  if (soldOut) {
    risk = "sold-out";
    score = 100;
    reasons.push(`UK ${item.trackedSize} is sold out`);
    if (unavailableDays) reasons.push(`Unavailable for ${unavailableDays} day${unavailableDays === 1 ? "" : "s"}`);
  } else if (available) {
    if (lowStockQuantity !== null) {
      risk = lowStockQuantity <= 2 ? "critical" : lowStockQuantity <= 5 ? "high" : "moderate";
      score = lowStockQuantity <= 2 ? 95 : lowStockQuantity <= 5 ? 80 : 60;
      reasons.push(`Only ${lowStockQuantity} left in UK ${item.trackedSize}`);
    } else if (item.scarcity === "very-low") {
      risk = "high"; score = 78; reasons.push("Very few sizes remain available");
    } else if (item.scarcity === "low") {
      risk = "moderate"; score = 58; reasons.push("Size range is becoming limited");
    } else {
      risk = "low"; score = 25; reasons.push(`UK ${item.trackedSize} is available`);
    }
    if (availableDays) reasons.push(`Back in stock for ${availableDays} day${availableDays === 1 ? "" : "s"}`);
  } else {
    reasons.push("Availability could not be confirmed");
  }

  if (totalSizeCount && availableSizeCount) reasons.push(`${availableSizeCount} of ${totalSizeCount} sizes available`);
  if (restocks) reasons.push(`${restocks} restock${restocks === 1 ? "" : "s"} observed`);
  if (sellOuts) reasons.push(`${sellOuts} sell-out${sellOuts === 1 ? "" : "s"} observed`);

  const action = soldOut ? "WAIT" : score >= 80 ? "BUY NOW" : score >= 55 ? "BUY SOON" : available ? "WATCH" : "CHECK";
  const status = soldOut ? "SOLD OUT" : available ? (lowStockQuantity ? `ONLY ${lowStockQuantity} LEFT` : item.scarcity === "very-low" ? "VERY LIMITED" : item.scarcity === "low" ? "LIMITED SIZES" : "IN STOCK") : "UNKNOWN";

  return {
    status,
    action,
    risk,
    score,
    reasons,
    restocks,
    sellOuts,
    unavailableDays,
    availableDays,
    lastChangeAt: lastChange ? lastChange.date : null,
    lowStockQuantity,
    availableSizeCount,
    totalSizeCount
  };
}

function record(item, details, date = new Date().toISOString()) {
  item.stockHistory = Array.isArray(item.stockHistory) ? item.stockHistory : [];
  const snapshot = {
    date,
    sizeAvailable: item.trackedSize ? details.sizeAvailable : null,
    availableSizes: Array.isArray(details.availableSizes) ? details.availableSizes : [],
    lowStockQuantity: Number.isFinite(Number(details.lowStockQuantity)) ? Number(details.lowStockQuantity) : null,
    scarcity: details.scarcity || null,
    availableSizeCount: Number(details.availableSizeCount || 0),
    totalSizeCount: Number(details.totalSizeCount || 0)
  };
  const last = item.stockHistory[item.stockHistory.length - 1];
  const changed = !last || last.sizeAvailable !== snapshot.sizeAvailable || last.lowStockQuantity !== snapshot.lowStockQuantity || last.scarcity !== snapshot.scarcity || JSON.stringify(last.availableSizes || []) !== JSON.stringify(snapshot.availableSizes);
  if (changed) item.stockHistory.push(snapshot);
  item.stockHistory = item.stockHistory.slice(-180);
  item.lowStockQuantity = snapshot.lowStockQuantity;
  item.scarcity = snapshot.scarcity;
  item.availableSizeCount = snapshot.availableSizeCount;
  item.totalSizeCount = snapshot.totalSizeCount;
  return snapshot;
}

module.exports = { analyse, record };
