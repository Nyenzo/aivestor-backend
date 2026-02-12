# Aivestor Backend

Express 5 REST API with WebSocket support, Firebase Admin for Firestore/Auth, and JWT-based authentication.

## Setup

```bash
cp .env.example .env    # fill in your keys
npm install
npm run dev             # starts with --watch for auto-reload
```

Production:

```bash
npm start
```

## API Endpoints

### Authentication

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | — | Register with email/password |
| POST | `/api/auth/login` | — | Login, returns JWT |
| POST | `/api/auth/google` | — | Google Sign-In |
| POST | `/api/auth/forgot-password` | — | Send reset email |
| POST | `/api/auth/reset-password` | — | Reset password with token |
| POST | `/api/auth/verify-email` | — | Verify email with token |
| POST | `/api/auth/refresh` | Bearer | Refresh JWT |

### Users

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/users` | Bearer | List all users |
| GET | `/api/users/me` | Bearer | Current user profile |
| PUT | `/api/users/me` | Bearer | Update profile |

### Portfolio & Onboarding

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/portfolio` | Bearer | Get portfolio |
| PUT | `/api/portfolio` | Bearer | Update portfolio |
| POST | `/api/onboarding` | Bearer | Submit risk profile, get AI recommendation |

### Nudges & Alerts

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/nudges` | Bearer | List nudges |
| POST | `/api/nudges` | Bearer | Create nudge |
| GET | `/api/alerts` | Bearer | List alerts |
| POST | `/api/alerts` | Bearer | Create price alert |

### Brokerage

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/brokerage/connect` | Bearer | Connect brokerage |
| GET | `/api/brokerage/status` | Bearer | List connections |
| DELETE | `/api/brokerage/disconnect` | Bearer | Disconnect brokerage |
| POST | `/api/brokerage/sync` | Bearer | Sync portfolio from brokerage |
| POST | `/api/brokerage/trade` | Bearer | Execute simulated trade |

### Predictions

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/predict` | Bearer | Get AI stock prediction |
| GET | `/api/predict/portfolio` | Bearer | Portfolio-wide prediction |

## WebSocket Events

The server broadcasts via Socket.IO:

| Event | Payload | Frequency |
|-------|---------|-----------|
| `price_update` | `{ ticker, price, change, changePercent, timestamp }` | Every 30s |

## Testing

```bash
npm test                # runs Jest + Supertest (58 tests)
```

## Project Structure

```
├── app.js              # Express app, routes, middleware
├── index.js            # Server entry point, WebSocket, scheduler
├── middleware/
│   └── auth.js         # JWT authentication middleware
├── routes/
│   ├── brokerage.js    # Brokerage endpoints
│   └── predictions.js  # AI prediction endpoints
├── tests/              # Jest test suites
├── .env.example
└── package.json
```
