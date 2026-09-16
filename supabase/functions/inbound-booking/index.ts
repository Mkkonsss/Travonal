/**
 * Supabase Edge Function: inbound-booking
 *
 * Receives forwarded booking confirmation emails via SendGrid Inbound Parse,
 * extracts booking details using Claude AI, verifies with Google Places,
 * and stores parsed results in the `parsed_bookings` table.
 *
 * SendGrid sends a multipart/form-data POST with fields:
 *   from, to, subject, text, html, envelope, ...
 *
 * Recipient format: bookings+{user_id}@travonal.com
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract user_id from the recipient email address.
 * Expected format: bookings+{user_id}@travonal.com
 * Also handles "Name <bookings+uuid@travonal.com>" format.
 * Returns null if the format doesn't match.
 */
function extractUserId(toField: string): string | null {
  if (!toField) return null;

  // SendGrid may include multiple recipients separated by commas.
  // Also may wrap in angle brackets: "Name <email>"
  const addresses = toField.split(",");
  for (const addr of addresses) {
    const trimmed = addr.trim();
    // Extract the bare email from "Name <email>" or just "email"
    const angleMatch = trimmed.match(/<([^>]+)>/);
    const email = angleMatch ? angleMatch[1] : trimmed;

    const match = email.match(/^bookings\+([a-f0-9-]{36})@travonal\.com$/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Strip HTML tags to extract plain text. Basic implementation for email bodies.
 */
function stripHtml(html: string): string {
  return html
    // Remove style and script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Replace <br>, <p>, <div>, <tr>, <li> with newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract JSON from AI response text. Same logic as ai-travonal.
 */
function extractJSON(text: string) {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = block ? block[1].trim() : text.trim();
  const start = raw.search(/[{[]/);
  if (start === -1) {
    throw new Error("No JSON found in response");
  }
  try {
    return JSON.parse(raw.slice(start));
  } catch (_e) {
    // Find outermost { } or [ ]
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
      } catch (_e2) {
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
    } catch (_e3) {
      // ignore
    }
    throw new Error("Could not parse JSON from response");
  }
}

/**
 * Call Claude with system/user prompt and return parsed JSON.
 * Same pattern as ai-travonal.
 */
async function callClaude(
  client: Anthropic,
  system: string,
  user: string,
  maxTokens: number,
  timeoutMs = 50000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: "user", content: user }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    const text = response.content[0].type === "text"
      ? response.content[0].text
      : "";
    return extractJSON(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Google Places verification (same as ai-travonal) ───────────────────────

async function fetchGooglePlaces(query: string, apiKey: string) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.types",
    "places.location",
    "places.photos",
  ].join(",");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify({ textQuery: query, pageSize: 10 }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.places || [];
  } catch (_e) {
    return [];
  }
}

async function verifyWithGooglePlaces(result: Record<string, unknown>, gpKey: string | undefined) {
  if (!gpKey || !result.found || (result.confidence != null && (result.confidence as number) < 50)) {
    return result;
  }
  const query = String(result.name || "") + " " + String(result.location || "");
  const places = await fetchGooglePlaces(query, gpKey);
  if (places.length === 0) return result;

  const vp = places[0];
  const vpName = vp.displayName ? vp.displayName.text : "";
  const aiLow = (String(result.name || "")).toLowerCase();
  const gpLow = (vpName || "").toLowerCase();
  let nameMatch = false;
  if (aiLow.length >= 5 && gpLow.length >= 5) {
    nameMatch =
      aiLow.indexOf(gpLow.slice(0, 5)) >= 0 ||
      gpLow.indexOf(aiLow.slice(0, 5)) >= 0;
  } else {
    nameMatch = aiLow === gpLow;
  }
  if (nameMatch) {
    if (vpName) result.name = vpName;
    if (vp.formattedAddress) result.address = vp.formattedAddress;
    if (vp.rating) result.rating = vp.rating;
    if (vp.location) {
      result.lat = vp.location.latitude;
      result.lng = vp.location.longitude;
    }
    if (vp.id) result.placeId = vp.id;
    result.verified = true;

    // Extract photo URL from Google Places
    if (vp.photos && vp.photos.length > 0) {
      const photoRef = vp.photos[0].name;
      if (photoRef) {
        try {
          const photoResp = await fetch(
            "https://places.googleapis.com/v1/" +
            photoRef + "/media?maxWidthPx=800" +
            "&skipHttpRedirect=true" +
            "&key=" + gpKey
          );
          if (photoResp.ok) {
            const photoJson = await photoResp.json();
            if (photoJson.photoUri) {
              result.photoUrl = photoJson.photoUri;
            }
          }
        } catch (_e) {
          // Photo fetch failed — non-critical
        }
      }
    }
  } else {
    result.confidence = Math.min((result.confidence as number) || 100, 60);
    result.verified = false;
  }
  return result;
}

// ─── Booking extraction (same prompt/schema as ai-travonal handleImportBooking) ─

async function extractBookingFromEmail(
  anthropicClient: Anthropic,
  emailText: string,
  subject: string,
) {
  const bookingSchema = [
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

  const systemPrompt = [
    "You extract booking confirmation details from " +
      "travel booking confirmation emails from sites like " +
      "Booking.com, Airbnb, Hotels.com, Expedia, OpenTable, " +
      "Resy, airline sites, train operators, etc.",
    "",
    "IMPORTANT: You ONLY extract from actual booking " +
      "confirmations, reservation pages, or itinerary " +
      "pages — NOT from marketing emails, newsletters, " +
      "or promotional content. " +
      "A real booking confirmation has at least one of: " +
      "a confirmation/reference number, specific booked " +
      "dates, or a confirmed price. If the email is just " +
      "marketing, a newsletter, or has no booking details, " +
      "return found: false.",
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
    "- If this is NOT a booking confirmation (just marketing " +
      "or a non-booking email), return found: false",
    "- If confidence is below 60%, return found: false",
  ].join("\n");

  const userPrompt = [
    "Extract the travel place and booking details " +
      "from this email:",
    "",
    "Subject: " + subject,
    "",
    emailText,
    "",
    "Return:",
    bookingSchema,
  ].join("\n");

  return await callClaude(anthropicClient, systemPrompt, userPrompt, 512);
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Always return 200 to SendGrid to prevent retries
  try {
    await processInboundEmail(req);
  } catch (err) {
    console.error("[inbound-booking] Unhandled error:", err instanceof Error ? err.message : err);
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    },
  );
});

async function processInboundEmail(req: Request) {
  if (req.method !== "POST") {
    console.log("[inbound-booking] Ignoring non-POST request:", req.method);
    return;
  }

  // ── Parse multipart/form-data from SendGrid ──
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error("[inbound-booking] Failed to parse form data:", err instanceof Error ? err.message : err);
    return;
  }

  const to = String(formData.get("to") || "");
  const from = String(formData.get("from") || "");
  const subject = String(formData.get("subject") || "");
  const textBody = String(formData.get("text") || "");
  const htmlBody = String(formData.get("html") || "");

  // Also try the envelope field for more reliable recipient parsing
  let envelopeTo = "";
  const envelopeRaw = formData.get("envelope");
  if (envelopeRaw) {
    try {
      const envelope = JSON.parse(String(envelopeRaw));
      if (Array.isArray(envelope.to) && envelope.to.length > 0) {
        envelopeTo = envelope.to.join(",");
      }
    } catch (_e) {
      // envelope parse failed — use to field
    }
  }

  console.log("[inbound-booking] Received email from:", from, "subject:", subject);

  // ── Extract user_id from recipient ──
  // Try envelope first (more reliable), then fall back to the to header
  let userId = extractUserId(envelopeTo) || extractUserId(to);
  if (!userId) {
    console.error("[inbound-booking] Could not extract user_id from recipient:", to, "envelope:", envelopeTo);
    return;
  }

  // ── Get email body text ──
  let emailText = textBody;
  if (!emailText && htmlBody) {
    emailText = stripHtml(htmlBody);
  }
  if (!emailText) {
    console.error("[inbound-booking] No email body content found");
    return;
  }

  // Truncate extremely long emails to avoid token limits
  const MAX_EMAIL_LENGTH = 15000;
  if (emailText.length > MAX_EMAIL_LENGTH) {
    emailText = emailText.slice(0, MAX_EMAIL_LENGTH) + "\n\n[... email truncated ...]";
  }

  // ── Verify user exists in Supabase ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userExists, error: userError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    console.error("[inbound-booking] Error checking user:", userError.message);
    return;
  }
  if (!userExists) {
    console.error("[inbound-booking] User not found:", userId);
    return;
  }

  // ── Extract booking details with Claude ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("[inbound-booking] ANTHROPIC_API_KEY not configured");
    return;
  }
  const anthropicClient = new Anthropic({ apiKey: anthropicKey });

  let bookingData: Record<string, unknown>;
  try {
    bookingData = await extractBookingFromEmail(anthropicClient, emailText, subject);
  } catch (err) {
    console.error("[inbound-booking] AI extraction failed:", err instanceof Error ? err.message : err);
    return;
  }

  // Validate AI response
  if (typeof bookingData.found !== "boolean") {
    console.error("[inbound-booking] AI response missing 'found' boolean");
    return;
  }

  // Not a booking email — skip silently
  if (!bookingData.found) {
    console.log("[inbound-booking] Email not recognized as booking confirmation, skipping");
    return;
  }

  if (!bookingData.name || typeof bookingData.name !== "string") {
    console.error("[inbound-booking] AI response missing 'name'");
    return;
  }

  // ── Verify with Google Places ──
  const gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  try {
    bookingData = await verifyWithGooglePlaces(bookingData, gpKey);
  } catch (err) {
    console.error("[inbound-booking] Google Places verification failed (non-fatal):", err instanceof Error ? err.message : err);
    // Continue with unverified data — Google Places is best-effort
  }

  // ── Save to parsed_bookings table ──
  const { error: insertError } = await supabase
    .from("parsed_bookings")
    .insert({
      user_id: userId,
      status: "pending",
      booking_data: bookingData,
      source_email_subject: subject.slice(0, 500) || null,
      source_email_from: from.slice(0, 500) || null,
    });

  if (insertError) {
    console.error("[inbound-booking] Failed to save parsed booking:", insertError.message);
    return;
  }

  console.log(
    "[inbound-booking] Successfully parsed and saved booking:",
    bookingData.name,
    "for user:", userId,
  );
}
