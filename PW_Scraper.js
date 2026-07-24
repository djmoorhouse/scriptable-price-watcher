function numberFrom(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value || "").replace(/\u00a0/g, " ").replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function currencyFrom(value, text) {
  const c = String(value || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  if (String(text).includes("£")) return "GBP";
  if (String(text).includes("€")) return "EUR";
  if (String(text).includes("$")) return "USD";
  return "GBP";
}

async function scrape(url) {
  const web = new WebView();
  const req = new Request(url);
  req.timeoutInterval = 30;
  req.headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "en-GB,en;q=0.9"
  };
  await web.loadRequest(req);
  await new Promise(resolve => Timer.schedule(2, false, resolve));

  const data = await web.evaluateJavaScript(`(() => {
    const meta = sels => {
      for (const s of sels) {
        const e = document.querySelector(s);
        if (e) {
          const v = e.content || e.getAttribute('content') || e.textContent;
          if (v && String(v).trim()) return String(v).trim();
        }
      }
      return '';
    };
    const flatten = x => {
      if (!x) return [];
      if (Array.isArray(x)) return x.flatMap(flatten);
      if (typeof x === 'object') return [x].concat(flatten(x['@graph']));
      return [];
    };
    const all = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try { all.push(...flatten(JSON.parse(s.textContent))); } catch (_) {}
    });
    const product = all.find(x => {
      const t = x && x['@type'];
      return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
    }) || {};
    const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
    let image = product.image;
    if (Array.isArray(image)) image = image[0];
    if (image && typeof image === 'object') image = image.url || image.contentUrl;
    image = image || meta(['meta[property="og:image"]','meta[name="twitter:image"]']);
    try { image = image ? new URL(image, document.baseURI).href : ''; } catch (_) {}
    return {
      title: product.name || meta(['meta[property="og:title"]','meta[name="twitter:title"]']) || document.querySelector('h1')?.textContent || document.title,
      image,
      currency: offer.priceCurrency || meta(['meta[property="product:price:currency"]','meta[itemprop="priceCurrency"]']),
      prices: [offer.price, offer.lowPrice, meta(['meta[property="product:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[data-testid*="price"]','.price','.current-price'])],
      text: (document.body?.innerText || '').slice(0, 150000)
    };
  })()`);

  let price = null;
  for (const candidate of data.prices || []) {
    const n = numberFrom(candidate);
    if (n !== null && n > 0 && n < 10000000) { price = n; break; }
  }
  if (price === null) {
    const matches = [...String(data.text || "").matchAll(/(?:£|€|\$)\s*([0-9]{1,7}(?:[.,][0-9]{2})?)/g)];
    for (const m of matches) {
      const n = numberFrom(m[1]);
      if (n !== null && n >= 1) { price = n; break; }
    }
  }
  if (price === null) throw new Error("No price found on this page");

  return {
    title: String(data.title || new URL(url).hostname).trim(),
    imageUrl: data.image || "",
    currency: currencyFrom(data.currency, data.text),
    price
  };
}

module.exports = { scrape };
