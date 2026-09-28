const crypto = require("node:crypto");

const SESSION_COOKIE = "claritypay_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function getAuthConfig() {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || "Strict";
  const secure = process.env.AUTH_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

  if (!username || !password || Buffer.byteLength(password) < 16) {
    throw new Error("Set AUTH_USERNAME and an AUTH_PASSWORD of at least 16 characters");
  }
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 bytes");
  }
  if (!["Strict", "Lax", "None"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be Strict, Lax, or None");
  }
  if (sameSite === "None" && !secure) {
    throw new Error("AUTH_COOKIE_SECURE=true is required with SameSite=None");
  }

  return { username, password, secret, sameSite, secure };
}

function createSessionToken(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, suppliedSignature] = parts;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.sub !== "string" || typeof session.exp !== "number" || session.exp <= Math.floor(now / 1000)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function serializeSessionCookie(token, config, maxAge = SESSION_TTL_SECONDS) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sameSite}`,
    `Max-Age=${maxAge}`
  ];
  if (config.secure) attributes.push("Secure");
  return attributes.join("; ");
}

function safeEqualStrings(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function createAuthMiddleware(config) {
  return (req, res, next) => {
    const session = verifySessionToken(readSessionCookie(req.headers.cookie), config.secret);
    if (!session || session.sub !== config.username) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.auth = { username: session.sub };
    next();
  };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createAuthMiddleware,
  createSessionToken,
  getAuthConfig,
  readSessionCookie,
  safeEqualStrings,
  serializeSessionCookie,
  verifySessionToken
};