# DeltaWatch

## The Problem

Every stock watchlist shows the same thing: a table of prices and a percentage change from yesterday's close. That answers the wrong question.

When you return to your portfolio after two hours, you don't need to know where prices are. You need to know **what moved since you were last here** and **which of those moves actually matters**.

Two specific failures in every standard watchlist:

**Flat thresholds lie.** A 2% move is enormous for Apple and unremarkable for Coinbase. A single global alert threshold is either deaf to volatile stocks or noisy on calm ones.

**"Since yesterday's close" isn't "since I looked."** If you check your watchlist five times a day, yesterday's close is stale context for four of those five visits. The meaningful baseline is your own last visit — not the exchange's clock.

DeltaWatch fixes both.

---

## What It Does

Every time you open DeltaWatch, it answers three questions — in this order:

### 1. What changed since I was last here?
A personal checkpoint stores the exact price of every stock at the moment you last reviewed your watchlist. When you return, every stock is compared against *that* price — not yesterday's close, not today's open. Your delta, not the market's.

### 2. What deserves my attention?
An **Attention Score (0–100)** ranks every stock by how unusual its move is — for that specific stock, confirmed by volume. The highest-scoring stocks float to the top automatically.

### 3. Why?
Every score comes with a plain-English explanation. Not just a badge — a reason.

> *"NVDA is down 2.6% — unusual for this symbol · Volume 3.1× above average"*

---

## The Attention Score

The score combines three signals. No single signal can dominate.

| Signal | Max Points | What It Measures |
|---|---|---|
| Volatility-adjusted delta | 55 | How big is this move *for this specific stock* — measured as a z-score against its own recent realized volatility, not a flat percentage |
| Volume confirmation | 30 | Is unusual trading volume backing the price move? A move on thin volume scores low. A move confirmed by 4× average volume scores high. |
| Catalyst tag | 15 | Block deal or corporate action in the last 5 minutes |

**Score → Band:**
- 0–32 → `LOW`
- 33–65 → `MEDIUM`
- 66–100 → `HIGH`

A stock cannot reach HIGH on price movement alone. Volume must confirm it. This is what separates signal from noise.

---

## Core Features

- **Personal checkpoint** — click "Mark as reviewed" and the server saves the current price of every stock. Come back later on any device and see exactly what moved since that moment.
- **Delta hero section** — the top of the dashboard shows only stocks that moved since your checkpoint, ranked by magnitude, before you see anything else.
- **Attention-sorted watchlist** — cards sorted by score, not alphabetically. What needs looking at is always first.
- **Sparklines with checkpoint marker** — a dashed vertical line marks where the price was when you last checked, so the chart tells the change story visually.
- **Stock search** — type a company name or ticker to find and add any stock. Supports US and Indian NSE symbols.
- **Market state labels** — every card shows whether the market is OPEN, CLOSED, PRE-market, or AFTER-hours. You always know what kind of price you're seeing.

---

## Architecture
Yahoo Finance (real market data, polled every 15s)
↓
Backend — fetches quotes, calculates attention scores
↓
Redis — distributes ticks across backend instances
↓
WebSocket — pushes live updates to connected browsers
↓
Frontend — shows delta since checkpoint, sorted by attention
↓
PostgreSQL — stores watchlists and checkpoints permanently

---

### Two clean abstractions enable scaling

**`DbApi` interface — `backend/src/db.ts`**
One interface, two implementations. Set `DATABASE_URL` to switch — no code changes.
- `SqliteDb` → local development, zero config
- `PostgresDb` → production, connection pool of 20, concurrent users

**`TickBus` interface — `backend/src/tickBus.ts`**
One interface, two implementations. Set `REDIS_URL` to switch — no code changes.
- `InMemoryTickBus` → single process, EventEmitter
- `RedisTickBus` → multiple backend instances, all sharing one Redis channel. A tick published by Instance A reaches clients connected to Instance B.

---

## How Stale and Delayed Data Is Handled

| Problem | Solution |
|---|---|
| Out-of-order ticks | Every tick has a monotonic sequence number. Last-write-wins by sequence, not arrival time. A delayed packet can never overwrite a fresher one — on either client or server. |
| Stale prices | If a symbol hasn't updated within 35 seconds (Yahoo) or 5 seconds (sim), it is explicitly flagged `stale` in the UI. Old prices are never shown as live. |
| Silent WebSocket death | The server sends a full snapshot every 20 seconds as a safety net, catching connections that died without a close event. |
| WebSocket drop | Frontend automatically falls back to REST polling. Switches back to WebSocket transparently when it reconnects. No blank screen, no manual refresh needed. |
| Provider failure | Each symbol's fetch is independent. One failed Yahoo request doesn't affect any other symbol. |
| Market closed | Yahoo returns `CLOSED` state. Cards show "Closed" and display the last traded price — never pretending it's a live quote. |

---

## Tech Stack

### Frontend
- **React** + TypeScript
- **Zustand** — state management
- **Tailwind CSS v4** — styling
- **Vite** — build tool
- Native WebSocket with automatic REST polling fallback

### Backend
- **Node.js** + Express + TypeScript
- **WebSocket** server (`ws`)
- **Yahoo Finance** via `yahoo-finance2` — real market data, no API key needed
- `tsx` for development

### Infrastructure
- **PostgreSQL** on Supabase — watchlists, checkpoints, persists across restarts and devices
- **Redis** on Upstash — tick pub/sub, enables horizontal scaling
- **Railway** — backend deployment
- **Vercel** — frontend deployment

---

## Running It Locally

**Requirements:** Node.js 18+ and npm

**Terminal 1 — Backend**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

Without a `.env` file the backend runs on a simulated feed, clearly labelled in the UI.

---

## Environment Variables

### `backend/.env`

```env
# "yahoo" for real data | "sim" for simulated (default)
MARKET_DATA_PROVIDER=yahoo

# PostgreSQL — leave unset to use SQLite locally
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# Redis — leave unset to use in-memory locally
REDIS_URL=rediss://default:password@host:6379

PORT=4000
```

### `frontend/.env.local`

```env
# Backend URL — leave unset to use http://localhost:4000 locally
VITE_API_URL=https://your-backend.railway.app
```

**Full production startup output:**
[db] Using PostgreSQL
[tickbus] Using Redis pub/sub — multi-instance scaling enabled
[market] Using Yahoo Finance provider (real market data)
[startup] DeltaWatch listening on :4000

---

## Deployment

**Backend → Railway**
Connect GitHub repo → set root directory to `backend` → add environment variables → deploy. Uses `railway.json` automatically.

**Frontend → Vercel**
Connect GitHub repo → set root directory to `frontend` → add `VITE_API_URL` → deploy. Uses `vercel.json` automatically.

---

## Project Structure
backend/
src/
server.ts Express + WebSocket gateway
db.ts DbApi interface — SQLite + PostgreSQL
tickBus.ts TickBus interface — in-memory + Redis
marketDataProvider.ts Provider interface — Yahoo Finance + simulated
marketFeed.ts Symbol registry, feed loop, rolling stats
attentionEngine.ts Attention score calculation
types.ts Shared TypeScript types
.env.example
railway.json

frontend/
src/
App.tsx
store.ts Zustand state — watchlists, packets, connection
useMarketSocket.ts WebSocket lifecycle + polling fallback
utils.ts Price, percent, time formatters
components/
DeltaHero.tsx "Since your last checkpoint" section
WatchlistGrid.tsx Card grid with sorting
StockCard.tsx Individual stock card
OverviewBar.tsx Status bar — connection, stats, checkpoint
AddSymbol.tsx Search and add with autocomplete
Sparkline.tsx SVG sparkline with checkpoint marker
AttentionBadge.tsx LOW / MEDIUM / HIGH badge
.env.example
vercel.json

---

## Supported Symbols

Any valid Yahoo Finance symbol works dynamically — no hardcoded lists.

**US:** `AAPL` `TSLA` `NVDA` `MSFT` `GOOGL` `AMZN` `META` `COIN` `PLTR` `AMD`

**Indian NSE:** `TCS.NS` `INFY.NS` `RELIANCE.NS` `HDFCBANK.NS` `WIPRO.NS` `ICICIBANK.NS`

Search by name — type *"Tata"* to find `TCS.NS`, type *"Apple"* to find `AAPL`.

---

## Honest Limitations

- Yahoo Finance is an unofficial API — no guaranteed uptime or SLA
- Quotes may be 15 minutes delayed depending on the exchange
- No WebSocket streaming from Yahoo — backend polls every 15 seconds
- Sparkline history is in-memory — rebuilt from Yahoo's intraday chart on restart
- Single `demo-user` identity by default — real authentication is one JWT middleware file away, since `userId` is already threaded through every API call and database query
