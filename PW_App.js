const Storage = importModule("PW_Storage");
const Scraper = importModule("PW_Scraper");
const Analytics = importModule("PW_Analytics");
const APP_VERSION = "0.6.0";

function money(value, currency) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(value); }
  catch (_) { return `${currency || "GBP"} ${Number(value).toFixed(2)}`; }
}

function store