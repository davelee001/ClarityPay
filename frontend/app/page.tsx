'use client';

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type Customer = {
  id: string;
  name: string;
  age: number;
  balance: number;
  typicalTransfer: number;
  trustedContact: string;
  trustedPhone: string;
};

type Risk = {
  riskScore: number;
  riskLevel: string;
  signals: string[];
  source?: string;
};

type Transaction = {
  id: string;
  amount: number;
  recipient: string;
  recipientRef: string;
  riskScore: number;
  riskLevel: string;
  status: string;
};

type Audit = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState("9500");
  const [recipient, setRecipient] = useState("Safe Clearinghouse");
  const [recipientRef, setRecipientRef] = useState("88392");
  const [transcript, setTranscript] = useState("");
  const [risk, setRisk] = useState<Risk>({
    riskScore: 0,
    riskLevel: "LOW",
    signals: []
  });
  const [audits, setAudits] = useState<Audit[]>([]);
  const [modal, setModal] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [hold, setHold] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const currency = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    []
  );

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/auth/session`, { credentials: "include" })
      .then(response => response.json())
      .then(data => {
        if (active) setAuthenticated(data.authenticated === true);
      })
      .catch(() => {
        if (active) setAuthError("Unable to connect to the ClarityPay API.");
      })
      .finally(() => {
        if (active) setAuthChecked(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    let active = true;
    Promise.all([
      fetch(`${API}/api/customer`, { credentials: "include" }),
      fetch(`${API}/api/audit`, { credentials: "include" })
    ]).then(async ([customerRes, auditRes]) => {
      if (!active) return;
      if (customerRes.ok) setCustomer(await customerRes.json());
      if (auditRes.ok) setAudits(await auditRes.json());
    }).catch(() => {
      if (active) setAuthError("Unable to load dashboard data.");
    });

    const source = new EventSource(`${API}/api/events`, { withCredentials: true });
    source.onmessage = event => {
      const data = JSON.parse(event.data);

      if (data.type === "risk") setRisk(data.result);

      if (data.type === "transcript") {
        setTranscript(data.transcript);
        setRisk(data.result);
      }

      if (data.type === "audit") {
        setAudits(prev => [data.event, ...prev].slice(0, 30));
      }

      if (data.type === "hold") {
        setHold(true);
        setLastTransaction(data.transaction);
      }
    };

    return () => {
      active = false;
      source.close();
    };
  }, [authenticated]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [transcript]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.error || "Sign-in failed.");
        return;
      }
      setPassword("");
      setAuthenticated(true);
    } catch {
      setAuthError("Unable to connect to the ClarityPay API.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    await fetch(`${API}/api/auth/logout`, {
      method: "POST",
      credentials: "include"
    }).catch(() => undefined);
    setAuthenticated(false);
    setHold(false);
    setModal(false);
  }

  async function startSimulation() {
    setTranscript("");
    setRisk({ riskScore: 0, riskLevel: "LOW", signals: [] });
    setModal(false);
    setHold(false);
    await fetch(`${API}/api/simulate-transcript`, { method: "POST" });
  }

  async function confirmTransfer() {
    setLoading(true);
    const res = await fetch(`${API}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        recipient,
        recipientRef,
        transcript
      })
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      alert(data.error || "Unable to create transaction");
      return;
    }

    setRisk(data.risk);
    setLastTransaction(data.transaction);

    if (data.risk.riskScore >= 50) {
      setModal(true);
    } else {
      alert("Transaction created in demo mode.");
    }
  }

  async function activateHold() {
    if (!lastTransaction) return;

    const res = await fetch(`${API}/api/transactions/${lastTransaction.id}/hold`, {
      method: "POST"
    });
    const data = await res.json();

    if (res.ok) {
      setHold(true);
      setModal(false);
      setLastTransaction(data.transaction);
    }
  }

  const riskClass = risk.riskLevel.toLowerCase();

  return (
    <main className="cp-shell">
      <header className="cp-topbar">
        <div className="brand">
          <div className="brand-mark">CP</div>
          <div>
            <div className="brand-title">ClarityPay</div>
            <div className="brand-sub">Human-context financial safety layer</div>
          </div>
        </div>
        <button className="demo-btn" onClick={startSimulation}>
          ▶ Start Scam Simulation
        </button>
      </header>

      <div className="grid">
        <section className="left">
          <div className="card card-pad">
            <div className="bank-header">
              <div>
                <div className="bank-name">APEX BANK</div>
                <div className="bank-tag">ClarityPay Protected</div>
              </div>
              <div>
                <div className="balance-label">Available balance</div>
                <div className="balance">
                  {currency.format(customer?.balance || 24800)}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22 }}>
              <div className="section-title">Customer profile</div>
              <div className="profile-row">
                <div className="metric">
                  <div className="metric-label">Customer</div>
                  <div className="metric-value">{customer?.name || "Arthur"}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Typical transfer</div>
                  <div className="metric-value">
                    {currency.format(customer?.typicalTransfer || 150)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Trusted contact</div>
                  <div className="metric-value">
                    {customer?.trustedContact || "Daughter"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">New wire transfer</div>

            <div className="transfer-grid">
              <div className="field">
                <label>Amount</label>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  type="number"
                  min="1"
                />
              </div>

              <div className="field">
                <label>Recipient</label>
                <input
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                />
              </div>

              <div className="field full">
                <label>Account / reference</label>
                <input
                  value={recipientRef}
                  onChange={e => setRecipientRef(e.target.value)}
                />
              </div>
            </div>

            <button
              className="confirm"
              disabled={loading || hold}
              onClick={confirmTransfer}
            >
              {loading ? "Analyzing…" : "Confirm Wire Transfer"}
            </button>

            <div className="status-box">
              <strong>Transaction protection status</strong>
              <div className="status-value">
                {hold
                  ? "PAUSED — 24H SAFETY HOLD"
                  : risk.riskScore >= 50
                    ? "INTERCEPT READY"
                    : "MONITORING"}
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">ClarityPay audit trail</div>
            <div className="audit-list">
              {audits.length === 0 && (
                <div style={{ color: "#8ea2bd", fontSize: 12 }}>
                  Waiting for events…
                </div>
              )}
              {audits.map(item => (
                <div className="audit" key={item.id}>
                  <div className="audit-type">{item.type}</div>
                  <div className="audit-msg">{item.message}</div>
                  <div className="audit-time">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="right">
          <div className="card card-pad">
            <div className="monitor-head">
              <div>
                <div className="section-title" style={{ marginBottom: 4 }}>
                  Live call monitor
                </div>
                <div className="live-dot"><i /> Monitoring context</div>
              </div>
              <span className={`level ${riskClass}`}>{risk.riskLevel}</span>
            </div>

            <div className="risk-number">{risk.riskScore}</div>
            <div className="risk-meta">
              <span>Coercion / transaction risk</span>
              <span>100</span>
            </div>
            <div className="risk-track">
              <div
                className="risk-fill"
                style={{ width: `${risk.riskScore}%` }}
              />
            </div>

            <div className="transcript" ref={transcriptRef}>
              {transcript || "Start the scam simulation to stream the call transcript here."}
            </div>

            <div className="signals">
              {risk.signals.length === 0 ? (
                <div style={{ color: "#8ea2bd", fontSize: 12 }}>
                  No high-risk signals detected yet.
                </div>
              ) : (
                risk.signals.map(signal => (
                  <div className="signal" key={signal}>
                    <span>⚠</span>
                    <span>{signal}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">Protection decision</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "#c5d4e7" }}>
              ClarityPay combines the transfer context with observable
              social-engineering signals before the customer confirms the payment.
            </div>

            <div className="profile-row" style={{ marginTop: 15 }}>
              <div className="metric">
                <div className="metric-label">Transcript</div>
                <div className="metric-value">
                  {transcript ? "ACTIVE" : "IDLE"}
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Beneficiary</div>
                <div className="metric-value">NEW</div>
              </div>
              <div className="metric">
                <div className="metric-label">AI</div>
                <div className="metric-value">
                  {risk.source === "openai" ? "ACTIVE" : "RULES"}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {modal && (
        <div className="overlay">
          <div className="intercept">
            <div className="intercept-banner">
              🚨 FINANCIAL INTERCEPT ACTIVE
            </div>
            <div className="intercept-body">
              <div style={{ color: "#ff9aae", fontWeight: 800 }}>
                Unusual transaction + coercion pattern detected
              </div>
              <div className="intercept-score">{risk.riskScore}/100</div>

              <p style={{ color: "#aebed2", lineHeight: 1.6 }}>
                ClarityPay has temporarily blocked this transfer from being
                confirmed while you verify what is happening.
              </p>

              <div className="question">
                Did someone on the phone tell you to transfer this money?
              </div>

              <div className="modal-actions">
                <button className="danger" onClick={activateHold}>
                  YES — I&apos;M ON A CALL
                </button>
                <button onClick={() => setModal(false)}>
                  NO — REVIEW TRANSFER
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {hold && (
        <div className="overlay">
          <div className="intercept">
            <div className="intercept-banner" style={{
              background: "rgba(72,224,155,.10)",
              color: "#72e9b1",
              borderBottomColor: "rgba(72,224,155,.25)"
            }}>
              ✓ FUNDS TEMPORARILY SECURED
            </div>
            <div className="hold">
              <div className="hold-icon">✓</div>
              <h2>24-HOUR SAFETY HOLD</h2>
              <p>
                The transfer has been paused. A trusted-contact notification
                has been created for {customer?.trustedContact || "your trusted contact"}.
              </p>

              <div className="status-box" style={{ textAlign: "left" }}>
                <strong>SIMULATED NOTIFICATION</strong>
                <div className="status-value">
                  Trusted contact notified
                </div>
              </div>

              <button className="hold-btn" onClick={() => setHold(false)}>
                Return to Banking Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
