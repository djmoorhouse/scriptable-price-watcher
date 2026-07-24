function host(item) {
  return String(item && item.url || "").toLowerCase();
}

function retailer(item) {
  const url = host(item);
  if (url.includes("amazon.")) return "amazon";
  if (url.includes("boden.")) return "boden";
  if (url.includes("reiss.")) return "reiss";
  if (url.includes("lidl.")) return "lidl";
  if (url.includes("temu.")) return "temu";
  return "generic";
}

function prices(item) {
  return (Array.isArray(item.history) ? item.history : [])
    .map(x => Number(x.price))
    .filter(Number.isFinite);
}

function changes(item) {
  const p = prices(item);
  let drops = 0, rises = 0;
  for (let i = 1; i < p.length; i++) {
    if (p[i] < p[i - 1]) drops++;
    if (p[i] > p[i - 1]) rises++;
  }
  return { drops, rises, observations: p.length };
}

function pctOff(item) {
  const initial = Number(item.initialPrice);
  const current = Number(item.currentPrice);
  return Number.isFinite(initial) && initial > 0 && Number.isFinite(current)
    ? Math.max(0, (initial - current) / initial * 100)
    : 0;
}

function analyse(item, insight) {
  const shop = retailer(item);
  const current = Number(item.currentPrice);
  const previous = Number(item.previousPrice);
  const lowest = Number(insight && insight.lowest);
  const score = Number(insight && insight.score) || 0;
  const discount = pctOff(item);
  const movement = changes(item);
  const atLow = Number.isFinite(lowest) && current <= lowest;
  const target = Number(item.targetPrice);
  const targetReached = Number.isFinite(target) && current <= target;
  const dropped = Number.isFinite(previous) && current < previous;
  const increased = Number.isFinite(previous) && current > previous;

  let action = targetReached || (atLow && score >= 70) || score >= 85 ? "BUY" : increased || score < 45 ? "WAIT" : "WATCH";
  let confidence = movement.observations >= 6 ? "high" : movement.observations >= 3 ? "medium" : "early";
  let advice;

  if (shop === "amazon") {
    if (targetReached) advice = "Your target has been reached. Amazon prices can change quickly, so this is a strong time to buy.";
    else if (atLow && movement.rises > 0) advice = "This is the lowest price you have recorded, and the price has risen before. Consider buying rather than waiting.";
    else if (dropped) advice = "The Amazon price has just fallen. Watch briefly only if you are comfortable risking another quick change.";
    else advice = "Amazon prices often move frequently. Let Deal Radar collect more observations before treating this as exceptional.";
  } else if (shop === "boden") {
    if (targetReached || discount >= 45) advice = "This is a substantial reduction for your tracked price. Buy if the colour and size you want are still available.";
    else if (atLow && discount >= 30) advice = "This is the lowest tracked price and already a meaningful markdown. Waiting may save more, but increases the risk of losing your size.";
    else if (dropped) advice = "The markdown has deepened. Keep watching unless stock availability matters more than achieving the absolute lowest price.";
    else advice = "Boden items can move through several markdown stages. Wait for a clearer drop or set a target price.";
  } else if (shop === "reiss") {
    if (targetReached || (atLow && discount >= 35)) advice = "This is a strong Reiss reduction against your recorded starting price. Consider buying before popular sizes disappear.";
    else if (discount < 20) advice = "The reduction is still modest against the price you first recorded. Waiting is reasonable unless availability is limited.";
    else advice = "This is a useful discount, but not yet an unusually strong one in your own tracking history.";
  } else if (shop === "lidl") {
    if (targetReached || atLow) advice = "This matches your best recorded price. Lidl availability can be more important than waiting for another reduction.";
    else if (dropped) advice = "The price has fallen. Check availability locally before deciding to wait longer.";
    else advice = "For Lidl products, availability may be limited or store-specific, so use the tracked price alongside local stock information.";
  } else if (shop === "temu") {
    if (targetReached || (atLow && score >= 70)) advice = "This meets your tracked buying threshold. Check the final basket price, delivery terms and any time-limited conditions before ordering.";
    else if (dropped) advice = "The displayed price has fallen, but verify the final checkout price before treating it as a genuine saving.";
    else advice = "Keep watching the final payable price rather than promotional percentages alone.";
  } else {
    advice = targetReached ? "Your target price has been reached." : atLow ? "This is the lowest price you have recorded." : dropped ? "The price has just dropped." : "Keep tracking for a clearer buying signal.";
  }

  return {
    retailer: shop,
    action,
    confidence,
    advice,
    discountPercent: Math.round(discount),
    observations: movement.observations
  };
}

module.exports = { analyse, retailer };