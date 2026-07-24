const Storage = importModule("PW_Storage");
const Radar = importModule("PW_Radar");

function money(value, currency) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value); }
  catch (_) { return `${currency || "GBP"} ${Number(value || 0).toFixed(2)}`; }
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning ☀️";
  if (hour < 18) return "Good afternoon 👋";
  return "Good evening 🌙";
}

function recommendation(entry) {
  if (!entry) return "";
  if (entry.targetReached || (entry.allTimeLow && entry.insight.score >= 70) || entry.insight.score >= 85) return "🟢 BUY NOW";
  if (entry.increased || entry.insight.score < 45) return "🟠 WAIT";
  return "🔵 WATCH";
}

async function show() {
  const items = await Storage.load();
  if (!items.length) return;

  const radar = Radar.analyseAll(items);
  const best = radar.topDeals[0] || radar.entries[0];
  const currency = best && best.item.currency ? best.item.currency : (items[0].currency || "GBP");

  const lines = [
    `I checked ${items.length} product${items.length === 1 ? "" : "s"}.`,
    "",
    `🔥 ${radar.greatDeals} great deal${radar.greatDeals === 1 ? "" : "s"}`,
    `📉 ${radar.priceDrops} price drop${radar.priceDrops === 1 ? "" : "s"}`,
    `🎯 ${radar.targetsReached} target${radar.targetsReached === 1 ? "" : "s"} reached`,
    `💰 ${money(radar.totalPotentialSavings, currency)} potential savings`
  ];

  if (best) {
    lines.push("", "Best opportunity today", recommendation(best), best.item.title, money(best.item.currentPrice, best.item.currency));
    if (best.allTimeLow) lines.push("Lowest recorded price");
    else if (best.dropped) lines.push("Price has just dropped");
  }

  const a = new Alert();
  a.title = greeting();
  a.message = lines.join("\n");
  a.addAction("Open Deal Radar");
  a.addCancelAction("Skip");
  await a.presentAlert();
}

module.exports = { show };