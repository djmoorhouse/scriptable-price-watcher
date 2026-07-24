const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");
const APP_VERSION = "0.5.0";

function money(value, currency) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value); }
  catch (_) { return `${currency || "GBP"} ${Number(value).toFixed(2)}`; }
}

function storeName(url) {
  const host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
  const name = host.split(".")[0] || "shop";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function percentChange(from, to) {
  return Number.isFinite(from) && Number.isFinite(to) && from !== 0 ? ((to - from) / from) * 100 : null;
}

function normaliseItem(item) {
  item.store = item.store || storeName(item.url);
  item.initialPrice = Number.isFinite(item.initialPrice) ? item.initialPrice : item.currentPrice;
  item.lowestPrice = Number.isFinite(item.lowestPrice) ? item.lowestPrice : item.currentPrice;
  item.history = Array.isArray(item.history) ? item.history : [];
  item.favourite = item.favourite === true;
  item.collection = String(item.collection || "").trim();
  return item;
}

async function alert(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

async function cachedImage(item) {
  return await Storage.loadCachedImage(item.id || item.url, item.imageUrl);
}

async function promptForProduct() {
  const a = new Alert();
  a.title = "Add product";
  a.message = "Paste the product URL. Target price and collection are optional.";
  a.addTextField("https://…", Pasteboard.pasteString() || "");
  a.addTextField("Target price, e.g. 150", "");
  a.addTextField("Collection, e.g. Clothes", "");
  a.addAction("Add");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return null;

  const url = a.textFieldValue(0).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) {
    await alert("Invalid URL", "Paste a complete URL beginning with http:// or https://");
    return null;
  }

  const targetText = a.textFieldValue(1).trim().replace(",", ".");
  const targetPrice = targetText ? Number(targetText) : null;
  if (targetText && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    await alert("Invalid target", "Enter only a positive number, or leave it blank.");
    return null;
  }

  try {
    const details = await Scraper.scrape(url);
    const now = new Date().toISOString();
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      store: storeName(url),
      title: details.title,
      imageUrl: details.imageUrl,
      currency: details.currency,
      initialPrice: details.price,
      currentPrice: details.price,
      previousPrice: null,
      lowestPrice: details.price,
      targetPrice,
      favourite: false,
      collection: a.textFieldValue(2).trim(),
      createdAt: now,
      checkedAt: now,
      history: [{ date: now, price: details.price }]
    };
    await cachedImage(item);
    return item;
  } catch (e) {
    await alert("Couldn’t add product", String(e.message || e));
    return null;
  }
}

async function editTarget(item) {
  const a = new Alert();
  a.title = "Target price";
  a.message = "Leave blank to remove the target.";
  a.addTextField("Target price", Number.isFinite(item.targetPrice) ? String(item.targetPrice) : "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  const text = a.textFieldValue(0).trim().replace(",", ".");
  if (!text) { item.targetPrice = null; return true; }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    await alert("Invalid target", "Enter only a positive number.");
    return false;
  }
  item.targetPrice = value;
  return true;
}

async function editCollection(item) {
  const a = new Alert();
  a.title = "Collection";
  a.message = "Examples: Clothes, Camping, Bikes or Gifts. Leave blank for none.";
  a.addTextField("Collection", item.collection || "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  item.collection = a.textFieldValue(0).trim();
  return true;
}

async function refreshItem(item, notify = true) {
  const details = await Scraper.scrape(item.url);
  const oldPrice = item.currentPrice;
  const newPrice = details.price;
  normaliseItem(item);
  item.title = details.title || item.title;
  item.imageUrl = details.imageUrl || item.imageUrl;
  item.currency = details.currency || item.currency;
  item.previousPrice = oldPrice;
  item.currentPrice = newPrice;
  item.lowestPrice = Math.min(item.lowestPrice ?? newPrice, newPrice);
  item.checkedAt = new Date().toISOString();
  item.lastError = null;
  const last = item.history[item.history.length - 1];
  if (!last || last.price !== newPrice) item.history.push({ date: item.checkedAt, price: newPrice });
  item.history = item.history.slice(-100);
  await cachedImage(item);

  const dropped = Number.isFinite(oldPrice) && newPrice < oldPrice;
  const hitTarget = Number.isFinite(item.targetPrice) && newPrice <= item.targetPrice && (!Number.isFinite(oldPrice) || oldPrice > item.targetPrice);
  if (notify && (dropped || hitTarget)) {
    const n = new Notification();
    n.title = dropped ? "Price dropped" : "Target price reached";
    const saving = dropped ? `\nSave ${money(oldPrice - newPrice, item.currency)}` : "";
    n.body = `${item.title}\n${money(oldPrice, item.currency)} → ${money(newPrice, item.currency)}${saving}`;
    n.openURL = item.url;
    await n.schedule();
  }
}

async function refreshAll(items, notify = true) {
  let changed = 0, failed = 0;
  for (const item of items) {
    const before = item.currentPrice;
    try { await refreshItem(item, notify); if (item.currentPrice !== before) changed++; }
    catch (e) { item.lastError = String(e.message || e); failed++; }
  }
  await Storage.save(items);
  return { changed, failed };
}

function chartImage(item) {
  const history = (item.history || []).slice(-30);
  const points = history.length === 1 ? [history[0], history[0]] : history;
  const width = 640, height = 300, left = 76, right = 24, top = 30, bottom = 48;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = true;
  ctx.setFillColor(new Color("111111"));
  ctx.fillRect(new Rect(0, 0, width, height));
  if (!points.length) {
    ctx.setTextColor(Color.white()); ctx.setFont(Font.systemFont(22));
    ctx.drawTextInRect("No price history yet", new Rect(30, 120, 580, 40));
    return ctx.getImage();
  }
  const values = points.map(x => Number(x.price));
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min *= 0.95; max *= 1.05; }
  const range = max - min;
  ctx.setTextColor(new Color("aaaaaa")); ctx.setFont(Font.systemFont(16));
  for (let i = 0; i < 4; i++) {
    const y = top + (height - top - bottom) * i / 3;
    const line = new Path(); line.move(new Point(left, y)); line.addLine(new Point(width - right, y));
    ctx.addPath(line); ctx.setStrokeColor(new Color("333333")); ctx.setLineWidth(1); ctx.strokePath();
    ctx.drawTextInRect(money(max - range * i / 3, item.currency), new Rect(4, y - 11, left - 10, 24));
  }
  const path = new Path();
  points.forEach((entry, i) => {
    const x = left + (width - left - right) * i / Math.max(1, points.length - 1);
    const y = top + (max - Number(entry.price)) / range * (height - top - bottom);
    if (i === 0) path.move(new Point(x, y)); else path.addLine(new Point(x, y));
  });
  ctx.addPath(path); ctx.setStrokeColor(new Color("55d66b")); ctx.setLineWidth(5); ctx.strokePath();
  ctx.setTextColor(Color.white()); ctx.setFont(Font.boldSystemFont(18));
  ctx.drawTextInRect(`${money(values[values.length - 1], item.currency)} now`, new Rect(left, height - 38, 240, 28));
  ctx.setTextColor(new Color("aaaaaa")); ctx.setFont(Font.systemFont(15));
  ctx.drawTextInRect(`${history.length} recorded price${history.length === 1 ? "" : "s"}`, new Rect(width - 250, height - 36, 220, 26));
  return ctx.getImage();
}

async function showHistory(item) {
  const table = new UITable(); table.showSeparators = false;
  const header = new UITableRow(); header.height = 56; header.isHeader = true; header.addText("Price history", item.title); table.addRow(header);
  const graph = new UITableRow(); graph.height = 190; const image = graph.addImage(chartImage(item)); image.widthWeight = 100; table.addRow(graph);
  for (const entry of (item.history || []).slice(-20).reverse()) {
    const row = new UITableRow(); row.height = 42; row.addText(new Date(entry.date).toLocaleString(), money(entry.price, item.currency)); table.addRow(row);
  }
  await table.present(true);
}

async function makeWidget(items) {
  const w = new ListWidget(); w.backgroundColor = new Color("111111"); w.setPadding(12, 12, 12, 12);
  const heading = w.addText("PRICE WATCHER"); heading.font = Font.boldSystemFont(11); heading.textColor = new Color("aaaaaa"); w.addSpacer(8);
  if (!items.length) { w.addText("Run the script to add a product."); return w; }
  const index = Number(args.widgetParameter);
  const item = Number.isInteger(index) && items[index] ? items[index] : items.find(x => x.favourite) || items[0];
  w.url = item.url;
  const row = w.addStack(); row.layoutHorizontally();
  const image = await cachedImage(item);
  if (image) { const img = row.addImage(image); img.imageSize = new Size(62, 62); img.cornerRadius = 9; row.addSpacer(10); }
  const text = row.addStack(); text.layoutVertically();
  const shop = text.addText(`${item.favourite ? "★ " : ""}${(item.store || storeName(item.url)).toUpperCase()}`); shop.font = Font.boldSystemFont(9); shop.textColor = new Color("888888");
  const title = text.addText(item.title); title.font = Font.semiboldSystemFont(13); title.textColor = Color.white(); title.lineLimit = 2;
  text.addSpacer(5);
  const price = text.addText(money(item.currentPrice, item.currency)); price.font = Font.boldSystemFont(20); price.textColor = Color.white();
  const pct = percentChange(item.initialPrice, item.currentPrice);
  const status = text.addText(Number.isFinite(pct) && Math.abs(pct) >= 0.01 ? `${pct < 0 ? "↓" : "↑"} ${Math.abs(pct).toFixed(1)}% since added` : Number.isFinite(item.targetPrice) ? `Target ${money(item.targetPrice, item.currency)}` : "No change");
  status.font = Font.systemFont(11); status.textColor = pct < 0 ? new Color("55d66b") : new Color("aaaaaa");
  w.addSpacer();
  const checked = w.addText(`Checked ${new Date(item.checkedAt).toLocaleString()}`); checked.font = Font.systemFont(9); checked.textColor = new Color("777777");
  return w;
}

async function productMenu(item, items) {
  while (true) {
    const pct = percentChange(item.initialPrice, item.currentPrice);
    const a = new Alert();
    a.title = `${item.favourite ? "★ " : ""}${item.title}`;
    a.message = `${item.store}\n${item.collection ? `Collection: ${item.collection}\n` : ""}\nCurrent: ${money(item.currentPrice, item.currency)}\nLowest: ${money(item.lowestPrice, item.currency)}\nAdded at: ${money(item.initialPrice, item.currency)}${Number.isFinite(pct) ? `\nChange: ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : ""}${Number.isFinite(item.targetPrice) ? `\nTarget: ${money(item.targetPrice, item.currency)}` : "\nTarget: Not set"}`;
    a.addAction(item.favourite ? "Remove from favourites" : "Add to favourites");
    a.addAction("Refresh now");
    a.addAction("Edit target price");
    a.addAction("Edit collection");
    a.addAction("View price graph");
    a.addAction("Open product page");
    a.addDestructiveAction("Remove product");
    a.addCancelAction("Back");
    const action = await a.presentAlert();
    if (action === -1) return;
    if (action === 0) { item.favourite = !item.favourite; await Storage.save(items); }
    else if (action === 1) {
      try { await refreshItem(item, true); await Storage.save(items); await alert("Updated", money(item.currentPrice, item.currency)); }
      catch (e) { await alert("Refresh failed", String(e.message || e)); }
    } else if (action === 2) {
      if (await editTarget(item)) { await Storage.save(items); await alert("Target saved", Number.isFinite(item.targetPrice) ? money(item.targetPrice, item.currency) : "Target removed"); }
    } else if (action === 3) {
      if (await editCollection(item)) { await Storage.save(items); await alert("Collection saved", item.collection || "No collection"); }
    } else if (action === 4) await showHistory(item);
    else if (action === 5) Safari.open(item.url);
    else if (action === 6) {
      const c = new Alert(); c.title = "Remove product?"; c.message = item.title; c.addDestructiveAction("Remove"); c.addCancelAction("Cancel");
      if (await c.presentAlert() === 0) {
        const index = items.findIndex(x => x.id === item.id); if (index >= 0) items.splice(index, 1);
        Storage.removeCachedImage(item.id || item.url); await Storage.save(items); return;
      }
    }
  }
}

function subtitle(item) {
  const pct = percentChange(item.initialPrice, item.currentPrice);
  const movement = Number.isFinite(pct) && Math.abs(pct) >= 0.01 ? `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct).toFixed(1)}%` : "No change";
  return `${item.collection ? `${item.collection} • ` : ""}${item.store} • ${movement}${Number.isFinite(item.targetPrice) ? ` • Target ${money(item.targetPrice, item.currency)}` : ""}`;
}

function sortedView(items, state) {
  let result = items.slice();
  if (state.favouritesOnly) result = result.filter(x => x.favourite);
  if (state.collection) result = result.filter(x => x.collection === state.collection);
  const drop = x => percentChange(x.initialPrice, x.currentPrice) ?? 0;
  if (state.sort === "drop") result.sort((a, b) => drop(a) - drop(b));
  else if (state.sort === "price") result.sort((a, b) => a.currentPrice - b.currentPrice);
  else if (state.sort === "newest") result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  else if (state.sort === "retailer") result.sort((a, b) => a.store.localeCompare(b.store));
  else result.sort((a, b) => Number(b.favourite) - Number(a.favourite));
  return result;
}

async function chooseCollection(items, state) {
  const collections = [...new Set(items.map(x => x.collection).filter(Boolean))].sort();
  const a = new Alert(); a.title = "Filter collection"; a.addAction("All collections");
  collections.forEach(x => a.addAction(x)); a.addCancelAction("Cancel");
  const choice = await a.presentSheet();
  if (choice === 0) state.collection = "";
  else if (choice > 0) state.collection = collections[choice - 1];
}

async function viewOptions(items, state) {
  const a = new Alert(); a.title = "View and sort";
  a.message = `Showing ${state.favouritesOnly ? "favourites" : "all products"}${state.collection ? ` in ${state.collection}` : ""}`;
  a.addAction(state.favouritesOnly ? "Show all products" : "Show favourites only");
  a.addAction("Filter by collection");
  a.addAction("Sort: Favourites first");
  a.addAction("Sort: Biggest drop");
  a.addAction("Sort: Lowest price");
  a.addAction("Sort: Newest");
  a.addAction("Sort: Retailer");
  a.addCancelAction("Cancel");
  const choice = await a.presentSheet();
  if (choice === 0) state.favouritesOnly = !state.favouritesOnly;
  else if (choice === 1) await chooseCollection(items, state);
  else if (choice === 2) state.sort = "favourites";
  else if (choice === 3) state.sort = "drop";
  else if (choice === 4) state.sort = "price";
  else if (choice === 5) state.sort = "newest";
  else if (choice === 6) state.sort = "retailer";
}

async function presentDashboard(items) {
  const table = new UITable(); table.showSeparators = true;
  const state = { favouritesOnly: false, collection: "", sort: "favourites" };
  async function rebuild() {
    table.removeAllRows();
    const visible = sortedView(items, state);
    const header = new UITableRow(); header.isHeader = true; header.height = 54;
    const filterText = state.favouritesOnly || state.collection ? ` • showing ${visible.length}` : "";
    const h = header.addText("Price Watcher", `${items.length} product${items.length === 1 ? "" : "s"}${filterText} • v${APP_VERSION}`); h.titleFont = Font.boldSystemFont(24); h.subtitleFont = Font.systemFont(11); table.addRow(header);
    const actions = new UITableRow(); actions.height = 48;
    const add = actions.addButton("＋ Add"); add.widthWeight = 33;
    add.onTap = async () => { const product = await promptForProduct(); if (product) { items.push(product); await Storage.save(items); await rebuild(); table.reload(); } };
    const refresh = actions.addButton("↻ Refresh"); refresh.widthWeight = 34;
    refresh.onTap = async () => { const result = await refreshAll(items, true); await rebuild(); table.reload(); await alert("Refresh complete", `${result.changed} price change${result.changed === 1 ? "" : "s"}.\n${result.failed} failed.`); };
    const view = actions.addButton("☰ View"); view.widthWeight = 33;
    view.onTap = async () => { await viewOptions(items, state); await rebuild(); table.reload(); };
    table.addRow(actions);
    if (!visible.length) { const row = new UITableRow(); row.height = 90; row.addText("Nothing to show", items.length ? "Change the View filters above." : "Tap ‘Add’ above to watch a product."); table.addRow(row); return; }
    for (const item of visible) {
      const row = new UITableRow(); row.height = 78; row.dismissOnSelect = false;
      const image = await cachedImage(item); if (image) { const cell = row.addImage(image); cell.widthWeight = 18; }
      const info = row.addText(`${item.favourite ? "★ " : ""}${item.title}`, subtitle(item)); info.widthWeight = 57; info.titleFont = Font.semiboldSystemFont(14); info.subtitleFont = Font.systemFont(11);
      const price = row.addText(money(item.currentPrice, item.currency), item.currentPrice === item.lowestPrice ? "Lowest seen" : `Low ${money(item.lowestPrice, item.currency)}`); price.widthWeight = 25; price.rightAligned(); price.titleFont = Font.boldSystemFont(16); price.subtitleFont = Font.systemFont(10);
      row.onSelect = async () => { await productMenu(item, items); await rebuild(); table.reload(); };
      table.addRow(row);
    }
  }
  await rebuild(); await table.present(true);
}

let items = (await Storage.load()).map(normaliseItem);
await Storage.save(items);
if (config.runsInWidget) { await refreshAll(items, true); Script.setWidget(await makeWidget(items)); }
else await presentDashboard(items);
Script.complete();
