import crypto from "node:crypto";

const SESSION_COOKIE = "inkling_session";
const STATE_COOKIE = "inkling_oauth_state";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secret() {
  return Netlify.env.get("SESSION_SECRET") || "dev-secret-change-me";
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!sig || !timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || "").split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function getUserIdFromRequest(req) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const data = verify(cookies[SESSION_COOKIE]);
  return data?.uid || null;
}

export function makeSessionCookie(uid) {
  const token = sign({ uid, iat: Date.now() });
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${THIRTY_DAYS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function makeStateCookie(state) {
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readStateCookie(req) {
  return parseCookies(req.headers.get("cookie"))[STATE_COOKIE] || null;
}

export function randomState() {
  return crypto.randomBytes(16).toString("hex");
}
