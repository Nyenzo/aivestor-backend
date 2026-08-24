const MAX_QUANTITY = 1_000_000_000;
const MAX_DECIMALS = 6;
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,20}$/;

function validatePaperOrder(input = {}) {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const type = String(input.type || '').trim().toLowerCase();
  const quantity = Number(input.quantity);

  if (!symbol || !type || input.quantity === undefined || input.quantity === null) {
    return { error: 'symbol, type (buy/sell), and quantity are required' };
  }
  if (!SYMBOL_PATTERN.test(symbol)) return { error: 'symbol contains unsupported characters' };
  if (!['buy', 'sell'].includes(type)) return { error: 'type must be buy or sell' };
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
    return { error: 'quantity must be a positive, finite value within the supported limit' };
  }
  if (decimalPlaces(quantity) > MAX_DECIMALS) return { error: `quantity supports at most ${MAX_DECIMALS} decimal places` };

  return { value: { symbol, type, quantity } };
}

function applyPaperOrder(existingPositions = [], order) {
  const positions = Array.isArray(existingPositions) ? existingPositions.map((position) => ({ ...position })) : [];
  const index = positions.findIndex((position) => String(position.stock_symbol || position.symbol || '').toUpperCase() === order.symbol);

  if (order.type === 'buy') {
    if (index === -1) {
      positions.push({
        stock_symbol: order.symbol,
        quantity: order.quantity,
        averagePrice: order.price,
        currentPrice: order.price,
        currency: order.currency || 'USD',
        priceSource: order.source,
        priceTimestamp: order.timestamp,
      });
    } else {
      const current = positions[index];
      const currentQuantity = Number(current.quantity) || 0;
      const currentAverage = Number(current.averagePrice) || 0;
      const nextQuantity = currentQuantity + order.quantity;
      positions[index] = {
        ...current,
        quantity: nextQuantity,
        averagePrice: roundPrice(((currentAverage * currentQuantity) + (order.price * order.quantity)) / nextQuantity),
        currentPrice: order.price,
        currency: order.currency || current.currency || 'USD',
        priceSource: order.source,
        priceTimestamp: order.timestamp,
      };
    }
    return { positions };
  }

  if (index === -1) return { error: `No simulated position in ${order.symbol}` };
  const current = positions[index];
  const currentQuantity = Number(current.quantity) || 0;
  if (currentQuantity + Number.EPSILON < order.quantity) {
    return { error: `Insufficient shares (have ${currentQuantity})` };
  }

  const nextQuantity = roundQuantity(currentQuantity - order.quantity);
  if (nextQuantity <= 0) positions.splice(index, 1);
  else {
    positions[index] = {
      ...current,
      quantity: nextQuantity,
      currentPrice: order.price,
      currency: order.currency || current.currency || 'USD',
      priceSource: order.source,
      priceTimestamp: order.timestamp,
    };
  }
  return { positions };
}

function decimalPlaces(value) {
  const text = String(value);
  const exponent = text.toLowerCase().split('e');
  const fraction = (exponent[0].split('.')[1] || '').length;
  const shift = Number(exponent[1] || 0);
  return Math.max(0, fraction - shift);
}

function roundPrice(value) {
  return Number(Number(value).toFixed(6));
}

function roundQuantity(value) {
  return Number(Number(value).toFixed(MAX_DECIMALS));
}

module.exports = { applyPaperOrder, validatePaperOrder };
