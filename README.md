# ✦ Aura AI — AI Companion Platform

A full-stack AI companion platform inspired by Candy.ai. Features realistic character creation, AI-powered chat, subscription payments, and a full admin panel.

![Aura AI](https://img.shields.io/badge/Aura_AI-Companion_Platform-ff6b9d?style=for-the-badge)

## Features

### User System
- Email/password authentication with JWT tokens
- 24-hour free trial with 50 messages and 1 companion
- Automatic paywall when trial expires
- User profiles with message tracking

### AI Companion Creation
- Multi-step creation wizard (4 steps)
- Upload custom photo OR describe appearance
- Customize: ethnicity, age, eye color, hair style/color, body type
- Set personality traits, voice style, and hobbies
- Realistic preset companions with high-quality images

### Chat Features
- Real-time AI chat powered by Claude (Anthropic API)
- Chat history saved per user per companion
- Content safety filter (PayPal/Stripe safe)
- Typing indicators and message timestamps
- Context-aware conversations (AI remembers history)

### Monetization
- 3 subscription tiers: Starter ($9.99), Plus ($19.99), Premium ($39.99)
- Message limits and companion slots per plan
- Stripe payment integration ready
- PayPal integration ready

### Admin Panel
- Dashboard with user/revenue/message stats
- View and manage all users
- View all companions (preset + user-created)
- Payment history tracking
- Ability to delete users and manage plans

### Design
- Dark theme with pink/rose accents (candy.ai inspired)
- Mobile-first responsive design
- Sidebar navigation with all sections
- Beautiful card-based companion grid
- Smooth animations and transitions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| AI | Anthropic Claude API |
| Auth | JWT + bcrypt |
| Payments | Stripe (ready) |
| Deployment | Railway |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Anthropic API key (optional, has fallback)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/aura-ai.git
cd aura-ai
```

### 2. Set up environment

```bash
cp .env.example server/.env
```

Edit `server/.env` with your values:
```
DATABASE_URL=postgresql://localhost:5432/aura_ai
JWT_SECRET=your-random-secret-key
ANTHROPIC_API_KEY=sk-ant-your-key  # optional
PORT=3001
```

### 3. Install dependencies

```bash
cd client && npm install && cd ..
cd server && npm install && cd ..
```

### 4. Build frontend

```bash
cd client && npm run build && cd ..
```

### 5. Start server

```bash
cd server && node index.js
```

Visit `http://localhost:3001`

**Admin Login:** `admin@aura.ai` / `admin123`

---

## Deploy to Railway

### 1. Create a GitHub repository

```bash
cd aura-ai
git init
git add .
git commit -m "Initial commit - Aura AI Companion Platform"
git remote add origin https://github.com/YOUR_USERNAME/aura-ai.git
git push -u origin main
```

### 2. Set up Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub Repo"**
4. Choose your `aura-ai` repository

### 3. Add PostgreSQL database

1. In your Railway project, click **"+ New"**
2. Select **"Database" → "PostgreSQL"**
3. Railway auto-creates the `DATABASE_URL` variable

### 4. Set environment variables

In your Railway service, go to **Variables** and add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | *(auto-set by Railway PostgreSQL)* |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `STRIPE_SECRET_KEY` | Your Stripe secret key (optional) |

### 5. Configure build settings

Railway should auto-detect from `railway.toml`. If needed, set:
- **Build Command:** `cd client && npm install && npm run build && cd ../server && npm install`
- **Start Command:** `cd server && node index.js`

### 6. Deploy

Push to GitHub and Railway auto-deploys:
```bash
git push origin main
```

Your app will be live at `https://your-app.railway.app`

---

## Stripe Integration (Production Payments)

1. Create a [Stripe account](https://stripe.com)
2. Get your API keys from the Stripe Dashboard
3. Set `STRIPE_SECRET_KEY` in Railway variables
4. The app auto-detects Stripe and creates real checkout sessions

### PayPal Integration

1. Create a [PayPal Developer account](https://developer.paypal.com)
2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`
3. Implement PayPal checkout in `server/routes/payments.js`

---

## Content Safety

All content is filtered to comply with payment processor policies:
- AI responses are system-prompted to stay PG-13
- User input is scanned for prohibited content
- AI output is double-checked before delivery
- Explicit content requests are redirected

---

## Project Structure

```
aura-ai/
├── client/                  # React Frontend
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── hooks/           # Auth context & hooks
│   │   ├── pages/           # Page components
│   │   ├── styles/          # Global CSS
│   │   ├── utils/           # API helpers
│   │   ├── App.jsx          # Main app
│   │   └── main.jsx         # Entry point
│   ├── index.html
│   └── vite.config.js
├── server/                  # Express Backend
│   ├── config/
│   │   └── database.js      # PostgreSQL + seeding
│   ├── middleware/
│   │   └── auth.js          # JWT + content filter
│   ├── routes/
│   │   ├── auth.js          # Login/signup
│   │   ├── chat.js          # AI chat + history
│   │   ├── companions.js    # CRUD companions
│   │   ├── collections.js   # Save favorites
│   │   ├── payments.js      # Stripe subscriptions
│   │   └── admin.js         # Admin dashboard
│   ├── uploads/             # Avatar uploads
│   └── index.js             # Server entry
├── .env.example
├── .gitignore
├── railway.toml             # Railway config
├── nixpacks.toml            # Build config
└── README.md
```

---

## License

MIT — Free for commercial use.
