/*
Price Watcher for Scriptable (iPhone/iPad)
------------------------------------------
Run inside Scriptable to:
- Add product URLs
- Extract product title, image and price
- Show a thumbnail-based product list/widget
- Notify when a product's price falls

For automatic checks, create an iOS Shortcut automation that runs this
Scriptable script daily. iOS controls whether automations run unattended.

Tip: Retail websites vary. The script first uses structured product metadata
(JSON-LD/Open Graph), then falls back to common price selectors.
*/

const SETTINGS = {
  currencyFallback: "GBP",
  notificationOnAnyDrop: true,
  requestTimeoutSeconds: 25,
  maxProductsInWidget: 4,
  dataFile: "PriceWatcher-products.json",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

const fm = FileManager.iCloud();
const baseDir = fm.joinPath(fm.documentsDirectory(), "PriceWatcher");
const dataPath = fm.joinPath(baseDir, SETTINGS.dataFile);

await ensureStorage();
let products = await loadProducts();

if (config.runsInWidget) {
  await refreshProducts(products, false);
  Script.setWidget(await buildWidget(products));
  Script.complete();
  return;
}

const action = await chooseAction();
switch (action) {
  case "add":
    await addProduct(products);
    break;
  case "check":
    await refreshProducts(products, true);
    await showProductTable(products);
    break;
  case "list":
    await showProductTable(products);
    break;
  case "remove":
    await removeProduct(products);
    break;
  case "reset":
    await resetHistory(products);
    break;
}

Script.complete();

async function chooseAction() {
  const a = new Alert();
  a.title = "Price Watcher";
  a.message = `${products.length} item${products.length === 1 ? "" : "s"} tracked`;
  a.addAction("Add item from URL");
  a.addAction("Check prices now");
  a.addAction("View tracked items");
  a.addAction("Remove an item");
  a.addAction("Reset price history");
  a.addCancelAction("Cancel");

  const choice = await a.presentSheet();
  return ["add", "check", "list", "remove", "reset"][choice] || "cancel";
}

async function addProduct(list) {
  const paste = Pasteboard.pasteString() || "";

  const a = new Alert();
  a.title = "Add product";
  a.message = "Paste the product page URL. You can optionally set a target price.";
  a.addTextField("Product URL", /^https?:\/\//i.test(paste) ? paste.trim() : "");
  a.addTextField("Target price (optional)", "");
  a.addAction("Add and check");
  a.addCancelAction("Cancel");

  if ((await a.presentAlert()) === -1) return;

  const url = normalizeUrl(a.textFieldValue(0));
  const target = parseOptionalNumber(a.textFieldValue(1));

  if (!url) {
    await message("Invalid URL", "Enter a full URL beginning with http:// or https://.");
    return;
  }

  if (list.some((p) => p.url === url)) {
    await message("Already tracked", "That URL is already in your watch list.");
    return;
  }

  const loading = new Notification();
  loading.title = "Price Watcher";
  loading.body = "Checking the new item…";
  // Deliberately not scheduled: avoids unnecessary notification noise.

  try {
    const scraped = await scrapeProduct(url);
    const item = {
      id: UUID.string(),
      url,
      title: scraped.title || hostName(url),
      imageUrl: scraped.imageUrl || "",
      currency: scraped.currency || SETTINGS.currencyFallback,
      currentPrice: scraped.price,
      previousPrice: null,
      lowestPrice: scraped.price,
      targetPrice: target,
      addedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      error: null,
    };

    list.unshift(item);
    await saveProducts(list);

    await message(
      "Item added",
      `${item.title}\n\nCurrent price: ${formatPrice(item.currentPrice, item.currency)}` +
        (target !== null ? `\nTarget: ${formatPrice(target, item.currency)}` : "")
    );
  } catch (e) {
    await message(
      "Could not read this product",
      `${String(e)}\n\nSome shops block automated page reading. Try opening the page in Safari first, or use a direct product-page URL.`
    );
  }
}

async function refreshProducts(list, showSummary) {
  if (!list.length) {
    if (showSummary) await message("Nothing tracked", "Add a product URL first.");
    return;
  }

  let checked = 0;
  let dropped = 0;
  let failed = 0;

  for (const item of list) {
    try {
      const result = await scrapeProduct(item.url);
      const oldPrice = isFiniteNumber(item.currentPrice) ? item.currentPrice : null;
      const newPrice = result.price;

      item.previousPrice = oldPrice;
      item.currentPrice = newPrice;
      item.lowestPrice =
        isFiniteNumber(item.lowestPrice) ? Math.min(item.lowestPrice, newPrice) : newPrice;
      item.title = result.title || item.title;
      item.imageUrl = result.imageUrl || item.imageUrl;
      item.currency = result.currency || item.currency || SETTINGS.currencyFallback;
      item.checkedAt = new Date().toISOString();
      item.error = null;
      checked++;

      const priceDropped = oldPrice !== null && newPrice < oldPrice;
      const hitTarget =
        isFiniteNumber(item.targetPrice) &&
        newPrice <= item.targetPrice &&
        (oldPrice === null || oldPrice > item.targetPrice);

      if (priceDropped || hitTarget) {
        dropped++;
        await notifyPriceDrop(item, oldPrice, hitTarget);
      }
    } catch (e) {
      item.error = String(e);
      item.checkedAt = new Date().toISOString();
      failed++;
    }
  }

  await saveProducts(list);

  if (showSummary) {
    await message(
      "Price check complete",
      `${checked} checked\n${dropped} price alert${dropped === 1 ? "" : "s"}\n${failed} failed`
    );
  }
}

async function scrapeProduct(url) {
  const web = new WebView();
  const req = new Request(url);
  req.timeoutInterval = SETTINGS.requestTimeoutSeconds;
  req.headers = {
    "User-Agent": SETTINGS.userAgent,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-GB,en;q=0.9",
  };

  await web.loadRequest(req);

  // A short pause helps client-rendered shops populate product metadata.
  await sleep(1600);

  const raw = await web.evaluateJavaScript(`
    (() => {
      const clean = v => typeof v === "string" ? v.trim() : v;
      const absolute = value => {
        if (!value) return "";
        try { return new URL(value, document.baseURI).href; }
        catch (_) { return value; }
      };
      const meta = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (!el) continue;
          const value = el.content || el.getAttribute("content") || el.textContent;
          if (value && String(value).trim()) return String(value).trim();
        }
        return "";
      };
      const flatten = value => {
        if (!value) return [];
        if (Array.isArray(value)) return value.flatMap(flatten);
        if (typeof value === "object") {
          const own = [value];
          if (value["@graph"]) own.push(...flatten(value["@graph"]));
          return own;
        }
        return [];
      };
      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
        try { jsonLd.push(...flatten(JSON.parse(node.textContent))); } catch (_) {}
      });
      const product = jsonLd.find(x => {
        const t = x && x["@type"];
        return t === "Product" || (Array.isArray(t) && t.includes("Product"));
      }) || {};
      const offers = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
      const aggregate = offers.lowPrice ? offers : (product.aggregateOffer || {});

      const title =
        clean(product.name) ||
        meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
        clean(document.querySelector("h1")?.textContent) ||
        clean(document.title);

      let image = product.image;
      if (Array.isArray(image)) image = image[0];
      if (image && typeof image === "object") image = image.url || image.contentUrl;
      image =
        absolute(image) ||
        absolute(meta([
          'meta[property="og:image"]',
          'meta[property="og:image:secure_url"]',
          'meta[name="twitter:image"]',
          'link[rel="image_src"]'
        ]));

      const priceCandidates = [
        offers.price,
        offers.lowPrice,
        aggregate.lowPrice,
        meta([
          'meta[property="product:price:amount"]',
          'meta[property="og:price:amount"]',
          'meta[itemprop="price"]',
          '[itemprop="price"]',
          '[data-testid*="price"]',
          '[data-test*="price"]',
          '.price',
          '.product-price',
          '.sales-price',
          '.current-price'
        ])
      ].filter(v => v !== undefined && v !== null && String(v).trim());

      const currency =
        clean(offers.priceCurrency) ||
        clean(aggregate.priceCurrency) ||
        meta([
          'meta[property="product:price:currency"]',
          'meta[property="og:price:currency"]',
          'meta[itemprop="priceCurrency"]',
          '[itemprop="priceCurrency"]'
        ]);

      return {
        title,
        image,
        currency,
        priceCandidates,
        bodyText: (document.body?.innerText || "").slice(0, 200000)
      };
    })();
  `);

  const price = choosePrice(raw.priceCandidates, raw.bodyText);
  if (!isFiniteNumber(price)) {
    throw new Error("No reliable price was found on the page.");
  }

  return {
    title: raw.title || hostName(url),
    imageUrl: raw.image || "",
    currency: normalizeCurrency(raw.currency, raw.bodyText),
    price,
  };
}

function choosePrice(candidates, bodyText) {
  for (const candidate of candidates || []) {
    const n = parsePrice(candidate);
    if (isFiniteNumber(n) && n >= 0.01 && n < 10000000) return n;
  }

  // Conservative fallback: look for a currency symbol followed by a plausible amount.
  const text = String(bodyText || "");
  const matches = [...text.matchAll(/(?:£|€|\$)\s*([0-9]{1,7}(?:[.,][0-9]{2})?)/g)];
  const values = matches.map((m) => parsePrice(m[1])).filter(isFiniteNumber);

  // The first visible currency amount is often the product price, but avoid
  // unrealistically tiny shipping/finance amounts where possible.
  return values.find((v) => v >= 1) ?? values[0] ?? null;
}

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d.,-]/g, "")
    .trim();

  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > lastDot) {
    // 1.234,56 or 1234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // 1,234.56 or 1234.56
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(value, pageText) {
  const c = String(value || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  const t = String(pageText || "");
  if (t.includes("£")) return "GBP";
  if (t.includes("€")) return "EUR";
  if (t.includes("$")) return "USD";
  return SETTINGS.currencyFallback;
}

async function notifyPriceDrop(item, oldPrice, hitTarget) {
  const n = new Notification();
  n.identifier = `pricewatch-${item.id}`;
  n.title = hitTarget ? "Target price reached" : "Price dropped";
  n.subtitle = item.title;
  n.body =
    oldPrice === null
      ? `Now ${formatPrice(item.currentPrice, item.currency)}`
      : `${formatPrice(oldPrice, item.currency)} → ${formatPrice(item.currentPrice, item.currency)}`;
  n.openURL = item.url;
  n.threadIdentifier = "PriceWatcher";
  await n.schedule();
}

async function showProductTable(list) {
  if (!list.length) {
    await message("Nothing tracked", "Add a product URL first.");
    return;
  }

  const table = new UITable();
  table.showSeparators = true;

  for (const item of list) {
    const row = new UITableRow();
    row.height = 76;
    row.dismissOnSelect = false;

    if (item.imageUrl) {
      try {
        const image = await loadImage(item.imageUrl);
        const imageCell = row.addImage(image);
        imageCell.widthWeight = 18;
      } catch (_) {
        row.addText("🛍️").widthWeight = 18;
      }
    } else {
      row.addText("🛍️").widthWeight = 18;
    }

    const detail =
      `${formatPrice(item.currentPrice, item.currency)}` +
      (isFiniteNumber(item.targetPrice)
        ? `  •  target ${formatPrice(item.targetPrice, item.currency)}`
        : "") +
      (item.error ? "\n⚠ Could not refresh" : "");

    const textCell = row.addText(item.title || hostName(item.url), detail);
    textCell.widthWeight = 70;
    textCell.titleFont = Font.semiboldSystemFont(15);
    textCell.subtitleFont = Font.systemFont(12);

    const open = row.addButton("Open");
    open.widthWeight = 12;
    open.onTap = () => Safari.open(item.url);

    table.addRow(row);
  }

  await table.present(true);
}

async function buildWidget(list) {
  const widget = new ListWidget();
  widget.url = "scriptable:///run";
  widget.setPadding(12, 12, 12, 12);

  const heading = widget.addText("PRICE WATCHER");
  heading.font = Font.boldSystemFont(12);
  heading.textOpacity = 0.65;
  widget.addSpacer(8);

  if (!list.length) {
    const empty = widget.addText("Run the script to add a product.");
    empty.font = Font.systemFont(14);
    return widget;
  }

  const count = config.widgetFamily === "small" ? 1 : SETTINGS.maxProductsInWidget;

  for (const item of list.slice(0, count)) {
    const row = widget.addStack();
    row.url = item.url;
    row.centerAlignContent();

    if (item.imageUrl) {
      try {
        const img = row.addImage(await loadImage(item.imageUrl));
        img.imageSize = new Size(48, 48);
        img.cornerRadius = 7;
      } catch (_) {
        const icon = row.addImage(SFSymbol.named("bag").image);
        icon.imageSize = new Size(32, 32);
      }
    }

    row.addSpacer(9);
    const words = row.addStack();
    words.layoutVertically();

    const title = words.addText(item.title || hostName(item.url));
    title.font = Font.semiboldSystemFont(13);
    title.lineLimit = 2;

    const price = words.addText(formatPrice(item.currentPrice, item.currency));
    price.font = Font.boldSystemFont(16);

    if (
      isFiniteNumber(item.previousPrice) &&
      isFiniteNumber(item.currentPrice) &&
      item.currentPrice < item.previousPrice
    ) {
      const drop = words.addText(
        `↓ ${formatPrice(item.previousPrice - item.currentPrice, item.currency)}`
      );
      drop.font = Font.systemFont(11);
    }

    widget.addSpacer(8);
  }

  const checked = list[0]?.checkedAt
    ? `Checked ${relativeDate(list[0].checkedAt)}`
    : "Not checked yet";
  const footer = widget.addText(checked);
  footer.font = Font.systemFont(10);
  footer.textOpacity = 0.55;

  return widget;
}

async function removeProduct(list) {
  if (!list.length) {
    await message("Nothing tracked", "There are no items to remove.");
    return;
  }

  const a = new Alert();
  a.title = "Remove item";
  for (const item of list) {
    a.addAction(`${item.title}\n${formatPrice(item.currentPrice, item.currency)}`);
  }
  a.addCancelAction("Cancel");

  const index = await a.presentSheet();
  if (index < 0) return;

  const removed = list.splice(index, 1)[0];
  await saveProducts(list);
  await message("Removed", removed.title);
}

async function resetHistory(list) {
  for (const item of list) {
    item.previousPrice = null;
    item.lowestPrice = item.currentPrice;
  }
  await saveProducts(list);
  await message("History reset", "Current prices are now the new starting prices.");
}

async function loadImage(url) {
  const req = new Request(url);
  req.timeoutInterval = 15;
  req.headers = { "User-Agent": SETTINGS.userAgent };
  return await req.loadImage();
}

async function ensureStorage() {
  if (!fm.fileExists(baseDir)) fm.createDirectory(baseDir, true);
  if (fm.isFileStoredIniCloud(dataPath) && !fm.isFileDownloaded(dataPath)) {
    await fm.downloadFileFromiCloud(dataPath);
  }
}

async function loadProducts() {
  if (!fm.fileExists(dataPath)) return [];
  try {
    if (fm.isFileStoredIniCloud(dataPath) && !fm.isFileDownloaded(dataPath)) {
      await fm.downloadFileFromiCloud(dataPath);
    }
    const parsed = JSON.parse(fm.readString(dataPath));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function saveProducts(list) {
  fm.writeString(dataPath, JSON.stringify(list, null, 2));
}

function formatPrice(value, currency) {
  if (!isFiniteNumber(value)) return "Price unavailable";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || SETTINGS.currencyFallback,
    }).format(value);
  } catch (_) {
    return `${currency || ""} ${Number(value).toFixed(2)}`.trim();
  }
}

function relativeDate(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function parseOptionalNumber(value) {
  if (!String(value || "").trim()) return null;
  return parsePrice(value);
}

function normalizeUrl(value) {
  const s = String(value || "").trim();
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch (_) {
    return null;
  }
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "Product";
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms) {
  return new Promise((resolve) => Timer.schedule(ms / 1000, false, resolve));
}

async function message(title, body) {
  const a = new Alert();
  a.title = title;
  a.message = body;
  a.addAction("OK");
  await a.presentAlert();
}
