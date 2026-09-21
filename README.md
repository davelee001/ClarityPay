# ClarityPay

ClarityPay is a hackathon-ready financial safety prototype that detects social-engineering/coercion signals around a transfer and pauses suspicious transactions before confirmation.

## What works out of the box

- Mock Apex Bank dashboard
- Demo customer profile and balance
- Transfer form with anomaly detection
- Simulated live scam transcript
- Real-time risk meter using Server-Sent Events
- Hybrid risk engine:
  - transaction anomalies
  - scam/coercion rules
  - optional OpenAI structured analysis
- Financial intercept modal
- 24-hour safety hold
- Trusted-contact notification simulation
- Audit event log
- No external API keys required for the demo

## Requirements

- Node.js 20+
- npm 10+

## Run

### Backend

```bash
cd backend
npm install
copy .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Backend: http://localhost:4000

### Frontend

Open another terminal:

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Frontend: http://localhost:3000

On PowerShell, if `copy` is unavailable, use:

```powershell
Copy-Item .env.example .env
```

## Optional AI

The default rule engine is sufficient for the hackathon demo. To add OpenAI analysis, put an API key in `backend/.env`:

```env
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o
```

The application falls back to the deterministic rules if the key is missing.

## Demo

1. Open the frontend.
2. Click **Start Scam Simulation**.
3. Watch the transcript appear line by line.
4. Watch the risk score rise.
5. Enter a transfer of $9,500 to the new beneficiary.
6. Click **Confirm Transfer**.
7. ClarityPay blocks the transaction.
8. Click **Yes — I'm on a call**.
9. The transfer becomes **PAUSED — 24H SAFETY HOLD**.
10. The trusted-contact alert and audit trail update.

## Important

This is a prototype/simulation. It does not connect to real bank accounts, wire networks, payment rails, or production financial systems.
