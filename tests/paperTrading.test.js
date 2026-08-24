const { applyPaperOrder, validatePaperOrder } = require('../services/paperTrading');

describe('paper trading domain service', () => {
  test('rejects invalid symbols, order types, and unsafe quantities', () => {
    expect(validatePaperOrder({ symbol: 'bad symbol', type: 'buy', quantity: 1 }).error).toMatch(/symbol/i);
    expect(validatePaperOrder({ symbol: 'AAPL', type: 'short', quantity: 1 }).error).toMatch(/buy or sell/i);
    expect(validatePaperOrder({ symbol: 'AAPL', type: 'buy', quantity: 0 }).error).toMatch(/positive/i);
  });

  test('updates a weighted average using the authoritative execution price', () => {
    const result = applyPaperOrder([{ stock_symbol: 'AAPL', quantity: 2, averagePrice: 100 }], {
      symbol: 'AAPL', type: 'buy', quantity: 3, price: 110, currency: 'USD', source: 'finnhub', timestamp: '2026-07-14T12:00:00Z',
    });

    expect(result.positions).toEqual([expect.objectContaining({ stock_symbol: 'AAPL', quantity: 5, averagePrice: 106, currentPrice: 110 })]);
  });

  test('does not mutate positions when a sale exceeds the simulated holding', () => {
    const positions = [{ stock_symbol: 'AAPL', quantity: 2, averagePrice: 100 }];
    const result = applyPaperOrder(positions, { symbol: 'AAPL', type: 'sell', quantity: 3, price: 110 });

    expect(result.error).toMatch(/Insufficient/i);
    expect(positions).toEqual([{ stock_symbol: 'AAPL', quantity: 2, averagePrice: 100 }]);
  });

  test('removes a position after a full sale', () => {
    const result = applyPaperOrder([{ stock_symbol: 'AAPL', quantity: 2, averagePrice: 100 }], {
      symbol: 'AAPL', type: 'sell', quantity: 2, price: 110,
    });

    expect(result.positions).toEqual([]);
  });
});
