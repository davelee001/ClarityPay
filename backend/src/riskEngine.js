const SIGNALS = [
  { pattern: /stay on the line|stay on the phone/i, label: "Caller insists you stay on the line", points: 12 },
  { pattern: /do not (call|tell|contact).*(daughter|son|family|anyone)/i, label: "Isolation from trusted contacts", points: 22 },
  { pattern: /compromised|hacked|fraud team|security team|bank/i, label: "Authority/fraud impersonation language", points: 12 },
  { pattern: /immediately|right now|within \d+ minutes?|urgent|urgently/i, label: "Urgency pressure", points: 18 },
  { pattern: /safe (account|clearinghouse)|secure account|move your money/i, label: "Safe-account narrative", points: 18 },
  { pattern: /do not tell|keep.*secret|secret/i, label: "Secrecy request", points: 20 },
  { pattern: /wire|transfer/i, label: "Payment instruction detected", points: 5 }
];

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function analyzeTranscript(transcript = "") {
  const signals = [];
  let score = 0;

  for (const item of SIGNALS) {
    if (item.pattern.test(transcript)) {
      score += item.points;
      signals.push(item.label);
    }
  }

  return {
    transcriptScore: clamp(score),
    signals
  };
}

function analyzeTransaction(transaction, customer) {
  const signals = [];
  let score = 0;

  if (!transaction || !customer) {
    return { transactionScore: 0, signals };
  }

  if (transaction.amount > customer.typicalTransfer * 5) {
    score += 25;
    signals.push("Transfer is far above the customer's typical amount");
  } else if (transaction.amount > customer.typicalTransfer * 2) {
    score += 15;
    signals.push("Transfer is above the customer's typical amount");
  }

  if (transaction.isNewRecipient) {
    score += 20;
    signals.push("Unfamiliar beneficiary");
  }

  if (transaction.amount >= 5000) {
    score += 10;
    signals.push("High-value transfer");
  }

  return {
    transactionScore: clamp(score),
    signals
  };
}

function level(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function combineRisk({ transcriptScore = 0, transactionScore = 0, aiScore = 0 }) {
  // Transcript/context is deliberately weighted heavily for the prototype.
  const score = clamp(transcriptScore * 0.55 + transactionScore * 0.35 + aiScore * 0.10);
  return { riskScore: score, riskLevel: level(score) };
}

async function optionalAIAnalysis(transcript, transaction, customer) {
  if (!process.env.OPENAI_API_KEY) return { score: 0, signals: [], source: "rules-only" };

  try {
    const OpenAI = require("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a financial safety classifier. Analyze possible social engineering around a transfer. " +
            "Return JSON only: {\"score\": number 0-100, \"signals\": string[]}. " +
            "Do not decide whether a person is truthful; identify observable coercion, urgency, secrecy, isolation, impersonation, or payment pressure."
        },
        {
          role: "user",
          content: JSON.stringify({ transcript, transaction, customer })
        }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return {
      score: clamp(Number(parsed.score) || 0),
      signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 8) : [],
      source: "openai"
    };
  } catch (error) {
    return { score: 0, signals: [], source: "rules-fallback", error: error.message };
  }
}

module.exports = {
  analyzeTranscript,
  analyzeTransaction,
  combineRisk,
  optionalAIAnalysis,
  level
};
