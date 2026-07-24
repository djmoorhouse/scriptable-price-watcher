function validHistory(item) {
  return (Array.isArray(item.history) ? item.history : [])
    .map(x => ({ date: new Date(x.date), price: Number(x.price) }))
    .filter(x => !Number.isNaN(x.date.getTime()) && Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => a.date - b.date);
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetween(a, b) {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

function analyse(item) {
  const history = validHistory(item);
  const current = Number(item.currentPrice);
  const initial = Number.isFinite(Number(item.initialPrice)) ? Number(item.initialPrice) : current;
  const values = history.map(x => x.price);
  if (Number.isFinite(current) && current > 0 && (!values.length || values[values.length - 1] !== current)) values.push(current);

  const lowest = values.length ? Math.min(...values) : current;
  const highest = values.length ? Math.max(...values) : current;
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : current;
  const med = median(values);
  const saving = Number.isFinite(initial) && Number.isFinite(current) ? Math.max(0, initial - current) : 0;
  const discountPct = Number.isFinite(initial) && initial > 0 && Number.isFinite(current) ? ((initial - current) / initial) * 100 : 0;
  const aboveLowPct = Number.isFinite(lowest) && lowest > 0 && Number.isFinite(current) ? ((current - lowest) / lowest) * 100 : 0;

  let changes = 0;
  let biggestDrop = 0;
  let biggestRise = 0;
  let lastChangeAt = history.length ? history[0].date : new Date(item.createdAt || Date.now());
  for (let i = 1; i < history.length; i++) {
    const delta = history[i].price - history[i - 1].price;
    if (delta !== 0) {
      changes++;
      lastChangeAt = history[i].date;
      if (delta < biggestDrop) biggestDrop = delta;
      if (delta > biggestRise) biggestRise = delta;
    }
  }

  const now = new Date();
  const createdAt = new Date(item.createdAt || (history[0] ? history[0].date : now));
  const daysTracked = Number.isNaN(createdAt.getTime()) ? 0 : daysBetween(createdAt, now);
  const daysSinceChange = Number.isNaN(lastChangeAt.getTime()) ? 0 : daysBetween(lastChangeAt, now);
  const targetReached = Number.isFinite(Number(item.targetPrice)) && Number.isFinite(current) && current <= Number(item.targetPrice);

  let score = 50;
  const reasons = [];

  if (Number.isFinite(lowest) && Number.isFinite(current)) {
    if (current <= lowest * 1.001) { score += 25; reasons.push("Lowest recorded price"); }
    else if (aboveLowPct <= 5) { score += 18; reasons.push("Within 5% of the lowest price"); }
    else if (aboveLowPct <= 15) { score += 8; reasons.push("Close to the historical low"); }
    else { score -= Math.min(20, aboveLowPct / 2); reasons.push("Previously seen cheaper"); }
  }

  if (discountPct >= 30) { score += 18; reasons.push(`${discountPct.toFixed(0)}% below the added price`); }
  else if (discountPct >= 15) { score += 10; reasons.push(`${discountPct.toFixed(0)}% below the added price`); }
  else if (discountPct > 0) { score += 4; reasons.push("Below the added price"); }
  else if (discountPct < 0) { score -= 12; reasons.push("Higher than when added"); }

  if (targetReached) { score += 15; reasons.push("Target price reached"); }
  if (daysSinceChange <= 3 && history.length > 1 && current <= history[history.length - 2].price) {
    score += 7; reasons.push("Recently reduced");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const stars = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  let label = "Fair price";
  let advice = "The current price is around its observed range.";
  if (score >= 90) { label = "Exceptional deal"; advice = "This is one of the strongest prices recorded."; }
  else if (score >= 75) { label = "Excellent deal"; advice = "This looks like a good time to buy."; }
  else if (score >= 60) { label = "Good price"; advice = "The price is attractive, though it may not be the absolute lowest."; }
  else if (score < 40) { label = "Wait"; advice = "This product has offered better value before."; }

  return {
    current,
    initial,
    lowest,
    highest,
    average,
    median: med,
    saving,
    discountPct,
    aboveLowPct,
    changes,
    biggestDrop: Math.abs(biggestDrop),
    biggestRise,
    daysTracked,
    daysSinceChange,
    targetReached,
    score,
    stars,
    label,
    advice,
    reasons: reasons.slice(0, 4),
    observations: values.length
  };
}

module.exports = { analyse };
