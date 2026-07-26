import type { Context, Config } from "@netlify/functions";
import crypto from "node:crypto";
import {
  getUserIdFromRequest,
  makeSessionCookie,
  clearSessionCookie,
  makeStateCookie,
  clearStateCookie,
  readStateCookie,
  randomState,
} from "./lib/session.mts";
import { store } from "./lib/store.mts";

function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

function googleConfigured() {
  return Boolean(Netlify.env.get("GOOGLE_CLIENT_ID") && Netlify.env.get("GOOGLE_CLIENT_SECRET"));
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/auth/, "") || "/";

  // ---- GET /auth/status ----
  if (path === "/status" && req.method === "GET") {
    return json({ googleAuthEnabled: googleConfigured() });
  }

  // ---- GET /auth/google ----
  if (path === "/google" && req.method === "GET") {
    if (!googleConfigured()) {
      return Response.redirect(`${url.origin}/index.html?error=google_not_configured`, 302);
    }
    const state = randomState();
    const redirectUri = `${url.origin}/auth/google/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", Netlify.env.get("GOOGLE_CLIENT_ID")!);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "online");
    authUrl.searchParams.set("prompt", "select_account");

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString(), "Set-Cookie": makeStateCookie(state) },
    });
  }

  // ---- GET /auth/google/callback ----
  if (path === "/google/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = readStateCookie(req);

    if (!code || !state || !expectedState || state !== expectedState) {
      return Response.redirect(`${url.origin}/index.html?error=google`, 302);
    }

    try {
      const redirectUri = `${url.origin}/auth/google/callback`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: Netlify.env.get("GOOGLE_CLIENT_ID")!,
          client_secret: Netlify.env.get("GOOGLE_CLIENT_SECRET")!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${await tokenRes.text()}`);
      const tokens = await tokenRes.json();

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileRes.ok) throw new Error("failed to fetch google profile");
      const profile = await profileRes.json();

      const user = await store.upsertUser({
        id: `google:${profile.sub}`,
        name: profile.name,
        email: profile.email,
        avatar: profile.picture,
      });

      const headers = new Headers({ Location: `${url.origin}/app.html` });
      headers.append("Set-Cookie", makeSessionCookie(user.id));
      headers.append("Set-Cookie", clearStateCookie());
      return new Response(null, { status: 302, headers });
    } catch (err) {
      console.error(err);
      return Response.redirect(`${url.origin}/index.html?error=google`, 302);
    }
  }

  // ---- POST /auth/guest ----
  if (path === "/guest" && req.method === "POST") {
    const existingUid = getUserIdFromRequest(req);
    const guestId = existingUid && existingUid.startsWith("guest:") ? existingUid : `guest:${crypto.randomUUID()}`;

    const user = await store.upsertUser({
      id: guestId,
      name: "Guest Writer",
      email: null,
      avatar: null,
    });

    return json({ user }, { headers: { "Set-Cookie": makeSessionCookie(user.id) } });
  }

  // ---- GET /auth/me ----
  if (path === "/me" && req.method === "GET") {
    const uid = getUserIdFromRequest(req);
    if (!uid) return json({ user: null }, { status: 401 });
    const user = await store.getUser(uid);
    if (!user) return json({ user: null }, { status: 401 });
    return json({ user });
  }

  // ---- POST /auth/logout ----
  if (path === "/logout" && req.method === "POST") {
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  return json({ error: "Not found" }, { status: 404 });
};

export const config: Config = {
  path: "/auth/*",
};
