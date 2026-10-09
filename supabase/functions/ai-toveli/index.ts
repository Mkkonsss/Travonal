import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS: Allow requests from the app's domains and local development.
// Mobile native clients don't enforce CORS, so this mainly protects
// against browser-based abuse of the edge function endpoints.
const ALLOWED_ORIGINS = [
  "https://tripseekapp.com",
  "https://www.tripseekapp.com",
  "http://localhost:8081",
  "http://localhost:19006",
];

function getCorsOrigin(req) {
  var origin = req.headers.get("origin") || "";
  // Allow listed origins, or any non-browser request (no Origin header = mobile/server)
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return origin || "*";
  return ALLOWED_ORIGINS[0]; // Deny by returning a non-matching origin
}

const CORS_HEADERS_STATIC = "authorization, x-client-info, apikey, content-type";
const CORS_METHODS = "POST, OPTIONS";

function makeCorsHeaders(req) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": CORS_HEADERS_STATIC,
    "Access-Control-Allow-Methods": CORS_METHODS,
  };
}

// Fallback static headers for places where req is not available
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": CORS_HEADERS_STATIC,
  "Access-Control-Allow-Methods": CORS_METHODS,
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5-20251001";

function extractJSON(text) {
  // Try code block first
  var block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  var raw = block ? block[1].trim() : text.trim();
  var start = raw.search(/[{[]/);
  if (start === -1) {
    throw new Error("No JSON found in response");
  }
  try {
    return JSON.parse(raw.slice(start));
  } catch (_e) {
    // Aggressive: find outermost { } or [ ]
    var opener = raw[start];
    var closer = opener === "{" ? "}" : "]";
    var depth = 0;
    var end = -1;
    for (var i = start; i < raw.length; i++) {
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
    // Truncation repair: if depth > 0, the response was likely cut off — close open brackets/braces
    var truncated = raw.slice(start);
    // Remove trailing incomplete string value (e.g. `"desc": "some text that got cu`)
    truncated = truncated.replace(/,\s*"[^"]*":\s*"[^"]*$/, "");
    truncated = truncated.replace(/,\s*"[^"]*$/, "");
    truncated = truncated.replace(/,\s*$/, "");
    // Count open brackets and braces
    var openBraces = 0, openBrackets = 0;
    var inStr = false;
    for (var j = 0; j < truncated.length; j++) {
      var ch = truncated[j];
      if (ch === '"' && (j === 0 || truncated[j-1] !== '\\')) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }
    // Close unclosed brackets then braces
    for (var bk = 0; bk < openBrackets; bk++) truncated += "]";
    for (var br = 0; br < openBraces; br++) truncated += "}";
    try {
      return JSON.parse(truncated);
    } catch (_e3) {
      // ignore — fall through
    }
    throw new Error("Could not parse JSON from response");
  }
}

async function claude(system, user, maxTokens, timeoutMs, model) {
  var tms = timeoutMs || 60000;
  var mdl = model || SONNET;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, tms);
  try {
    var response = await client.messages.create({
      model: mdl,
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: "user", content: user }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    console.log("[claude] stop_reason:", response.stop_reason,
      "usage:", JSON.stringify(response.usage),
      "content_length:", response.content.length);
    var text = response.content[0].type === "text"
      ? response.content[0].text
      : "";
    try {
      return extractJSON(text);
    } catch (parseErr) {
      console.error("[claude] extractJSON failed. text length:", text.length,
        "first 500 chars:", text.substring(0, 500));
      parseErr.rawText = text;
      throw parseErr;
    }
  } catch (err) {
    clearTimeout(timer);
    console.error("[claude] error:", err.message || err);
    throw err;
  }
}

// --- Google Places helper ---

// locationBias: { lat, lng, radiusMeters } — pass user location or trip destination coords
// to prevent Google from defaulting to the edge function server's IP (which is in Canada).
async function fetchGooglePlaces(query, apiKey, locationBias?) {
  var url =
    "https://places.googleapis.com" +
    "/v1/places:searchText";
  var fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.types",
    "places.primaryTypeDisplayName",
    "places.location",
    "places.photos",
  ].join(",");
  var reqBody: any = {
    textQuery: query,
    pageSize: 20,
  };
  // Always set a location bias so Google doesn't fall back to server IP geolocation
  if (locationBias?.lat != null && locationBias?.lng != null) {
    reqBody.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lng },
        radius: locationBias.radiusMeters ?? 50000,
      },
    };
  }
  try {
    var resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(reqBody),
    });
    if (!resp.ok) return [];
    var data = await resp.json();
    return data.places || [];
  } catch (_e) {
    return [];
  }
}

function formatGooglePlaces(places, compact) {
  var lines = [];
  var limit = Math.min(places.length, compact ? 60 : 40);
  for (var i = 0; i < limit; i++) {
    var p = places[i];
    var name = p.displayName
      ? p.displayName.text || "Unknown"
      : "Unknown";
    var addr = p.formattedAddress || "";
    var pid = p.id || p.placeId || "";
    var lat = p.location ? p.location.latitude : "";
    var lng = p.location ? p.location.longitude : "";
    if (compact) {
      // Minimal format for long trips: name|placeId|addr|lat|lng
      lines.push(name + "|" + pid + "|" + addr + "|" + lat + "|" + lng);
    } else {
      var rating = p.rating ? " Rating:" + p.rating : "";
      var types = (p.types || []).filter(function(t) {
        return t !== "point_of_interest" && t !== "establishment";
      }).slice(0, 4).join(", ");
      var primaryTypeLabel = p.primaryTypeDisplayName
        ? p.primaryTypeDisplayName.text || "" : "";
      lines.push((i + 1) + ". " + name + rating);
      if (primaryTypeLabel) lines.push("   Category: " + primaryTypeLabel);
      if (types) lines.push("   Types: " + types);
      if (addr) lines.push("   Address: " + addr);
      if (pid) lines.push("   placeId: " + pid);
      if (lat && lng) lines.push("   lat: " + lat + " lng: " + lng);
    }
  }
  return lines.join("\n");
}

// --- Structured output validation ---

function validateOutput(data, action) {
  if (data == null || typeof data !== "object") {
    throw new Error("AI returned non-object response");
  }
  if (action === "generate_trip" ||
      action === "edit_trip") {
    if (!Array.isArray(data.activities)) {
      throw new Error(
        "Missing activities array in AI response"
      );
    }
    for (var i = 0; i < data.activities.length; i++) {
      var a = data.activities[i];
      if (!a || typeof a !== "object") {
        throw new Error(
          "Activity at " + i + " is not an object"
        );
      }
      if (!a.title || typeof a.title !== "string") {
        throw new Error(
          "Activity at " + i + " missing title"
        );
      }
      if (a.day == null) {
        throw new Error(
          "Activity at " + i + " missing day"
        );
      }
      if (!a.time || typeof a.time !== "string") {
        throw new Error(
          "Activity at " + i + " missing time"
        );
      }
    }
  }
  if (action === "chat") {
    // Salvage partial responses — set defaults for missing fields instead of throwing
    if (typeof data.message !== "string") {
      data.message = data.message ? String(data.message) : "Here's what I found:";
    }
    if (!Array.isArray(data.actions)) {
      data.actions = [];
    }
    // Ensure suggestions is an array (optional)
    if (data.suggestions && !Array.isArray(data.suggestions)) {
      data.suggestions = [];
    }
    // Ensure context is a string or null (optional)
    if (data.context && typeof data.context !== "string") {
      data.context = null;
    }
  }
  if (action === "import_place") {
    if (typeof data.found !== "boolean") {
      throw new Error(
        "Missing found boolean in import response"
      );
    }
    if (data.found === true) {
      // Multi-place results have places array
      if (Array.isArray(data.places)) {
        for (var pi = 0; pi < data.places.length; pi++) {
          if (!data.places[pi].name ||
              typeof data.places[pi].name !== "string") {
            throw new Error(
              "Place at index " + pi + " missing name"
            );
          }
        }
      } else if (!data.name ||
          typeof data.name !== "string") {
        throw new Error(
          "Missing name in import response"
        );
      }
    }
  }
  if (action === "import_booking") {
    if (typeof data.found !== "boolean") {
      throw new Error(
        "Missing found boolean in import_booking response"
      );
    }
    if (data.found === true && (!data.name ||
        typeof data.name !== "string")) {
      throw new Error(
        "Missing name in import_booking response"
      );
    }
  }
}

// --- 1. Trip Generation ---

async function handleGenerateTrip(payload) {
  console.log("[generate_trip] START", new Date().toISOString());
  const trip = payload.trip;
  const profile = payload.profile;
  const memory = payload.memory ?? [];

  const startDate = String(trip.startDate ?? "");
  const endDate = String(trip.endDate ?? "");
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  const numDays = Math.round(ms / 86400000) + 1;

  const activities = trip.activities ?? [];
  const fixedLines = [];
  for (const a of activities) {
    if (a.fixed || a.locked) {
      const tag = a.fixed ? " [FIXED]" : " [LOCKED]";
      fixedLines.push(
        "Day " + String(a.day) + " at " + String(a.time) +
        ": " + String(a.title) + " (" + String(a.type) + ")" + tag
      );
    }
  }
  const fixedActivities = fixedLines.length > 0
    ? fixedLines.join("\n")
    : "None";

  // Extract requested activities (from boards/inbox)
  const requestedLines = [];
  for (const a of activities) {
    if (a.requested && !a.fixed && !a.locked) {
      var detail = String(a.title) + " (" + String(a.type) + ")";
      if (a.category) detail += " [" + String(a.category) + "]";
      if (a.duration) detail += " ~" + String(a.duration) + "min";
      if (a.description) detail += " - " + String(a.description);
      if (a.placeId) detail += " placeId:" + String(a.placeId);
      if (a.address) detail += " addr:" + String(a.address);
      if (a.lat && a.lng) detail += " (" + String(a.lat) + "," + String(a.lng) + ")";
      if (a.openingHours && a.openingHours.length > 0) detail += " hours:" + a.openingHours.join("; ");
      if (a.rating) detail += " rating:" + String(a.rating) + "/5";
      if (a.reviewCount) detail += " (" + String(a.reviewCount) + " reviews)";
      if (a.notes) detail += ' notes:"' + String(a.notes) + '"';
      requestedLines.push(detail);
    }
  }
  const requestedPlaces = requestedLines.length > 0
    ? requestedLines.join("\n")
    : "None";

  var geoContext = String(trip.geoContext || "");

  var tripPaceRaw = String(trip.pace || "");
  var profPaceRaw = String(profile.pace || "moderate");
  const pace = tripPaceRaw || profPaceRaw;
  const perDay = pace === "relaxed"
    ? "1-2 main experiences + meals"
    : pace === "active"
    ? "4-6 main experiences + meals"
    : "2-4 main experiences + meals";

  const memoryLines = [];
  for (const m of memory) {
    memoryLines.push("- " + m.detail);
  }
  const memCtx = memoryLines.length > 0
    ? "\nLEARNED PREFERENCES:\n" + memoryLines.join("\n")
    : "";

  const interests = (profile.interests ?? []).join(", ")
    || "general sightseeing";
  const dislikes = (profile.dislikes ?? []).join(", ") || "none";
  const dietary = (profile.dietaryRestrictions ?? []).join(", ") || "none";
  const decisionPriorities = (profile.decisionPriorities ?? []).join(", ");

  var sysArr = [
    "You are Tripseek AI trip planner. Return ONLY valid JSON.",
    "",
    "PACE: relaxed=1-2 activities+meals/day, moderate=2-4+meals, active=4-6+meals.",
    "Every day MUST have breakfast+lunch+dinner. Relaxed must still have real activities, not just meals.",
    "",
    "MEALS: breakfast 07:00-09:30, lunch 12:00-13:30, dinner 19:00-21:30. Never repeat a restaurant.",
    "Vary cuisines across days. Mix dining styles (fine dining, casual, street food, cafes, markets).",
    "",
    "Day 1: lighter schedule (2 activities max), start after 14:00 if arriving by flight.",
    "Last day: no activities after 14:00 (checkout+airport). Middle days: full pace.",
    "",
    "No duplicate places across ANY days. Group activities by neighborhood. Min 30min gaps (relaxed: 60min).",
    "Nightlife/bars after 19:00. Museums/popular spots early morning. Outdoor activities in morning.",
    "",
    "FIXED/LOCKED activities: do NOT include (merged client-side). Plan around them.",
    "REQUESTED places: MUST include ALL at optimal times. Copy placeId if provided.",
    "",
    "TYPE RULES: food=restaurants/cafes/bars/bakeries. activity=attractions/museums/parks/tours/shopping/entertainment. hotel=accommodation. flight=flights.",
    "Use Category label from place data if available. Waterparks/museums are activity, NOT food.",
    "",
    "Each description: 1 short sentence. Use real places only, never invent names.",
    "personalNote: 1 short phrase connecting this place to a specific traveler preference (e.g. 'great for your love of street food', 'quiet spot for crowd-avoiders'). Omit for flights and hotels.",
    "cost: free/budget/moderate/premium. time: HH:MM 24h. duration: minutes.",
    "Copy placeId, address, lat, lng from the verified places list exactly.",
  ];
  var isLong = numDays > 5;
  if (isLong) {
    sysArr.push("");
    sysArr.push("LONG TRIP (" + numDays + " days): OMIT descriptions entirely (leave empty string). Keep output minimal to fit response limits.");
  }
  var system = sysArr.join("\n");

  var schemaArr = [
    "{",
    '  "activities": [',
    "    {",
    '      "day": 1,',
    '      "time": "09:00",',
    '      "title": "Place name",',
    '      "type": "activity",',
  ];
  if (!isLong) {
    schemaArr.push('      "description": "One sentence: what makes it special + a practical tip.",');
    schemaArr.push('      "personalNote": "One phrase: why this fits you (e.g. \'quiet spot for crowd-avoiders\' or \'top pick for foodies\').",');
  }
  schemaArr.push(
    '      "duration": 90,',
    '      "category": "culture",',
    '      "cost": "moderate",',
    '      "placeId": "ChIJ...",',
    '      "address": "Full address",',
    '      "lat": 35.71,',
    '      "lng": 139.79',
    "    }",
    "  ]",
    "}",
  );
  var schema = schemaArr.join("\n");

  // Fetch real venues from Google Places — multiple queries for variety
  var gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  var venueCtx = "";
  var t0 = Date.now();
  if (gpKey) {
    var dest = String(trip.destination || "");
    var country = String(trip.country || "");

    var gpQuery = dest + " " + country +
      " attractions " + interests;
    var foodQuery = "best restaurants cafes breakfast spots street food in " +
      dest + " " + country;
    if (dietary !== "none") {
      foodQuery += " " + dietary;
    }
    var gpQueries = [
      fetchGooglePlaces(gpQuery, gpKey),
      fetchGooglePlaces(foodQuery, gpKey),
    ];
    if (isLong) {
      // Extra searches for long trips — need 60+ unique venues
      gpQueries.push(fetchGooglePlaces("cafes breakfast bakeries in " + dest + " " + country, gpKey));
      gpQueries.push(fetchGooglePlaces("bars nightlife rooftop in " + dest + " " + country, gpKey));
      gpQueries.push(fetchGooglePlaces("parks gardens outdoor in " + dest + " " + country, gpKey));
    }
    var gpResults = await Promise.all(gpQueries);
    console.log("[generate_trip] GP done:", Date.now() - t0, "ms");
    // Deduplicate by placeId
    var seenIds = new Set();
    var allVenues = [];
    for (var r of gpResults) {
      for (var v of r) {
        var pid = (v as any).place_id || (v as any).placeId || (v as any).id || "";
        if (!pid || !seenIds.has(pid)) {
          if (pid) seenIds.add(pid);
          allVenues.push(v);
        }
      }
    }
    if (allVenues.length > 0) {
      var compact = isLong;
      venueCtx = "\n\nREAL VERIFIED PLACES FOR " +
        dest + ":\n" +
        (compact ? "Format: name|placeId|address|lat|lng\n" : "") +
        formatGooglePlaces(allVenues, compact) +
        "\nPREFER places from this list. " +
        "Copy placeId, address, lat, lng exactly when using a listed place." +
        "\nIf you need additional places " +
        "beyond this list, use your knowledge " +
        "of " + dest + " — real place names only, " +
        "omit placeId/address/lat/lng for those.";
    } else {
      venueCtx = "\n\nNote: Live place data " +
        "unavailable. Use your knowledge " +
        "for this destination.";
    }
  }

  var tripNotes = String(trip.notes || "none");
  var tripRestrictions = String(trip.restrictions || "none");
  var tripPace = String(trip.pace || "");
  var paceNote = tripPace ? tripPace : pace;
  var mobility = (profile.mobilityNeeds || []).join(", ") || "none";
  var absRules = (profile.absoluteRules || []).join(", ") || "none";
  var crowdTolerance = String(profile.crowdTolerance || "fine");
  var foodImportance = String(profile.foodImportance || "moderate");
  var recommendationStyle = String(profile.recommendationStyle || "few");
  var anythingElse = String(profile.anythingElse || "");
  var travelWith = String(
    trip.travelWith || profile.travelWith || "not specified"
  );
  var travelers = String(
    trip.travelers || "not specified"
  );

  var userArr = [
    "TRIP:",
    "Destination: " + String(trip.destination) +
      ", " + String(trip.country),
    "Dates: " + startDate + " to " + endDate +
      " (" + numDays + " days)",
    "Budget: " + String(trip.budget || "moderate"),
    "Traveling: " + travelWith +
      " (" + travelers + " person(s))",
    "Purpose: " + String(trip.tripPurpose || "leisure"),
    "Requests: " + String(trip.tripInstructions || "none"),
    "Trip notes: " + tripNotes,
    "Trip restrictions: " + tripRestrictions,
    "",
    "TRAVELER PROFILE:",
    "Pace limit: " + paceNote + " -> " + perDay + " per day MAX",
    "Interests: " + interests,
    "Dislikes: " + dislikes,
    "Dietary: " + dietary,
    "Mobility needs: " + mobility,
    "Absolute rules: " + absRules,
    "Crowd tolerance: " + crowdTolerance + (crowdTolerance === "avoid" ? " — prefer quieter, off-the-beaten-path spots over famous tourist traps" : ""),
    "Food importance: " + foodImportance + (foodImportance === "big" ? " — food is a top priority; describe dishes and food culture in detail, include more dining variety" : foodImportance === "simple" ? " — just note the place name, minimal food detail" : ""),
    "Recommendation style: " + recommendationStyle + (recommendationStyle === "best" ? " — give the single best option with confidence, not a list" : recommendationStyle === "explore" ? " — include a broader range of options including surprises and hidden gems" : " — give 2-3 curated options"),
    anythingElse ? "User notes: " + anythingElse : "",
    decisionPriorities ? "Decision priorities: " + decisionPriorities : "",
    "Accommodation: " +
      String(profile.accommodationPreference || "hotel")
      + memCtx + venueCtx,
    "",
    "REQUESTED PLACES (MUST include ALL of these):",
    requestedPlaces,
    "",
    "FIXED ACTIVITIES (do NOT regenerate these):",
    fixedActivities,
    "",
    "Generate a complete " + numDays + "-day itinerary.",
    "Include ALL requested places above at optimal times.",
    "Do NOT include the fixed activities above.",
    "They will be merged automatically. Return JSON:",
    schema,
  ];
  var user = userArr.join("\n");

  console.log("[generate_trip] calling claude:", Date.now() - t0, "ms");
  var maxTok = isLong ? 16000 : 8192;
  var genResult = await claude(system, user, maxTok, 140000);
  console.log("[generate_trip] claude done:", Date.now() - t0, "ms");
  validateOutput(genResult, "generate_trip");
  return genResult;
}

// --- 2. Chat ---

async function handleChat(payload) {
  const message = String(payload.message ?? "");
  const history = payload.history ?? [];
  const tripContext = String(payload.tripContext ?? "");
  const profile = payload.profile ?? {};
  const activeTrip = payload.activeTrip;
  const userLocation = payload.userLocation ?? null; // { lat, lng, city? }

  // Resolve the canonical trip ID for actions.
  // activeTrip.id is authoritative; payload.activeTripId is fallback.
  const activeTripId = activeTrip
    ? String(activeTrip.id ?? "")
    : String(payload.activeTripId ?? "");

  const histLines = [];
  for (const m of history) {
    const who = m.role === "user" ? "User" : "Tripseek";
    histLines.push(who + ": " + m.content);
  }

  const focusTripLines = [];
  if (activeTrip) {
    const acts = activeTrip.activities ?? [];
    const actLines = [];
    for (const a of acts) {
      const lk = a.locked || a.fixed ? " [locked]" : "";
      actLines.push(
        "[id:" + String(a.id) +
        "] Day " + String(a.day) +
        " " + String(a.time) +
        " - " + String(a.title) + lk
      );
    }
    focusTripLines.push(
      "FOCUS TRIP (tripId: " + activeTripId + ")"
    );
    focusTripLines.push(
      String(activeTrip.destination) +
      ", " + String(activeTrip.country) +
      " (" + String(activeTrip.startDate) +
      " to " + String(activeTrip.endDate) + ")"
    );
    focusTripLines.push("Activities:");
    for (const line of actLines) {
      focusTripLines.push("  " + line);
    }
    // Include reservations with IDs so the AI can reference them
    const reservations = (activeTrip.reservations ?? []).filter(function(r) { return !r.cancelled; });
    if (reservations.length > 0) {
      focusTripLines.push("Reservations:");
      for (const r of reservations) {
        var when = r.day ? "Day " + r.day : (r.date || "");
        var time = r.time ? " " + r.time : "";
        var conf = r.confirmationNumber ? " #" + r.confirmationNumber : "";
        focusTripLines.push("  [id:" + r.id + "] " + r.type + ": " + r.title + (when ? " " + when : "") + time + conf);
      }
    }
  }

  const fmt = [
    "{",
    '  "message": "your response text",',
    '  "actions": [],',
    '  "recommended_places": [{"name": "Exact Place Name", "reason": "one phrase: why this fits the traveler"}, {"name": "Exact Place Name 2", "reason": "..."}],',
    '  "suggestions": ["follow-up 1", "follow-up 2"],',
    '  "context": "optional — what personalization you used"',
    "}",
  ].join("\n");

  // Build action examples using the real trip ID (or placeholder)
  var tid = activeTripId || "<tripId>";

  // Detect place-recommendation intent and enrich
  // Broadly detect any message that might involve places — err on the side of fetching
  var isPlaceQ = /restaurant|cafe|hotel|attraction|museum|park|bar|show|visit|sushi|coffee|eat|food|lunch|dinner|breakfast|brunch|dessert|cocktail|drink|snack|bite|go to|nightlife|club|beach|temple|church|market|shop|mall|spa|gym|pool|tour|hike|trail|gallery|theater|cinema|stadium|zoo|aquarium|garden|palace|castle|bridge|tower|monument|square|plaza|street|district|neighborhood/i.test(message) ||
    /recommend|suggest|find|where|what should|what can|what to do|things to do|places to|spots|best|top|popular|famous|hidden gem|local|nearby|around here|somewhere|something to/i.test(message) ||
    /add .*(to|on)|put .*(in|on)|include|schedule|plan .*(day|trip)|replace|swap|change .*(to|with)|instead of|rather than|something .*(else|different|better|chill|fun|cool|nice)/i.test(message) ||
    // If there's an active trip, almost any message might reference places — err on fetching
    (!!activeTripId && /do|see|explore|check out|try|experience|morning|evening|tonight|afternoon|grab|want|need|feel like|how about|what about/i.test(message));
  var chatGpKey = Deno.env.get(
    "GOOGLE_PLACES_API_KEY"
  );
  var chatPlacesCtx = "";
  var chatPlaces = [];
  // Search Google Places using user's current location, trip context, or destination
  var searchDest = activeTrip
    ? String(activeTrip.destination || "")
    : "";
  // Fall back to destination from trip context string
  if (!searchDest && tripContext) {
    var destMatch = tripContext.match(/(?:Active|Upcoming) trips:\s*-\s*(?:"[^"]*"\s*—\s*)?([^,(]+)/);
    if (destMatch) searchDest = destMatch[1].trim();
  }
  // Use user's current location city if available and no trip destination
  if (!searchDest && userLocation?.city) {
    searchDest = userLocation.city;
  }
  if (isPlaceQ && chatGpKey) {
    var chatPlaceQ = searchDest ? (message + " near " + searchDest) : message;
    // Determine location bias: prefer user's current GPS coords, fall back to nothing
    // (the text query already includes the destination city when relevant)
    var chatBias = userLocation?.lat != null
      ? { lat: userLocation.lat, lng: userLocation.lng, radiusMeters: 50000 }
      : undefined;
    chatPlaces = await fetchGooglePlaces(
      chatPlaceQ, chatGpKey, chatBias
    );
    if (chatPlaces.length > 0) {
      chatPlacesCtx =
        "\n\nREAL NEARBY PLACES — you MUST pick from this list when recommending places.\n" +
        "CRITICAL: Put the EXACT place names (copy-paste from below) into the \"recommended_places\" array in your response.\n" +
        "The first place in the array is shown as the primary recommendation. Include 3-5 places max.\n" +
        "Your main recommendation should be first, then alternatives. Only include places you actually discuss in your message.\n" +
        formatGooglePlaces(chatPlaces);
    }
  }

  const sysArr = [
    // --- IDENTITY ---
    "You are Tripseek, a personal travel companion — not a rigid trip assistant.",
    "Your name is Tripseek. Never refer to yourself as Travonal, Toveli, or any other name.",
    "You have full access to the user's entire account: all trips, boards, saved places, profile, preferences, and memory in the TRIP CONTEXT below.",
    userLocation
      ? ("The user's current location is: " + (userLocation.city ? userLocation.city + " (" : "(") + "lat " + userLocation.lat.toFixed(4) + ", lng " + userLocation.lng.toFixed(4) + "). Use this when they ask about 'nearby', 'around here', 'near me', or any location-relative request.")
      : "The user's current location is unknown — don't assume a location if they ask for nearby places; ask where they are.",
    "You think across their whole travel life — past trips, upcoming plans, saved ideas, preferences — and connect dots naturally.",
    "You ask questions when something is unclear rather than guessing. You feel like a smart friend who happens to know everything about travel.",
    "",
    // --- COMPANION BEHAVIOR ---
    "COMPANION MINDSET:",
    "- You know everything in the user's account. Reference it naturally: 'I see you're heading to Tokyo next month...' or 'You saved that sushi place in your Tokyo board...'",
    "- You're proactive but not pushy. If you notice something relevant (a conflict, an opportunity, a saved place nearby), mention it.",
    "- You ask clarifying questions naturally, like a person would. Not 'Please specify the trip ID' but 'Which trip do you mean — Tokyo or Lisbon?'",
    "- If the user asks a vague question, make your best inference from their context and answer, then offer to refine.",
    "- Never tell the user to 'go to settings' or 'select a trip' — just handle it conversationally.",
    "",
    // --- CORE RULES ---
    "BEFORE ANY ACTION — ASK IF ANYTHING IS UNCLEAR:",
    "For ANY action (add, remove, move, replace, update — all of them), you need ALL details before executing.",
    "If the place, day, or time is missing or ambiguous, set actions to [] and ask the user to specify.",
    "Never guess a day, time, or place. Never invent a place. Never pick randomly.",
    "If the user said 'add that' but you recommended multiple places, ask which one.",
    "If 'remove the restaurant' but there are multiple restaurants, ask which one.",
    "Only execute when you have everything with zero ambiguity.",
    "",
    "RECOMMEND vs MODIFY — different intents:",
    "- 'Recommend' / 'Suggest' / 'What's good?' / 'Any ideas?' / 'Where should I eat?' → ALWAYS give concrete suggestions with place cards, actions: [].",
    "  Even if the request is vague ('suggest something fun', 'dinner spot?'), pick your best suggestions based on the user's profile and trip context.",
    "  Lead with recommendations first. You can follow up with a short question to refine ('Want something more upscale?' or 'Prefer a specific cuisine?') but NEVER ask questions without also giving suggestions.",
    "- 'Add [place] on day 2 at 7pm' / 'Remove the museum' / 'Move lunch to 2pm' → modification. Check you have all details, then execute.",
    "- When ambiguous, default to recommending. Never auto-add to the itinerary.",
    "",
    "NEVER REFUSE a type of request. If the user wants it, help them get it. But 'never refuse' does not mean 'execute without details'.",
    "If a user overrides their profile preferences, follow their instruction.",
    "Respect dietary restrictions/allergies — warn if a place conflicts.",
    "",
    "PREFERENCES — use to shape your recommendations, never to block a request:",
    "Interests, budget, decision priorities, and crowd tolerance inform your picks.",
    "Crowd tolerance: 'avoid' = lean toward quieter, less-touristy spots; 'fine' = no preference.",
    "Food importance: 'big' = describe dishes and food culture in detail; 'simple' = just name the place.",
    "Recommendation style: 'best' = give ONE confident top pick, not a list; 'few' = 2-3 curated options; 'explore' = broader range including surprises.",
    "NEVER mention 'pace', 'flexibility', 'accommodation preference', or 'decision priorities' to the user — these are internal field names they never saw.",
    "Instead say things like 'since you prefer local and authentic places' or 'based on what you look for in a spot'.",
    "User notes (from their onboarding): treat as important context that should shape your suggestions.",
    "",
    // --- INTENT INTERPRETATION ---
    "Users speak casually. Understand their intent:",
    "- 'Nah scratch the museum' / 'I'm not feeling it' → remove.",
    "- 'Can we do something else instead?' → replace (still need all details).",
    "- 'Push lunch back' / 'A bit later' → move time.",
    "- 'Swap day 1 and day 2' / 'Flip the first two days' → swap days.",
    "",
    "CONVERSATION CONTEXT:",
    "- 'That one' / 'the first one' → only resolve if exactly ONE place is referenced. If multiple, ask which.",
    "- 'Actually make it later' → adjust time of what was just discussed.",
    "- 'Never mind' / 'undo that' → remove the last thing you added.",
    "- Relative time: 'morning' = 08:00-11:00, 'afternoon' = 13:00-17:00, 'evening' = 18:00-21:00.",
    "- When the user refers to a place from earlier in the conversation, use EXACTLY that place. Never substitute a different one.",
    "MULTIPLE TRIPS — resolve naturally, don't ask for IDs:",
    "- If the user says 'add this to my Tokyo trip' — use the trip with Tokyo as destination.",
    "- If the user's message is ambiguous and they have multiple active trips, ask casually: 'Which trip — Tokyo or Lisbon?'",
    "- If only one active trip exists, always use it without asking.",
    "- NEVER ask the user to 'select a trip' or use any app UI concept. Just ask which destination they mean.",
    "",
    // --- PERSONALIZATION GUIDANCE ---
    "WHEN TO PERSONALIZE:",
    "- User asks for recommendations or suggestions — they're asking you to choose, so choose for them using their profile.",
    "- Open-ended questions ('where should I eat?', 'what's good here?') — these are invitations to personalize.",
    "- A profile detail is directly relevant (e.g., allergy when recommending food, crowd preference when picking a bar).",
    "WHEN NOT TO PERSONALIZE:",
    "- Executing direct commands ('remove this', 'move that to 3pm') — just do it.",
    "- Answering factual questions ('what time does X open?', 'how far is X?') — just answer.",
    "- The user names a specific place — they've already decided, don't second-guess with profile commentary.",
    "- NEVER force personalization into every message. If it's not genuinely shaping your answer, leave it out.",
    "HOW TO PERSONALIZE — sound like a friend, not a chatbot:",
    "- GOOD: 'This one's more your vibe — local spot, not the tourist trap version'",
    "- GOOD: 'Skipping the obvious picks since you prefer discovering things off the beaten path'",
    "- BAD: 'Based on your crowd tolerance setting of avoid...'",
    "- BAD: 'According to your what-they-look-for-in-a-place preference...'",
    "- Reference what they care about naturally, never cite field names or survey answers literally.",
    "Use the user's name naturally (not every message, but in greetings and key moments).",
    "Cross-reference saved boards with trips — if they saved a place nearby, mention it when relevant.",
    "",
    // --- RESPONSE FORMAT ---
    "RESPONSE FORMAT — always return valid JSON:",
    fmt,
    "",
    "FORMATTING — use markdown the app supports: **bold**, *italic*, bullet lists (- item), numbered lists (1. item), and blank lines for spacing.",
    "",
    "MESSAGE STRUCTURE — pick the right format for the situation:",
    "",
    "WHEN ACTIONS WERE TAKEN (actions array is non-empty):",
    "- The app shows each action as a visual card with a green checkmark. The user sees exactly what was done.",
    "- Your message should NOT repeat what the action cards say. No 'I added X to Day 2 at 3pm' — the card already shows that.",
    "- Instead, write 1 sentence max with a useful tip, practical detail, or context the cards don't show.",
    "- Examples of good action messages:",
    "  'The tasting menu at **Narisawa** books out weeks ahead — reserve at narisawa.tokyo.'",
    "  '**Senso-ji** is most photogenic before 8am when the crowds are thin.'",
    "  'Moved to afternoon — **Tsukiji Outer Market** stalls close by 2pm, so this gives you more time.'",
    "  'Done! Your morning is free now.'",
    "- If there is genuinely nothing useful to add beyond what the cards show, write a single short confirmation like 'Done!' or 'All set.' or 'Swapped.'",
    "",
    "WHEN GIVING RECOMMENDATIONS (actions array is empty, user asked for suggestions):",
    "- Always use this two-section structure:",
    "  **For you**",
    "  - **Place Name** — [what it is / why it's great] — *[brief natural reason why it fits THIS person specifically]*",
    "  - **Place Name** — [what it is / why it's great] — *[brief natural reason why it fits THIS person specifically]*",
    "  ",
    "  **Also great**",
    "  - **Place Name** — one line: why it's broadly excellent (no personal commentary)",
    "  - **Place Name** — one line: why it's broadly excellent (no personal commentary)",
    "- 'For you' = 1-2 picks genuinely shaped by their profile. Each must end with a short italicized reason like:",
    "  *you tend to avoid the tourist crowds*",
    "  *fits your love of local food culture*",
    "  *your kind of spot — hidden, not on every list*",
    "  *given you prefer discovering places over the obvious picks*",
    "  Keep the reason short (under 8 words), natural, and specific to what you know about them.",
    "- 'Also great' = 1-3 broadly excellent picks. No personalization commentary here at all.",
    "- If the user has NO profile signal (no interests, no preferences set), skip 'For you' entirely and give 3-4 great picks under one header.",
    "- Keep descriptions concise. No filler.",
    "",
    "WHEN ANSWERING QUESTIONS OR GIVING INFO (actions array is empty, not a recommendation):",
    "- Use **bold section headers** on their own line to organize topics, followed by bullet points.",
    "- Lead with the most actionable info first.",
    "- For general info, structure like:",
    "  **Getting there**",
    "  - Bullet with key detail",
    "  ",
    "  **Good to know**",
    "  - Bullet with key detail",
    "- Max 6-8 bullet points total. No filler sentences.",
    "- For questions about the user's profile or what you know about them, be thorough — list ALL their preferences comprehensively.",
    "",
    "FIELD RULES:",
    "- \"message\": Follow the structure rules above. When actions are taken, 1 sentence with a useful tip or just a brief confirmation. When answering questions, structured bullets with bold headers.",
    "- \"actions\": Array of mutation objects. Empty [] when just answering questions.",
    "- \"recommended_places\": Array of {name, reason} objects from REAL NEARBY PLACES to show as cards.",
    "  Each object: {\"name\": \"Exact Place Name\", \"reason\": \"one short phrase why this fits the traveler (e.g. 'great for street food lovers' or 'quiet spot for crowd-avoiders')\"}.",
    "  STRICT: Only include places you explicitly name and discuss in your message. Every name in this array MUST appear in your message text.",
    "  If you mention 3 places in your message, this array must have exactly those 3 entries — no more, no less.",
    "  This applies ANY TIME you mention specific place names — including when asking clarifying questions, offering options, suggesting alternatives, or proposing cheaper/better swaps.",
    "  When suggesting replacements or alternatives, include ALL the new suggestions — not just the original place being replaced.",
    "  Use the EXACT name string from the places list — copy-paste, not paraphrased. Empty [] when not mentioning any specific places.",
    "- \"suggestions\": 2-4 short follow-up prompts (max 30 chars each). Contextual to the conversation.",
    "- \"context\": Set this when your response was shaped by personalization.",
    "  Examples: \"Based on your interest in street food\", \"From your Tokyo eats board\",",
    "  \"Keeping your peanut allergy in mind\", \"Matching your crowd preference\".",
    "  Omit or set null when response isn't specifically personalized.",
    "",
    "AVAILABLE ACTIONS (use the exact tripId/activityId from FOCUS TRIP):",
    "CRITICAL: Always use exact IDs shown in the data. Never invent IDs.",
    "WHICH TRIP: Always use the FOCUS TRIP tripId for actions. The FOCUS TRIP is the trip the user is talking about.",
    "If no FOCUS TRIP is shown, look at the conversation to figure out which trip the user means, and use that tripId from the FULL APP CONTEXT.",
    "",
    "Activity operations:",
    "  ACTIONS: Always use 24-hour time format HH:MM in action JSON (e.g. '09:00', '19:30').",
    "  MESSAGE TEXT: Always use 12-hour format when mentioning times to the user (e.g. '7:00 PM', '9:30 AM'). Never show 24-hour times in your message.",
    '- add_activity: { "type": "add_activity", "tripId": "' + tid + '", "activity": { "day": 1, "time": "19:00", "title": "...", "type": "food", "description": "...", "duration": 60, "category": "dining", "cost": "moderate", "placeId": "ChIJ...", "address": "...", "lat": 0, "lng": 0, "rating": 4.5 } }',
    "  CRITICAL: You MUST include ALL of these fields for every activity: duration, category, cost, placeId, address, lat, lng, rating.",
    "  Copy placeId, address, lat, lng, rating EXACTLY from REAL NEARBY PLACES data. Without placeId the activity will have NO IMAGE in the app — this is mandatory.",
    "  Write a specific 1-2 sentence description — what makes this place special, what to expect, or a practical tip. NEVER use generic filler like 'A great spot' or 'Popular restaurant'.",
    "  Use the EXACT time the user requested — do NOT shift the time to avoid conflicts with existing activities.",
    "  ONLY use add_activity for NEW places not already in the trip. To move an existing activity, use move_activity instead.",
    '- remove_activity: { "type": "remove_activity", "tripId": "' + tid + '", "activityId": "<id>" }',
    '- update_activity: { "type": "update_activity", "tripId": "' + tid + '", "activityId": "<id>", "updates": { ... } }',
    '  Updatable fields: time, title, type, description, duration, category, cost, notes, day, address, lat, lng, placeId, rating, bookingStatus ("booked"/"pending")',
    '- move_activity: { "type": "move_activity", "tripId": "' + tid + '", "activityId": "<id>", "newDay": 2, "newTime": "14:00" }',
    "  CRITICAL: When user asks to MOVE an existing activity to a different day or time, ALWAYS use move_activity with the activity's existing ID. NEVER use add_activity to move — that duplicates instead of moving.",
    '- replace_activity: { "type": "replace_activity", "tripId": "' + tid + '", "oldActivityId": "<id>", "newActivity": { "day": 1, "time": "19:00", "title": "...", "type": "food", "description": "...", "duration": 60, "category": "dining", "cost": "moderate", "placeId": "ChIJ...", "address": "...", "lat": 0, "lng": 0, "rating": 4.5 } }',
    '- swap_days: { "type": "swap_days", "tripId": "' + tid + '", "day1": 2, "day2": 3 }',
    '- toggle_lock: { "type": "toggle_lock", "tripId": "' + tid + '", "activityId": "<id>" }',
    "  Locks/unlocks an activity. Locked activities can't be moved, replaced, or removed by AI operations.",
    "",
    "Trip management:",
    '- create_trip: { "type": "create_trip", "trip": { "destination": "Tokyo", "country": "Japan", "startDate": "2026-10-15", "endDate": "2026-10-22", "notes": "", "emoji": "🗼" }, "activities": [...] }',
    "  Set notes to empty string. Do NOT put traveler descriptions, preferences, or trip summaries in notes.",
    "  DATES CAN BE TBD: If the user doesn't mention dates, use placeholder dates (today + duration) and set datesKnown: false.",
    '  Example TBD trip: { "destination": "Miami", "country": "United States", "startDate": "2026-09-15", "endDate": "2026-09-18", "datesKnown": false, "notes": "", "emoji": "🌴" }',
    "  EMPTY TRIPS: If the user asks for an empty trip, set activities to []. Don't require dates or activities to create a trip.",
    '- update_trip: { "type": "update_trip", "tripId": "' + tid + '", "updates": { ... } }',
    '  Updatable fields: title, destination, country, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), notes, emoji, datesKnown (true/false)',
    "  DURATION CHANGES: 'Make it 3 days' → compute new endDate from startDate + 2 days. 'Make it a week' → startDate + 6 days.",
    "  TBD DATES: 'Leave dates TBD' or 'I don't know the dates yet' → set datesKnown: false. Never say you need specific dates — TBD is valid.",
    '- delete_trip: { "type": "delete_trip", "tripId": "' + tid + '" }',
    "",
    "Reservations:",
    '- add_reservation: { "type": "add_reservation", "tripId": "' + tid + '", "reservation": { "type": "restaurant", "title": "Le Comptoir", "day": 3, "time": "19:00", "confirmationNumber": "ABC123" } }',
    '  Types: restaurant, hotel, flight, train, activity, other. Optional fields: address, price, currency, notes, bookingUrl, date',
    '- update_reservation: { "type": "update_reservation", "tripId": "' + tid + '", "reservationId": "<id>", "updates": { "day": 2, "time": "20:00" } }',
    '  Updatable fields: type, title, day, date, time, confirmationNumber, address, bookingUrl, price, currency, notes',
    '- remove_reservation: { "type": "remove_reservation", "tripId": "' + tid + '", "reservationId": "<id>" }',
    "",
    "Boards:",
    '- save_to_board: { "type": "save_to_board", "boardId": "<id>", "item": { "title": "...", "type": "food", "sourceType": "explore", "category": "dining", "cost": "moderate", "placeId": "ChIJ...", "address": "...", "lat": 0, "lng": 0, "rating": 4.5 } }',
    "  Always include placeId, address, lat, lng, rating when available from REAL NEARBY PLACES.",
    '- create_board: { "type": "create_board", "name": "Tokyo eats" }',
    '- rename_board: { "type": "rename_board", "boardId": "<id>", "name": "New name" }',
    '- delete_board: { "type": "delete_board", "boardId": "<id>" }',
    '- remove_board_item: { "type": "remove_board_item", "boardId": "<id>", "itemId": "<id>" }',
    '- move_board_to_trip: { "type": "move_board_to_trip", "boardId": "<id>", "tripId": "' + tid + '", "itemIds": ["<id1>", "<id2>"] }',
    "",
    "Profile:",
    '- update_profile: { "type": "update_profile", "updates": { ... } }',
    '  Updatable fields: pace, flexibility, accommodation, interests (array), dietaryRestrictions (array),',
    '  dietaryNotes, mobilityNeeds (array), absoluteRules (array), dislikes (array), crowdTolerance,',
    '  foodImportance, spendingPriorities, decisionPriorities, recommendationStyle, travelWith, budget',
    "  Confirm profile changes conversationally: \"Got it, I'll remember you prefer boutique hotels.\"",
    "",
    "Navigation:",
    '- navigate: { "type": "navigate", "route": "/(tabs)/trips" }',
    "",
    "MULTI-ACTION: You can return multiple actions in one response. For example, create a board AND save items to it.",
    "When creating a board + saving items, use the same boardId placeholder — the app will resolve it.",
    "",
    "SAFETY: delete_trip, delete_board, and swap_days are destructive — only use when clearly requested.",
    "When returning destructive actions, do NOT ask the user to confirm in your message text (no 'type yes', 'are you sure?', etc.). The app handles confirmation via a UI card automatically.",
    "For create_trip: If the user asked for a PLANNED trip (e.g. 'plan me a trip', 'create a trip with activities'), generate a full itinerary with 3-5 activities for EVERY day, no day empty.",
    "  But if the user asked for an EMPTY trip (e.g. 'make me an empty trip', 'create a blank trip') or didn't mention activities at all, set activities to [] — do NOT auto-generate activities.",
    "  TIMING RULES for create_trip activities (REQUIRED):",
    "  Breakfast: 08:00-09:30. Lunch: 12:00-13:30. Dinner: 19:00-21:00.",
    "  Activities: spread throughout the day (10:00, 14:00, 16:00 typical).",
    "  Each activity MUST have a UNIQUE time on its day — NEVER schedule two at the same time.",
    "  Minimum 30 min gap between end of one activity and start of the next.",
    "  Example day: breakfast 08:30 → activity 10:00 → lunch 12:30 → activity 14:30 → dinner 19:30.",
    "  ERROR: Multiple activities at 12:00. ERROR: All activities at the same time.",
    "",
    "REMINDER: Your response MUST be valid JSON and nothing else. No text before or after the JSON object.",
  ];
  const system = sysArr.join("\n");

  const userArr = [];

  // The tripContext from the client now includes the full profile,
  // user name, datetime, boards, saved places, and all trip data.
  userArr.push("FULL APP CONTEXT (profile, trips, boards, saved places):");
  userArr.push(tripContext);

  if (focusTripLines.length > 0) {
    userArr.push("");
    for (const line of focusTripLines) {
      userArr.push(line);
    }
  }

  userArr.push("");
  userArr.push("CONVERSATION:");
  userArr.push(histLines.join("\n"));
  if (chatPlacesCtx) {
    userArr.push(chatPlacesCtx);
  }
  userArr.push("");
  userArr.push("User: " + message);

  const user = userArr.join("\n");

  var chatResult;
  try {
    chatResult = await claude(system, user, 8192, undefined, HAIKU);
    validateOutput(chatResult, "chat");
  } catch (parseErr) {
    console.error("[handleChat] first attempt error:", String(parseErr), "rawText:", parseErr.rawText ? parseErr.rawText.substring(0, 200) : "NONE");
    try {
      chatResult = await claude(system, user, 10240, undefined, HAIKU);
      validateOutput(chatResult, "chat");
    } catch (retryErr) {
      console.error("[handleChat] retry also failed:", String(retryErr), "rawText:", retryErr.rawText ? retryErr.rawText.substring(0, 200) : "NONE");
      // Try to recover raw text from either attempt
      var fallbackText = (retryErr && retryErr.rawText) || (parseErr && parseErr.rawText);
      if (fallbackText && fallbackText.trim()) {
        // The model responded with useful text but not valid JSON — use it as the message
        // Strip any markdown code fences or JSON fragments from the text
        var cleanedText = fallbackText.trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```\s*$/i, "")
          .trim();
        chatResult = {
          message: cleanedText,
          actions: [],
          suggestions: [],
        };
      } else if (chatResult && typeof chatResult === "object") {
        if (typeof chatResult.message !== "string") chatResult.message = "Let me try that again — could you rephrase your request?";
        if (!Array.isArray(chatResult.actions)) chatResult.actions = [];
      } else {
        chatResult = {
          message: "I had trouble processing that. Could you try rephrasing?",
          actions: [],
          suggestions: ["Try again", "Something else"],
        };
      }
    }
  }
  // Sanitize actions — drop any with missing required fields so one bad action doesn't crash the whole response
  if (Array.isArray(chatResult.actions)) {
    chatResult.actions = chatResult.actions.filter(function(a) {
      if (!a || typeof a !== "object" || !a.type) return false;
      // Ensure activity/trip operations have tripId
      var needsTripId = ["add_activity", "remove_activity", "update_activity", "move_activity", "replace_activity", "swap_days", "create_trip", "update_trip", "delete_trip", "add_reservation", "update_reservation", "remove_reservation", "toggle_lock", "move_board_to_trip"];
      if (needsTripId.indexOf(a.type) !== -1 && !a.tripId && a.type !== "create_trip") return false;
      // Ensure board operations have boardId
      var needsBoardId = ["save_to_board", "rename_board", "delete_board", "remove_board_item", "move_board_to_trip"];
      if (needsBoardId.indexOf(a.type) !== -1 && !a.boardId) return false;
      // Ensure create_board has a name
      if (a.type === "create_board" && !a.name) return false;
      return true;
    });
  }

  // Post-processing: fix duplicate times in create_trip activities
  if (Array.isArray(chatResult.actions)) {
    for (var tfi = 0; tfi < chatResult.actions.length; tfi++) {
      var tfAction = chatResult.actions[tfi];
      if (tfAction.type === "create_trip" && Array.isArray(tfAction.activities)) {
        // Group by day
        var dayMap = {};
        for (var tai = 0; tai < tfAction.activities.length; tai++) {
          var act = tfAction.activities[tai];
          var d = act.day || 1;
          if (!dayMap[d]) dayMap[d] = [];
          dayMap[d].push(act);
        }
        // For each day, check if multiple activities share the same time
        var dayKeys = Object.keys(dayMap);
        for (var dki = 0; dki < dayKeys.length; dki++) {
          var dayActs = dayMap[dayKeys[dki]];
          var times = dayActs.map(function(a) { return a.time; });
          var unique = {};
          var hasDupes = false;
          for (var ui = 0; ui < times.length; ui++) {
            if (unique[times[ui]]) { hasDupes = true; break; }
            unique[times[ui]] = true;
          }
          if (hasDupes) {
            // Spread activities across the day with realistic times
            var schedule = ["08:30", "10:00", "12:30", "14:30", "16:30", "19:30", "21:00"];
            for (var si = 0; si < dayActs.length; si++) {
              dayActs[si].time = schedule[si] || (String(si + 8).padStart(2, "0") + ":00");
            }
          }
        }
      }
    }
  }

  // Post-processing: backfill placeId for new activities (add_activity, replace_activity, create_trip)
  // ALWAYS backfill — the AI often fabricates fake placeIds that cause 404s on lookup.
  // Real Google Places search is the only reliable source for placeIds.
  if (Array.isArray(chatResult.actions) && chatGpKey) {
    var backfillTargets = [];
    for (var bfi = 0; bfi < chatResult.actions.length; bfi++) {
      var bfAction = chatResult.actions[bfi];
      var bfDest = searchDest;
      if (bfAction.type === "add_activity" && bfAction.activity && bfAction.activity.title) {
        backfillTargets.push({ target: bfAction.activity, dest: bfDest });
      } else if (bfAction.type === "replace_activity" && bfAction.newActivity && bfAction.newActivity.title) {
        backfillTargets.push({ target: bfAction.newActivity, dest: bfDest });
      } else if (bfAction.type === "create_trip" && Array.isArray(bfAction.activities)) {
        var ctDest = (bfAction.trip && bfAction.trip.destination) || bfDest;
        for (var ctk = 0; ctk < bfAction.activities.length; ctk++) {
          var ctAct = bfAction.activities[ctk];
          if (ctAct.title) {
            backfillTargets.push({ target: ctAct, dest: ctDest });
          }
        }
      }
    }
    // Strip common title prefixes for cleaner Google search
    function cleanTitleForSearch(title) {
      return String(title)
        .replace(/^(lunch|dinner|brunch|breakfast|visit|walk|stroll|tour|trip|farewell dinner|farewell lunch|farewell)\s+(at|to|through|around|in|near)\s+/i, "")
        .replace(/^(neighbourhood|neighborhood)\s+(walk|stroll|exploration)\s*/i, "")
        .replace(/\s*&\s*(sacr[eé]|pont|walk|stroll).*/i, "")
        .trim();
    }
    // Bad place types that indicate a wrong result for food/activity
    var badFoodTypes = /corporate|office|service|storage|moving|plumber|electrician|locksmith|insurance|lawyer|accounting/i;

    // Backfill in parallel (up to 10 at a time) with 4s per-call timeout
    var bfLimit = Math.min(backfillTargets.length, 10);
    var bfSlice = backfillTargets.slice(0, bfLimit);
    var bfPromises = bfSlice.map(function(bfEntry) {
      var cleanTitle = cleanTitleForSearch(bfEntry.target.title);
      var typeHint = bfEntry.target.type === "food" ? "restaurant" : "";
      var searchQuery = cleanTitle + " " + typeHint + " in " + bfEntry.dest;
      return Promise.race([
        fetchGooglePlaces(searchQuery.trim(), chatGpKey),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, 4000); }),
      ]).then(function(bfPlaces) {
        if (bfPlaces && bfPlaces.length > 0) {
          // Find first valid result (skip bad type matches)
          var bfp = null;
          for (var ri = 0; ri < Math.min(bfPlaces.length, 3); ri++) {
            var candidate = bfPlaces[ri];
            var cTypes = (candidate.types || []).join(" ");
            if (bfEntry.target.type === "food" && badFoodTypes.test(cTypes)) continue;
            bfp = candidate;
            break;
          }
          if (!bfp) bfp = bfPlaces[0]; // fallback to first if all filtered
          bfEntry.target.placeId = bfp.id || "";
          bfEntry.target.address = bfp.formattedAddress || "";
          bfEntry.target.lat = bfp.location ? bfp.location.latitude : undefined;
          bfEntry.target.lng = bfp.location ? bfp.location.longitude : undefined;
          bfEntry.target.rating = bfp.rating || undefined;
          bfEntry.target.reviewCount = bfp.userRatingCount || undefined;
          // Use Google's primary type label as category for consistent display
          var bfPrimaryType = bfp.primaryTypeDisplayName ? bfp.primaryTypeDisplayName.text : "";
          if (bfPrimaryType) {
            bfEntry.target.category = bfPrimaryType;
          }
          if (!bfEntry.target.description || bfEntry.target.description.length < 20) {
            bfEntry.target.description = bfp.editorialSummary ? bfp.editorialSummary.text : bfEntry.target.description;
          }
        }
      }).catch(function() { /* non-critical */ });
    });
    await Promise.allSettled(bfPromises);
  }

  // Attach places the AI explicitly recommended (via recommended_places array)
  // Helper: normalize text for matching (strip accents, lowercase, remove common prefixes)
  function normalizePlaceName(s) {
    return String(s).toLowerCase().trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/^(the|el|la|le|les|los|las|il|lo|restaurante|restaurant|cafe|libreria|museo|hotel|bar|trattoria|osteria|ristorante|pizzeria|brasserie)\s+/i, "")
      .replace(/[''`]/g, "")
      .trim();
  }
  if (chatPlaces && chatPlaces.length > 0) {
    var recItems = Array.isArray(chatResult.recommended_places) ? chatResult.recommended_places : [];
    // Support both legacy string[] and new {name, reason}[] formats
    var recNames = recItems.map(function(p) { return typeof p === 'string' ? p : (p && p.name ? p.name : ''); });
    var recReasons = recItems.map(function(p) { return (typeof p === 'object' && p && p.reason) ? String(p.reason) : ''; });
    // Normalize recommended names for matching
    var recNamesNorm = recNames.map(function(n) { return normalizePlaceName(n); });
    var recNamesLower = recNames.map(function(n) { return String(n).toLowerCase().trim(); });

    var cardPlaces = [];
    // First pass: match by recommended_places in order (preserves AI's priority)
    for (var ri = 0; ri < recNamesNorm.length && cardPlaces.length < 5; ri++) {
      var recName = recNamesNorm[ri];
      var recNameRaw = recNamesLower[ri];
      if (!recName) continue;
      for (var ci = 0; ci < chatPlaces.length; ci++) {
        var cp = chatPlaces[ci];
        var cpRawName = cp.displayName ? (cp.displayName.text || "").toLowerCase() : "";
        var cpCheckName = normalizePlaceName(cpRawName);
        if (!cpCheckName) continue;
        // Match: exact, contains, or significant word overlap
        var isMatch = cpCheckName === recName || cpCheckName.includes(recName) || recName.includes(cpCheckName)
          || cpRawName === recNameRaw || cpRawName.includes(recNameRaw) || recNameRaw.includes(cpRawName);
        if (!isMatch) {
          // Fuzzy: count shared significant words (length > 3 to skip generic words like "cafe", "bar", "shop")
          var stopWords = ["the", "and", "of", "at", "in", "a", "an", "la", "le", "el", "los", "las", "de", "del", "di", "da"];
          var genericWords = ["coffee", "cafe", "shop", "bar", "restaurant", "hotel", "place", "house", "room", "kitchen", "grill", "bistro", "lounge"];
          var recWords = recName.split(/[\s&,]+/).filter(function(w) { return w.length > 3 && stopWords.indexOf(w) === -1 && genericWords.indexOf(w) === -1; });
          var cpWords = cpCheckName.split(/[\s&,]+/).filter(function(w) { return w.length > 3 && stopWords.indexOf(w) === -1 && genericWords.indexOf(w) === -1; });
          var sharedCount = 0;
          for (var wi = 0; wi < recWords.length; wi++) {
            for (var wj = 0; wj < cpWords.length; wj++) {
              if (recWords[wi] === cpWords[wj]) { sharedCount++; break; }
            }
          }
          // Require at least 2 significant word overlaps to avoid false matches on generic terms
          isMatch = sharedCount >= 2;
        }
        if (!isMatch) continue;
        // Avoid duplicates
        if (cardPlaces.some(function(existing) { return existing._srcIdx === ci; })) continue;
        var cpName = cp.displayName ? cp.displayName.text || "" : "";
        var cpAddr = cp.formattedAddress || "";
        var cpRating = cp.rating || null;
        var cpRatingCount = cp.userRatingCount || null;
        var cpId = cp.id || "";
        var cpLat = cp.location ? cp.location.latitude : null;
        var cpLng = cp.location ? cp.location.longitude : null;
        var cpTypes = cp.types || [];
        var cpPhotos = [];
        if (cp.photos && cp.photos.length > 0) {
          for (var pi = 0; pi < Math.min(cp.photos.length, 1); pi++) {
            cpPhotos.push(cp.photos[pi].name || "");
          }
        }
        var cpPrimaryType = cp.primaryTypeDisplayName ? cp.primaryTypeDisplayName.text || "" : "";
        cardPlaces.push({
          name: cpName,
          address: cpAddr,
          rating: cpRating,
          ratingCount: cpRatingCount,
          placeId: cpId,
          lat: cpLat,
          lng: cpLng,
          types: cpTypes,
          primaryTypeLabel: cpPrimaryType || undefined,
          photoRefs: cpPhotos,
          reason: recReasons[ri] || undefined,
          _srcIdx: ci,
        });
        break; // Found match for this recommended name, move to next
      }
    }
    // Also scan AI message for any place names from Google results not already matched
    var aiMsg = (chatResult.message || "").toLowerCase();
    for (var fi = 0; fi < chatPlaces.length && cardPlaces.length < 5; fi++) {
      // Skip if already matched by recommended_places
      if (cardPlaces.some(function(existing) { return existing._srcIdx === fi; })) continue;
      var fp = chatPlaces[fi];
      var fpName = fp.displayName ? (fp.displayName.text || "").toLowerCase() : "";
      if (!fpName) continue;
      if (aiMsg.includes(fpName)) {
        var fpDisplayName = fp.displayName ? fp.displayName.text || "" : "";
        var fpPhotos = [];
        if (fp.photos && fp.photos.length > 0) fpPhotos.push(fp.photos[0].name || "");
        var fpPrimaryType = fp.primaryTypeDisplayName ? fp.primaryTypeDisplayName.text || "" : "";
        cardPlaces.push({
          name: fpDisplayName,
          address: fp.formattedAddress || "",
          rating: fp.rating || null,
          ratingCount: fp.userRatingCount || null,
          placeId: fp.id || "",
          lat: fp.location ? fp.location.latitude : null,
          lng: fp.location ? fp.location.longitude : null,
          types: fp.types || [],
          primaryTypeLabel: fpPrimaryType || undefined,
          photoRefs: fpPhotos,
          _srcIdx: fi,
        });
      }
    }
    // Fallback: individually search for any recommended places we couldn't match
    if (recNames.length > 0 && cardPlaces.length < recNames.length && chatGpKey) {
      var unmatchedNames = [];
      for (var ui = 0; ui < recNames.length; ui++) {
        var uName = recNamesNorm[ui];
        if (!uName) continue;
        var alreadyMatched = cardPlaces.some(function(cp) {
          return normalizePlaceName(cp.name) === uName;
        });
        if (!alreadyMatched) unmatchedNames.push(recNames[ui]);
      }
      // Search all unmatched names in parallel
      var uPromises = unmatchedNames.slice(0, 5).map(function(uNameRaw) {
        var uQuery = searchDest ? (uNameRaw + " " + searchDest) : uNameRaw;
        return Promise.race([
          fetchGooglePlaces(uQuery, chatGpKey, chatBias),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, 4000); }),
        ]).catch(function() { return []; });
      });
      var uResults = await Promise.all(uPromises);
      for (var uri = 0; uri < uResults.length && cardPlaces.length < 5; uri++) {
        var uPlaces = uResults[uri];
        if (uPlaces && uPlaces.length > 0) {
          var up = uPlaces[0];
          var upName = up.displayName ? up.displayName.text || "" : "";
          var upPhotos = [];
          if (up.photos && up.photos.length > 0) upPhotos.push(up.photos[0].name || "");
          var upPrimaryType = up.primaryTypeDisplayName ? up.primaryTypeDisplayName.text || "" : "";
          cardPlaces.push({
            name: upName,
            address: up.formattedAddress || "",
            rating: up.rating || null,
            ratingCount: up.userRatingCount || null,
            placeId: up.id || "",
            lat: up.location ? up.location.latitude : null,
            lng: up.location ? up.location.longitude : null,
            types: up.types || [],
            primaryTypeLabel: upPrimaryType || undefined,
            photoRefs: upPhotos,
            _srcIdx: -1,
          });
        }
      }
    }
    // Clean up internal tracking field
    cardPlaces.forEach(function(p) { delete p._srcIdx; });
    chatResult.places = cardPlaces;
  } else if (Array.isArray(chatResult.recommended_places) && chatResult.recommended_places.length > 0 && chatGpKey) {
    // chatPlaces was empty but AI returned recommended_places — search individually in parallel
    var fbItems = chatResult.recommended_places.slice(0, 5);
    var fbNames = fbItems.map(function(p) { return typeof p === 'string' ? p : (p && p.name ? p.name : ''); });
    var fbReasons = fbItems.map(function(p) { return (typeof p === 'object' && p && p.reason) ? String(p.reason) : ''; });
    var fbPromises = fbNames.map(function(fbName) {
      var fbQuery = searchDest ? (String(fbName) + " " + searchDest) : String(fbName);
      return Promise.race([
        fetchGooglePlaces(fbQuery, chatGpKey, chatBias),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, 4000); }),
      ]).catch(function() { return []; });
    });
    var fbResults = await Promise.all(fbPromises);
    var fallbackCards = [];
    for (var fbi = 0; fbi < fbResults.length; fbi++) {
      var fbPlaces = fbResults[fbi];
      if (fbPlaces && fbPlaces.length > 0) {
        var fbp = fbPlaces[0];
        var fbpName = fbp.displayName ? fbp.displayName.text || "" : "";
        var fbpPhotos = [];
        if (fbp.photos && fbp.photos.length > 0) fbpPhotos.push(fbp.photos[0].name || "");
        var fbpPrimaryType = fbp.primaryTypeDisplayName ? fbp.primaryTypeDisplayName.text || "" : "";
        fallbackCards.push({
          name: fbpName,
          address: fbp.formattedAddress || "",
          rating: fbp.rating || null,
          ratingCount: fbp.userRatingCount || null,
          placeId: fbp.id || "",
          lat: fbp.location ? fbp.location.latitude : null,
          lng: fbp.location ? fbp.location.longitude : null,
          types: fbp.types || [],
          primaryTypeLabel: fbpPrimaryType || undefined,
          photoRefs: fbpPhotos,
          reason: fbReasons[fbi] || undefined,
        });
      }
    }
    if (fallbackCards.length > 0) chatResult.places = fallbackCards;
  }
  // Clean up recommended_places from response (client doesn't need it)
  delete chatResult.recommended_places;

  return chatResult;
}

// --- 3. Smart Trip Editing ---

async function handleEditTrip(payload) {
  const trip = payload.trip ?? {};
  const instruction = String(payload.instruction ?? "");
  const day = payload.day != null ? Number(payload.day) : null;
  const profile = payload.profile ?? {};

  const activities = trip.activities ?? [];
  const targets = day != null
    ? activities.filter((a) => Number(a.day) === day)
    : activities;

  const lockedLines = [];
  const editableLines = [];
  for (const a of targets) {
    const lk = a.locked || a.fixed;
    const entry =
      '  { "id": "' + String(a.id) +
      '", "day": ' + String(a.day) +
      ', "time": "' + String(a.time) +
      '", "title": "' + String(a.title) +
      '", "type": "' + String(a.type) +
      '", "description": "' + String(a.description ?? "") +
      '", "duration": ' + String(a.duration ?? 60) + " }";
    if (lk) {
      lockedLines.push(entry);
    } else {
      editableLines.push(entry);
    }
  }

  const interests = (profile.interests ?? []).join(", ");
  const dayScope = day != null ? "Day " + day : "all days";

  const schema = [
    "{",
    '  "activities": [',
    "    {",
    '      "id": "keep-existing-ids",',
    '      "day": 1,',
    '      "time": "HH:MM",',
    '      "title": "...",',
    '      "type": "activity|food|hotel|flight",',
    '      "description": "...",',
    '      "duration": 60,',
    '      "cost": "free|budget|moderate|premium"',
    "    }",
    "  ]",
    "}",
  ].join("\n");

  // Fetch Google Places for real alternatives
  var editGpKey = Deno.env.get(
    "GOOGLE_PLACES_API_KEY"
  );
  var editVenueCtx = "";
  if (editGpKey) {
    var editDest = String(trip.destination || "");
    var editQ = instruction + " in " + editDest;
    var editPlaces = await fetchGooglePlaces(
      editQ, editGpKey
    );
    if (editPlaces.length > 0) {
      editVenueCtx = "\n\nREAL PLACES:\n" +
        formatGooglePlaces(editPlaces) +
        "\nPrefer these real places.";
    }
  }

  const sysArr = [
    "You are Tripseek smart itinerary editor.",
    "You modify travel itineraries based on",
    "natural language.",
    "",
    "RULES:",
    "- Return ONLY valid JSON",
    "- NEVER include locked/fixed activities",
    "- They are shown in LOCKED ACTIVITIES below",
    "- Only return EDITABLE activities, modified",
    "- Preserve existing IDs for edited activities",
    "- New activities have no id field",
    "- Keep times realistic, non-overlapping",
    "- 30 min gaps between activities",
    "- Meal timing: breakfast 07:00-09:30,",
    "  lunch 12:00-13:30, dinner 19:00-21:30",
  ];
  const system = sysArr.join("\n");

  const userArr = [
    "TRIP: " + String(trip.destination) +
      ", " + String(trip.country),
    "TRAVELER: pace=" + String(profile.pace) +
      ", interests=" + interests,
    "",
    "LOCKED/FIXED (preserve exactly, DO NOT include in output):",
    lockedLines.length > 0 ? lockedLines.join("\n") : "None",
    "",
    "EDITABLE ACTIVITIES (Day " + dayScope + "):",
    "[",
    editableLines.join(",\n"),
    "]",
    "",
    'INSTRUCTION: "' + instruction + '"',
    editVenueCtx,
    "",
    "Return updated activities (scope: " +
      dayScope + "):",
    schema,
  ];
  const user = userArr.join("\n");

  var editResult = await claude(system, user, 4096);
  validateOutput(editResult, "edit_trip");
  return editResult;
}

// --- 4. Profile Enhancement ---

async function handleEnhanceProfile(payload) {
  const profile = payload.profile ?? {};
  const memory = payload.memory ?? [];

  const memLines = [];
  for (const m of memory) {
    memLines.push("- " + m.detail);
  }
  const memText = memLines.length > 0 ? memLines.join("\n") : "None yet";

  const system = [
    "You are analyzing a traveler profile to create a nuanced summary",
    "that will power personalized travel recommendations.",
    "",
    "Return ONLY valid JSON.",
  ].join("\n");

  const schema = [
    "{",
    '  "summary": "2-3 sentence description of this traveler",',
    '  "insights": [',
    '    "insight 1", "insight 2", "insight 3"',
    "  ],",
    '  "recommendationStyle": "Short phrase"',
    "}",
  ].join("\n");

  const userArr = [
    "RAW PROFILE:",
    "Pace: " + String(profile.pace),
    "Budget: " + String(profile.budget),
    "Flexibility: " + String(profile.flexibility),
    "Interests: " + (profile.interests ?? []).join(", "),
    "Dislikes: " + (profile.dislikes ?? []).join(", "),
    "Dietary: " + (
      (profile.dietaryRestrictions ?? []).join(", ") || "none"
    ),
    "Mobility: " + (
      (profile.mobilityNeeds ?? []).join(", ") || "none"
    ),
    "Travel with: " + String(
      profile.travelWith || "not specified"
    ),
    "Accommodation: " + String(
      profile.accommodationPreference || "not specified"
    ),
    "Rules: " + ((profile.absoluteRules ?? []).join(", ") || "none"),
    "",
    "LEARNED PREFERENCES:",
    memText,
    "",
    "Create a nuanced traveler summary. Return JSON:",
    schema,
  ];
  const user = userArr.join("\n");

  return claude(system, user, 1024);
}

// --- Import Place helpers ---

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, function(_, n) {
      return String.fromCharCode(Number(n));
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, n) {
      return String.fromCharCode(parseInt(n, 16));
    });
}

function extractHTMLServerSide(html) {
  var parts = [];
  var titleMatch = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );
  if (titleMatch) {
    parts.push("Title: " +
      decodeHTMLEntities(titleMatch[1].trim()));
  }
  var metaDesc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
  );
  if (metaDesc) {
    parts.push("Description: " +
      decodeHTMLEntities(metaDesc[1].trim()));
  }
  var ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
  );
  if (ogTitle) {
    parts.push("OG Title: " +
      decodeHTMLEntities(ogTitle[1].trim()));
  }
  var ogDesc = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i
  );
  if (ogDesc) {
    parts.push("OG Description: " +
      decodeHTMLEntities(ogDesc[1].trim()));
  }
  var ogSite = html.match(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i
  );
  if (ogSite) {
    parts.push("Site: " +
      decodeHTMLEntities(ogSite[1].trim()));
  }
  // JSON-LD structured data
  var jsonLdRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var ldMatch;
  while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      var ld = JSON.parse(ldMatch[1].trim());
      var ldStr = JSON.stringify(ld);
      if (ldStr.length < 3000) {
        parts.push("Structured Data: " + ldStr);
      }
    } catch (_e) { /* ignore */ }
  }

  // TikTok embedded video data
  var ttDataMatch = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (ttDataMatch) {
    try {
      var ttData = JSON.parse(ttDataMatch[1].trim());
      var videoDetail = ttData
        ?.__DEFAULT_SCOPE__
        ?.["webapp.video-detail"]
        ?.itemInfo?.itemStruct;
      if (videoDetail) {
        var ttParts = [];
        if (videoDetail.desc) {
          ttParts.push("Video Description: " +
            videoDetail.desc);
        }
        if (videoDetail.contents) {
          for (var ci = 0;
               ci < videoDetail.contents.length;
               ci++) {
            var c = videoDetail.contents[ci];
            if (c.desc) {
              ttParts.push("Content: " + c.desc);
            }
          }
        }
        // Location / POI data
        if (videoDetail.poi) {
          var poi = videoDetail.poi;
          if (poi.name) {
            ttParts.push("Tagged Location: " +
              poi.name);
          }
          if (poi.address) {
            ttParts.push("Location Address: " +
              poi.address);
          }
        }
        // Hashtags / challenges
        if (videoDetail.challenges &&
            videoDetail.challenges.length > 0) {
          var tags = videoDetail.challenges.map(
            function(ch) { return "#" + ch.title; }
          );
          ttParts.push("Hashtags: " +
            tags.join(" "));
        }
        // Text stickers / overlays
        if (videoDetail.textExtra &&
            videoDetail.textExtra.length > 0) {
          var extras = videoDetail.textExtra
            .filter(function(t) {
              return t.hashtagName || t.userUniqueId;
            })
            .map(function(t) {
              return t.hashtagName
                ? "#" + t.hashtagName
                : "@" + t.userUniqueId;
            });
          if (extras.length > 0) {
            ttParts.push("Tags: " +
              extras.join(" "));
          }
        }
        if (ttParts.length > 0) {
          parts.push("TikTok Video Data:\n" +
            ttParts.join("\n"));
        }
      }
    } catch (_e) { /* ignore parse errors */ }
  }

  // Instagram embedded data (_sharedData or similar)
  var igDataMatch = html.match(
    /window\._sharedData\s*=\s*(\{[\s\S]*?\});<\/script>/i
  ) || html.match(
    /window\.__additionalDataLoaded\s*\([^,]*,\s*(\{[\s\S]*?\})\s*\)/i
  );
  if (igDataMatch) {
    try {
      var igData = JSON.parse(igDataMatch[1]);
      var igStr = JSON.stringify(igData);
      if (igStr.length < 4000) {
        parts.push("Instagram Data: " + igStr);
      }
    } catch (_e) { /* ignore */ }
  }
  // Body text
  var bodyMatch = html.match(
    /<body[^>]*>([\s\S]*?)<\/body>/i
  );
  if (bodyMatch) {
    var bodyText = bodyMatch[1];
    bodyText = bodyText.replace(
      /<script[\s\S]*?<\/script>/gi, ""
    );
    bodyText = bodyText.replace(
      /<style[\s\S]*?<\/style>/gi, ""
    );
    bodyText = bodyText.replace(
      /<nav[\s\S]*?<\/nav>/gi, ""
    );
    bodyText = bodyText.replace(
      /<footer[\s\S]*?<\/footer>/gi, ""
    );
    bodyText = bodyText.replace(/<[^>]+>/g, " ");
    bodyText = decodeHTMLEntities(bodyText);
    bodyText = bodyText.replace(/\s+/g, " ").trim();
    if (bodyText.length > 3000) {
      bodyText = bodyText.slice(0, 3000) + "...";
    }
    if (bodyText) {
      parts.push("Page Content: " + bodyText);
    }
  }
  return parts.length > 0
    ? parts.join("\n") : null;
}

// Resolve short URLs (vm.tiktok.com etc.) to
// canonical URLs by following redirects
async function resolveShortUrl(url) {
  var shortPatterns =
    /vm\.tiktok\.com|vt\.tiktok\.com|bit\.ly|t\.co|goo\.gl|tinyurl\.com|is\.gd|ow\.ly|booking\.com\/Share/i;
  if (!shortPatterns.test(url)) return url;
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() {
      controller.abort();
    }, 8000);
    var resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 " +
          "like Mac OS X) AppleWebKit/605.1.15 " +
          "(KHTML, like Gecko) Version/17.0 " +
          "Mobile/15E148 Safari/604.1",
      },
    });
    clearTimeout(timeout);
    if (resp.url && resp.url !== url) return resp.url;
    return url;
  } catch (_e) {
    return url;
  }
}

// OEmbed for social platforms — gets video captions,
// titles, author info without needing to render JS
async function fetchSocialOEmbed(url) {
  var lower = url.toLowerCase();
  var oembedUrl = null;
  if (/tiktok\.com/.test(lower)) {
    oembedUrl = "https://www.tiktok.com/oembed?url=" +
      encodeURIComponent(url);
  } else if (/twitter\.com|\/\/x\.com/.test(lower)) {
    oembedUrl =
      "https://publish.twitter.com/oembed?url=" +
      encodeURIComponent(url);
  } else if (/instagram\.com/.test(lower)) {
    oembedUrl =
      "https://graph.facebook.com/v18.0/" +
      "instagram_oembed?url=" +
      encodeURIComponent(url) +
      "&access_token=IGQVJ" +
      "placeholder&omitscript=true";
    // IG oEmbed often fails without valid token;
    // fall through to HTML extraction if so
  }
  if (!oembedUrl) return null;
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() {
      controller.abort();
    }, 12000);
    var resp = await fetch(oembedUrl, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    var data = await resp.json();
    var parts = [];
    if (data.title) {
      parts.push("Video Caption: " + data.title);
    }
    if (data.author_name) {
      parts.push("Author: " + data.author_name);
    }
    if (data.provider_name) {
      parts.push("Platform: " + data.provider_name);
    }
    if (data.html) {
      var embedText = data.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim();
      if (embedText && embedText.length > 10) {
        parts.push("Embed Content: " + embedText);
      }
    }
    return parts.length > 0
      ? parts.join("\n") : null;
  } catch (_e) {
    return null;
  }
}

// Extract context from URL patterns — many sites
// encode place names right in the URL path
function extractUrlContext(url) {
  var parts = [];
  // Google Maps
  var gmaps = url.match(/place\/([^\/\?#]+)/);
  if (gmaps) {
    parts.push("Google Maps place: " +
      decodeURIComponent(
        gmaps[1].replace(/\+/g, " ")
      ));
  }
  // TripAdvisor
  var ta = url.match(
    /Reviews-[^-]+-([^-]+)-Reviews/i
  ) || url.match(
    /Attraction_Review[^"]*-([^-]+)-[^"]*\.html/i
  );
  if (ta) {
    parts.push("TripAdvisor: " +
      ta[1].replace(/_/g, " "));
  }
  // Yelp
  var yelp = url.match(
    /yelp\.com\/biz\/([^\/\?#]+)/i
  );
  if (yelp) {
    parts.push("Yelp business: " +
      yelp[1].replace(/-/g, " "));
  }
  // Airbnb
  var abnb = url.match(
    /airbnb\.[^\/]+\/rooms\/(\d+)/i
  );
  if (abnb) {
    parts.push("Airbnb listing ID: " + abnb[1]);
  }
  // Booking.com — standard hotel pages
  var booking = url.match(
    /booking\.com\/hotel\/[^\/]+\/([^\/\?#\.]+)/i
  );
  if (booking) {
    parts.push("Booking.com hotel: " +
      booking[1].replace(/-/g, " "));
  }
  // Booking.com — query params (label, ss, dest_id)
  if (/booking\.com/i.test(url)) {
    var ssMatch = url.match(/[?&]ss=([^&#]+)/i);
    if (ssMatch) {
      parts.push("Booking.com search: " +
        decodeURIComponent(
          ssMatch[1].replace(/\+/g, " ")
        ));
    }
    var labelMatch = url.match(
      /[?&]label=([^&#]+)/i
    );
    if (labelMatch) {
      parts.push("Booking label: " +
        decodeURIComponent(
          labelMatch[1].replace(/\+/g, " ")
        ));
    }
  }
  return parts.length > 0
    ? "URL Context:\n" + parts.join("\n") : null;
}

// Fetch HTML with platform-aware user agents.
// Tries two strategies for social media: Facebook
// crawler UA first (for OG tags), then mobile UA
// (for embedded JSON data like TikTok's rehydration)
async function fetchHTMLContent(url) {
  var fullUrl = url.startsWith("http")
    ? url : "https://" + url;
  var lower = url.toLowerCase();
  var isSocial = /tiktok\.com|instagram\.com|twitter\.com|\/\/x\.com|facebook\.com|fb\.com|threads\.net|reddit\.com/.test(lower);
  var isBookingSite = /booking\.com|airbnb\.|expedia\.|hotels\.com|agoda\.com|hostelworld\.com/.test(lower);

  // First attempt: Facebook crawler (gets rich OG tags)
  // Also use Facebook UA for booking sites — they serve
  // JS-only pages to Googlebot but rich OG tags to social
  var ua = (isSocial || isBookingSite)
    ? "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
    : "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  var result = await _fetchHTML(fullUrl, ua);

  // For TikTok: try mobile browser UA if first
  // attempt got thin content (< 500 chars extracted)
  if (isSocial && /tiktok\.com/.test(lower)) {
    var mobileUa =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 " +
      "like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 " +
      "Mobile/15E148 Safari/604.1";
    var mobileResult = await _fetchHTML(
      fullUrl, mobileUa
    );
    // Use mobile result if it has more content
    if (mobileResult &&
        (!result ||
         mobileResult.length > result.length)) {
      result = mobileResult;
    }
  }
  return result;
}

async function _fetchHTML(fullUrl, ua) {
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() {
      controller.abort();
    }, 15000);
    var resp = await fetch(fullUrl, {
      headers: {
        "User-Agent": ua,
        "Accept":
          "text/html,application/xhtml+xml," +
          "application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    var html = await resp.text();
    return extractHTMLServerSide(html);
  } catch (_e) {
    return null;
  }
}

// Main URL fetcher — combines OEmbed, HTML, and
// URL pattern extraction for maximum coverage
async function fetchAndExtractUrl(url) {
  // Resolve short URLs first (vm.tiktok.com etc.)
  var resolved = await resolveShortUrl(url);
  var sections = [];
  // 1. URL pattern context (instant, no network)
  var urlCtx = extractUrlContext(resolved);
  if (urlCtx) sections.push(urlCtx);
  // 2. OEmbed for social media (captions, titles)
  var oembed = await fetchSocialOEmbed(resolved);
  if (oembed) sections.push(oembed);
  // 3. HTML fetch (meta tags, structured data, text)
  var html = await fetchHTMLContent(resolved);
  if (html) sections.push(html);
  return sections.length > 0
    ? sections.join("\n\n") : null;
}

function detectMultiPlace(content) {
  var numbered = (
    content.match(/(?:^|\n)\s*\d+[\.\)]\s+/g) || []
  ).length;
  if (numbered >= 3) return true;
  var bullets = (
    content.match(/(?:^|\n)\s*[-\u2022*]\s+/g) || []
  ).length;
  if (bullets >= 3) return true;
  var multiKeyword =
    /(?:top|best)\s+\d+|recommendations|places to (?:visit|eat|see|go)|things to do|must[\s-]?(?:visit|see|try)/i;
  if (multiKeyword.test(content) &&
      content.length > 200) return true;
  return false;
}

async function verifyWithGooglePlaces(result, gpKey) {
  if (!gpKey || !result.found ||
      (result.confidence != null &&
       result.confidence < 50)) {
    return result;
  }
  var query = String(result.name || "") +
    " " + String(result.location || "");
  var places = await fetchGooglePlaces(query, gpKey);
  if (places.length === 0) return result;

  var vp = places[0];
  var vpName = vp.displayName
    ? vp.displayName.text : "";
  var aiLow = (result.name || "").toLowerCase();
  var gpLow = (vpName || "").toLowerCase();
  var nameMatch = false;
  if (aiLow.length >= 5 && gpLow.length >= 5) {
    nameMatch =
      aiLow.indexOf(gpLow.slice(0, 5)) >= 0 ||
      gpLow.indexOf(aiLow.slice(0, 5)) >= 0;
  } else {
    nameMatch = aiLow === gpLow;
  }
  if (nameMatch) {
    if (vpName) result.name = vpName;
    if (vp.formattedAddress) {
      result.address = vp.formattedAddress;
    }
    if (vp.rating) result.rating = vp.rating;
    if (vp.location) {
      result.lat = vp.location.latitude;
      result.lng = vp.location.longitude;
    }
    if (vp.id) result.placeId = vp.id;
    result.verified = true;
  } else {
    result.confidence =
      Math.min(result.confidence || 100, 60);
    result.verified = false;
  }

  // Always try to fetch a photo from the top Google
  // Places result, regardless of name match
  if (!result.photoUrl && vp.photos &&
      vp.photos.length > 0) {
    var photoRef = vp.photos[0].name;
    if (photoRef) {
      try {
        var photoResp = await fetch(
          "https://places.googleapis.com/v1/" +
          photoRef + "/media?maxWidthPx=800" +
          "&skipHttpRedirect=true" +
          "&key=" + gpKey
        );
        if (photoResp.ok) {
          var photoJson = await photoResp.json();
          if (photoJson.photoUri) {
            result.photoUrl = photoJson.photoUri;
          }
        }
      } catch (_e) {
        // Photo fetch failed — non-critical
      }
    }
  }
  // Also grab placeId if we don't have one yet
  if (!result.placeId && vp.id) {
    result.placeId = vp.id;
  }
  return result;
}

/** Try to extract a searchable place name from known
 *  URL patterns. Returns null if no name found. */
function extractPlaceNameFromUrl(url) {
  // Booking.com: /hotel/xx/hotel-name or /hotel/xx/hotel-name.en-gb.html
  var bk = url.match(
    /booking\.com\/hotel\/[^\/]+\/([^\/\?#]+?)(?:\.[a-z]{2}[\-a-z]*\.html|\.html|\?|#|$)/i
  );
  if (bk) return bk[1].replace(/-/g, " ");
  // Simpler Booking.com match
  var bk2 = url.match(
    /booking\.com\/hotel\/[^\/]+\/([^\/\?#\.]+)/i
  );
  if (bk2) return bk2[1].replace(/-/g, " ");
  // Google Maps place
  var gm = url.match(/place\/([^\/\?#]+)/);
  if (gm) return decodeURIComponent(
    gm[1].replace(/\+/g, " "));
  // TripAdvisor
  var ta = url.match(
    /Reviews-[^-]+-([^-]+)-Reviews/i
  ) || url.match(
    /Attraction_Review[^"]*-([^-]+)-[^"]*\.html/i
  );
  if (ta) return ta[1].replace(/_/g, " ");
  // Yelp
  var yp = url.match(
    /yelp\.com\/biz\/([^\/\?#]+)/i
  );
  if (yp) return yp[1].replace(/-/g, " ");
  // Airbnb
  var ab = url.match(
    /airbnb\.[^\/]+\/rooms\/(\d+)/i
  );
  if (ab) return "Airbnb " + ab[1];
  return null;
}

// --- 5. Import Place ---

async function handleImportPlace(payload) {
  var content = String(payload.content || "");
  var contentType = String(
    payload.contentType || "text"
  );
  var mimeType = String(
    payload.mimeType || "image/jpeg"
  );
  var gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  var _savedOriginalUrl = (contentType === "url")
    ? content : null;

  // ── Server-side URL fetching ──
  if (contentType === "url") {
    var originalUrl = content;
    var fetched = await fetchAndExtractUrl(content);
    if (fetched) {
      content = "Source URL: " + originalUrl +
        "\n\nExtracted page data:\n" + fetched;
    } else {
      // Last resort: try a basic HEAD request to at
      // least get the final redirected URL
      var resolved = await resolveShortUrl(originalUrl);
      content =
        "URL (page data could not be fully fetched" +
        " — identify from URL and any available " +
        "context):\nOriginal: " + originalUrl +
        (resolved !== originalUrl
          ? "\nResolved: " + resolved : "");
    }
    contentType = "text";
  }

  var singleSchema = [
    "{",
    '  "found": true,',
    '  "confidence": 90,',
    '  "name": "Exact place name",',
    '  "location": "City, Country",',
    '  "country": "Country name",',
    '  "category": "restaurant|attraction|hotel|' +
      'cafe|museum|park|other",',
    '  "description": "1-2 specific factual ' +
      'sentences.",',
    '  "notes": "Practical tip: hours, price ' +
      'range, or best time to visit.",',
    '  "emoji": "single emoji"',
    "}",
  ].join("\n");

  // ── Image handling ──
  if (contentType === "image_base64") {
    var imgSysLines = [
      "You identify travel places from images.",
      "",
      "RULES:",
      "- Think step-by-step before outputting JSON",
      "- Be honest - never invent a location",
      "- Set confidence 0-100 based on how certain " +
        "you are of the specific place",
      "- If truly unidentifiable, return found: false",
      "",
      "WHAT TO LOOK FOR:",
      "- Signage, text, menus with business names",
      "- Distinctive architecture or landmarks",
      "- Recognizable interiors (famous restaurants, " +
        "hotels, museums)",
      "- Well-known natural landmarks, beaches, parks",
      "- Social media screenshots: captions, " +
        "location tags, hashtags",
      "- Map screenshots: place names, pins",
      "- Travel/review app screenshots: place details",
      "- Food that is iconic to a specific restaurant " +
        "or region",
      "",
      "ONLY reject (found: false) if:",
      "- Completely generic with zero identifiable " +
        "features",
      "- Blurry or unreadable content",
      "- Not related to a place at all",
    ];
    var imgSystem = imgSysLines.join("\n");

    var imgPrompt = [
      "Examine this image carefully.",
      "",
      "First, write a <reasoning> block describing:",
      "- What you see: text, signs, landmarks, " +
        "location tags, distinctive features",
      "- Your best identification of the place",
      "- How confident you are and why",
      "",
      "Then output the JSON result.",
      "",
      "Example format:",
      "<reasoning>",
      "I can see a large red torii gate in water " +
        "with mountains behind it. This is the " +
        "iconic floating torii of Itsukushima " +
        "Shrine in Miyajima, Japan.",
      "</reasoning>",
      singleSchema,
    ].join("\n");

    var imgContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: content,
        },
      },
      { type: "text", text: imgPrompt },
    ];

    var imgResp = await client.messages.create({
      model: HAIKU,
      max_tokens: 1024,
      system: imgSystem,
      messages: [
        { role: "user", content: imgContent },
      ],
    });

    var imgText = imgResp.content[0].type === "text"
      ? imgResp.content[0].text : "";
    var imgResult = extractJSON(imgText);
    validateOutput(imgResult, "import_place");
    return await verifyWithGooglePlaces(
      imgResult, gpKey
    );
  }

  // ── Multi-place detection ──
  if (detectMultiPlace(content)) {
    var multiSysLines = [
      "You extract specific travel places from text.",
      "",
      "RULES:",
      "- Return ONLY valid JSON",
      "- Extract ALL specific, named places",
      "- Each place needs a confidence score 0-100",
      "- Only include places with confidence >= 70%",
      "- Never invent places - only extract what is" +
        " explicitly mentioned",
      "- Include city/country when mentioned or" +
        " clearly inferable",
      "- Maximum 10 places",
      "- If no specific places, return found: false",
    ];
    var multiSystem = multiSysLines.join("\n");

    var multiSchema = [
      "{",
      '  "found": true,',
      '  "places": [',
      "    {",
      '      "confidence": 90,',
      '      "name": "Exact place name",',
      '      "location": "City, Country",',
      '      "country": "Country name",',
      '      "category": "restaurant|attraction|' +
        'hotel|cafe|museum|park|other",',
      '      "description": "1-2 factual sentences.",',
      '      "notes": "Practical tip if available.",',
      '      "emoji": "single emoji"',
      "    }",
      "  ]",
      "}",
    ].join("\n");

    var multiUser = [
      "Extract all specific travel places from " +
        "this text:",
      "",
      content,
      "",
      "Return JSON with ALL identified places:",
      multiSchema,
    ].join("\n");

    var multiResult = await claude(
      multiSystem, multiUser, 2048, undefined, HAIKU
    );
    if (typeof multiResult.found !== "boolean") {
      multiResult.found = false;
    }
    if (!Array.isArray(multiResult.places)) {
      multiResult.places = [];
    }
    multiResult.places = multiResult.places.filter(
      function(p) {
        return p && p.confidence >= 70 && p.name;
      }
    );
    if (multiResult.places.length === 0) {
      multiResult.found = false;
    }
    // Verify top places with Google (limit 5)
    if (gpKey && multiResult.found) {
      var vLimit = Math.min(
        multiResult.places.length, 5
      );
      for (var vi = 0; vi < vLimit; vi++) {
        multiResult.places[vi].found = true;
        multiResult.places[vi] =
          await verifyWithGooglePlaces(
            multiResult.places[vi], gpKey
          );
      }
    }
    return multiResult;
  }

  // ── Single place extraction ──
  var singleSysLines = [
    "You identify specific travel places from " +
      "content. You are an expert at finding place " +
      "names in social media posts, travel content, " +
      "and web pages.",
    "",
    "RULES:",
    "- Return ONLY valid JSON",
    "- Be honest - never invent a location",
    "- If confidence is below 60%, return " +
      "found: false",
    "- Extract the primary place discussed",
    "- Look for: place names, addresses, " +
      "restaurants, hotels, attractions, landmarks," +
      " cities, neighborhoods, beaches, parks",
    "",
    "CONTENT PRIORITY (check in order):",
    "- Tagged Location / POI data (highest priority)",
    "- Video description / caption text",
    "- Hashtags (often contain place names: " +
      "#BurjKhalifa #Tokyo #EiffelTower)",
    "- Page title and meta description",
    "- OG tags and structured data",
    "- Body text content",
    "- URL path segments",
    "",
    "SOCIAL MEDIA TIPS:",
    "- TikTok/Instagram/Twitter posts about places " +
      "often put the place in hashtags, not captions",
    "- Hashtags like #Dubai #Tokyo #Bali indicate " +
      "a city/destination — use them",
    "- Hashtags like #BurjKhalifa #Colosseum " +
      "#GoldenGateBridge are specific landmarks",
    "- Caption + hashtags together give context: " +
      "'amazing views' + #BurjKhalifa = Burj Khalifa",
    "- Location tags (Tagged Location) are the most " +
      "reliable identifier",
    "- Author bio/name can hint at location",
    "",
    "CONFIDENCE GUIDE:",
    "- Tagged Location with name: 95%",
    "- Specific place named in caption: 90%",
    "- Specific place in hashtag: 85%",
    "- City/country only (from hashtags): 75%",
    "- Vague hints only: found: false",
  ];
  var singleSystem = singleSysLines.join("\n");

  var singleUser = [
    "Identify the travel place from this content. " +
      "Pay special attention to hashtags, location " +
      "tags, and video descriptions — these are the " +
      "most reliable signals in social media content.",
    "",
    content,
    "",
    "Return:",
    singleSchema,
  ].join("\n");

  var textResult = await claude(
    singleSystem, singleUser, 512, undefined, HAIKU
  );
  validateOutput(textResult, "import_place");
  var verified = await verifyWithGooglePlaces(
    textResult, gpKey
  );

  // ── URL fallback: if AI couldn't identify from page
  // content but we can extract a name from the URL,
  // search Google Places directly ──
  if (_savedOriginalUrl && gpKey &&
      (!verified.name || verified.name.trim() === "" ||
       (typeof verified.confidence === "number" &&
        verified.confidence < 50))) {
    var urlName = extractPlaceNameFromUrl(
      _savedOriginalUrl
    );
    if (urlName) {
      var gpResults = await fetchGooglePlaces(
        urlName, gpKey
      );
      if (gpResults.length > 0) {
        var gp = gpResults[0];
        var gpName = gp.displayName
          ? gp.displayName.text : "";
        if (gpName) {
          verified.found = true;
          verified.name = gpName;
          verified.confidence = 85;
          if (gp.formattedAddress) {
            verified.address = gp.formattedAddress;
            verified.location = gp.formattedAddress
              .split(",").slice(-2).join(",").trim();
          }
          if (gp.rating) verified.rating = gp.rating;
          if (gp.location) {
            verified.lat = gp.location.latitude;
            verified.lng = gp.location.longitude;
          }
          if (gp.id) verified.placeId = gp.id;
          verified.verified = true;
          // Detect category from Google types
          var gpTypes = (gp.types || []).join(" ");
          if (/restaurant|food|meal|bakery|cafe/
              .test(gpTypes)) {
            verified.category = "dining";
            verified.type = "food";
          } else if (/bar|night_club/
              .test(gpTypes)) {
            verified.category = "bar";
            verified.type = "food";
          } else if (/lodging|hotel|motel|resort/
              .test(gpTypes)) {
            verified.category = "accommodation";
            verified.type = "hotel";
          } else if (/museum|art_gallery/
              .test(gpTypes)) {
            verified.category = "culture";
            verified.type = "activity";
          } else if (/amusement_park|water_park|theme_park|zoo|aquarium|bowling_alley|movie_theater|casino/
              .test(gpTypes)) {
            verified.category = "entertainment";
            verified.type = "activity";
          } else if (/gym|stadium|spa|golf_course/
              .test(gpTypes)) {
            verified.category = "sport";
            verified.type = "activity";
          } else if (/park|garden|natural_feature/
              .test(gpTypes)) {
            verified.category = "nature";
            verified.type = "activity";
          } else if (/shopping_mall|store|clothing_store/
              .test(gpTypes)) {
            verified.category = "shopping";
            verified.type = "activity";
          } else {
            verified.category = "attraction";
            verified.type = "activity";
          }
          // Fetch photo
          if (gp.photos && gp.photos.length > 0) {
            var pr = gp.photos[0].name;
            if (pr) {
              try {
                var pResp = await fetch(
                  "https://places.googleapis.com/v1/" +
                  pr + "/media?maxWidthPx=800" +
                  "&skipHttpRedirect=true&key=" + gpKey
                );
                if (pResp.ok) {
                  var pj = await pResp.json();
                  if (pj.photoUri) {
                    verified.photoUrl = pj.photoUri;
                  }
                }
              } catch (_e) {}
            }
          }
        }
      }
    }
  }

  return verified;
}

// --- 5b. Import Booking (place + booking details) ---

async function handleImportBooking(payload) {
  var content = String(payload.content || "");
  var contentType = String(payload.contentType || "text");
  var gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

  // Server-side URL fetching (same as handleImportPlace)
  if (contentType === "url") {
    var originalUrl = content;
    var fetched = await fetchAndExtractUrl(content);
    if (fetched) {
      content = "Source URL: " + originalUrl +
        "\n\nExtracted page data:\n" + fetched;
    } else {
      var resolved = await resolveShortUrl(originalUrl);
      content =
        "URL (page data could not be fully fetched" +
        " — identify from URL and any available " +
        "context):\nOriginal: " + originalUrl +
        (resolved !== originalUrl
          ? "\nResolved: " + resolved : "");
    }
    contentType = "text";
  }

  var bookingSchema = [
    "{",
    '  "found": true,',
    '  "confidence": 90,',
    '  "name": "Exact place/business name",',
    '  "location": "City, Country",',
    '  "country": "Country name",',
    '  "category": "restaurant|attraction|hotel|' +
      'cafe|museum|park|other",',
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

  var sysLines = [
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
      "listing or search page), return found: false",
    "- If confidence is below 60%, return found: false",
  ];

  var userPrompt = [
    "Extract the travel place and booking details " +
      "from this content:",
    "",
    content,
    "",
    "Return:",
    bookingSchema,
  ].join("\n");

  var result = await claude(
    sysLines.join("\n"), userPrompt, 512, undefined, HAIKU
  );
  validateOutput(result, "import_booking");
  return await verifyWithGooglePlaces(result, gpKey);
}

// --- 6. Rank Places ---

async function handleRankPlaces(payload) {
  const places = payload.places ?? [];
  const profile = payload.profile ?? {};
  const tripContext = payload.tripContext
    ? String(payload.tripContext) : "";

  const placeLines = [];
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    placeLines.push(
      String(i) + ": " +
      String(p.name ?? p.title ?? "place") +
      " (" + String(p.category ?? p.type ?? "place") + ")" +
      " - " + String(p.description ?? "")
    );
  }

  const system = [
    "You are ranking travel places for a specific traveler",
    "based on their profile and context.",
    "",
    "Return ONLY valid JSON.",
  ].join("\n");

  const schema = [
    "{",
    '  "ranked": [',
    '    { "index": 0, "score": 95, "reason": "One short phrase: why this fits you." }',
    "  ]",
    "}",
  ].join("\n");

  const decisionPri = (profile.decisionPriorities ?? []).join(", ");
  const userArr = [
    "TRAVELER:",
    "Pace: " + String(profile.pace) +
      ", Budget: " + String(profile.budget),
    "Interests: " + (profile.interests ?? []).join(", "),
    "Dislikes: " + (profile.dislikes ?? []).join(", "),
    "Dietary: " + (
      (profile.dietaryRestrictions ?? []).join(", ") || "none"
    ),
    "Crowd tolerance: " + String(profile.crowdTolerance || "fine"),
    "Food importance: " + String(profile.foodImportance || "moderate"),
    decisionPri ? "Decision priorities: " + decisionPri : "",
  ].filter(Boolean);
  if (tripContext) {
    userArr.push("", "TRIP CONTEXT:", tripContext);
  }
  userArr.push("", "PLACES TO RANK:");
  for (const line of placeLines) {
    userArr.push(line);
  }
  userArr.push(
    "",
    "Rank by fit for this traveler. Score 0-100. Return:",
    schema
  );
  const user = userArr.join("\n");

  return claude(system, user, 1024);
}

// --- 7. Google Places ---

async function handleGooglePlaces(payload) {
  var query = String(payload.query || "");
  var location = String(payload.location || "");
  var placeType = String(payload.placeType || "");
  var apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured in Supabase secrets"
    );
  }
  var searchQ = query + (location ? " in " + location : "");
  var baseUrl = "https://maps.googleapis.com" +
    "/maps/api/place/textsearch/json";
  var url = baseUrl +
    "?query=" + encodeURIComponent(searchQ) +
    "&key=" + apiKey;
  if (placeType) {
    url += "&type=" + encodeURIComponent(placeType);
  }
  var resp = await fetch(url);
  var data = await resp.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error("Google Places API error: " + data.status);
  }
  var places = (data.results || []).slice(0, 20).map((p) => ({
    name: p.name,
    address: p.formatted_address,
    rating: p.rating,
    ratingCount: p.user_ratings_total,
    types: p.types,
    placeId: p.place_id,
    lat: p.geometry && p.geometry.location
      ? p.geometry.location.lat : null,
    lng: p.geometry && p.geometry.location
      ? p.geometry.location.lng : null,
    openNow: p.opening_hours
      ? p.opening_hours.open_now : null,
  }));
  return { places };
}

// --- 7a. Flight Search (SerpAPI → Google Flights) ---

// Maps common city/region names to their IATA city or airport codes.
// SerpAPI Google Flights requires IATA codes, not full city names.
var CITY_TO_IATA: Record<string, string> = {
  // North America
  "new york": "NYC", "new york city": "NYC", "nyc": "NYC",
  "los angeles": "LAX", "la": "LAX",
  "chicago": "ORD",
  "san francisco": "SFO", "sf": "SFO",
  "miami": "MIA", "hollywood": "FLL", "fort lauderdale": "FLL",
  "toronto": "YYZ",
  "vancouver": "YVR",
  "montreal": "YUL",
  "calgary": "YYC",
  "ottawa": "YOW",
  "washington": "DCA", "washington dc": "DCA",
  "boston": "BOS",
  "seattle": "SEA",
  "dallas": "DFW",
  "houston": "IAH",
  "atlanta": "ATL",
  "denver": "DEN",
  "phoenix": "PHX",
  "las vegas": "LAS",
  "orlando": "MCO",
  "san diego": "SAN",
  "portland": "PDX",
  "minneapolis": "MSP",
  "detroit": "DTW",
  "philadelphia": "PHL",
  "charlotte": "CLT",
  "salt lake city": "SLC",
  "mexico city": "MEX",
  "cancun": "CUN",
  // Europe
  "london": "LON",
  "paris": "PAR",
  "amsterdam": "AMS",
  "frankfurt": "FRA",
  "madrid": "MAD",
  "barcelona": "BCN",
  "rome": "FCO",
  "milan": "MIL",
  "zurich": "ZRH",
  "vienna": "VIE",
  "berlin": "BER",
  "munich": "MUC",
  "brussels": "BRU",
  "lisbon": "LIS",
  "athens": "ATH",
  "oslo": "OSL",
  "stockholm": "STO",
  "copenhagen": "CPH",
  "helsinki": "HEL",
  "warsaw": "WAW",
  "prague": "PRG",
  "budapest": "BUD",
  "dublin": "DUB",
  "edinburgh": "EDI",
  "manchester": "MAN",
  "istanbul": "IST",
  "moscow": "MOW",
  // Middle East & Africa
  "dubai": "DXB",
  "abu dhabi": "AUH",
  "doha": "DOH",
  "riyadh": "RUH",
  "tel aviv": "TLV",
  "cairo": "CAI",
  "casablanca": "CMN",
  "nairobi": "NBO",
  "johannesburg": "JNB",
  "cape town": "CPT",
  // Asia Pacific
  "tokyo": "TYO",
  "osaka": "KIX",
  "seoul": "SEL",
  "beijing": "BJS",
  "shanghai": "SHA",
  "hong kong": "HKG",
  "singapore": "SIN",
  "bangkok": "BKK",
  "kuala lumpur": "KUL",
  "jakarta": "CGK",
  "manila": "MNL",
  "taipei": "TPE",
  "delhi": "DEL", "new delhi": "DEL",
  "mumbai": "BOM",
  "bangalore": "BLR",
  "sydney": "SYD",
  "melbourne": "MEL",
  "brisbane": "BNE",
  "auckland": "AKL",
  // South America
  "sao paulo": "SAO", "são paulo": "SAO",
  "rio de janeiro": "RIO",
  "buenos aires": "BUE",
  "bogota": "BOG", "bogotá": "BOG",
  "lima": "LIM",
  "santiago": "SCL",
};

function cityToIata(cityName: string): string {
  var lower = cityName.toLowerCase().trim();
  // Direct match first
  if (CITY_TO_IATA[lower]) return CITY_TO_IATA[lower];
  // If already 3 chars, assume it's an IATA code — return uppercase
  if (/^[a-z]{3}$/i.test(lower)) return lower.toUpperCase();
  // Partial match — check if the city name contains a known key
  for (var key of Object.keys(CITY_TO_IATA)) {
    if (lower.includes(key) || key.includes(lower)) return CITY_TO_IATA[key];
  }
  // Fallback: return as-is (user may have typed an airport code)
  return cityName.trim();
}

async function handleSearchFlights(payload) {
  var origin = String(payload.origin || "");
  var destination = String(payload.destination || "");
  var departureDate = String(payload.departureDate || "");
  var returnDate = String(payload.returnDate || "");

  if (!origin || !destination) throw new Error("origin and destination are required");

  // Convert city names to IATA codes for SerpAPI
  origin = cityToIata(origin);
  destination = cityToIata(destination);

  var serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) throw new Error("SERPAPI_KEY not configured");

  var params = new URLSearchParams({
    engine: "google_flights",
    departure_id: origin,
    arrival_id: destination,
    outbound_date: departureDate,
    api_key: serpApiKey,
    currency: "USD",
    hl: "en",
  });
  if (returnDate) {
    params.set("return_date", returnDate);
    params.set("type", "1"); // round trip
  } else {
    params.set("type", "2"); // one way
  }

  var url = "https://serpapi.com/search?" + params.toString();
  var resp = await fetch(url);
  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error("SerpAPI error: " + resp.status + " " + errText.substring(0, 200));
  }
  var data = await resp.json();

  // Extract best_flights and other_flights, take top 3 total
  var allFlights = [
    ...(data.best_flights || []),
    ...(data.other_flights || []),
  ].slice(0, 3);

  var flights = allFlights.map((f) => {
    var leg = (f.flights || [])[0] || {};
    return {
      airline: leg.airline || f.airline || "",
      flightNumber: leg.flight_number || "",
      departureAirport: leg.departure_airport?.id || origin,
      arrivalAirport: leg.arrival_airport?.id || destination,
      departureTime: leg.departure_airport?.time || "",
      arrivalTime: leg.arrival_airport?.time || "",
      duration: f.total_duration || leg.duration || 0,
      stops: (f.flights || []).length - 1,
      price: f.price || null,
      airlineLogo: leg.airline_logo || "",
    };
  });

  return { flights };
}

// --- 7b. Destination Photo ---
// Uses New Places API v1 Text Search to find a high-quality scenic photo
// for a destination city. Returns the photo URL directly so the API key
// never leaves the server.

async function handleDestinationPhoto(payload) {
  var destination = String(payload.destination || "");
  if (!destination) throw new Error("destination is required");

  var apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  // Use New Places API v1 Text Search — returns photos[i].name resource paths
  var searchUrl = "https://places.googleapis.com/v1/places:searchText";
  var searchBody = {
    textQuery: destination + " landmark scenic",
    maxResultCount: 5,
  };
  var searchResp = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.photos",
    },
    body: JSON.stringify(searchBody),
  });
  if (!searchResp.ok) {
    var errText = await searchResp.text();
    throw new Error("Places Text Search failed: " + searchResp.status + " " + errText);
  }
  var searchData = await searchResp.json();
  var places = searchData.places || [];

  // Walk results to find first usable photo resource name
  var photoName = null;
  for (var i = 0; i < places.length; i++) {
    var photos = places[i].photos || [];
    if (photos.length > 0 && photos[0].name) {
      photoName = photos[0].name;
      break;
    }
  }

  if (!photoName) return { url: null };

  // Build photo URL using Places API v1 media endpoint
  var photoUrl = "https://places.googleapis.com/v1/" + photoName + "/media?maxWidthPx=1600&key=" + apiKey;
  return { url: photoUrl };
}

// --- 8. Natural Language Place Search ---

async function handleNaturalSearch(payload) {
  var query = String(payload.query || "");
  var destination = String(payload.destination || "");
  var profile = payload.profile || {};
  var interests = (profile.interests || []).join(", ") || "general";
  var budget = String(profile.budget || "moderate");

  var sysArr = [
    "You suggest specific real places that match a",
    "natural-language travel search query.",
    "",
    "Return ONLY valid JSON.",
    "Only suggest real, well-known places.",
    "Never invent or hallucinate place names.",
    "If you are uncertain, omit that place.",
  ];
  var system = sysArr.join("\n");

  var schema = [
    "{",
    '  "suggestions": [',
    "    {",
    '      "title": "Exact real place name",',
    '      "category": "nature|culture|food|shopping|' +
      'nightlife|adventure|other",',
    '      "type": "activity",',
    '      "description": "1-2 specific factual sentences.",',
    '      "cost": "free|budget|moderate|premium",',
    '      "tags": ["tag1", "tag2"]',
    "    }",
    "  ]",
    "}",
  ].join("\n");

  // Fetch real candidates from Google Places
  var nsKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  var gpCtx = "";
  if (nsKey) {
    var nsQ = query + " in " + destination;
    var nsPlaces = await fetchGooglePlaces(
      nsQ, nsKey
    );
    if (nsPlaces.length > 0) {
      gpCtx = "\n\nREAL PLACES FROM GOOGLE:\n" +
        formatGooglePlaces(nsPlaces) +
        "\nPrefer these real places in your response.";
    }
  }

  var userArr = [
    "SEARCH: " + query,
    "DESTINATION: " + destination,
    "TRAVELER INTERESTS: " + interests,
    "BUDGET: " + budget + gpCtx,
    "",
    "Suggest 5-8 specific real places that match this",
    "search in " + destination + ".",
    "Return JSON:",
    schema,
  ];
  var user = userArr.join("\n");

  return claude(system, user, 1024);
}
// --- Place Photo ---

async function handlePlacePhoto(payload) {
  var ref = String(payload.reference || "");
  var maxW = Number(payload.maxWidth || 800);
  var gKey = Deno.env.get(
    "GOOGLE_PLACES_API_KEY"
  ) || "";
  if (!gKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured"
    );
  }
  if (!ref) {
    throw new Error("Missing photo reference");
  }
  var url = "https://places.googleapis.com/v1/"
    + ref
    + "/media?maxWidthPx=" + maxW
    + "&key=" + gKey;
  return { url: url };
}

// --- Resolve photo URL server-side (keeps API key on server) ---

async function handleResolvePhotoUrl(payload) {
  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");
  var reference = String(payload.reference || "");
  if (!reference) throw new Error("reference is required");
  var maxW = Number(payload.maxWidth) || 1024;
  var resp = await fetch(
    "https://places.googleapis.com/v1/" + reference + "/media" +
    "?maxWidthPx=" + maxW +
    "&skipHttpRedirect=true" +
    "&key=" + gKey
  );
  if (!resp.ok) {
    throw new Error("Photo fetch failed: " + resp.status);
  }
  var data = await resp.json();
  return { url: data.photoUri || null };
}

// --- Place Details ---

async function handlePlaceDetails(payload) {
  var placeId = String(
    payload.placeId || ""
  );
  var gKey = Deno.env.get(
    "GOOGLE_PLACES_API_KEY"
  ) || "";
  if (!gKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured"
    );
  }
  if (!placeId) {
    throw new Error("Missing placeId");
  }
  var url =
    "https://places.googleapis.com/v1/places/"
    + placeId;
  var fields = [
    "id",
    "displayName",
    "formattedAddress",
    "shortFormattedAddress",
    "location",
    "rating",
    "userRatingCount",
    "priceLevel",
    "types",
    "primaryTypeDisplayName",
    "currentOpeningHours",
    "websiteUri",
    "nationalPhoneNumber",
    "googleMapsUri",
    "photos",
    "editorialSummary",
    "reviews",
    "generativeSummary",
    "businessStatus",
    "reservable",
    "dineIn",
    "takeout",
    "delivery",
  ].join(",");
  var resp = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": gKey,
      "X-Goog-FieldMask": fields,
    },
  });
  if (!resp.ok) {
    throw new Error(
      "Places Details failed: "
      + resp.status
    );
  }
  var data = await resp.json();
  return data;
}

// --- Places Nearby ---

async function handlePlacesNearby(payload) {
  var lat = Number(payload.lat || 0);
  var lng = Number(payload.lng || 0);
  var radius = Number(payload.radius || 15000);
  var type = String(payload.type || "");
  var keyword = String(payload.keyword || "");
  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey) {
    throw new Error("GOOGLE_PLACES_API_KEY not configured");
  }

  var fields = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.types",
    "places.primaryTypeDisplayName",
    "places.location",
    "places.photos",
  ].join(",");

  // Always use searchText — it supports full keyword queries AND hard geographic
  // constraints via locationRestriction. searchNearby only supports type filtering,
  // which strips away the semantic meaning of queries like "hidden gems" or
  // "artisan cafes", returning generic distance-ranked results instead.
  var query = keyword || (type ? type : "popular restaurants cafes attractions");
  var url = "https://places.googleapis.com/v1/places:searchText";
  var body = {
    textQuery: query,
    pageSize: 20,
  };
  if (lat && lng) {
    // locationRestriction (rectangle) is a HARD constraint — Google only returns
    // places within the rectangle. locationBias is just a soft hint that Google
    // can and does ignore, returning results from other countries.
    var radiusKm = Math.max(radius, 5000) / 1000;
    var dLat = radiusKm / 111;
    var dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    body.locationRestriction = {
      rectangle: {
        low: { latitude: lat - dLat, longitude: lng - dLng },
        high: { latitude: lat + dLat, longitude: lng + dLng },
      },
    };
  }
  console.log("[places_nearby] Request:", JSON.stringify({ url, query, lat, lng, radiusKm: Math.max(radius, 5000) / 1000 }));
  var resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": gKey,
      "X-Goog-FieldMask": fields,
    },
    body: JSON.stringify(body),
  });
  var respText = await resp.text();
  console.log("[places_nearby] Google response status:", resp.status, "body length:", respText.length, "body preview:", respText.substring(0, 500));
  if (!resp.ok) {
    console.error("[places_nearby] Google error:", resp.status, respText);
    throw new Error("Places search failed: " + resp.status + " " + respText);
  }
  var data = JSON.parse(respText);
  var placeCount = (data.places || []).length;
  console.log("[places_nearby] Found", placeCount, "places");
  if (placeCount === 0) {
    console.warn("[places_nearby] Zero results. Raw response:", respText.substring(0, 1000));
  }
  return { places: data.places || [] };
}

/**
 * Map a keyword string to Google Place types for searchNearby.
 * searchNearby requires explicit types — it doesn't support free-text keywords.
 */
function keywordToPlaceTypes(keyword) {
  var kw = (keyword || "").toLowerCase();
  var types = [];
  if (/restaurant|dining|food|eat|lunch|dinner|breakfast/.test(kw)) types.push("restaurant");
  if (/cafe|coffee|espresso|brunch/.test(kw)) types.push("cafe");
  if (/bar|cocktail|pub|beer|wine|nightlife/.test(kw)) types.push("bar");
  if (/night.?club|nightclub|club/.test(kw)) types.push("night_club");
  if (/bakery|pastry|bread/.test(kw)) types.push("bakery");
  if (/museum/.test(kw)) types.push("museum");
  if (/art.?gallery|gallery/.test(kw)) types.push("art_gallery");
  if (/tourist|attraction|landmark|sight/.test(kw)) types.push("tourist_attraction");
  if (/park|garden|nature|outdoor/.test(kw)) types.push("park");
  if (/shop|market|boutique|store/.test(kw)) types.push("store");
  if (/spa|wellness|massage/.test(kw)) types.push("spa");
  if (/hotel|stay|accommodation/.test(kw)) types.push("lodging");
  // If we matched multiple OR matched nothing, broaden the search
  if (types.length === 0) {
    types = ["restaurant", "tourist_attraction", "museum", "art_gallery", "bar"];
  }
  // searchNearby allows max 50 types but Google recommends keeping it small
  return types.slice(0, 5);
}

// --- City Autocomplete ---

async function handleCityAutocomplete(payload) {
  var query = String(payload.query || "");
  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey || query.trim().length < 2) return { suggestions: [] };

  var url = "https://places.googleapis.com/v1/places:autocomplete";
  var body = {
    input: query,
    includedPrimaryTypes: ["locality", "administrative_area_level_1", "administrative_area_level_2"],
    languageCode: "en",
  };

  try {
    var resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gKey,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { suggestions: [] };
    var data = await resp.json();

    var suggestions = (data.suggestions || []).slice(0, 5).map((s) => {
      var pred = s.placePrediction || {};
      var structured = pred.structuredFormat || {};
      var main = (structured.mainText || {}).text || (pred.text || {}).text || query;
      var secondary = (structured.secondaryText || {}).text || "";
      var display = secondary ? main + ", " + secondary : main;
      return { display: display, city: main };
    });

    return { suggestions: suggestions };
  } catch (_e) {
    return { suggestions: [] };
  }
}

// --- Photo Cache (shared across all users) ---

function getSupabaseAdmin() {
  var url = Deno.env.get("SUPABASE_URL") || "";
  var key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key);
}

async function handlePhotoCacheLookup(payload) {
  var placeIds = payload.placeIds || [];
  if (placeIds.length === 0) return { photos: {} };

  var sb = getSupabaseAdmin();
  var { data, error } = await sb
    .from("photo_cache")
    .select("place_id, photo_url")
    .in("place_id", placeIds);

  if (error) {
    console.error("[photo_cache] lookup error:", error.message);
    return { photos: {} };
  }

  var photos = {};
  for (var row of (data || [])) {
    photos[row.place_id] = row.photo_url;
  }
  return { photos: photos };
}

async function handlePhotoCacheStore(payload) {
  var placeId = String(payload.placeId || "");
  var photoRef = String(payload.photoRef || "");
  if (!placeId || !photoRef) {
    throw new Error("placeId and photoRef are required");
  }

  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  // 1. Fetch the photo from Google
  var photoUrl = "https://places.googleapis.com/v1/"
    + photoRef
    + "/media?maxWidthPx=400&skipHttpRedirect=true&key=" + gKey;

  var photoResp = await fetch(photoUrl);
  if (!photoResp.ok) {
    throw new Error("Google photo fetch failed: " + photoResp.status);
  }
  var photoData = await photoResp.json();
  var googleUrl = photoData.photoUri;
  if (!googleUrl) throw new Error("No photoUri in response");

  // 2. Download the actual image
  var imgResp = await fetch(googleUrl);
  if (!imgResp.ok) {
    throw new Error("Image download failed: " + imgResp.status);
  }
  var imgBlob = await imgResp.blob();
  var contentType = imgResp.headers.get("content-type") || "image/jpeg";
  var ext = contentType.includes("png") ? "png" : "jpg";
  var storagePath = "photos/" + placeId.replace(/[^a-zA-Z0-9_-]/g, "_") + "." + ext;

  // 3. Upload to Supabase Storage
  var sb = getSupabaseAdmin();
  var { error: uploadErr } = await sb.storage
    .from("photo-cache")
    .upload(storagePath, imgBlob, {
      contentType: contentType,
      upsert: true,
    });

  if (uploadErr) {
    console.error("[photo_cache] upload error:", uploadErr.message);
    // Fall back to returning the direct Google URL (temporary but functional)
    var fallbackResult = await sb
      .from("photo_cache")
      .upsert({
        place_id: placeId,
        photo_url: googleUrl,
        photo_ref: photoRef,
      }, { onConflict: "place_id" });
    if (fallbackResult.error) {
      console.error("[photo_cache] fallback insert error:", fallbackResult.error.message);
    }
    return { url: googleUrl, stored: false };
  }

  // 4. Get the public URL
  var { data: publicUrlData } = sb.storage
    .from("photo-cache")
    .getPublicUrl(storagePath);
  var permanentUrl = publicUrlData.publicUrl;

  // 5. Store in cache table
  var { error: insertErr } = await sb
    .from("photo_cache")
    .upsert({
      place_id: placeId,
      photo_url: permanentUrl,
      photo_ref: photoRef,
    }, { onConflict: "place_id" });

  if (insertErr) {
    console.error("[photo_cache] insert error:", insertErr.message);
  }

  return { url: permanentUrl, stored: true };
}

// --- Photo Street View Fallback ---

async function handlePhotoStreetView(payload) {
  var placeId = String(payload.placeId || "");
  var lat = Number(payload.lat);
  var lng = Number(payload.lng);

  if (!placeId || isNaN(lat) || isNaN(lng)) throw new Error("placeId, lat, lng required");

  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  var sb = getSupabaseAdmin();

  // Check shared cache first
  var { data: cached } = await sb.from("photo_cache").select("photo_url").eq("place_id", placeId).maybeSingle();
  if (cached?.photo_url) return { url: cached.photo_url, stored: true };

  // Check Street View metadata (free endpoint — no charge)
  var metaUrl = "https://maps.googleapis.com/maps/api/streetview/metadata?location=" + lat + "," + lng + "&source=outdoor&key=" + gKey;
  var metaResp = await fetch(metaUrl);
  if (!metaResp.ok) throw new Error("Street View metadata failed: " + metaResp.status);
  var meta = await metaResp.json();
  if (meta.status !== "OK") throw new Error("No Street View available at " + lat + "," + lng);

  // Fetch the image (billed: $0.007 per call)
  var svUrl = "https://maps.googleapis.com/maps/api/streetview?size=800x500&location=" + lat + "," + lng + "&source=outdoor&fov=80&pitch=10&key=" + gKey;
  var imgResp = await fetch(svUrl);
  if (!imgResp.ok) throw new Error("Street View image fetch failed: " + imgResp.status);

  var imgBlob = await imgResp.blob();
  var storagePath = "photos/" + placeId.replace(/[^a-zA-Z0-9_-]/g, "_") + "_sv.jpg";

  var { error: uploadErr } = await sb.storage.from("photo-cache").upload(storagePath, imgBlob, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) {
    console.error("[photo_sv] upload error:", uploadErr.message);
    throw new Error("Upload failed: " + uploadErr.message);
  }

  var { data: publicUrlData } = sb.storage.from("photo-cache").getPublicUrl(storagePath);
  var permanentUrl = publicUrlData.publicUrl;

  await sb.from("photo_cache").upsert({ place_id: placeId, photo_url: permanentUrl }, { onConflict: "place_id" });

  return { url: permanentUrl, stored: false };
}

// --- 9. Prepare Fix (Trip Pulse background solutions) ---

async function handlePrepareFix(payload) {
  var trip = payload.trip || {};
  var alert = payload.alert || {};
  var profile = payload.profile || {};
  var memory = payload.memory || [];

  var activities = trip.activities || [];
  var dest = String(trip.destination || "");
  var country = String(trip.country || "");

  var actLines = [];
  for (var i = 0; i < activities.length; i++) {
    var a = activities[i];
    var lk = (a.locked || a.fixed) ? " [LOCKED]" : "";
    actLines.push(
      "Day " + String(a.day) + " " + String(a.time) +
      " - " + String(a.title) + " (" + String(a.type) + ", " +
      String(a.duration || 60) + "min)" + lk
    );
  }

  var memLines = [];
  for (var m of memory) {
    memLines.push("- " + m.detail);
  }

  // Fetch real places for alternatives
  var gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  var venueCtx = "";
  if (gpKey) {
    var gpQuery = alert.message + " alternatives in " +
      dest + " " + country;
    var gpPlaces = await fetchGooglePlaces(gpQuery, gpKey);
    if (gpPlaces.length > 0) {
      venueCtx = "\n\nREAL PLACES:\n" +
        formatGooglePlaces(gpPlaces) +
        "\nPrefer these real places.";
    }
  }

  var interests = (profile.interests || []).join(", ") ||
    "general";
  var pace = String(
    trip.pace || profile.pace || "moderate"
  );

  var sysArr = [
    "You are Tripseek AI, fixing a specific",
    "itinerary issue.",
    "",
    "PROBLEM: " + String(alert.type) + " - " +
      String(alert.message),
    "",
    "RULES:",
    "- Return ONLY valid JSON",
    "- NEVER modify locked/fixed activities",
    "- Only modify activities needed to fix the issue",
    "- Keep times realistic and non-overlapping",
    "- Minimum 30 min gap between activities",
    "- Meal timing: breakfast 07:00-09:30,",
    "  lunch 12:00-13:30, dinner 19:00-21:30",
    "- Use real, well-known places",
    "- Preserve existing activity IDs when modifying",
    "- New activities have no id field",
  ];
  var system = sysArr.join("\n");

  var schema = [
    "{",
    '  "activities": [',
    "    {",
    '      "id": "existing-or-omit-for-new",',
    '      "day": 1, "time": "HH:MM",',
    '      "title": "...",',
    '      "type": "activity|food|hotel|flight",',
    '      "description": "...",',
    '      "duration": 60,',
    '      "cost": "free|budget|moderate|premium"',
    "    }",
    "  ],",
    '  "summary": "One sentence describing the fix",',
    '  "changes": ["Change 1", "Change 2"]',
    "}",
  ].join("\n");

  var userArr = [
    "TRIP: " + dest + ", " + country,
    "TRAVELER: pace=" + pace +
      ", interests=" + interests,
    "",
    "CURRENT ITINERARY:",
    actLines.join("\n"),
    "",
    "ISSUE TO FIX:",
    "Type: " + String(alert.type),
    "Message: " + String(alert.message),
  ];
  if (alert.day != null) {
    userArr.push(
      "Affected day: " + String(alert.day)
    );
  }
  if (memLines.length > 0) {
    userArr.push(
      "", "LEARNED PREFERENCES:",
      memLines.join("\n")
    );
  }
  if (venueCtx) {
    userArr.push(venueCtx);
  }
  userArr.push(
    "",
    "Fix this issue. Return the COMPLETE activity",
    "list with the fix applied:",
    schema
  );

  var user = userArr.join("\n");
  var result = await claude(system, user, 4096);
  validateOutput(result, "edit_trip");
  return result;
}

// --- Usage gating ---

// Map actions to usage categories. Null = ungated (no usage tracking).
function getUsageCategory(action) {
  switch (action) {
    case "generate_trip": return "generation";
    case "chat":
    case "edit_trip":
    case "analyze_trip":
    case "prepare_fix":
    case "natural_search":
    case "enhance_profile":
    case "rank_places":
      return "assistance";
    case "import_place":
    case "import_booking": return "import";
    default: return null;
  }
}

// Get current billing period key (e.g. "2026-09")
function getCurrentPeriod() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, "0");
  return y + "-" + m;
}

// Check usage via the Supabase RPC function. Returns { allowed, remaining, reason }.
async function checkUsage(userId, action, contentType) {
  var category = getUsageCategory(action);
  if (!category) return { allowed: true, remaining: 99 };

  var sbUrl = Deno.env.get("SUPABASE_URL");
  var sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !sbKey) {
    // No Supabase config — allow (dev mode)
    return { allowed: true, remaining: 99 };
  }

  var sb = createClient(sbUrl, sbKey);
  var period = getCurrentPeriod();

  var { data, error } = await sb.rpc("check_and_use", {
    p_user_id: userId,
    p_period: period,
    p_category: category,
    p_content_type: contentType || null,
  });

  if (error) {
    console.error("[usage] check_and_use error:", error.message);
    // Fail closed — deny the action on error to prevent abuse
    return { allowed: false, remaining: 0, reason: "Usage service temporarily unavailable. Please try again." };
  }

  return data;
}

// Rollback usage on handler error (error recovery is free)
async function rollbackUsageServer(userId, action, contentType) {
  var category = getUsageCategory(action);
  if (!category) return;

  var sbUrl = Deno.env.get("SUPABASE_URL");
  var sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !sbKey) return;

  var sb = createClient(sbUrl, sbKey);
  var period = getCurrentPeriod();

  await sb.rpc("rollback_usage", {
    p_user_id: userId,
    p_period: period,
    p_category: category,
    p_content_type: contentType || null,
  });
}

// Verify JWT via Supabase auth and extract user ID.
// Caches the result per-request to avoid redundant network calls.
var _verifiedUserCache = new Map();

async function getUserIdFromRequest(req) {
  var auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  var token = auth.slice(7);

  // Return cached result if we already verified this token in this request
  if (_verifiedUserCache.has(token)) return _verifiedUserCache.get(token);

  try {
    var sbUrl = Deno.env.get("SUPABASE_URL");
    var sbAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    var sb = createClient(sbUrl, sbAnonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
    });
    var { data, error } = await sb.auth.getUser();
    if (error || !data?.user) {
      _verifiedUserCache.set(token, null);
      return null;
    }
    _verifiedUserCache.set(token, data.user.id);
    return data.user.id;
  } catch (_e) {
    _verifiedUserCache.set(token, null);
    return null;
  }
}

// --- Generate Place Description ---

async function handleGenerateDescription(payload) {
  var name = String(payload.name || "");
  var location = String(payload.location || "");
  var category = String(payload.category || "");
  var type = String(payload.type || "");

  if (!name) throw new Error("name is required");

  var system = [
    "You write concise, informative descriptions of real places for a travel app.",
    "Write 2-3 sentences about what makes this place special, what visitors can expect,",
    "or why it's worth visiting. Be specific and factual — mention signature dishes,",
    "architectural style, historical significance, atmosphere, or unique features.",
    "Do NOT mention ratings, reviews, location/address, or price — those are shown separately.",
    "Do NOT start with the place name — the user already sees it.",
    'Return JSON: { "description": "your text here" }',
  ].join(" ");

  var user = "Place: " + name;
  if (location) user += "\nLocation: " + location;
  if (category) user += "\nCategory: " + category;
  if (type) user += "\nType: " + type;

  var result = await claude(system, user, 200, 10000, HAIKU);
  return { description: result.description || "" };
}

// --- Router ---

Deno.serve(async (req) => {
  var dynamicCors = makeCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: dynamicCors });
  }

  try {
    const body = await req.json();
    const action = body.action;
    const payload = body.payload;

    // Basic input validation
    if (!action || typeof action !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid 'action' field" }),
        { status: 400, headers: { ...dynamicCors, "Content-Type": "application/json" } }
      );
    }
    if (payload !== undefined && payload !== null && typeof payload !== "object") {
      return new Response(
        JSON.stringify({ success: false, error: "'payload' must be an object or null" }),
        { status: 400, headers: { ...dynamicCors, "Content-Type": "application/json" } }
      );
    }

    var handler;
    if (action === "generate_trip") {
      handler = handleGenerateTrip;
    } else if (action === "chat") {
      handler = handleChat;
    } else if (action === "edit_trip") {
      handler = handleEditTrip;
    } else if (action === "enhance_profile") {
      handler = handleEnhanceProfile;
    } else if (action === "import_place") {
      handler = handleImportPlace;
    } else if (action === "import_booking") {
      handler = handleImportBooking;
    } else if (action === "rank_places") {
      handler = handleRankPlaces;
    } else if (action === "search_flights") {
      handler = handleSearchFlights;
    } else if (action === "destination_photo") {
      handler = handleDestinationPhoto;
    } else if (action === "google_places") {
      handler = handleGooglePlaces;
    } else if (action === "natural_search") {
      handler = handleNaturalSearch;
    } else if (action === "place_photo") {
      handler = handlePlacePhoto;
    } else if (action === "get_photo_key" || action === "resolve_photo_url") {
      handler = async function() {
        return handleResolvePhotoUrl(payload);
      };
    } else if (action === "place_details") {
      handler = handlePlaceDetails;
    } else if (action === "city_autocomplete") {
      handler = handleCityAutocomplete;
    } else if (action === "places_nearby") {
      handler = handlePlacesNearby;
    } else if (action === "photo_cache_lookup") {
      handler = handlePhotoCacheLookup;
    } else if (action === "photo_cache_store") {
      handler = handlePhotoCacheStore;
    } else if (action === "photo_street_view") {
      handler = handlePhotoStreetView;
    } else if (action === "generate_description") {
      handler = async function() {
        return handleGenerateDescription(payload);
      };
    } else if (action === "prepare_fix") {
      handler = handlePrepareFix;
    } else if (action === "get_booking_email") {
      handler = async function() {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        return { email: "bookings+" + uid + "@toveli.com" };
      };
    } else if (action === "get_parsed_bookings") {
      handler = async function() {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        var sbUrl = Deno.env.get("SUPABASE_URL");
        var sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        var resp = await fetch(
          sbUrl + "/rest/v1/parsed_bookings?user_id=eq." + uid + "&order=created_at.desc&limit=50",
          { headers: { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json" } }
        );
        if (!resp.ok) return { bookings: [] };
        var bookings = await resp.json();
        return { bookings: bookings };
      };
    } else if (action === "dismiss_parsed_booking") {
      handler = async function(p) {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        var sbUrl = Deno.env.get("SUPABASE_URL");
        var sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        await fetch(
          sbUrl + "/rest/v1/parsed_bookings?id=eq." + p.id + "&user_id=eq." + uid,
          { method: "PATCH", headers: { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json", "Prefer": "return=minimal" }, body: JSON.stringify({ status: "dismissed" }) }
        );
        return { success: true };
      };
    } else if (action === "mark_booking_imported") {
      handler = async function(p) {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        var sbUrl = Deno.env.get("SUPABASE_URL");
        var sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        await fetch(
          sbUrl + "/rest/v1/parsed_bookings?id=eq." + p.id + "&user_id=eq." + uid,
          { method: "PATCH", headers: { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json", "Prefer": "return=minimal" }, body: JSON.stringify({ status: "imported" }) }
        );
        return { success: true };
      };
    } else if (action === "gmail_auth_url" || action === "gmail_exchange_code" || action === "gmail_disconnect" || action === "gmail_status") {
      // Gmail auth actions — proxy to gmail-auth edge function
      handler = async function(p) {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        var sbUrl = Deno.env.get("SUPABASE_URL");
        var token = req.headers.get("Authorization") || "";
        var gmailAction = action.replace("gmail_", "");
        var resp = await fetch(
          sbUrl + "/functions/v1/gmail-auth",
          { method: "POST", headers: { "Content-Type": "application/json", "Authorization": token, "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "" }, body: JSON.stringify({ action: gmailAction, ...p }) }
        );
        var result = await resp.json();
        if (!resp.ok) throw new Error(result.error || "Gmail auth failed");
        return result.data || result;
      };
    } else if (action === "get_trip_alerts") {
      handler = async function(p) {
        var destination = p.destination || "the destination";
        var startDate = p.startDate;
        var endDate = p.endDate;
        var dateRange = startDate && endDate
          ? "from " + startDate + " to " + endDate
          : startDate
          ? "departing " + startDate
          : "upcoming";

        var alertsText = await claude(
          "You are a travel safety and information assistant. Return ONLY valid JSON.",
          "Generate real-world external alerts for a traveler visiting " + destination + " " + dateRange + ".\n\n" +
          "Return 2-5 alerts covering what's genuinely relevant. Only include alerts based on well-established facts (seasonal patterns, entry requirements, known risks). Do NOT invent specific news events.\n\n" +
          "Alert types: weather_risk, travel_advisory, entry_requirement, local_disruption, health_advisory\n" +
          "Severity: urgent (safety risk requiring action), important (affects planning), info (good to know)\n\n" +
          "Return ONLY valid JSON matching this schema exactly:\n" +
          '{\n  "alerts": [\n    {\n      "id": "unique-string",\n      "type": "weather_risk",\n      "severity": "important",\n      "title": "Short title (max 8 words)",\n      "message": "2-3 sentence explanation with practical advice.",\n      "actionUrl": "https://... (optional, only include real official sources)"\n    }\n  ]\n}',
          1024,
          30000
        );
        return { alerts: alertsText.alerts ?? [] };
      };
    } else if (action === "gmail_sync") {
      // Gmail sync — proxy to gmail-sync edge function
      handler = async function() {
        var uid = getUserIdFromRequest(req);
        if (!uid) throw new Error("Not authenticated");
        var sbUrl = Deno.env.get("SUPABASE_URL");
        var token = req.headers.get("Authorization") || "";
        var resp = await fetch(
          sbUrl + "/functions/v1/gmail-sync",
          { method: "POST", headers: { "Content-Type": "application/json", "Authorization": token, "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "" }, body: JSON.stringify({}) }
        );
        var result = await resp.json();
        if (!resp.ok) throw new Error(result.error || "Gmail sync failed");
        return result.data || result;
      };
    } else {
      throw new Error("Unknown action: " + action);
    }

    // --- Usage gating (server-side enforcement) ---
    // TODO: Re-enable before launch
    var userId = getUserIdFromRequest(req);
    var usageCategory = getUsageCategory(action);
    var contentType = payload && payload.contentType ? payload.contentType : null;

    if (userId && usageCategory) {
      var usageCheck = await checkUsage(userId, action, contentType);
      if (!usageCheck.allowed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: usageCheck.reason || "Usage limit reached.",
            code: "USAGE_LIMIT",
            remaining: 0,
            is_plus: usageCheck.is_plus || false,
          }),
          {
            status: 403,
            headers: {
              ...dynamicCors,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    var data;
    try {
      data = await handler(payload);
    } catch (handlerErr) {
      var hMsg = handlerErr instanceof Error
        ? handlerErr.message
        : "Handler failed";
      console.error("[ai-toveli:" + action + "]", hMsg);

      // Rollback usage on handler error (error recovery is free)
      if (userId && usageCategory) {
        await rollbackUsageServer(userId, action, contentType);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: hMsg,
        }),
        {
          status: 500,
          headers: {
            ...dynamicCors,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: data }),
      {
        headers: {
          ...dynamicCors,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ai-toveli]", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      {
        status: 500,
        headers: { ...dynamicCors, "Content-Type": "application/json" },
      }
    );
  }
});
