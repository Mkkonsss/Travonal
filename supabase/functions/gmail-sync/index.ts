import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS (same pattern as ai-travonal) ──────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Environment ─────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

// Max emails to process per sync run
const MAX_EMAILS_PER_SYNC = 20;

// ── Auth helper (same JWT decode as ai-travonal) ────────────────────────────

function getUserIdFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ── Supabase admin client ───────────────────────────────────────────────────

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ── Response helpers ────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

// ── JSON extraction (same as ai-travonal) ───────────────────────────────────

function extractJSON(text: string) {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = block ? block[1].trim() : text.trim();
  const start = raw.search(/[{[]/);
  if (start === -1) {
    throw new Error("No JSON found in response");
  }
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    // Aggressive: find outermost { } or [ ]
    const opener = raw[start];
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let end = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === opener) depth++;
      if (raw[i] === closer) depth--;
      if (depth === 0) { end = i; break; }
    }
    if (end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // fall through to truncation repair
      }
    }
    // Truncation repair
    let truncated = raw.slice(start);
    truncated = truncated.replace(/,\s*"[^"]*":\s*"[^"]*$/, "");
    truncated = truncated.replace(/,\s*"[^"]*$/, "");
    truncated = truncated.replace(/,\s*$/, "");
    let openBraces = 0, openBrackets = 0;
    let inStr = false;
    for (let j = 0; j < truncated.length; j++) {
      const ch = truncated[j];
      if (ch === '"' && (j === 0 || truncated[j - 1] !== '\\')) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }
    for (let bk = 0; bk < openBrackets; bk++) truncated += "]";
    for (let br = 0; br < openBraces; br++) truncated += "}";
    try {
      return JSON.parse(truncated);
    } catch {
      // ignore
    }
    throw new Error("Could not parse JSON from response");
  }
}

// ── Token refresh ───────────────────────────────────────────────────────────
// Refresh tokens are long-lived; access tokens expire after ~1 hour.
// We cache the access token in the DB to avoid unnecessary refreshes.

interface TokenResult {
  accessToken: string;
  expiresAt: string;
}

async function getValidAccessToken(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<TokenResult> {
  const { data: conn, error } = await supabase
    .from("gmail_connections")
    .select("refresh_token, access_token, token_expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    throw new Error("Gmail not connected");
  }

  // If the cached access token is still valid (with a 2-minute buffer), use it
  if (conn.access_token && conn.token_expires_at) {
    const expiresAt = new Date(conn.token_expires_at).getTime();
    if (Date.now() < expiresAt - 120_000) {
      return { accessToken: conn.access_token, expiresAt: conn.token_expires_at };
    }
  }

  // Refresh the access token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("[gmail-sync] token refresh failed:", errBody);
    throw new Error("Failed to refresh Gmail access token. User may need to reconnect.");
  }

  const tokens = await resp.json();
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  // Cache the new access token
  await supabase
    .from("gmail_connections")
    .update({
      access_token: tokens.access_token,
      token_expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return { accessToken: tokens.access_token, expiresAt: newExpiresAt };
}

// ── Gmail API helpers ───────────────────────────────────────────────────────

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const GMAIL_SEARCH_QUERY =
  "subject:(confirmation OR booking OR reservation OR itinerary OR e-ticket) newer_than:30d";

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailMessageList {
  messages?: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** List message IDs matching our booking-related search query. */
async function listBookingEmails(accessToken: string): Promise<GmailMessage[]> {
  const url =
    GMAIL_API +
    "/messages?q=" +
    encodeURIComponent(GMAIL_SEARCH_QUERY) +
    "&maxResults=" +
    MAX_EMAILS_PER_SYNC;

  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[gmail-sync] list messages failed:", resp.status, errText);
    throw new Error("Gmail API error: " + resp.status);
  }

  const data: GmailMessageList = await resp.json();
  return data.messages || [];
}

/** Strip HTML tags and decode common entities to get plain text. */
function stripHtml(html: string): string {
  // Remove style and script blocks entirely
  let text = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Replace <br>, <p>, <div>, <tr>, <li> with newlines for readability
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Collapse excessive whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Decode a base64url-encoded string. */
function decodeBase64Url(data: string): string {
  // base64url -> base64
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

interface EmailContent {
  subject: string;
  from: string;
  body: string;
}

/**
 * Recursively search MIME parts for a text body.
 * Prefers text/plain; falls back to text/html (stripped).
 */
function extractBodyFromParts(parts: any[]): { plain: string; html: string } {
  let plain = "";
  let html = "";

  for (const part of parts) {
    const mime = (part.mimeType || "").toLowerCase();

    if (mime === "text/plain" && part.body?.data && !plain) {
      plain = decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }

    // Recurse into nested multipart
    if (part.parts && Array.isArray(part.parts)) {
      const nested = extractBodyFromParts(part.parts);
      if (!plain && nested.plain) plain = nested.plain;
      if (!html && nested.html) html = nested.html;
    }
  }

  return { plain, html };
}

/** Fetch the full message and extract subject, from, and body text. */
async function fetchEmailContent(
  accessToken: string,
  messageId: string,
): Promise<EmailContent> {
  const url = GMAIL_API + "/messages/" + messageId + "?format=full";

  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });

  if (!resp.ok) {
    throw new Error("Failed to fetch message " + messageId + ": " + resp.status);
  }

  const msg = await resp.json();

  // Extract headers
  const headers: { name: string; value: string }[] = msg.payload?.headers || [];
  const subject = headers.find(
    (h: { name: string }) => h.name.toLowerCase() === "subject",
  )?.value || "";
  const from = headers.find(
    (h: { name: string }) => h.name.toLowerCase() === "from",
  )?.value || "";

  // Extract body — handle both single-part and multipart messages
  let body = "";
  const payload = msg.payload;

  if (payload?.parts && Array.isArray(payload.parts)) {
    const { plain, html } = extractBodyFromParts(payload.parts);
    body = plain || (html ? stripHtml(html) : "");
  } else if (payload?.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    const mime = (payload.mimeType || "").toLowerCase();
    body = mime === "text/html" ? stripHtml(decoded) : decoded;
  }

  // Truncate extremely long emails to avoid blowing up Claude's context
  const MAX_BODY_LENGTH = 12_000;
  if (body.length > MAX_BODY_LENGTH) {
    body = body.slice(0, MAX_BODY_LENGTH) + "\n\n[...truncated]";
  }

  return { subject, from, body };
}

// ── Claude booking extraction (same prompt/schema as ai-travonal) ───────────

const BOOKING_SCHEMA = [
  "{",
  '  "found": true,',
  '  "confidence": 90,',
  '  "name": "Exact place/business name",',
  '  "location": "City, Country",',
  '  "country": "Country name",',
  '  "category": "restaurant|attraction|hotel|cafe|museum|park|other",',
  '  "description": "1-2 specific factual sentences.",',
  '  "notes": "Practical tip if available.",',
  '  "emoji": "single emoji",',
  '  "confirmationNumber": "booking confirmation code or null",',
  '  "bookingDate": "YYYY-MM-DD check-in/arrival date or null",',
  '  "checkoutDate": "YYYY-MM-DD check-out/departure date or null",',
  '  "bookingTime": "HH:MM reservation time or null",',
  '  "price": 0,',
  '  "currency": "USD or relevant currency code or null",',
  '  "reservationType": "hotel|flight|restaurant|train|activity|other"',
  "}",
].join("\n");

const BOOKING_SYSTEM_PROMPT = [
  "You extract booking confirmation details from " +
    "travel booking sites like Booking.com, Airbnb, " +
    "Hotels.com, Expedia, OpenTable, Resy, airline " +
    "sites, etc.",
  "",
  "IMPORTANT: You ONLY extract from actual booking " +
    "confirmations, reservation pages, or itinerary " +
    "pages — NOT from listing/search/browse pages. " +
    "A real booking confirmation has at least one of: " +
    "a confirmation/reference number, specific booked " +
    "dates, or a confirmed price. If the page is just " +
    "a property listing, search results, or a browse " +
    "page with no booking details, return found: false.",
  "",
  "You are analyzing the TEXT CONTENT OF AN EMAIL. " +
    "Many booking confirmation emails contain lots of " +
    "footer text, unsubscribe links, etc. Focus on the " +
    "core booking details only.",
  "",
  "RULES:",
  "- Return ONLY valid JSON",
  "- Be honest - never invent information",
  "- Extract the place/business name and location",
  "- Extract booking details when visible: " +
    "confirmation number, dates, times, price",
  "- Set null for any booking field you cannot find",
  "- Set price to 0 if not found",
  "- For hotels: bookingDate = check-in, " +
    "checkoutDate = check-out",
  "- For flights: bookingDate = departure date",
  "- For restaurants: bookingDate = reservation date, " +
    "bookingTime = reservation time",
  "- reservationType should match the type of booking",
  "- If this is NOT a booking confirmation (just a " +
    "newsletter, marketing email, or search results), return found: false",
  "- If confidence is below 60%, return found: false",
].join("\n");

async function extractBookingFromEmail(
  subject: string,
  from: string,
  body: string,
): Promise<any> {
  const userPrompt = [
    "Extract the travel place and booking details from this email:",
    "",
    "Subject: " + subject,
    "From: " + from,
    "",
    body,
    "",
    "Return:",
    BOOKING_SCHEMA,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 512,
        system: BOOKING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return extractJSON(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Main sync logic ─────────────────────────────────────────────────────────

async function syncGmail(userId: string): Promise<Response> {
  const supabase = getAdminClient();

  // 1. Get a valid access token (refreshes if needed)
  let tokenResult: TokenResult;
  try {
    tokenResult = await getValidAccessToken(supabase, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token error";
    return errorResponse(msg, 401);
  }

  const accessToken = tokenResult.accessToken;

  // 2. List booking-related emails
  let messages: GmailMessage[];
  try {
    messages = await listBookingEmails(accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gmail API error";
    return errorResponse(msg, 502);
  }

  if (messages.length === 0) {
    // Update last_sync_at even if nothing found
    await supabase
      .from("gmail_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("user_id", userId);

    return jsonResponse({ success: true, new_bookings: 0, processed: 0 });
  }

  // 3. Filter out already-processed messages
  const messageIds = messages.map((m) => m.id);
  const { data: existingRows } = await supabase
    .from("parsed_bookings")
    .select("gmail_message_id")
    .in("gmail_message_id", messageIds);

  const existingIds = new Set((existingRows || []).map((r: any) => r.gmail_message_id));
  const newMessages = messages.filter((m) => !existingIds.has(m.id));

  if (newMessages.length === 0) {
    await supabase
      .from("gmail_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("user_id", userId);

    return jsonResponse({ success: true, new_bookings: 0, processed: 0 });
  }

  // 4. Process each new email
  let newBookings = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const msg of newMessages) {
    try {
      // Fetch the email content
      const email = await fetchEmailContent(accessToken, msg.id);
      processed++;

      // Skip emails with very short bodies (likely not booking confirmations)
      if (email.body.length < 50) {
        continue;
      }

      // Extract booking details with Claude
      const booking = await extractBookingFromEmail(
        email.subject,
        email.from,
        email.body,
      );

      // Only store if a booking was actually found
      if (booking && booking.found === true && booking.confidence >= 60) {
        const { error: insertError } = await supabase
          .from("parsed_bookings")
          .insert({
            user_id: userId,
            status: "pending",
            booking_data: booking,
            source_email_subject: email.subject.slice(0, 500),
            source_email_from: email.from.slice(0, 300),
            gmail_message_id: msg.id,
          });

        if (insertError) {
          // Unique constraint on gmail_message_id — means it was already processed
          // (race condition with concurrent syncs). Not a real error.
          if (insertError.code === "23505") {
            continue;
          }
          console.error("[gmail-sync] insert error:", insertError);
          errors.push("Insert failed for " + msg.id);
        } else {
          newBookings++;
        }
      }

      // Small delay between Claude calls to be respectful of rate limits
      if (newMessages.indexOf(msg) < newMessages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[gmail-sync] error processing message " + msg.id + ":", errMsg);
      errors.push(msg.id + ": " + errMsg);
      // Continue processing remaining emails
    }
  }

  // 5. Update last_sync_at
  await supabase
    .from("gmail_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("user_id", userId);

  return jsonResponse({
    success: true,
    new_bookings: newBookings,
    processed,
    total_found: messages.length,
    already_processed: messages.length - newMessages.length,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

// ── Router ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return errorResponse("Unauthorized", 401);
    }

    return await syncGmail(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[gmail-sync]", msg);
    return errorResponse(msg, 500);
  }
});
