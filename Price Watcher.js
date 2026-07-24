const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");

function money(value, currency) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value);
  } catch (_) {
    return `${currency || "GBP"} ${Number(value).toFixed(2)}`;
  }
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

  const rawUrl = a.textFieldValue(0).trim();
  if (!/^https?:\/\//i.test(rawUrl)) {
    await alert("Invalid URL", "Paste a complete URL beginning with http:// or https://");
    return null;
  }

  let url;
  try { url = new URL(rawUrl).href; }
  catch (_) {
    await alert("Invalid URL", "That web address could not be read.");
    return null;
  }

  const targetText = a.textFieldValue(1).trim().replace(",", ".");
  const targetPrice = targetText ? Number(targetText) : null;
  if (targetText && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    await alert("Invalid target", "Enter only a number, or leave the target blank.");
    return null;
  }

  const progress = new Notification();
  progress.title = "Price Watcher";
  progress.body = "Reading product page…";

  try {
    const details = await Scraper.scrape(url);
    const now = new Date().toISOString();
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      title: details.title,
      imageUrl: details.imageUrl,
      currency: details.currency,
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

async function refreshItem(item, notify = true) {
  const details = await Scraper.scrape(item.url);
  const oldPrice = item.currentPrice;
  const newPrice = details.price;
  item.title = details.title || item.title;
  item.imageUrl = details.imageUrl || item.imageUrl;
  item.currency = details.currency || item.currency;
  item.previousPrice = oldPrice;
  item.currentPrice = newPrice;
  item.lowestPrice = Math.min(item.lowestPrice ?? newPrice, newPrice);
  item.checkedAt = new Date().toISOString();
  item.history = Array.isArray(item.history) ? item.history : [];
  item.history.push({ date: item.checkedAt, price: newPrice });
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
  const title = text.addText(item.title);
  title.font = Font.semiboldSystemFont(13);
  title.textColor = Color.white();
  title.lineLimit = 2;
  text.addSpacer(5);

  const price = text.addText(money(item.currentPrice, item.currency));
  price.font = Font.boldSystemFont(20);
  price.textColor = Color.white();

  if (Number.isFinite(item.previousPrice) && item.previousPrice !== item.currentPrice) {
    const difference = item.currentPrice - item.previousPrice;
    const change = text.addText(`${difference < 0 ? "↓" : "↑"} ${money(Math.abs(difference), item.currency)}`);
    change.font = Font.systemFont(11);
    change.textColor = difference < 0 ? new Color("55d66b") : new Color("ff6b6b");
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

async function chooseItem(items, title) {
  const a = new Alert();
  a.title = title;
  items.forEach(item => a.addAction(`${item.title}\n${money(item.currentPrice, item.currency)}`));
  a.addCancelAction("Cancel");
  const index = await a.presentSheet();
  return index >= 0 ? index : null;
}

async function runApp() {
  let items = await Storage.load();
  while (true) {
    const menu = new Alert();
    menu.title = "Price Watcher";
    menu.message = items.length ? `${items.length} product${items.length === 1 ? "" : "s"} being watched` : "No products added yet";
    menu.addAction("Add product");
    if (items.length) {
      menu.addAction("View products");
      menu.addAction("Refresh all");
      menu.addDestructiveAction("Remove product");
    }
    menu.addCancelAction("Done");
    const choice = await menu.presentSheet();
    if (choice === -1) break;

    if (choice === 0) {
      const product = await promptForProduct();
      if (product) {
        items.push(product);
        await Storage.save(items);
        await alert("Added", `${product.title}\n${money(product.currentPrice, product.currency)}`);
      }
    } else if (choice === 1) {
      const index = await chooseItem(items, "Products");
      if (index !== null) {
        const item = items[index];
        const a = new Alert();
        a.title = item.title;
        a.message = `Current: ${money(item.currentPrice, item.currency)}\nLowest: ${money(item.lowestPrice, item.currency)}${Number.isFinite(item.targetPrice) ? `\nTarget: ${money(item.targetPrice, item.currency)}` : ""}`;
        a.addAction("Open product page");
        a.addAction("Refresh now");
        a.addCancelAction("Back");
        const action = await a.presentAlert();
        if (action === 0) Safari.open(item.url);
        if (action === 1) {
          try {
            await refreshItem(item, true);
            await Storage.save(items);
            await alert("Updated", money(item.currentPrice, item.currency));
          } catch (e) {
            await alert("Refresh failed", String(e.message || e));
          }
        }
      }
    } else if (choice === 2) {
      const result = await refreshAll(items, true);
      await alert("Refresh complete", `${result.changed} price change${result.changed === 1 ? "" : "s"}.\n${result.failed} failed.`);
    } else if (choice === 3) {
      const index = await chooseItem(items, "Remove product");
      if (index !== null) {
        const removed = items.splice(index, 1)[0];
        await Storage.save(items);
        await alert("Removed", removed.title);
      }
    }
  }
}

let items = await Storage.load();
if (config.runsInWidget) {
  await refreshAll(items, true);
  const widget = await makeWidget(items);
  Script.setWidget(widget);
} else {
  await runApp();
}
Script.complete();
