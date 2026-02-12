// Thin entry point — all routes live in app.js
const { app } = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const schedule = require('node-schedule');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Emit price update to all connected clients
function emitPriceUpdate(data) { io.emit('price_update', data); }

// Mock price emitter runs every 30 seconds for demo purposes
const DEMO_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'AMD'];

schedule.scheduleJob('*/30 * * * * *', () => {
  const ticker = DEMO_TICKERS[Math.floor(Math.random() * DEMO_TICKERS.length)];
  const basePrice = 150 + Math.random() * 700;
  const change = (Math.random() - 0.5) * 10;
  emitPriceUpdate({
    ticker,
    price: parseFloat(basePrice.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(((change / basePrice) * 100).toFixed(2)),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with WebSocket support`));