# AIvestor Backend

A robust backend service for the AIvestor platform, providing secure API endpoints for investment management and analysis.

## 🚀 Features

- RESTful API endpoints for investment management
- Firebase Authentication integration
- SQL database for data persistence
- Secure user management
- Investment portfolio tracking
- Real-time data processing

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v14.0.0 or higher)
- npm (v6.0.0 or higher)
- SQL database (MySQL/PostgreSQL)

## 🛠️ Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/aivestor-backend.git
   cd aivestor-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Create a `.env` file in the root directory
   - Add necessary environment variables (see Configuration section)

4. Set up the database:
   ```bash
   # Run the SQL setup script
   mysql -u your_username -p < setup_tables.sql
   ```

5. Start the server:
   ```bash
   npm start
   ```

## ⚙️ Configuration

The following environment variables are required:

```env
PORT=3000
NODE_ENV=development
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=aivestor_db
FIREBASE_CONFIG_PATH=./aivestor-firebase-adminsdk.json
```

## 📚 API Documentation

### Authentication
- POST `/api/auth/login` - User login
- POST `/api/auth/register` - User registration
- POST `/api/auth/logout` - User logout

### Investment Management
- GET `/api/portfolio` - Get user portfolio
- POST `/api/portfolio/invest` - Make new investment
- GET `/api/portfolio/analysis` - Get portfolio analysis

## 🔒 Security

- Firebase Authentication for secure user management
- JWT token-based API authentication
- SQL injection prevention
- Rate limiting on API endpoints
- Secure environment variable handling

## 🧪 Testing

Run the test suite:
```bash
npm test
```


## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


