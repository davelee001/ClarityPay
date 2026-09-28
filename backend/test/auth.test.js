const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SESSION_TTL_SECONDS,
  createAuthMiddleware,
  createSessionToken,
  readSessionCookie,
  serializeSessionCookie,
  verifySessionToken
} = require("../src/auth");

const secret = "test-session-secret-that-is-long-enough";

test("valid session tokens verify and expire", () => {
  const now = 1_800_000_000_000;
  const token = createSessionToken("operator", secret, now);

  assert.equal(verifySessionToken(token, secret, now)?.sub, "operator");
  assert.equal(verifySessionToken(token, secret, now + SESSION_TTL_SECONDS * 1000), null);
});

test("tampered tokens and tokens signed with another key are rejected", () => {
  const token = createSessionToken("operator", secret);

  assert.equal(verifySessionToken(`${token}x`, secret), null);
  assert.equal(verifySessionToken(token, `${secret}-different`), null);
});

test("session cookies are HttpOnly and can be read from request headers", () => {
  const cookie = serializeSessionCookie("signed.token", { sameSite: "Strict", secure: true });

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(readSessionCookie(`other=value; ${cookie.split(";")[0]}`), "signed.token");
});

test("API authentication middleware rejects missing sessions and accepts valid ones", () => {
  const config = { username: "operator", secret };
  const middleware = createAuthMiddleware(config);
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  middleware({ headers: {} }, response, () => assert.fail("Unauthenticated request passed"));
  assert.equal(response.statusCode, 401);

  const request = {
    headers: { cookie: `claritypay_session=${createSessionToken("operator", secret)}` }
  };
  let continued = false;
  middleware(request, response, () => { continued = true; });

  assert.equal(continued, true);
  assert.deepEqual(request.auth, { username: "operator" });
});