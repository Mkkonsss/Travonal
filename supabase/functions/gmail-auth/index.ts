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
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return origin || "*";
  return ALLOWED_ORIGINS[0];
}

function makeCorsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Static fallback for contexts where req isn't available
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Environment ─────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REDIRECT_URI = "toveli://gmail-callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

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

// Dynamic CORS response helpers — these get overridden per-request in the router
let _currentCors = corsHeaders;

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

function handleGetAuthUrl(): Response {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // always ask so we get a refresh_token
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
    const errBody = await tokenResp.text();
    console.error("[gmail-auth] token exchange failed:", errBody);
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

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return errorResponse("Unauthorized", 401);
    }

    const body = await req.json();
    const action = body.action as string;

    if (action === "get_auth_url") {
      return handleGetAuthUrl();
    }

    if (action === "exchange_code") {
      const code = body.code as string;
      if (!code) {
        return errorResponse("Missing authorization code");
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
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[gmail-auth]", msg);
    return errorResponse(msg, 500);
  }
});
