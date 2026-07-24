const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");
const APP_VERSION = "0.3.0";

function money(value, currency) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value);
  } catch (_) {
    return `${currency || "GBP"} ${Number(value).toFixed(2)}`;
  }
}

function storeName(url) {
  const host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
  const name = host.split(".")[0] || "shop";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function percentChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

async function alert(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

async function promptForProduct() {
  const a = new Alert();
  a.title = "Add product";
  a.message = "Paste the full product page URL. The target price is optional.";
  a.addTextField("https://…", Pasteboard.pasteString() || "");
  a.addTextField("Target price, e.g. 150", "");
  a.addAction("Add");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return null;

  const rawUrl = a.textFieldValue(0).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(rawUrl)) {
    await alert("Invalid URL", "Paste a complete URL beginning with http:// or https://");
    return null;
  }

  const targetText = a.textFieldValue(1).trim().replace(",", ".");
  const targetPrice = targetText ? Number(targetText) : null;
  if (targetText && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    await alert("Invalid target", "Enter only a number, or leave the target blank.");
    return null;
  }

  try {
    const details = await Scraper.scrape(rawUrl);
    const now = new Date().toISOString();
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: rawUrl,
      store: storeName(rawUrl),
      title: details.title,
      imageUrl: details.imageUrl,
      currency: details.currency,
      initialPrice: details.price,
      currentPrice: details.price,
      previousPrice: null,
      lowestPrice: details.price,
      targetPrice,
      createdAt: now,
      checkedAt: now,
      history: [{ date: now, price: details.price }]
    };
  } catch (e) {
    await alert("Couldn’t add product", String(e.message || e));
    return null;
  }
}

async function editTarget(item) {
  const a = new Alert();
  a.title = "Target price";
  a.message = "Enter the price at which you want to be notified. Leave blank to remove the target.";
  a.addTextField("Target price", Number.isFinite(item.targetPrice) ? String(item.targetPrice) : "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  const text = a.textFieldValue(0).trim().replace(",", ".");
  if (!text) {
    item.targetPrice = null;
    return true;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    await alert("Invalid target", "Enter only a positive number.");
    return false;
  }
  item.targetPrice = value;
  return true;
}

function historyText(item) {
  const history = Array.isArray(item.history) ? item.history : [];
  const recent = history.slice(-10).reverse();
  if (!recent.length) return "No history recorded yet.";
  return recent.map(entry => `${new Date(entry.date).toLocaleDateString()}  ${money(entry.price, item.currency)}`).join("\n");
}

async function refreshItem(item, notify = true) {
  const details = await Scraper.scrape(item.url);
  const oldPrice = item.currentPrice;
  const newPrice = details.price;
  item.store = item.store || storeName(item.url);
  item.initialPrice = Number.isFinite(item.initialPrice) ? item.initialPrice : oldPrice;
  item.title = details.title || item.title;
  item.imageUrl = details.imageUrl || item.imageUrl;
  item.currency = details.currency || item.currency;
  item.previousPrice = oldPrice;
  item.currentPrice = newPrice;
  item.lowestPrice = Math.min(item.lowestPrice ?? newPrice, newPrice);
  item.checkedAt = new Date().toISOString();
  item.lastError = null;
  item.history = Array.isArray(item.history) ? item.history : [];
  const last = item.history[item.history.length - 1];
  if (!last || last.price !== newPrice) item.history.push({ date: item.checkedAt, price: newPrice });
  item.history = item.history.slice(-100);

  const dropped = Number.isFinite(oldPrice) && newPrice < oldPrice;
  const hitTarget = Number.isFinite(item.targetPrice) && newPrice <= item.targetPrice && (!Number.isFinite(oldPrice) || oldPrice > item.targetPrice);
  if (notify && (dropped || hitTarget)) {
    const n = new Notification();
    n.title = dropped ? "Price dropped" : "Target price reached";
    n.body = `${item.title}\n${money(oldPrice, item.currency)} → ${money(newPrice, item.currency)}`;
    n.openURL = item.url;
    await n.schedule();
  }
  return item;
}

async function refreshAll(items, notify = true) {
  let changed = 0;
  let failed = 0;
  for (const item of items) {
    const before = item.currentPrice;
    try {
      await refreshItem(item, notify);
      if (item.currentPrice !== before) changed++;
    } catch (e) {
      item.lastError = String(e.message || e);
      failed++;
    }
  }
  await Storage.save(items);
  return { changed, failed };
}

async function loadImage(url) {
  if (!url) return null;
  try {
    const req = new Request(url);
    req.timeoutInterval = 15;
    return await req.loadImage();
  } catch (_) {
    return null;
  }
}

async function makeWidget(items) {
  const w = new ListWidget();
  w.backgroundColor = new Color("111111");
  w.setPadding(12, 12, 12, 12);
  const heading = w.addText("PRICE WATCHER");
  heading.font = Font.boldSystemFont(11);
  heading.textColor = new Color("aaaaaa");
  w.addSpacer(8);

  if (!items.length) {
    const empty = w.addText("Run the script to add your first product.");
    empty.font = Font.systemFont(14);
    empty.textColor = Color.white();
    return w;
  }

  const parameter = Number(args.widgetParameter);
  const item = Number.isInteger(parameter) && items[parameter] ? items[parameter] : items[0];
  w.url = item.url;
  const row = w.addStack();
  row.layoutHorizontally();
  const image = await loadImage(item.imageUrl);
  if (image) {
    const img = row.addImage(image);
    img.imageSize = new Size(62, 62);
    img.cornerRadius = 9;
    row.addSpacer(10);
  }

  const text = row.addStack();
  text.layoutVertically();
  const shop = text.addText((item.store || storeName(item.url)).toUpperCase());
  shop.font = Font.boldSystemFont(9);
  shop.textColor = new Color("888888");
  const title = text.addText(item.title);
  title.font = Font.semiboldSystemFont(13);
  title.textColor = Color.white();
  title.lineLimit = 2;
  text.addSpacer(5);
  const price = text.addText(money(item.currentPrice, item.currency));
  price.font = Font.boldSystemFont(20);
  price.textColor = Color.white();

  const base = Number.isFinite(item.initialPrice) ? item.initialPrice : item.previousPrice;
  const changePct = percentChange(base, item.currentPrice);
  if (Number.isFinite(changePct) && Math.abs(changePct) >= 0.01) {
    const change = text.addText(`${changePct < 0 ? "↓" : "↑"} ${Math.abs(changePct).toFixed(1)}% since added`);
    change.font = Font.systemFont(11);
    change.textColor = changePct < 0 ? new Color("55d66b") : new Color("ff6b6b");
  } else if (Number.isFinite(item.targetPrice)) {
    const target = text.addText(`Target ${money(item.targetPrice, item.currency)}`);
    target.font = Font.systemFont(11);
    target.textColor = new Color("aaaaaa");
  }

  w.addSpacer();
  const checked = w.addText(`Checked ${new Date(item.checkedAt).toLocaleString()}`);
  checked.font = Font.systemFont(9);
  checked.textColor = new Color("777777");
  return w;
}

async function productMenu(item, items) {
  while (true) {
    const initial = Number.isFinite(item.initialPrice) ? item.initialPrice : item.currentPrice;
    const pct = percentChange(initial, item.currentPrice);
    const a = new Alert();
    a.title = item.title;
    a.message = `${item.store || storeName(item.url)}\n\nCurrent: ${money(item.currentPrice, item.currency)}\nLowest: ${money(item.lowestPrice, item.currency)}\nAdded at: ${money(initial, item.currency)}${Number.isFinite(pct) ? `\nChange: ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : ""}${Number.isFinite(item.targetPrice) ? `\nTarget: ${money(item.targetPrice, item.currency)}` : "\nTarget: Not set"}`;
    a.addAction("Refresh now");
    a.addAction("Edit target price");
    a.addAction("Price history");
    a.addAction("Open product page");
    a.addDestructiveAction("Remove product");
    a.addCancelAction("Back");
    const action = await a.presentAlert();
    if (action === -1) return false;
    if (action === 0) {
      try {
        await refreshItem(item, true);
        await Storage.save(items);
        await alert("Updated", money(item.currentPrice, item.currency));
      } catch (e) {
        await alert("Refresh failed", String(e.message || e));
      }
    } else if (action === 1) {
      if (await editTarget(item)) {
        await Storage.save(items);
        await alert("Target saved", Number.isFinite(item.targetPrice) ? money(item.targetPrice, item.currency) : "Target removed");
      }
    } else if (action === 2) {
      await alert("Price history", historyText(item));
    } else if (action === 3) {
      Safari.open(item.url);
    } else if (action === 4) {
      const confirm = new Alert();
      confirm.title = "Remove product?";
      confirm.message = item.title;
      confirm.addDestructiveAction("Remove");
      confirm.addCancelAction("Cancel");
      if (await confirm.presentAlert() === 0) {
        const index = items.findIndex(x => x.id === item.id);
        if (index >= 0) items.splice(index, 1);
        await Storage.save(items);
        return true;
      }
    }
  }
}

function dashboardSubtitle(item) {
  const initial = Number.isFinite(item.initialPrice) ? item.initialPrice : item.currentPrice;
  const pct = percentChange(initial, item.currentPrice);
  const movement = Number.isFinite(pct) && Math.abs(pct) >= 0.01
    ? `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct).toFixed(1)}%`
    : "No change";
  const target = Number.isFinite(item.targetPrice) ? ` • Target ${money(item.targetPrice, item.currency)}` : "";
  return `${item.store || storeName(item.url)} • ${movement}${target}`;
}

async function presentDashboard(items) {
  const table = new UITable();
  table.showSeparators = true;

  async function rebuild() {
    table.removeAllRows();

    const titleRow = new UITableRow();
    titleRow.isHeader = true;
    titleRow.height = 54;
    const title = titleRow.addText("Price Watcher", `${items.length} product${items.length === 1 ? "" : "s"} • v${APP_VERSION}`);
    title.titleFont = Font.boldSystemFont(24);
    title.subtitleFont = Font.systemFont(11);
    table.addRow(titleRow);

    const actions = new UITableRow();
    actions.height = 48;
    const add = actions.addButton("＋ Add product");
    add.widthWeight = 50;
    add.onTap = async () => {
      const product = await promptForProduct();
      if (product) {
        items.push(product);
        await Storage.save(items);
        await rebuild();
        table.reload();
      }
    };
    const refresh = actions.addButton("↻ Refresh all");
    refresh.widthWeight = 50;
    refresh.onTap = async () => {
      const result = await refreshAll(items, true);
      await rebuild();
      table.reload();
      await alert("Refresh complete", `${result.changed} price change${result.changed === 1 ? "" : "s"}.\n${result.failed} failed.`);
    };
    table.addRow(actions);

    if (!items.length) {
      const empty = new UITableRow();
      empty.height = 90;
      empty.addText("No products yet", "Tap ‘Add product’ above to start watching a price.");
      table.addRow(empty);
      return;
    }

    for (const item of items) {
      const row = new UITableRow();
      row.height = 78;
      row.dismissOnSelect = false;
      const image = await loadImage(item.imageUrl);
      if (image) {
        const cell = row.addImage(image);
        cell.widthWeight = 18;
      }
      const info = row.addText(item.title, dashboardSubtitle(item));
      info.widthWeight = 57;
      info.titleFont = Font.semiboldSystemFont(14);
      info.subtitleFont = Font.systemFont(11);
      const price = row.addText(money(item.currentPrice, item.currency), item.currentPrice === item.lowestPrice ? "Lowest seen" : `Low ${money(item.lowestPrice, item.currency)}`);
      price.widthWeight = 25;
      price.rightAligned();
      price.titleFont = Font.boldSystemFont(16);
      price.subtitleFont = Font.systemFont(10);
      row.onSelect = async () => {
        await productMenu(item, items);
        await rebuild();
        table.reload();
      };
      table.addRow(row);
    }
  }

  await rebuild();
  await table.present(true);
}

let items = await Storage.load();
if (config.runsInWidget) {
  await refreshAll(items, true);
  Script.setWidget(await makeWidget(items));
} else {
  await presentDashboard(items);
}
Script.complete();
