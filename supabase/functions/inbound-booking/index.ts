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
 * All users forward to: bookings@tripseekapp.com
 * The user is identified by matching the sender's email to auth.users.
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

const MODEL = "claude-haiku-4-5-20251001";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the sender's bare email address from the `from` field.
 * Handles both "Name <email@example.com>" and plain "email@example.com" formats.
 * Returns null if no valid email is found.
 */
function extractSenderEmail(fromField: string): string | null {
  if (!fromField) return null;
  const trimmed = fromField.trim();
  // "Name <email>" format
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].toLowerCase().trim();
  // Plain email
  const plain = trimmed.toLowerCase().trim();
  if (plain.includes("@")) return plain;
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
 * Convert an ArrayBuffer to a base64 string (chunked to avoid stack overflow).
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Parse an ICS (iCalendar) file and return a human-readable text summary
 * of all VEVENT blocks found. Handles folded lines per RFC 5545.
 */
function parseICS(icsText: string): string {
  // Unfold lines (lines that start with space/tab are continuations)
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events: string[] = [];
  let inEvent = false;
  let current: Record<string, string> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (line === 'END:VEVENT') {
      inEvent = false;
      const parts: string[] = [];
      if (current['SUMMARY'])     parts.push(`Event: ${current['SUMMARY']}`);
      if (current['DTSTART'])     parts.push(`Start: ${current['DTSTART']}`);
      if (current['DTEND'])       parts.push(`End: ${current['DTEND']}`);
      if (current['LOCATION'])    parts.push(`Location: ${current['LOCATION']}`);
      if (current['DESCRIPTION']) parts.push(`Description: ${current['DESCRIPTION'].replace(/\\n/g, '\n').replace(/\\,/g, ',')}`);
      if (parts.length > 0) events.push(parts.join('\n'));
      continue;
    }
    if (!inEvent) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    // Strip parameters (e.g. DTSTART;TZID=America/New_York)
    const key = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);
    current[key] = value;
  }

  if (events.length === 0) return '';
  return '\n\n[Calendar attachment]\n' + events.join('\n---\n');
}

/**
 * Extract JSON from AI response text. Same logic as ai-toveli.
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
 * Same pattern as ai-toveli.
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

// ─── Google Places verification (same as ai-toveli) ───────────────────────

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
  // Flights and trains are not searchable in Google Places — skip verification
  const resType = String(result.reservationType || '');
  if (resType === 'flight' || resType === 'train') {
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

/**
 * Call Claude with PDF documents + text prompt. Used when attachments include PDFs.
 */
async function callClaudeWithDocuments(
  client: Anthropic,
  system: string,
  userText: string,
  pdfs: string[], // base64-encoded PDF data
  maxTokens: number,
  timeoutMs = 60000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const content: Anthropic.MessageParam['content'] = [
      ...pdfs.map((data) => ({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
      })),
      { type: 'text' as const, text: userText },
    ];
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return extractJSON(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Booking extraction (same prompt/schema as ai-toveli handleImportBooking) ─

async function extractBookingFromEmail(
  anthropicClient: Anthropic,
  emailText: string,
  subject: string,
  pdfAttachments: string[] = [],
) {
  const bookingSchema = [
    "{",
    '  "found": true,',
    '  "confidence": 90,',
    '  "name": "Place/business/airline name e.g. Grand Hyatt or Delta Air Lines",',
    '  "location": "City, Country",',
    '  "country": "Country name",',
    '  "category": "restaurant|attraction|hotel|cafe|museum|park|transport|other",',
    '  "description": "1-2 specific factual sentences.",',
    '  "notes": "Practical tip if available.",',
    '  "emoji": "single emoji",',
    '  "confirmationNumber": "booking/reservation/reference code or null",',
    '  "bookingDate": "YYYY-MM-DD departure/check-in/reservation date or null",',
    '  "checkoutDate": "YYYY-MM-DD arrival/check-out date or null",',
    '  "bookingTime": "HH:MM departure/reservation time or null",',
    '  "arrivalTime": "HH:MM arrival time (flights/trains) or null",',
    '  "price": 0,',
    '  "currency": "USD or relevant currency code or null",',
    '  "reservationType": "hotel|flight|restaurant|train|activity|other",',
    '  "flightNumber": "flight or train number e.g. F8 1600 or null",',
    '  "origin": "departure airport/station CODE - City e.g. YYZ - Toronto or null",',
    '  "destination": "arrival airport/station CODE - City e.g. FLL - Fort Lauderdale or null",',
    '  "seat": "seat number or null",',
    '  "boardingTime": "HH:MM boarding/gate time or null",',
    '  "passengerName": "passenger or guest full name or null",',
    '  "baggage": "baggage allowance description e.g. 1 x personal item or null",',
    '  "roomType": "hotel room/unit type or null",',
    '  "checkInTime": "HH:MM hotel check-in time or null",',
    '  "checkOutTime": "HH:MM hotel check-out time or null",',
    '  "guestCount": null,',
    '  "cancellationPolicy": "short cancellation policy description or null",',
    '  "duration": "activity duration e.g. 3 hours or null"',
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
    "- Be honest — never invent information; set null for anything not found",
    "- For 'name': hotel/restaurant/venue name for stays and dining; " +
      "airline name for flights (e.g. 'Delta Air Lines'); train operator for trains",
    "- FLIGHTS: name=airline, origin='CODE - City' (departure), " +
      "destination='CODE - City' (arrival), bookingDate=departure date, " +
      "checkoutDate=arrival date if overnight, bookingTime=departure HH:MM, " +
      "arrivalTime=arrival HH:MM, flightNumber, seat, boardingTime, " +
      "passengerName, baggage, reservationType='flight'",
    "- TRAINS: same pattern as flights with operator name, reservationType='train'",
    "- HOTELS: bookingDate=check-in, checkoutDate=check-out, " +
      "checkInTime=HH:MM earliest check-in, checkOutTime=HH:MM latest check-out, " +
      "roomType, guestCount=number of guests, cancellationPolicy",
    "- RESTAURANTS: bookingDate=reservation date, bookingTime=reservation time, " +
      "guestCount=party size, cancellationPolicy",
    "- ACTIVITIES: bookingDate=activity date, bookingTime=start time, " +
      "duration='X hours', guestCount=participants, cancellationPolicy; " +
      "meeting point goes in location/address",
    "- Set price to 0 if not found",
    "- reservationType must match: hotel|flight|restaurant|train|activity|other",
    "- If this is NOT a booking confirmation return found: false",
    "- If confidence is below 60% return found: false",
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

  if (pdfAttachments.length > 0) {
    return await callClaudeWithDocuments(anthropicClient, systemPrompt, userPrompt, pdfAttachments, 1024);
  }
  return await callClaude(anthropicClient, systemPrompt, userPrompt, 1024);
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

  // ── Look up user by sender email ──
  const senderEmail = extractSenderEmail(from);
  if (!senderEmail) {
    console.error("[inbound-booking] Could not extract sender email from:", from);
    return;
  }

  // ── Get email body text ──
  let emailText = textBody;
  if (!emailText && htmlBody) {
    emailText = stripHtml(htmlBody);
  }

  // ── Process attachments ──
  const pdfAttachments: string[] = [];
  const attachmentInfoRaw = formData.get('attachment-info');
  if (attachmentInfoRaw) {
    let attachmentInfo: Record<string, unknown> = {};
    try { attachmentInfo = JSON.parse(String(attachmentInfoRaw)); } catch (_e) {}

    for (const [key, info] of Object.entries(attachmentInfo)) {
      const file = formData.get(key);
      if (!(file instanceof File)) continue;

      const mimeType = ((info as Record<string, string>).type ?? '').toLowerCase();
      const filename = ((info as Record<string, string>).filename ?? '').toLowerCase();

      if (mimeType === 'text/calendar' || filename.endsWith('.ics')) {
        try {
          const icsText = await file.text();
          emailText += parseICS(icsText);
          console.log('[inbound-booking] Parsed ICS attachment:', filename);
        } catch (_e) { /* non-fatal */ }

      } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
        try {
          const buffer = await file.arrayBuffer();
          pdfAttachments.push(arrayBufferToBase64(buffer));
          console.log('[inbound-booking] Added PDF attachment:', filename);
        } catch (_e) { /* non-fatal */ }

      } else if (mimeType === 'text/html' || filename.endsWith('.html') || filename.endsWith('.htm')) {
        try {
          const htmlText = await file.text();
          emailText += '\n\n[HTML attachment]\n' + stripHtml(htmlText);
        } catch (_e) { /* non-fatal */ }
      }
    }
  }

  // Need at least some content to parse
  if (!emailText && pdfAttachments.length === 0) {
    console.error("[inbound-booking] No email body or attachments found");
    return;
  }

  // Truncate extremely long email text to avoid token limits (PDFs go via document API, not truncated)
  const MAX_EMAIL_LENGTH = 15000;
  if (emailText.length > MAX_EMAIL_LENGTH) {
    emailText = emailText.slice(0, MAX_EMAIL_LENGTH) + "\n\n[... email truncated ...]";
  }

  // ── Look up user in auth by sender email ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userList, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    console.error("[inbound-booking] Error listing users:", userError.message);
    return;
  }

  const matchedUser = userList.users.find(
    (u) => u.email?.toLowerCase() === senderEmail
  );

  if (!matchedUser) {
    console.error("[inbound-booking] No user found with email:", senderEmail);
    return;
  }

  const userId = matchedUser.id;

  // ── Extract booking details with Claude ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("[inbound-booking] ANTHROPIC_API_KEY not configured");
    return;
  }
  const anthropicClient = new Anthropic({ apiKey: anthropicKey });

  let bookingData: Record<string, unknown>;
  try {
    bookingData = await extractBookingFromEmail(anthropicClient, emailText, subject, pdfAttachments);
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
