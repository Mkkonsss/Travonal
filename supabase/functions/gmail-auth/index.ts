import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://tripseekapp.com",
  "https://www.tripseekapp.com",
  "http://localhost:8081",
  "http://localhost:19006",
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return origin || ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS[0];
}

function makeCorsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const DEFAULT_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Environment ─────────────────────────────────────────────────────────────

// Validate required env vars at startup — fail fast
const _REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const _MISSING_ENV = _REQUIRED_ENV.filter((k) => !Deno.env.get(k));
if (_MISSING_ENV.length > 0) {
  throw new Error("[gmail-auth] Missing required env vars: " + _MISSING_ENV.join(", "));
}
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REDIRECT_URI = "tripseek://gmail-callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

// ── OAuth state CSRF protection ──────────────────────────────────────────
// State is an HMAC-signed token: base64(timestamp:userId):signature
// This prevents CSRF without server-side session storage.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getHmacKey(): Promise<CryptoKey> {
  // Use the service role key as HMAC secret (already a secret, always available)
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw", enc.encode(SUPABASE_SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function createOAuthState(userId: string): Promise<string> {
  const payload = `${Date.now()}:${userId}`;
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(payload)}.${sigB64}`;
}

async function verifyOAuthState(state: string, userId: string): Promise<boolean> {
  try {
    const [payloadB64, sigB64] = state.split(".");
    if (!payloadB64 || !sigB64) return false;
    const payload = atob(payloadB64);
    const [tsStr, uid] = payload.split(":");
    // Verify user matches
    if (uid !== userId) return false;
    // Verify not expired
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts) || Date.now() - ts > STATE_TTL_MS) return false;
    // Verify signature
    const key = await getHmacKey();
    const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

// ── Auth helper — verifies JWT via Supabase auth server ───────────────────

async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// ── Supabase admin client (service role — bypasses RLS) ─────────────────────

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Dynamic CORS response helpers — set per-request in the router
let _currentCors: Record<string, string> = DEFAULT_CORS_HEADERS;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ..._currentCors, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

// ── Action: get_auth_url ────────────────────────────────────────────────────
// Returns a Google OAuth consent URL the client opens in the system browser.

async function handleGetAuthUrl(userId: string): Promise<Response> {
  const state = await createOAuthState(userId);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // always ask so we get a refresh_token
    state,
  });

  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
  return jsonResponse({ success: true, url });
}

// ── Action: exchange_code ───────────────────────────────────────────────────
// Exchanges the authorization code for tokens and persists the refresh_token.

async function handleExchangeCode(userId: string, code: string): Promise<Response> {
  // Exchange code for tokens with Google
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    console.error("[gmail-auth] token exchange failed — status:", tokenResp.status);
    return errorResponse("Failed to exchange authorization code", 502);
  }

  const tokens = await tokenResp.json();

  if (!tokens.refresh_token) {
    // This happens if the user already authorized but Google didn't return a
    // new refresh_token (usually if prompt=consent wasn't used). Since we
    // always set prompt=consent this shouldn't normally occur.
    return errorResponse(
      "No refresh token received. Please revoke app access in your Google account and try again.",
      400,
    );
  }

  // Compute access token expiry
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Upsert into gmail_connections
  const supabase = getAdminClient();
  const { error } = await supabase.from("gmail_connections").upsert(
    {
      user_id: userId,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token || null,
      token_expires_at: expiresAt,
      connected_at: new Date().toISOString(),
      last_sync_at: null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[gmail-auth] upsert error:", error);
    return errorResponse("Failed to store connection", 500);
  }

  return jsonResponse({ success: true, connected: true });
}

// ── Action: disconnect ──────────────────────────────────────────────────────
// Removes stored tokens so Gmail is no longer connected.

async function handleDisconnect(userId: string): Promise<Response> {
  const supabase = getAdminClient();

  // Optionally revoke the token at Google so the app disappears from the
  // user's "Third-party apps with account access" list.
  const { data: row } = await supabase
    .from("gmail_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .single();

  if (row?.refresh_token) {
    try {
      await fetch(
        "https://oauth2.googleapis.com/revoke?token=" +
          encodeURIComponent(row.refresh_token),
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
    } catch {
      // Non-critical — even if revocation fails we still delete locally
    }
  }

  const { error } = await supabase
    .from("gmail_connections")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("[gmail-auth] delete error:", error);
    return errorResponse("Failed to disconnect", 500);
  }

  return jsonResponse({ success: true, connected: false });
}

// ── Action: status ──────────────────────────────────────────────────────────
// Returns whether the user has a connected Gmail account.

async function handleStatus(userId: string): Promise<Response> {
  const supabase = getAdminClient();

  const { data: row, error } = await supabase
    .from("gmail_connections")
    .select("connected_at, last_sync_at")
    .eq("user_id", userId)
    .single();

  if (error || !row) {
    return jsonResponse({ success: true, connected: false });
  }

  return jsonResponse({
    success: true,
    connected: true,
    connected_at: row.connected_at,
    last_sync_at: row.last_sync_at,
  });
}

// ── Router ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  _currentCors = makeCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: _currentCors });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Reject oversized payloads (64 KB — this endpoint only receives small action commands)
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > 64 * 1024) {
    return errorResponse("Request body too large", 413);
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return errorResponse("Unauthorized", 401);
    }

    const body = await req.json();
    const action = body.action as string;

    if (action === "get_auth_url") {
      return await handleGetAuthUrl(userId);
    }

    if (action === "exchange_code") {
      const code = body.code as string;
      const state = body.state as string;
      if (!code) {
        return errorResponse("Missing authorization code");
      }
      if (!state || !(await verifyOAuthState(state, userId))) {
        return errorResponse("Invalid or expired OAuth state", 403);
      }
      return await handleExchangeCode(userId, code);
    }

    if (action === "disconnect") {
      return await handleDisconnect(userId);
    }

    if (action === "status") {
      return await handleStatus(userId);
    }

    return errorResponse("Unknown action: " + action);
  } catch (err) {
    console.error("[gmail-auth]", err instanceof Error ? err.message : "Internal error");
    return errorResponse("An internal error occurred", 500);
  }
});
