const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");
const Analytics = importModule("PW_Analytics");
const Radar = importModule("PW_Radar");
const RetailerIntel = importModule("PW_RetailerIntel");
const StockIntel = importModule("PW_StockIntel");
const APP_VERSION = "0.9.0";

function money(value, currency) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value); }
  catch (_) { return `${currency || "GBP"} ${Number(value).toFixed(2)}`; }
}

function storeName(url) {
  const host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
  const name = host.split(".")[0] || "shop";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function sizeLabel(item) {
  if (!item.trackedSize) return "";
  const stock = StockIntel.analyse(item);
  return `UK ${item.trackedSize} • ${stock.status}`;
}

function normalise(item) {
  item.store = item.store || storeName(item.url);
  item.initialPrice = Number.isFinite(Number(item.initialPrice)) ? Number(item.initialPrice) : Number(item.currentPrice);
  item.lowestPrice = Number.isFinite(Number(item.lowestPrice)) ? Number(item.lowestPrice) : Number(item.currentPrice);
  item.history = Array.isArray(item.history) ? item.history : [];
  item.stockHistory = Array.isArray(item.stockHistory) ? item.stockHistory : [];
  item.favourite = item.favourite === true;
  item.collection = String(item.collection || "").trim();
  item.trackedSize = String(item.trackedSize || "").replace(/^UK\s*/i, "").trim();
  item.availableSizes = Array.isArray(item.availableSizes) ? item.availableSizes : [];
  if (item.sizeAvailable !== true && item.sizeAvailable !== false) item.sizeAvailable = null;
  return item;
}

async function alert(title, message) {
  const a = new Alert(); a.title = title; a.message = message; a.addAction("OK"); await a.presentAlert();
}

async function cachedImage(item) {
  return await Storage.loadCachedImage(item.id || item.url, item.imageUrl);
}

async function addProduct() {
  const a = new Alert();
  a.title = "Add product";
  a.message = "Paste a product URL. Target price, collection and clothing size are optional.";
  a.addTextField("https://…", Pasteboard.pasteString() || "");
  a.addTextField("Target price", "");
  a.addTextField("Collection", "");
  a.addTextField("UK size, e.g. 10", "");
  a.addAction("Add"); a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return null;
  const url = a.textFieldValue(0).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) { await alert("Invalid URL", "Paste a complete URL beginning with http:// or https://"); return null; }
  const targetText = a.textFieldValue(1).trim().replace(",", ".");
  const targetPrice = targetText ? Number(targetText) : null;
  if (targetText && (!Number.isFinite(targetPrice) || targetPrice <= 0)) { await alert("Invalid target", "Enter a positive number or leave it blank."); return null; }
  const trackedSize = a.textFieldValue(3).replace(/^UK\s*/i, "").trim();
  try {
    const details = await Scraper.scrape(url, trackedSize);
    const now = new Date().toISOString();
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url, store: storeName(url), title: details.title, imageUrl: details.imageUrl,
      currency: details.currency, initialPrice: details.price, currentPrice: details.price,
      previousPrice: null, lowestPrice: details.price, targetPrice,
      favourite: false, collection: a.textFieldValue(2).trim(), trackedSize,
      sizeAvailable: trackedSize ? details.sizeAvailable : null, availableSizes: details.availableSizes || [],
      createdAt: now, checkedAt: now, history: [{ date: now, price: details.price }], stockHistory: []
    };
    StockIntel.record(item, details, now);
    await cachedImage(item);
    return item;
  } catch (e) { await alert("Couldn’t add product", String(e.message || e)); return null; }
}

async function editTarget(item) {
  const a = new Alert(); a.title = "Target price"; a.addTextField("Target price", Number.isFinite(item.targetPrice) ? String(item.targetPrice) : "");
  a.addAction("Save"); a.addCancelAction("Cancel"); if (await a.presentAlert() === -1) return false;
  const text = a.textFieldValue(0).trim().replace(",", ".");
  if (!text) { item.targetPrice = null; return true; }
  const value = Number(text); if (!Number.isFinite(value) || value <= 0) { await alert("Invalid target", "Enter a positive number."); return false; }
  item.targetPrice = value; return true;
}

async function editCollection(item) {
  const a = new Alert(); a.title = "Collection"; a.addTextField("Collection", item.collection || "");
  a.addAction("Save"); a.addCancelAction("Cancel"); if (await a.presentAlert() === -1) return false;
  item.collection = a.textFieldValue(0).trim(); return true;
}

async function editSize(item) {
  const a = new Alert(); a.title = "Tracked UK size"; a.message = "Leave blank to stop size tracking.";
  a.addTextField("UK size, e.g. 10", item.trackedSize || "");
  a.addAction("Save"); a.addCancelAction("Cancel"); if (await a.presentAlert() === -1) return false;
  item.trackedSize = a.textFieldValue(0).replace(/^UK\s*/i, "").trim();
  item.sizeAvailable = null; item.availableSizes = []; item.stockHistory = [];
  return true;
}

async function refreshItem(item, notify = true) {
  normalise(item);
  const oldPrice = Number(item.currentPrice);
  const oldSizeAvailable = item.sizeAvailable;
  const oldStock = StockIntel.analyse(item);
  const details = await Scraper.scrape(item.url, item.trackedSize);
  const newPrice = Number(details.price);
  item.title = details.title || item.title; item.imageUrl = details.imageUrl || item.imageUrl; item.currency = details.currency || item.currency;
  item.previousPrice = oldPrice; item.currentPrice = newPrice; item.lowestPrice = Math.min(item.lowestPrice, newPrice);
  item.availableSizes = details.availableSizes || [];
  item.sizeAvailable = item.trackedSize ? details.sizeAvailable : null;
  item.checkedAt = new Date().toISOString(); item.lastError = null;
  StockIntel.record(item, details, item.checkedAt);
  const stock = StockIntel.analyse(item);
  const last = item.history[item.history.length - 1]; if (!last || Number(last.price) !== newPrice) item.history.push({ date: item.checkedAt, price: newPrice });
  item.history = item.history.slice(-100); await cachedImage(item);
  const dropped = Number.isFinite(oldPrice) && newPrice < oldPrice;
  const hitTarget = Number.isFinite(item.targetPrice) && newPrice <= item.targetPrice && oldPrice > item.targetPrice;
  const backInStock = Boolean(item.trackedSize) && oldSizeAvailable === false && item.sizeAvailable === true;
  const soldOut = Boolean(item.trackedSize) && oldSizeAvailable === true && item.sizeAvailable === false;
  const becameScarce = Boolean(item.trackedSize) && item.sizeAvailable === true && stock.score >= 80 && oldStock.score < 80;
  if (notify && (dropped || hitTarget || backInStock || soldOut || becameScarce)) {
    const insight = Analytics.analyse(item); const intel = RetailerIntel.analyse(item, insight); const n = new Notification();
    n.title = backInStock ? `BACK IN STOCK • UK ${item.trackedSize}` : soldOut ? `SOLD OUT • UK ${item.trackedSize}` : becameScarce ? `${stock.action} • ${stock.status}` : `${intel.action} • ${"★".repeat(insight.stars)} ${insight.label}`;
    n.body = `${item.title}\n${money(oldPrice, item.currency)} → ${money(newPrice, item.currency)}${item.trackedSize ? `\n${sizeLabel(item)}` : ""}\n${stock.reasons[0] || intel.advice}`;
    n.openURL = item.url; await n.schedule();
  }
}

async function refreshAll(items, notify = true) {
  let changed = 0, failed = 0;
  for (const item of items) {
    const before = `${item.currentPrice}|${item.sizeAvailable}|${item.lowStockQuantity}|${item.scarcity}`;
    try { await refreshItem(item, notify); if (`${item.currentPrice}|${item.sizeAvailable}|${item.lowStockQuantity}|${item.scarcity}` !== before) changed++; }
    catch (e) { item.lastError = String(e.message || e); failed++; }
  }
  await Storage.save(items); return { changed, failed };
}

function chartImage(item) {
  const history = (item.history || []).slice(-30); const points = history.length === 1 ? [history[0], history[0]] : history;
  const width = 640, height = 300, left = 76, right = 24, top = 30, bottom = 48;
  const ctx = new DrawContext(); ctx.size = new Size(width, height); ctx.opaque = true;
  ctx.setFillColor(new Color("111111")); ctx.fillRect(new Rect(0, 0, width, height));
  if (!points.length) { ctx.setTextColor(Color.white()); ctx.setFont(Font.systemFont(22)); ctx.drawTextInRect("No price history yet", new Rect(30, 120, 580, 40)); return ctx.getImage(); }
  const values = points.map(x => Number(x.price)); let min = Math.min(...values), max = Math.max(...values); if (min === max) { min *= 0.95; max *= 1.05; }
  const range = max - min; const path = new Path();
  points.forEach((entry, i) => { const x = left + (width - left - right) * i / Math.max(1, points.length - 1); const y = top + (max - Number(entry.price)) / range * (height - top - bottom); if (!i) path.move(new Point(x, y)); else path.addLine(new Point(x, y)); });
  ctx.addPath(path); ctx.setStrokeColor(new Color("55d66b")); ctx.setLineWidth(5); ctx.strokePath();
  ctx.setTextColor(Color.white()); ctx.setFont(Font.boldSystemFont(18)); ctx.drawTextInRect(`${money(values[values.length - 1], item.currency)} now`, new Rect(left, height - 38, 300, 28));
  return ctx.getImage();
}

async function showHistory(item) {
  const table = new UITable(); table.showSeparators = false;
  const header = new UITableRow(); header.isHeader = true; header.height = 56; header.addText("Price history", item.title); table.addRow(header);
  const graph = new UITableRow(); graph.height = 190; graph.addImage(chartImage(item)).widthWeight = 100; table.addRow(graph);
  for (const entry of (item.history || []).slice(-20).reverse()) { const row = new UITableRow(); row.height = 42; row.addText(new Date(entry.date).toLocaleString(), money(entry.price, item.currency)); table.addRow(row); }
  await table.present(true);
}

async function showInsights(item) {
  const x = Analytics.analyse(item); const intel = RetailerIntel.analyse(item, x); const stock = StockIntel.analyse(item); const table = new UITable(); table.showSeparators = true;
  const header = new UITableRow(); header.isHeader = true; header.height = 72;
  const h = header.addText(`${item.trackedSize ? stock.action : intel.action} • ${"★".repeat(x.stars)} ${x.label}`, `${item.store} • ${intel.confidence} confidence • Deal score ${x.score}/100`); h.titleFont = Font.boldSystemFont(21); h.subtitleFont = Font.systemFont(12); table.addRow(header);
  if (item.trackedSize) {
    const size = new UITableRow(); size.height = 58; size.addText(`UK size ${item.trackedSize}`, `${stock.status} • risk ${stock.risk} • ${stock.score}/100`); table.addRow(size);
    const stockAdvice = new UITableRow(); stockAdvice.height = 76; stockAdvice.addText("Stock intelligence", stock.reasons.join(" • ") || "Building stock history"); table.addRow(stockAdvice);
  }
  const retailerAdvice = new UITableRow(); retailerAdvice.height = 92; retailerAdvice.addText("Retailer intelligence", intel.advice); table.addRow(retailerAdvice);
  const advice = new UITableRow(); advice.height = 66; advice.addText(x.advice, x.reasons.join(" • ")); table.addRow(advice);
  const stats = [["Current", x.current], ["Lowest", x.lowest], ["Highest", x.highest], ["Average", x.average], ["Saving", x.saving]];
  for (const [label, value] of stats) { const row = new UITableRow(); row.height = 42; row.addText(label, money(value, item.currency)); table.addRow(row); }
  const discount = new UITableRow(); discount.height = 42; discount.addText("Discount from start", `${intel.discountPercent}%`); table.addRow(discount);
  const tracked = new UITableRow(); tracked.height = 42; tracked.addText("Tracking", `${x.daysTracked} days • ${x.changes} price changes • ${(item.stockHistory || []).length} stock events`); table.addRow(tracked);
  const graph = new UITableRow(); graph.height = 48; graph.addText("View price graph", "Price history"); graph.onSelect = async () => await showHistory(item); table.addRow(graph);
  await table.present(true);
}

async function productMenu(item, items) {
  while (true) {
    const x = Analytics.analyse(item); const intel = RetailerIntel.analyse(item, x); const stock = StockIntel.analyse(item); const a = new Alert();
    a.title = `${item.favourite ? "★ " : ""}${item.title}`;
    a.message = `${item.trackedSize ? stock.action : intel.action} • ${intel.confidence} confidence\n${item.trackedSize ? stock.reasons.join(" • ") : intel.advice}${item.trackedSize ? `\n\n${sizeLabel(item)}` : ""}\n\n${"★".repeat(x.stars)} ${x.label} • ${x.score}/100\nCurrent: ${money(item.currentPrice, item.currency)}\nLowest: ${money(x.lowest, item.currency)}${Number.isFinite(item.targetPrice) ? `\nTarget: ${money(item.targetPrice, item.currency)}` : ""}`;
    a.addAction("View full insights"); a.addAction(item.favourite ? "Remove from favourites" : "Add to favourites"); a.addAction("Refresh now"); a.addAction("Edit target"); a.addAction("Edit collection"); a.addAction("Edit tracked size"); a.addAction("Open product page"); a.addDestructiveAction("Remove product"); a.addCancelAction("Back");
    const choice = await a.presentAlert(); if (choice === -1) return;
    if (choice === 0) await showInsights(item);
    else if (choice === 1) { item.favourite = !item.favourite; await Storage.save(items); }
    else if (choice === 2) { try { await refreshItem(item, true); await Storage.save(items); await alert("Updated", `${money(item.currentPrice, item.currency)}${item.trackedSize ? `\n${sizeLabel(item)}` : ""}`); } catch (e) { await alert("Refresh failed", String(e.message || e)); } }
    else if (choice === 3) { if (await editTarget(item)) await Storage.save(items); }
    else if (choice === 4) { if (await editCollection(item)) await Storage.save(items); }
    else if (choice === 5) { if (await editSize(item)) { await refreshItem(item, false); await Storage.save(items); } }
    else if (choice === 6) Safari.open(item.url);
    else if (choice === 7) { const c = new Alert(); c.title = "Remove product?"; c.addDestructiveAction("Remove"); c.addCancelAction("Cancel"); if (await c.presentAlert() === 0) { const i = items.findIndex(x => x.id === item.id); if (i >= 0) items.splice(i, 1); Storage.removeCachedImage(item.id || item.url); await Storage.save(items); return; } }
  }
}

async function makeWidget(items) {
  const w = new ListWidget(); w.backgroundColor = new Color("111111"); w.setPadding(12, 12, 12, 12);
  const heading = w.addText("PRICE WATCHER"); heading.font = Font.boldSystemFont(11); heading.textColor = new Color("aaaaaa"); w.addSpacer(8);
  if (!items.length) { w.addText("Run the script to add a product."); return w; }
  const index = Number(args.widgetParameter); const item = Number.isInteger(index) && items[index] ? items[index] : items.find(x => x.favourite) || items[0]; const x = Analytics.analyse(item); const intel = RetailerIntel.analyse(item, x); const stockIntel = StockIntel.analyse(item); w.url = item.url;
  const row = w.addStack(); row.layoutHorizontally(); const image = await cachedImage(item); if (image) { const img = row.addImage(image); img.imageSize = new Size(62, 62); img.cornerRadius = 9; row.addSpacer(10); }
  const text = row.addStack(); text.layoutVertically(); const title = text.addText(item.title); title.font = Font.semiboldSystemFont(13); title.textColor = Color.white(); title.lineLimit = 2;
  text.addSpacer(5); const price = text.addText(money(item.currentPrice, item.currency)); price.font = Font.boldSystemFont(20); price.textColor = Color.white();
  const action = item.trackedSize ? stockIntel.action : intel.action; const status = text.addText(`${action} • ${"★".repeat(x.stars)} ${x.score}/100`); status.font = Font.systemFont(10); status.textColor = new Color(action.indexOf("BUY") === 0 ? "55d66b" : action === "WAIT" ? "f3b33d" : "6db5ff");
  if (item.trackedSize) { const stock = text.addText(sizeLabel(item)); stock.font = Font.systemFont(9); stock.textColor = new Color(item.sizeAvailable === true ? "55d66b" : item.sizeAvailable === false ? "f05b5b" : "aaaaaa"); }
  return w;
}

function recommendation(entry) {
  if (entry.stockInsight && entry.item.trackedSize) return entry.stockInsight.action;
  if (entry.retailerInsight && entry.retailerInsight.action) return entry.retailerInsight.action;
  if (entry.targetReached || (entry.allTimeLow && entry.insight.score >= 70) || entry.insight.score >= 85) return "BUY";
  if (entry.increased || entry.insight.score < 45) return "WAIT";
  return "WATCH";
}

function trend(entry) { if (entry.dropped) return "↓"; if (entry.increased) return "↑"; return "→"; }
function shortTitle(value, length = 48) { const text = String(value || "Untitled product"); return text.length > length ? text.slice(0, length - 1) + "…" : text; }
function drawLabel(ctx, text, rect, font, color, alignment = "left") { ctx.setFont(font); ctx.setTextColor(color); if (alignment === "right") ctx.setTextAlignedRight(); else if (alignment === "center") ctx.setTextAlignedCenter(); else ctx.setTextAlignedLeft(); ctx.drawTextInRect(String(text), rect); }
function drawSparkline(ctx, item, rect, positive) { const history = (item.history || []).slice(-20); if (history.length < 2) { ctx.setStrokeColor(new Color("555555")); ctx.setLineWidth(3); const p = new Path(); p.move(new Point(rect.x, rect.y + rect.height / 2)); p.addLine(new Point(rect.x + rect.width, rect.y + rect.height / 2)); ctx.addPath(p); ctx.strokePath(); return; } const values = history.map(x => Number(x.price)).filter(Number.isFinite); if (values.length < 2) return; let min = Math.min(...values), max = Math.max(...values); if (min === max) { min -= 1; max += 1; } const p = new Path(); values.forEach((value, i) => { const x = rect.x + rect.width * i / (values.length - 1); const y = rect.y + (max - value) / (max - min) * rect.height; if (!i) p.move(new Point(x, y)); else p.addLine(new Point(x, y)); }); ctx.addPath(p); ctx.setStrokeColor(new Color(positive ? "55d66b" : "f3b33d")); ctx.setLineWidth(4); ctx.strokePath(); }

async function productCard(entry) {
  const item = entry.item, x = entry.insight, intel = entry.retailerInsight || RetailerIntel.analyse(item, x), stock = entry.stockInsight || StockIntel.analyse(item);
  const width = 720, height = 300; const ctx = new DrawContext(); ctx.size = new Size(width, height); ctx.opaque = true; ctx.respectScreenScale = true;
  ctx.setFillColor(new Color("161616")); ctx.fillRect(new Rect(0, 0, width, height)); ctx.setFillColor(new Color("242424")); ctx.fillRect(new Rect(12, 12, width - 24, height - 24));
  const image = await cachedImage(item); if (image) ctx.drawImageInRect(image, new Rect(28, 34, 182, 182)); else { ctx.setFillColor(new Color("333333")); ctx.fillRect(new Rect(28, 34, 182, 182)); drawLabel(ctx, "No image", new Rect(28, 108, 182, 32), Font.systemFont(18), new Color("999999"), "center"); }
  drawLabel(ctx, `${item.favourite ? "★ " : ""}${shortTitle(item.title)}`, new Rect(230, 28, 462, 56), Font.boldSystemFont(24), Color.white());
  drawLabel(ctx, `${item.store}${item.collection ? " • " + item.collection : ""} • ${intel.confidence} confidence`, new Rect(230, 82, 420, 28), Font.systemFont(15), new Color("aaaaaa"));
  drawLabel(ctx, money(item.currentPrice, item.currency), new Rect(230, 112, 270, 42), Font.boldSystemFont(30), Color.white());
  const rec = recommendation(entry); drawLabel(ctx, `${trend(entry)}  ${rec}`, new Rect(480, 116, 194, 34), Font.boldSystemFont(22), new Color(rec.indexOf("BUY") === 0 ? "55d66b" : rec === "WAIT" ? "f3b33d" : "6db5ff"), "right");
  drawLabel(ctx, `${"★".repeat(x.stars)}  ${x.score}/100`, new Rect(230, 158, 240, 30), Font.boldSystemFont(18), new Color("f3cc4b"));
  drawLabel(ctx, `${intel.discountPercent}% off start`, new Rect(470, 160, 204, 28), Font.systemFont(15), new Color("aaaaaa"), "right");
  let badgeX = 230;
  if (item.trackedSize) { const label = `UK ${item.trackedSize} ${stock.status}`; ctx.setFillColor(new Color(item.sizeAvailable === true ? (stock.score >= 80 ? "7a4b14" : "1f5a31") : item.sizeAvailable === false ? "6b2525" : "444444")); ctx.fillRect(new Rect(badgeX, 196, 210, 32)); drawLabel(ctx, label, new Rect(badgeX, 201, 210, 24), Font.boldSystemFont(12), Color.white(), "center"); badgeX += 220; }
  if (entry.allTimeLow) { ctx.setFillColor(new Color("1f5a31")); ctx.fillRect(new Rect(badgeX, 196, 154, 32)); drawLabel(ctx, "LOWEST PRICE", new Rect(badgeX, 201, 154, 24), Font.boldSystemFont(13), Color.white(), "center"); }
  drawSparkline(ctx, item, new Rect(230, 244, 444, 30), entry.dropped || entry.allTimeLow);
  drawLabel(ctx, "PRICE HISTORY", new Rect(28, 238, 182, 24), Font.boldSystemFont(12), new Color("777777"));
  drawLabel(ctx, item.trackedSize ? stock.reasons[0] || "Building stock history" : entry.dropped ? "Price dropped" : entry.increased ? "Price increased" : "Price steady", new Rect(28, 261, 182, 24), Font.systemFont(14), new Color("bbbbbb"));
  return ctx.getImage();
}

async function addCardRow(table, entry, items, rebuild) { const row = new UITableRow(); row.height = 164; row.dismissOnSelect = false; const image = row.addImage(await productCard(entry)); image.widthWeight = 100; row.onSelect = async () => { await productMenu(entry.item, items); await rebuild(); table.reload(); }; table.addRow(row); }

async function dashboard(items) {
  const table = new UITable(); table.showSeparators = false;
  async function rebuild() {
    table.removeAllRows(); const radar = Radar.analyseAll(items);
    const header = new UITableRow(); header.isHeader = true; header.height = 62; const h = header.addText("🔥 Deal Radar", `${items.length} product${items.length === 1 ? "" : "s"} • v${APP_VERSION}`); h.titleFont = Font.boldSystemFont(24); h.subtitleFont = Font.systemFont(11); table.addRow(header);
    const actions = new UITableRow(); actions.height = 48; const add = actions.addButton("＋ Add"); add.widthWeight = 50; add.onTap = async () => { const item = await addProduct(); if (item) { items.push(item); await Storage.save(items); await rebuild(); table.reload(); } }; const refresh = actions.addButton("↻ Refresh"); refresh.widthWeight = 50; refresh.onTap = async () => { const result = await refreshAll(items, true); await rebuild(); table.reload(); await alert("Refresh complete", `${result.changed} changed • ${result.failed} failed`); }; table.addRow(actions);
    if (!items.length) { const row = new UITableRow(); row.height = 90; row.addText("Nothing to show", "Tap Add to watch a product."); table.addRow(row); return; }
    const summary = new UITableRow(); summary.height = 62; summary.addText(`🔥 ${radar.greatDeals} great`, `⚠️ ${radar.lowStock} low stock`).widthWeight = 34; summary.addText(`🎯 ${radar.targetsReached} targets`, `⛔ ${radar.soldOut} sold out`).widthWeight = 34; const currency = items[0] && items[0].currency ? items[0].currency : "GBP"; const saved = summary.addText(money(radar.totalPotentialSavings, currency), "potential saving"); saved.widthWeight = 32; saved.rightAligned(); table.addRow(summary);
    if (radar.topDeals.length) { const top = new UITableRow(); top.isHeader = true; top.height = 38; top.addText("Top opportunities", "Best price and stock opportunities right now"); table.addRow(top); for (const entry of radar.topDeals) await addCardRow(table, entry, items, rebuild); }
    const allHeader = new UITableRow(); allHeader.isHeader = true; allHeader.height = 38; allHeader.addText("All products", "Ranked by opportunity score"); table.addRow(allHeader);
    const visible = radar.entries.slice().sort((a, b) => Number(b.item.favourite) - Number(a.item.favourite) || b.opportunityScore - a.opportunityScore); for (const entry of visible) await addCardRow(table, entry, items, rebuild);
  }
  await rebuild(); await table.present(true);
}

async function run() { const items = (await Storage.load()).map(normalise); await Storage.save(items); if (config.runsInWidget) { await refreshAll(items, true); Script.setWidget(await makeWidget(items)); } else await dashboard(items); }
module.exports = { run };