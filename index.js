// Thin entry point — all routes live in app.js
const { app } = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const schedule = require('node-schedule');
const { DEFAULT_STREAM_SYMBOLS, fetchMarketData } = require('./services/marketData');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Emit price update to all connected clients
function emitPriceUpdate(data) { io.emit('price_update', data); }

async function broadcastLivePrices() {
  try {
    const data = await fetchMarketData(DEFAULT_STREAM_SYMBOLS, { force: true });
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

io.on('connection', () => {
  broadcastLivePrices();
});

schedule.scheduleJob('*/30 * * * * *', broadcastLivePrices);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with WebSocket support`));
