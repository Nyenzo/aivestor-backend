const SECTOR_DEFINITIONS = [
  { name: 'Technology', symbols: ['XLK', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META'], benchmark: 'XLK' },
  { name: 'Consumer Discretionary', symbols: ['XLY', 'AMZN', 'TSLA'], benchmark: 'XLY' },
  { name: 'Financials', symbols: ['XLF', 'JPM', 'BRK-B'], benchmark: 'XLF' },
  { name: 'Health Care', symbols: ['XLV'], benchmark: 'XLV' },
  { name: 'Energy', symbols: ['XLE'], benchmark: 'XLE' },
  { name: 'Consumer Staples', symbols: ['XLP'], benchmark: 'XLP' },
  { name: 'Industrials', symbols: ['XLI'], benchmark: 'XLI' },
  { name: 'Materials', symbols: ['XLB'], benchmark: 'XLB' },
  { name: 'Utilities', symbols: ['XLU'], benchmark: 'XLU' },
  { name: 'Real Estate', symbols: ['XLRE'], benchmark: 'XLRE' },
];

function buildMarketModel(data, options = {}) {
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  const riskLevel = String(options.riskLevel || 'medium').toLowerCase();
  const source = data?.source || 'market data';
  const sectors = buildSectorHeatmap(quotes);
  const sentiment = buildSentiment(quotes, sectors);
  const tradeSuggestions = Array.isArray(options.tradeSuggestions) && options.tradeSuggestions.length
    ? options.tradeSuggestions
    : buildTradeSuggestions(quotes, riskLevel);
  const notifications = buildNotifications(quotes, sectors, tradeSuggestions, source);

  return {
    asOf: data?.asOf || new Date().toISOString(),
    source,
    model: {
      name: 'Aivestor Market Pulse',
      version: 'market-trend-js-v1',
      inputs: [`${source} quotes`, 'cross-asset momentum', 'sector breadth', 'risk tolerance'],
    },
    summary: buildSummary(quotes, sectors, sentiment, tradeSuggestions, riskLevel),
    sectors,
    sentiment,
    notifications,
    tradeSuggestions,
  };
}

function buildSectorHeatmap(quotes) {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return SECTOR_DEFINITIONS.map((sector) => {
    const members = sector.symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean);
    const changePercent = average(members.map((quote) => quote.changePercent));
    const totalAbsMove = members.reduce((sum, quote) => sum + Math.abs(Number(quote.changePercent) || 0), 0);
    const leader = [...members].sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))[0];
    const laggard = [...members].sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0))[0];
    return {
      name: sector.name,
      benchmark: sector.benchmark,
      symbols: sector.symbols,
      tracked: members.length,
      changePercent: round(changePercent),
      relativeWeight: round(Math.max(8, members.length * 8 + totalAbsMove * 3), 2),
      leader: leader ? compactQuote(leader) : null,
      laggard: laggard ? compactQuote(laggard) : null,
      signal: changePercent >= 1 ? 'Overweight' : changePercent <= -1 ? 'Underweight' : 'Market weight',
    };
  }).filter((sector) => sector.tracked > 0);
}

function buildSentiment(quotes, sectors) {
  const breadth = quotes.length ? quotes.filter((quote) => Number(quote.changePercent) >= 0).length / quotes.length : 0;
  const avgChange = average(quotes.map((quote) => quote.changePercent));
  const vix = quotes.find((quote) => quote.symbol === '^VIX');
  const volatility = Number(vix?.changePercent) || 0;
  const riskPenalty = Math.max(0, Math.min(30, volatility / 2));
  const score = Math.max(0, Math.min(100, 50 + avgChange * 7 + (breadth - 0.5) * 35 - riskPenalty));
  const topSector = [...sectors].sort((a, b) => b.changePercent - a.changePercent)[0];
  const weakSector = [...sectors].sort((a, b) => a.changePercent - b.changePercent)[0];

  return {
    score: round(score, 1),
    label: score >= 70 ? 'Risk-on' : score >= 55 ? 'Constructive' : score >= 45 ? 'Neutral' : 'Defensive',
    breadthPercent: round(breadth * 100, 1),
    averageChangePercent: round(avgChange),
    volatilityChangePercent: round(volatility),
    topSector: topSector?.name || null,
    weakSector: weakSector?.name || null,
    gauges: [
      { label: 'Market Breadth', value: round(breadth * 100, 1), status: breadth >= 0.55 ? 'Positive' : 'Narrow' },
      { label: 'Sector Momentum', value: round(Math.max(0, Math.min(100, 50 + average(sectors.map((sector) => sector.changePercent)) * 10)), 1), status: topSector?.name || 'Mixed' },
      { label: 'Volatility Pressure', value: round(Math.max(0, Math.min(100, 100 - riskPenalty * 2)), 1), status: volatility > 15 ? 'Elevated' : 'Contained' },
    ],
  };
}

function buildTradeSuggestions(quotes, riskLevel) {
  const riskMultiplier = riskLevel === 'high' ? 1.25 : riskLevel === 'low' ? 0.65 : 1;
  return [...quotes]
    .filter((quote) => quote.type === 'equity' || quote.type === 'crypto')
    .sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0))
    .slice(0, 6)
    .map((quote) => {
      const change = Number(quote.changePercent) || 0;
      const action = change >= 1.5 ? 'Buy momentum' : change <= -2.5 ? 'Watch reversal' : change < 0 ? 'Hold / reduce risk' : 'Hold';
      const confidence = Math.max(45, Math.min(92, 58 + Math.abs(change) * 5 * riskMultiplier));
      const stop = quote.price ? quote.price * (change >= 0 ? 0.965 : 0.94) : null;
      const target = quote.price ? quote.price * (change >= 0 ? 1.055 : 1.03) : null;
      return {
        symbol: quote.symbol,
        name: quote.name || quote.symbol,
        action,
        confidence: round(confidence, 1),
        price: quote.price,
        changePercent: quote.changePercent,
        stop: round(stop),
        target: round(target),
        rationale: `${displaySymbol(quote.symbol)} ${change >= 0 ? 'is leading' : 'is lagging'} with a ${formatSigned(change)} move; position sizing adjusted for ${riskLevel} risk.`,
      };
    });
}

function buildNotifications(quotes, sectors, tradeSuggestions, source = 'market data') {
  const movers = [...quotes].sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)).slice(0, 4);
  const sector = [...sectors].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0];
  const suggestions = tradeSuggestions.slice(0, 2).map((suggestion) => ({
    type: 'trade-suggestion',
    severity: suggestion.action.includes('Buy') ? 'opportunity' : 'watch',
    title: `${displaySymbol(suggestion.symbol)} ${suggestion.action}`,
    message: suggestion.rationale,
  }));

  return [
    ...movers.map((quote) => ({
      type: 'market-move',
      severity: quote.changePercent >= 0 ? 'opportunity' : 'risk',
      title: `${displaySymbol(quote.symbol)} moved ${formatSigned(quote.changePercent)}`,
      message: `${quote.name || quote.symbol} is trading at ${formatPrice(quote.price)} from ${sourceLabel(source)}.`,
    })),
    ...(sector ? [{
      type: 'sector-breadth',
      severity: sector.changePercent >= 0 ? 'opportunity' : 'risk',
      title: `${sector.name} sector ${sector.signal}`,
      message: `${sector.name} average move is ${formatSigned(sector.changePercent)} across ${sector.tracked} tracked instruments.`,
    }] : []),
    ...suggestions,
  ].slice(0, 7);
}

function sourceLabel(source = '') {
  if (/finnhub/i.test(source)) return 'Finnhub';
  if (/yahoo/i.test(source)) return 'Yahoo Finance';
  return 'market data';
}

function buildSummary(quotes, sectors, sentiment, tradeSuggestions, riskLevel) {
  const top = [...sectors].sort((a, b) => b.changePercent - a.changePercent)[0];
  const weak = [...sectors].sort((a, b) => a.changePercent - b.changePercent)[0];
  const advancers = quotes.filter((quote) => Number(quote.changePercent) >= 0).length;
  const suggestion = tradeSuggestions?.[0];
  const modelReadout = suggestion ? ` The model flags ${displaySymbol(suggestion.symbol)} as ${String(suggestion.action).toLowerCase()}.` : '';
  return `Aivestor Market Pulse is ${sentiment.label.toLowerCase()} with ${advancers}/${quotes.length} tracked markets advancing. ${top?.name || 'Leading sectors'} leads at ${formatSigned(top?.changePercent || 0)}, while ${weak?.name || 'the weakest group'} trails at ${formatSigned(weak?.changePercent || 0)}.${modelReadout} For a ${riskLevel} risk profile, maintain diversification and apply defined risk limits.`;
}

function compactQuote(quote) {
  return {
    symbol: quote.symbol,
    name: quote.name || quote.symbol,
    price: quote.price,
    changePercent: quote.changePercent,
  };
}

function displaySymbol(symbol = '') {
  return String(symbol).replace(/^\^/, '').replace('-USD', '');
}

function formatSigned(value) {
  const number = Number(value) || 0;
  const sign = number >= 0 ? '+' : '-';
  return `${sign}${Math.abs(number).toFixed(2)}%`;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'the live market price';
  return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

module.exports = {
  SECTOR_DEFINITIONS,
  buildMarketModel,
  buildSectorHeatmap,
  buildTradeSuggestions,
};
