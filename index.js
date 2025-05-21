const express = require('express');
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Aivestor Backend API'));

app.get('/api/test', (req, res) => {
  res.json({ message: 'Test endpoint working', status: 'success' });
});

app.listen(5000, () => console.log('Server running on port 5000'));