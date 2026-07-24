const Analytics = importModule("PW_Analytics");
const RetailerIntel = importModule("PW_RetailerIntel");
const StockIntel = importModule("PW_StockIntel");

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function analyseAll(items) {
  const entries = (Array.isArray(items) ? items : []).map(item => {
    const insight = Analytics.analyse(item);
    const retailerInsight = RetailerIntel.analyse(item, insight);
    const stockInsight = StockIntel.analyse(item);
    const current = number(item.currentPrice);
    const previous = number(item.previousPrice, current);
    const initial = number(item.initialPrice, current);
    const lowest = number(insight.lowest, current);

    return {
      item,
      insight,
      retailerInsight,
      stockInsight,
      current,
      previous,
      initial,
      dropped: current < previous,
      increased: current > previous,
      targetReached: Number.isFinite(Number(item.targetPrice)) && current <= Number(item.targetPrice),
      allTimeLow: current <= lowest,
      saving: Math.max(0, initial - current),
      opportunityScore: insight.score + (item.trackedSize && item.sizeAvailable === true ? Math.min(25, stockInsight.score / 4) : 0)
    };
  });

  entries.sort((a, b) =>
    Number(b.item.sizeAvailable === true) - Number(a.item.sizeAvailable === true) ||
    Number(b.targetReached) - Number(a.targetReached) ||
    Number(b.dropped) - Number(a.dropped) ||
    b.opportunityScore - a.opportunityScore
  );

  return {
    entries,
    topDeals: entries.filter(x => !x.item.trackedSize || x.item.sizeAvailable !== false).slice(0, 3),
    greatDeals: entries.filter(x => x.insight.score >= 75).length,
    priceDrops: entries.filter(x => x.dropped).length,
    targetsReached: entries.filter(x => x.targetReached).length,
    allTimeLows: entries.filter(x => x.allTimeLow).length,
    increases: entries.filter(x => x.increased).length,
    lowStock: entries.filter(x => x.stockInsight.risk === "critical" || x.stockInsight.risk === "high").length,
    soldOut: entries.filter(x => x.item.trackedSize && x.item.sizeAvailable === false).length,
    totalPotentialSavings: entries.reduce((sum, x) => sum + x.saving, 0)
  };
}

module.exports = { analyseAll };