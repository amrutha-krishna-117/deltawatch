# How to run DeltaWatch

You need **two terminals** — one for the backend, one for the frontend.

## Terminal 1 — Backend

```bash
cd deltawatch/backend
npm install          # only needed once
npm run dev
```

You should see:
```
[market] Using simulated market data provider
[startup] Registered 6 symbol(s).
[startup] DeltaWatch backend listening on :4000
```

### Optional: real Yahoo Finance data

```bash
# Create backend/.env with this content:
MARKET_DATA_PROVIDER=yahoo
```

Then restart the backend. Real prices for AAPL, TCS.NS, INFY.NS etc. will be fetched from Yahoo Finance (no API key needed, just internet access).

## Terminal 2 — Frontend

```bash
cd deltawatch/frontend
npm install          # only needed once
npm run dev
```

Open **http://localhost:5173** in your browser.

## What you should see

- 6 default stocks (NVDA, TSLA, AAPL, AMD, COIN, PLTR) with live prices
- Top-right badge shows "◌ Simulated data" or "● Yahoo Finance"
- "Connecting…" → "Live" within 2–3 seconds

## Adding stocks

- Type a symbol directly: `MSFT`, `TCS.NS`, `INFY.NS`, `RELIANCE.NS`
- Or type a company name: `Tata`, `Apple`, `Infosys` — a dropdown appears
- Click the result to select it, then click **Add**

## Troubleshooting

**"No symbols yet" / "Connecting…" stuck** → The backend is not running. Start it in Terminal 1.

**Port conflict** → If port 5173 is taken, Vite uses 5174, 5175, etc. That's fine — the backend is always on :4000.
