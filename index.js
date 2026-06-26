// Thin entry point — all routes live in app.js
const { app } = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const schedule = require('node-schedule');
const { config } = require('./config/env');
const { socketCorsOptions } = require('./middleware/security');
const {
  DEFAULT_STREAM_SYMBOLS,
  fetchMarketData,
  getFinnhubWebSocketConfig,
  normalizeFinnhubTrade,
} = require('./services/marketData');

const server = http.createServer(app);
const io = new Server(server, { cors: socketCorsOptions });
let connectedClients = 0;
let finnhubSocket = null;
let finnhubReconnectTimer = null;
let finnhubSymbolMap = new Map();

io.on('connection', (socket) => {
  connectedClients += 1;
  console.log('Client connected:', socket.id);
  startFinnhubStream();
  broadcastLivePrices();
  socket.on('disconnect', () => {
    connectedClients = Math.max(0, connectedClients - 1);
    console.log('Client disconnected:', socket.id);
    if (connectedClients === 0) stopFinnhubStream();
  });
});

// Emit price update to all connected clients
function emitPriceUpdate(data) { io.emit('price_update', data); }

async function broadcastLivePrices() {
  if (connectedClients === 0) return;
  try {
    const data = await fetchMarketData(DEFAULT_STREAM_SYMBOLS);
    data.quotes.forEach((quote) => {
      emitPriceUpdate({
        ticker: quote.symbol,
        symbol: quote.symbol,
        name: quote.name,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        currency: quote.currency,
        source: quote.source,
        timestamp: quote.timestamp || data.asOf,
      });
    });
  } catch (err) {
    console.error('Live market broadcast failed:', err.message);
  }
}

schedule.scheduleJob('*/30 * * * * *', broadcastLivePrices);

const PORT = config.port;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with WebSocket support`));

function startFinnhubStream() {
  if (connectedClients === 0 || finnhubSocket) return;
  const config = getFinnhubWebSocketConfig(DEFAULT_STREAM_SYMBOLS);
  if (!config || typeof WebSocket === 'undefined') return;

  finnhubSymbolMap = new Map(config.symbols.map(({ symbol, providerSymbol }) => [providerSymbol.toUpperCase(), symbol]));
  finnhubSocket = new WebSocket(config.url);

  finnhubSocket.addEventListener('open', () => {
    config.symbols.forEach(({ providerSymbol }) => {
      finnhubSocket?.send(JSON.stringify({ type: 'subscribe', symbol: providerSymbol }));
    });
    console.log(`Finnhub stream connected for ${config.symbols.length} symbols`);
  });

  finnhubSocket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'trade' || !Array.isArray(payload.data)) return;
      payload.data
        .map((trade) => normalizeFinnhubTrade(trade, finnhubSymbolMap))
        .filter(Boolean)
        .forEach(emitPriceUpdate);
    } catch (error) {
      console.error('Finnhub stream message parse failed:', error.message);
    }
  });

  finnhubSocket.addEventListener('error', () => {
    console.error('Finnhub stream error');
  });

  finnhubSocket.addEventListener('close', () => {
    finnhubSocket = null;
    if (connectedClients > 0 && !finnhubReconnectTimer) {
      finnhubReconnectTimer = setTimeout(() => {
        finnhubReconnectTimer = null;
        startFinnhubStream();
      }, 10000);
    }
  });
}

function stopFinnhubStream() {
  if (finnhubReconnectTimer) {
    clearTimeout(finnhubReconnectTimer);
    finnhubReconnectTimer = null;
  }
  if (finnhubSocket) {
    finnhubSocket.close();
    finnhubSocket = null;
  }
}
