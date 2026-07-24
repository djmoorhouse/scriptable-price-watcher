const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");
const Analytics = importModule("PW_Analytics");
const APP_VERSION = "0.6.0";

function money(value, currency) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value); }
  catch (_) { return `${currency || "GBP"} ${Number(value).toFixed(2)}`; }
}

function storeName(url) {
  const host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
  const name = host.split(".")[0] || "shop";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function normalise(item) {
  item.store = item.store || storeName(item.url);
  item.initialPrice = Number.isFinite(Number(item.initialPrice)) ? Number(item.initialPrice) : Number(item.currentPrice);
  item.lowestPrice = Number.isFinite(Number(item.lowestPrice)) ? Number(item.lowestPrice) : Number(item.currentPrice);
  item.history = Array.isArray(item.history) ? item.history : [];
  item.favourite = item.favourite === true;
  item.collection = String(item.collection || "").trim();
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
  a.message = "Paste a product URL. Target price and collection are optional.";
  a.addTextField("https://…", Pasteboard.pasteString() || "");
  a.addTextField("Target price", "");
  a.addTextField("Collection", "");
  a.addAction("Add"); a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return null;
  const url = a.textFieldValue(0).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) { await alert("Invalid URL", "Paste a complete URL beginning with http:// or https://"); return null; }
  const targetText = a.textFieldValue(1).trim().replace(",", ".");
  const targetPrice = targetText ? Number(targetText) : null;
  if (targetText && (!Number.isFinite(targetPrice) || targetPrice <= 0)) { await alert("Invalid target", "Enter a positive number or leave it blank."); return null; }
  try {
    const details = await Scraper.scrape(url);
    const now = new Date().toISOString();
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url, store: storeName(url), title: details.title, imageUrl: details.imageUrl,
      currency: details.currency, initialPrice: details.price, currentPrice: details.price,
      previousPrice: null, lowestPrice: details.price, targetPrice,
      favourite: false, collection: a.textFieldValue(2).trim(), createdAt: now, checkedAt: now,
      history: [{ date: now, price: details.price }]
    };
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

async function refreshItem(item, notify = true) {
  const details = await Scraper.scrape(item.url);
  const oldPrice = Number(item.currentPrice), newPrice = Number(details.price);
  normalise(item);
  item.title = details.title || item.title; item.imageUrl = details.imageUrl || item.imageUrl; item.currency = details.currency || item.currency;
  item.previousPrice = oldPrice; item.currentPrice = newPrice; item.lowestPrice = Math.min(item.lowestPrice, newPrice);
  item.checkedAt = new Date().toISOString(); item.lastError = null;
  const last = item.history[item.history.length - 1]; if (!last || Number(last.price) !== newPrice) item.history.push({ date: item.checkedAt, price: newPrice });
  item.history = item.history.slice(-100); await cachedImage(item);
  const dropped = Number.isFinite(oldPrice) && newPrice < oldPrice;
  const hitTarget = Number.isFinite(item.targetPrice) && newPrice <= item.targetPrice && oldPrice > item.targetPrice;
  if (notify && (dropped || hitTarget)) {
    const insight = Analytics.analyse(item); const n = new Notification();
    n.title = `${"★".repeat(insight.stars)} ${insight.label}`;
    n.body = `${item.title}\n${money(oldPrice, item.currency)} → ${money(newPrice, item.currency)}\nDeal score ${insight.score}/100`;
    n.openURL = item.url; await n.schedule();
  }
}

async function refreshAll(items, notify = true) {
  let changed = 0, failed = 0;
  for (const item of items) {
    const before = item.currentPrice;
    try { await refreshItem(item, notify); if (item.currentPrice !== before) changed++; }
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
  const x = Analytics.analyse(item); const table = new UITable(); table.showSeparators = true;
  const header = new UITableRow(); header.isHeader = true; header.height = 72;
  const h = header.addText(`${"★".repeat(x.stars)} ${x.label}`, `${item.store} • Deal score ${x.score}/100`); h.titleFont = Font.boldSystemFont(21); h.subtitleFont = Font.systemFont(12); table.addRow(header);
  const advice = new UITableRow(); advice.height = 66; advice.addText(x.advice, x.reasons.join(" • ")); table.addRow(advice);
  const stats = [["Current", x.current], ["Lowest", x.lowest], ["Highest", x.highest], ["Average", x.average], ["Saving", x.saving]];
  for (const [label, value] of stats) { const row = new UITableRow(); row.height = 42; row.addText(label, money(value, item.currency)); table.addRow(row); }
  const tracked = new UITableRow(); tracked.height = 42; tracked.addText("Tracking", `${x.daysTracked} days • ${x.changes} price changes`); table.addRow(tracked);
  const graph = new UITableRow(); graph.height = 48; graph.addText("View price graph", "Price history"); graph.onSelect = async () => await showHistory(item); table.addRow(graph);
  await table.present(true);
}

async function productMenu(item, items) {
  while (true) {
    const x = Analytics.analyse(item); const a = new Alert();
    a.title = `${item.favourite ? "★ " : ""}${item.title}`;
    a.message = `${"★".repeat(x.stars)} ${x.label} • ${x.score}/100\n${x.advice}\n\nCurrent: ${money(item.currentPrice, item.currency)}\nLowest: ${money(x.lowest, item.currency)}${Number.isFinite(item.targetPrice) ? `\nTarget: ${money(item.targetPrice, item.currency)}` : ""}`;
    a.addAction("View full insights"); a.addAction(item.favourite ? "Remove from favourites" : "Add to favourites"); a.addAction("Refresh now"); a.addAction("Edit target"); a.addAction("Edit collection"); a.addAction("Open product page"); a.addDestructiveAction("Remove product"); a.addCancelAction("Back");
    const choice = await a.presentAlert(); if (choice === -1) return;
    if (choice === 0) await showInsights(item);
    else if (choice === 1) { item.favourite = !item.favourite; await Storage.save(items); }
    else if (choice === 2) { try { await refreshItem(item, true); await Storage.save(items); await alert("Updated", money(item.currentPrice, item.currency)); } catch (e) { await alert("Refresh failed", String(e.message || e)); } }
    else if (choice === 3) { if (await editTarget(item)) await Storage.save(items); }
    else if (choice === 4) { if (await editCollection(item)) await Storage.save(items); }
    else if (choice === 5) Safari.open(item.url);
    else if (choice === 6) { const c = new Alert(); c.title = "Remove product?"; c.addDestructiveAction("Remove"); c.addCancelAction("Cancel"); if (await c.presentAlert() === 0) { const i = items.findIndex(x => x.id === item.id); if (i >= 0) items.splice(i, 1); Storage.removeCachedImage(item.id || item.url); await Storage.save(items); return; } }
  }
}

async function makeWidget(items) {
  const w = new ListWidget(); w.backgroundColor = new Color("111111"); w.setPadding(12, 12, 12, 12);
  const heading = w.addText("PRICE WATCHER"); heading.font = Font.boldSystemFont(11); heading.textColor = new Color("aaaaaa"); w.addSpacer(8);
  if (!items.length) { w.addText("Run the script to add a product."); return w; }
  const index = Number(args.widgetParameter); const item = Number.isInteger(index) && items[index] ? items[index] : items.find(x => x.favourite) || items[0]; const x = Analytics.analyse(item); w.url = item.url;
  const row = w.addStack(); row.layoutHorizontally(); const image = await cachedImage(item); if (image) { const img = row.addImage(image); img.imageSize = new Size(62, 62); img.cornerRadius = 9; row.addSpacer(10); }
  const text = row.addStack(); text.layoutVertically(); const title = text.addText(item.title); title.font = Font.semiboldSystemFont(13); title.textColor = Color.white(); title.lineLimit = 2;
  text.addSpacer(5); const price = text.addText(money(item.currentPrice, item.currency)); price.font = Font.boldSystemFont(20); price.textColor = Color.white();
  const status = text.addText(`${"★".repeat(x.stars)} ${x.label} • ${x.score}/100`); status.font = Font.systemFont(10); status.textColor = new Color("55d66b");
  return w;
}

async function dashboard(items) {
  const table = new UITable(); table.showSeparators = true;
  async function rebuild() {
    table.removeAllRows(); const header = new UITableRow(); header.isHeader = true; header.height = 54;
    const h = header.addText("Price Watcher", `${items.length} product${items.length === 1 ? "" : "s"} • v${APP_VERSION}`); h.titleFont = Font.boldSystemFont(24); h.subtitleFont = Font.systemFont(11); table.addRow(header);
    const actions = new UITableRow(); actions.height = 48;
    const add = actions.addButton("＋ Add"); add.widthWeight = 50; add.onTap = async () => { const item = await addProduct(); if (item) { items.push(item); await Storage.save(items); await rebuild(); table.reload(); } };
    const refresh = actions.addButton("↻ Refresh"); refresh.widthWeight = 50; refresh.onTap = async () => { const result = await refreshAll(items, true); await rebuild(); table.reload(); await alert("Refresh complete", `${result.changed} changed • ${result.failed} failed`); }; table.addRow(actions);
    if (!items.length) { const row = new UITableRow(); row.height = 90; row.addText("Nothing to show", "Tap Add to watch a product."); table.addRow(row); return; }
    const visible = items.slice().sort((a, b) => { const ax = Analytics.analyse(a), bx = Analytics.analyse(b); return Number(b.favourite) - Number(a.favourite) || bx.score - ax.score; });
    for (const item of visible) {
      const x = Analytics.analyse(item); const row = new UITableRow(); row.height = 82; row.dismissOnSelect = false;
      const image = await cachedImage(item); if (image) row.addImage(image).widthWeight = 18;
      const info = row.addText(`${item.favourite ? "★ " : ""}${item.title}`, `${item.collection ? item.collection + " • " : ""}${item.store} • ${x.label}`); info.widthWeight = 57; info.titleFont = Font.semiboldSystemFont(14); info.subtitleFont = Font.systemFont(11);
      const price = row.addText(money(item.currentPrice, item.currency), `${"★".repeat(x.stars)} ${x.score}/100`); price.widthWeight = 25; price.rightAligned(); price.titleFont = Font.boldSystemFont(16); price.subtitleFont = Font.systemFont(10);
      row.onSelect = async () => { await productMenu(item, items); await rebuild(); table.reload(); }; table.addRow(row);
    }
  }
  await rebuild(); await table.present(true);
}

async function run() {
  const items = (await Storage.load()).map(normalise); await Storage.save(items);
  if (config.runsInWidget) { await refreshAll(items, true); Script.setWidget(await makeWidget(items)); }
  else await dashboard(items);
}

module.exports = { run };
