require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const {
  analyzeTranscript,
  analyzeTransaction,
  combineRisk,
  optionalAIAnalysis
} = require("./riskEngine");
const {
  createAuthMiddleware,
  createSessionToken,
  getAuthConfig,
  readSessionCookie,
  safeEqualStrings,
  serializeSessionCookie,
  verifySessionToken
} = require("./auth");

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const authConfig = getAuthConfig();
const loginFailures = new Map();

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json({ limit: "32kb" }));

const clients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}

async function audit(type, message, metadata = {}) {
  const item = await prisma.auditEvent.create({
    data: { type, message, metadata: JSON.stringify(metadata) }
  });
  broadcast({ type: "audit", event: item });
  return item;
}

async function seed() {
  const count = await prisma.customer.count();
  if (count === 0) {
    await prisma.customer.create({
      data: {
        name: "Arthur",
        age: 72,
        balance: 24800,
        typicalTransfer: 150,
        trustedContact: "Martha — Daughter",
        trustedPhone: "+256 700 000 000"
      }
    });
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "ClarityPay API", time: new Date().toISOString() });
});

app.post("/api/auth/login", (req, res) => {
  const now = Date.now();
  const client = req.socket.remoteAddress || "unknown";
  let attempt = loginFailures.get(client);
  if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000) {
    attempt = { startedAt: now, count: 0 };
  }
  if (attempt.count >= 10) {
    res.setHeader("Retry-After", "900");
    return res.status(429).json({ error: "Too many login attempts. Try again later." });
  }

  attempt.count += 1;
  loginFailures.set(client, attempt);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const username = typeof body.username === "string" ? body.username.slice(0, 256) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  const usernameMatches = safeEqualStrings(username, authConfig.username);
  const passwordMatches = safeEqualStrings(password, authConfig.password);

  if (!usernameMatches || !passwordMatches) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  loginFailures.delete(client);
  const token = createSessionToken(authConfig.username, authConfig.secret);
  res.setHeader("Set-Cookie", serializeSessionCookie(token, authConfig));
  res.json({ authenticated: true, user: { username: authConfig.username } });
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", serializeSessionCookie("", authConfig, 0));
  res.status(204).end();
});

app.get("/api/auth/session", (req, res) => {
  const session = verifySessionToken(readSessionCookie(req.headers.cookie), authConfig.secret);
  res.json({
    authenticated: session?.sub === authConfig.username,
    user: session?.sub === authConfig.username ? { username: session.sub } : null
  });
});

app.use("/api", createAuthMiddleware(authConfig));

app.get("/api/customer", async (req, res) => {
  const customer = await prisma.customer.findFirst({
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } }
  });
  res.json(customer);
});

app.get("/api/audit", async (req, res) => {
  const events = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 30
  });
  res.json(events);
});

app.get("/api/alerts", async (req, res) => {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 20
  });
  res.json(alerts);
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  clients.add(res);

  req.on("close", () => clients.delete(res));
});

app.post("/api/analyze", async (req, res) => {
  const { transcript = "", transaction } = req.body;
  const customer = await prisma.customer.findFirst();

  const transcriptResult = analyzeTranscript(transcript);
  const transactionResult = analyzeTransaction(transaction, customer);
  const ai = await optionalAIAnalysis(transcript, transaction, customer);

  const combined = combineRisk({
    transcriptScore: transcriptResult.transcriptScore,
    transactionScore: transactionResult.transactionScore,
    aiScore: ai.score
  });

  const signals = [...new Set([
    ...transcriptResult.signals,
    ...transactionResult.signals,
    ...ai.signals
  ])];

  const result = {
    ...combined,
    signals,
    source: ai.source
  };

  broadcast({ type: "risk", result });
  res.json(result);
});

app.post("/api/simulate-transcript", async (req, res) => {
  const customer = await prisma.customer.findFirst();

  const lines = [
    "Hello Arthur, this is your bank fraud prevention team.",
    "We detected suspicious activity on your account.",
    "Stay on the line while we secure your money.",
    "Do not call your daughter or tell anyone about this.",
    "You need to move your money to a safe clearinghouse account.",
    "Open online banking right now and start a wire transfer.",
    "Transfer $9,500 immediately.",
    "Do not hang up until the transfer is complete."
  ];

  let transcript = "";

  for (let i = 0; i < lines.length; i++) {
    transcript += (i ? " " : "") + lines[i];

    const tx = {
      amount: 9500,
      recipient: "Safe Clearinghouse",
      recipientRef: "88392",
      isNewRecipient: true
    };

    const transcriptResult = analyzeTranscript(transcript);
    const transactionResult = analyzeTransaction(tx, customer);
    const combined = combineRisk({
      transcriptScore: transcriptResult.transcriptScore,
      transactionScore: transactionResult.transactionScore
    });

    broadcast({
      type: "transcript",
      line: lines[i],
      transcript,
      result: {
        ...combined,
        signals: [...new Set([
          ...transcriptResult.signals,
          ...transactionResult.signals
        ])]
      }
    });

    await new Promise(resolve => setTimeout(resolve, 900));
  }

  await audit("SIMULATION", "Scam-call simulation completed", {
    customer: customer?.name
  });

  res.json({ ok: true });
});

app.post("/api/transactions", async (req, res) => {
  const { amount, recipient, recipientRef, transcript = "" } = req.body;
  const customer = await prisma.customer.findFirst();

  if (!customer) return res.status(500).json({ error: "Customer profile not found" });

  const transaction = {
    amount: Number(amount),
    recipient,
    recipientRef,
    isNewRecipient: true
  };

  const transcriptResult = analyzeTranscript(transcript);
  const transactionResult = analyzeTransaction(transaction, customer);
  const combined = combineRisk({
    transcriptScore: transcriptResult.transcriptScore,
    transactionScore: transactionResult.transactionScore
  });

  const signals = [...new Set([
    ...transcriptResult.signals,
    ...transactionResult.signals
  ])];

  const created = await prisma.transaction.create({
    data: {
      customerId: customer.id,
      amount: transaction.amount,
      recipient,
      recipientRef,
      isNewRecipient: true,
      riskScore: combined.riskScore,
      riskLevel: combined.riskLevel,
      status: combined.riskScore >= 50 ? "INTERCEPTED" : "PENDING"
    }
  });

  await audit(
    combined.riskScore >= 50 ? "INTERCEPT" : "TRANSFER_CREATED",
    combined.riskScore >= 50
      ? "Suspicious transfer intercepted before confirmation"
      : "Transfer created",
    { transactionId: created.id, riskScore: combined.riskScore, signals }
  );

  res.json({
    transaction: created,
    risk: { ...combined, signals }
  });
});

app.post("/api/transactions/:id/hold", async (req, res) => {
  const changed = await prisma.transaction.updateMany({
    where: { id: req.params.id, status: "INTERCEPTED" },
    data: { status: "PAUSED_24H" },
  });
  if (changed.count === 0) {
    const exists = await prisma.transaction.findUnique({ where: { id: req.params.id }, select: { id: true } });
    return res.status(exists ? 409 : 404).json({
      error: exists ? "Only intercepted transactions can be placed on hold" : "Transaction not found"
    });
  }
  const transaction = await prisma.transaction.findUnique({
    where: { id: req.params.id },
    include: { customer: true }
  });

  const alert = await prisma.alert.create({
    data: {
      customerId: transaction.customerId,
      channel: "TRUSTED_CONTACT",
      message: `${transaction.customer.name}'s $${transaction.amount.toLocaleString()} transfer was paused by ClarityPay. Please verify with them directly.`,
      status: "SIMULATED"
    }
  });

  await audit("SAFE_HOLD", "24-hour safety hold activated", {
    transactionId: transaction.id,
    alertId: alert.id
  });

  broadcast({
    type: "hold",
    transaction,
    alert
  });

  res.json({ transaction, alert });
});

app.post("/api/transactions/:id/release", async (req, res) => {
  const changed = await prisma.transaction.updateMany({
    where: { id: req.params.id, status: "PAUSED_24H" },
    data: { status: "RELEASED" }
  });
  if (changed.count === 0) {
    const exists = await prisma.transaction.findUnique({ where: { id: req.params.id }, select: { id: true } });
    return res.status(exists ? 409 : 404).json({
      error: exists ? "Only transactions on hold can be released" : "Transaction not found"
    });
  }
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });

  await audit("RELEASE", "Transaction released from hold", {
    transactionId: transaction.id
  });

  res.json(transaction);
});

seed()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ClarityPay API running on http://localhost:${PORT}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
