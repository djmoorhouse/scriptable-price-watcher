const Analytics = importModule("PW_Analytics");
const RetailerIntel = importModule("PW_RetailerIntel");

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function analyseAll(items) {
  const entries = (Array.isArray(items) ? items : []).map(item => {
    const insight = Analytics.analyse(item);
    const retailerInsight = RetailerIntel.analyse(item, insight);
    const current = number(item.currentPrice);
    const previous = number(item.previousPrice, current);
    const initial = number(item.initialPrice, current);
    const lowest = number(insight.lowest, current);

    return {
      item,
      insight,
      retailerInsight,
      current,
      previous,
      initial,
      dropped: current < previous,
      increased: current > previous,
      targetReached: Number.isFinite(Number(item.targetPrice)) && current <= Number(item.targetPrice),
      allTimeLow: current <= lowest,
      saving: Math.max(0, initial - current)
    };
  });

  entries.sort((a, b) =>
    Number(b.targetReached) - Number(a.targetReached) ||
    Number(b.dropped) - Number(a.dropped) ||
    b.insight.score - a.insight.score
  );

  return {
    entries,
    topDeals: entries.slice(0, 3),
    greatDeals: entries.filter(x => x.insight.score >= 75).length,
    priceDrops: entries.filter(x => x.dropped).length,
    targetsReached: entries.filter(x => x.targetReached).length,
    allTimeLows: entries.filter(x => x.allTimeLow).length,
    increases: entries.filter(x => x.increased).length,
    totalPotentialSavings: entries.reduce((sum, x) => sum + x.saving, 0)
  };
}

module.exports = { analyseAll };