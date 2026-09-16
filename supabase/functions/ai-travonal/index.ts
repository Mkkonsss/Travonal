import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_ORIGIN = "*";
const CORS_HEADERS = "authorization, x-client-info, apikey, content-type";
const CORS_METHODS = "POST, OPTIONS";

const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Headers": CORS_HEADERS,
  "Access-Control-Allow-Methods": CORS_METHODS,
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const MODEL = "claude-sonnet-4-6";

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

async function claude(system, user, maxTokens, timeoutMs) {
  var tms = timeoutMs || 50000;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, tms);
  try {
    var response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: "user", content: user }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    var text = response.content[0].type === "text"
      ? response.content[0].text
      : "";
    return extractJSON(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// --- Google Places helper ---

async function fetchGooglePlaces(query, apiKey) {
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
    "places.location",
    "places.photos",
  ].join(",");
  var body = JSON.stringify({
    textQuery: query,
    pageSize: 10,
  });
  try {
    var resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: body,
    });
    if (!resp.ok) return [];
    var data = await resp.json();
    return data.places || [];
  } catch (_e) {
    return [];
  }
}

function formatGooglePlaces(places) {
  var lines = [];
  var limit = Math.min(places.length, 15);
  for (var i = 0; i < limit; i++) {
    var p = places[i];
    var name = p.displayName
      ? p.displayName.text || "Unknown"
      : "Unknown";
    var addr = p.formattedAddress || "";
    var rating = p.rating
      ? " Rating:" + p.rating : "";
    var pid = p.id || p.placeId || "";
    var lat = p.location
      ? p.location.latitude : "";
    var lng = p.location
      ? p.location.longitude : "";
    lines.push(
      (i + 1) + ". " + name + rating
    );
    if (addr) {
      lines.push("   Address: " + addr);
    }
    if (pid) {
      lines.push("   placeId: " + pid);
    }
    if (lat && lng) {
      lines.push(
        "   lat: " + lat + " lng: " + lng
      );
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

  var sysArr = [
    "You are Travonal AI trip planner.",
    "Create personalized, realistic travel itineraries.",
    "",
    "RESPONSE FORMAT: Return ONLY valid JSON.",
    "",
    "PACE MODEL (meals separate from experiences):",
    "  relaxed: 1-2 main experiences/day",
    "    + breakfast + lunch + dinner",
    "    Large free-time gaps, slow mornings",
    "    DO NOT fill every hour",
    "    Must include meaningful activities",
    "    not just meals",
    "  moderate: 2-4 main experiences/day",
    "    + breakfast + lunch + dinner",
    "  active: 4-6 main experiences/day",
    "    + breakfast + lunch + dinner",
    "",
    "A relaxed trip MUST include real experiences",
    "matching the traveler interests, not only meals.",
    "",
    "MEAL TIMING (REQUIRED - exact HH:MM range):",
    "  breakfast: 07:00-09:30 ONLY",
    "  lunch: 12:00-13:30 ONLY",
    "  dinner: 19:00-21:30 ONLY",
    "  Every day MUST have breakfast + lunch + dinner",
    "  ERROR: breakfast after 10:00, dinner before 19:00",
    "  ERROR: breakfast at noon or later",
    "  ERROR: day without dinner",
    "",
    "NO DUPLICATE PLACES:",
    "  Each title must appear at most once across ALL days",
    "  Before adding a place, check all previous days",
    "",
    ...(geoContext
      ? [
          "GEOGRAPHIC SCHEDULING (computed from real coordinates — follow strictly):",
          geoContext,
          "",
        ]
      : [
          "GEOGRAPHIC EFFICIENCY:",
          "  Group activities by area/neighborhood",
          "  Morning: one area. Afternoon: adjacent area.",
          "  Never alternate between distant parts of the city",
          "  Add 45-60 min transit time between distant areas",
          "",
        ]
    ),
    "TIMING GAPS (required):",
    "  Minimum 30 min gap between each activity",
    "  relaxed pace: minimum 60 min gap",
    "  previous_end_time + gap <= next_start_time",
    "",
    "LOCKED/FIXED ACTIVITIES:",
    "  Do NOT include them in output (merged client-side)",
    "  Plan around them without listing them",
    "",
    "REQUESTED PLACES:",
    "  You MUST include ALL requested places in the itinerary.",
    "  Place each one at the optimal day and time.",
    "  If a requested place has a placeId, copy it into the output.",
    "  Failure to include any requested place is an error.",
    "",
    "  SCHEDULING INTELLIGENCE FOR REQUESTED PLACES:",
    "  - Opening hours: If a place has hours listed, schedule within those hours.",
    "  - Category timing: nightlife/bar → evening (19:00+). museum/gallery → morning.",
    "    outdoor/nature/park → daylight hours. breakfast spot → morning meal slot.",
    "  - User notes: If the user wrote notes (e.g. 'dinner spot', 'go at sunset'),",
    "    honor that intent when scheduling.",
    "  - Crowd avoidance: Places with 1000+ reviews are popular tourist spots.",
    "    Schedule these early morning (first activity of the day) when possible.",
    "  - Intensity balancing: Don't stack 3+ long-duration (90min+) activities",
    "    on the same day. Mix heavy and light activities across days.",
    "  - Food type: If a requested food place's name/category suggests a specific",
    "    meal (breakfast, lunch, dinner), place it in the matching meal slot.",
    "",
    "OTHER RULES:",
    "  Use real, well-known places at the destination",
    "  Never invent place names",
    '  type: activity, food, hotel, or flight',
    '  cost: free, budget, moderate, or premium',
    '  time: HH:MM (24-hour), duration: minutes',
    "",
    "VENUE FORMAT:",
    "  Each REAL VERIFIED PLACE has an ID.",
    "  When you pick a place from the list,",
    "  copy its placeId, address, lat, lng",
    "  into the activity JSON exactly.",
  ];
  var system = sysArr.join("\n");

  const schema = [
    "{",
    '  "activities": [',
    "    {",
    '      "day": 1,',
    '      "time": "09:00",',
    '      "title": "Place name",',
    '      "type": "activity",',
    '      "description": "One sentence.",',
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
  ].join("\n");

  // Fetch real venues from Google Places
  var gpKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  var venueCtx = "";
  if (gpKey) {
    var dest = String(trip.destination || "");
    var country = String(trip.country || "");
    var gpQuery = dest + " " + country +
      " attractions " + interests;
    var gpPlaces = await fetchGooglePlaces(
      gpQuery, gpKey
    );
    var foodQuery = "best restaurants in " +
      dest + " " + country;
    if (dietary !== "none") {
      foodQuery += " " + dietary;
    }
    var gpFood = await fetchGooglePlaces(
      foodQuery, gpKey
    );
    var allVenues = gpPlaces.concat(gpFood);
    if (allVenues.length > 0) {
      venueCtx = "\n\nREAL VERIFIED PLACES FOR " +
        dest + ":\n" +
        formatGooglePlaces(allVenues) +
        "\nRULE: You MUST select places " +
        "from the REAL VERIFIED PLACES " +
        "list above." +
        "\nDo not invent restaurants or " +
        "attractions." +
        "\nIf you need a type of place " +
        "not in the list, note it as " +
        '"[type needed - no verified ' +
        'place available]".';
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

  var genResult = await claude(system, user, 10240);
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

  // Resolve the canonical trip ID for actions.
  // activeTrip.id is authoritative; payload.activeTripId is fallback.
  const activeTripId = activeTrip
    ? String(activeTrip.id ?? "")
    : String(payload.activeTripId ?? "");

  const histLines = [];
  for (const m of history) {
    const who = m.role === "user" ? "User" : "Travonal";
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
    '  "recommended_places": ["Exact Place Name 1", "Exact Place Name 2"],',
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
  // Search Google Places using trip context OR general destination
  var searchDest = activeTrip
    ? String(activeTrip.destination || "")
    : "";
  // Fall back to destination from trip context string
  if (!searchDest && tripContext) {
    var destMatch = tripContext.match(/(?:Active|Upcoming) trips:\s*-\s*(?:"[^"]*"\s*—\s*)?([^,(]+)/);
    if (destMatch) searchDest = destMatch[1].trim();
  }
  if (isPlaceQ && chatGpKey) {
    var chatPlaceQ = searchDest ? (message + " near " + searchDest) : message;
    chatPlaces = await fetchGooglePlaces(
      chatPlaceQ, chatGpKey
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
    "You are Travonal, a travel assistant that executes user requests.",
    "You have access to this user's profile, preferences, and trip data in the TRIP CONTEXT below.",
    "Your primary job is to DO what the user asks. Your secondary job is to do it WELL using what you know about them.",
    "",
    // --- COMMAND HIERARCHY (strict priority order) ---
    "PRIORITY 1 — USER INSTRUCTIONS (supreme, always obey):",
    "When the user gives a direct instruction, EXECUTE IT. No exceptions.",
    "- 'Add a breakfast spot' → add it, even if one already exists on that day.",
    "- 'Replace X with something less crowded' → find a less crowded option and replace it. Do NOT explain why you can't.",
    "- 'Add a fine dining restaurant' → add it, even if their profile says 'street food lover.'",
    "- 'Remove the museum' → remove it. No personality needed, just confirm what you did.",
    "The user is the boss. If they ask for it, do it. Include the action in your response.",
    "NEVER respond to an action request with only text explaining why you won't or can't do it.",
    "If a user explicitly overrides their own profile ('I know I said no early mornings, but schedule a 6am hike'), follow their instruction.",
    "",
    "PRIORITY 2 — SAFETY CONSTRAINTS (only these can block an action):",
    "a) ABSOLUTE RULES from the profile are non-negotiable. Warn if a request conflicts, but still execute if the user insists.",
    "b) DISLIKES: avoid recommending disliked things UNLESS the user explicitly asks for them. If they ask, do it without mentioning the dislike.",
    "c) DIETARY RESTRICTIONS / ALLERGIES: always respect. If a user asks for a place that conflicts,",
    "   complete the request but add a clear warning: 'Added! Heads up — [place] serves [allergen] heavily. Want me to check alternatives?'",
    "",
    "PRIORITY 3 — PREFERENCES (use to decide HOW, never WHETHER):",
    "These inform your choices when the user leaves the decision to you. They NEVER block or refuse a user request.",
    "- Interests: shape which specific place you pick, not which category. User asks for 'a restaurant' → pick one matching their interests.",
    "- Crowd tolerance: pick less crowded options when you are choosing. Never refuse a popular place the user asked for.",
    "- Budget: pick price-appropriate options when you are choosing. Never refuse a price tier the user requests.",
    "- Food importance: 'big' → describe dishes, atmosphere, why it's special. 'simple' → just name the place.",
    "- Recommendation style: best → 1 confident pick, few → 2-3 options with a top pick, explore → 4-5+ diverse options.",
    "- Pace: informs scheduling suggestions. Not a hard limit on what the user can add.",
    "",
    // --- INTENT INTERPRETATION ---
    "UNDERSTANDING MESSAGES: Users speak casually. Your job is to understand their INTENT, not match keywords.",
    "Read the message, figure out what they actually want, then do it. Think like a smart human assistant.",
    "",
    "Users express the SAME intent in many ways. ALL of these mean 'add an activity':",
    "- 'Add a coffee shop on day 2'",
    "- 'I need coffee in the morning'",
    "- 'Where can I get coffee on day 2?' (if there's a trip, they probably want it added)",
    "- 'We should do coffee before the museum'",
    "- 'Ooh what about a cafe near the hotel?'",
    "- 'I want something to eat around 10am'",
    "",
    "ALL of these mean 'remove or replace an activity':",
    "- 'Remove the museum'",
    "- 'I don't want to do the museum anymore'",
    "- 'Nah scratch the museum'",
    "- 'The museum isn't for me, what else is there?'",
    "- 'Can we do something else instead of the museum?'",
    "- 'I'm not feeling the museum'",
    "",
    "ALL of these mean 'change the schedule':",
    "- 'Move lunch to 2pm'",
    "- 'Can we do lunch a bit later?'",
    "- 'Push lunch back'",
    "- 'I'd rather eat later'",
    "- 'Swap day 1 and day 2'",
    "- 'Flip the first two days'",
    "",
    "CONVERSATION CONTEXT: Use the conversation history to resolve references.",
    "- 'That one' / 'it' / 'the first one' → refers to the last place or activity discussed.",
    "- 'Actually make it later' → adjust the time of what was just added/discussed.",
    "- 'Never mind' / 'undo that' → remove the last thing you added.",
    "- 'What about day 3 instead?' → move the discussed activity to day 3.",
    "- Relative time: 'later' = +1-2 hours, 'earlier' = -1-2 hours, 'morning' = 08:00-11:00, 'afternoon' = 13:00-17:00, 'evening' = 18:00-21:00.",
    "",
    "WHEN AMBIGUOUS: If you're unsure whether the user wants an action or just info, look at the context.",
    "If they have an active trip and mention a place/activity → they probably want it added or changed.",
    "When in doubt, take the action. The user can undo. It's better to act and let them correct than to do nothing.",
    "",
    // --- ACTION-FIRST PRINCIPLE ---
    "ACTION-FIRST: When the user's message implies a change to their trip, your response MUST contain an action.",
    "Pick the best option from REAL NEARBY PLACES and do it. Do NOT ask 'would you like me to add it?' — just add it. The user can undo.",
    "",
    // --- PERSONALIZATION GUIDANCE ---
    "WHEN TO PERSONALIZE:",
    "- Recommending places the user didn't specifically name — use interests, budget, crowd tolerance to choose.",
    "- User asks for open-ended suggestions — lean heavily on profile to curate.",
    "- A profile detail is directly relevant (e.g., allergy when recommending food).",
    "WHEN NOT TO PERSONALIZE:",
    "- Executing direct commands ('remove this', 'move that to 3pm') — just do it, no profile commentary needed.",
    "- Answering factual questions — just answer.",
    "- Do NOT force a profile reference into every response. Only mention preferences when they genuinely shaped your recommendation.",
    "Use the user's name naturally (not every message, but in greetings and key moments).",
    "Cross-reference saved boards with trips — if they saved a place nearby, mention it when relevant.",
    "",
    // --- RESPONSE FORMAT ---
    "RESPONSE FORMAT — always return valid JSON:",
    fmt,
    "",
    "FORMATTING: Keep responses concise. Use short paragraphs (2-3 sentences max).",
    "Use bullet points for lists of 3+ items. Bold key place names with **name**.",
    "Never write more than 4 short paragraphs. For place recommendations, use a numbered list.",
    "",
    "FIELD RULES:",
    "- \"message\": 2-5 sentences. Warm, specific, practical. Personalize when it adds value.",
    "  For questions about the user's profile or what you know about them,",
    "  be thorough — list ALL their preferences comprehensively.",
    "- \"actions\": Array of mutation objects. Empty [] when just answering questions.",
    "- \"recommended_places\": Array of EXACT place names from REAL NEARBY PLACES to show as cards.",
    "  First = primary recommendation, rest = alternatives. Only include places you discuss in your message.",
    "  Use the EXACT name string from the places list — not paraphrased. Empty [] when not recommending places.",
    "- \"suggestions\": 2-4 short follow-up prompts (max 30 chars each). Contextual to the conversation.",
    "- \"context\": Set this when your response was shaped by personalization.",
    "  Examples: \"Based on your interest in street food\", \"From your Tokyo eats board\",",
    "  \"Keeping your peanut allergy in mind\", \"Matching your relaxed pace\".",
    "  Omit or set null when response isn't specifically personalized.",
    "",
    "AVAILABLE ACTIONS (use the exact tripId/activityId from FOCUS TRIP):",
    "CRITICAL: Always use exact IDs shown in the data. Never invent IDs.",
    "WHICH TRIP: Always use the FOCUS TRIP tripId for actions. The FOCUS TRIP is the trip the user is talking about.",
    "If no FOCUS TRIP is shown, look at the conversation to figure out which trip the user means, and use that tripId from the FULL APP CONTEXT.",
    "",
    "Activity operations:",
    "  ALWAYS use 24-hour time format HH:MM (e.g. '09:00', '19:30'). Never use 12-hour format like '7:00 PM'.",
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
    chatResult = await claude(system, user, 8192);
    validateOutput(chatResult, "chat");
  } catch (parseErr) {
    console.error("[handleChat] first attempt error:", parseErr, "— retrying with more tokens");
    try {
      chatResult = await claude(system, user, 10240);
      validateOutput(chatResult, "chat");
    } catch (retryErr) {
      console.error("[handleChat] retry also failed:", retryErr);
      // Last resort: if we got any object at all, try to use it
      if (chatResult && typeof chatResult === "object") {
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

  // Post-processing: backfill placeId for activities missing it (add_activity, replace_activity, create_trip)
  if (Array.isArray(chatResult.actions) && chatGpKey) {
    // Collect all activity objects that need placeId backfill
    var backfillTargets = [];
    for (var bfi = 0; bfi < chatResult.actions.length; bfi++) {
      var bfAction = chatResult.actions[bfi];
      var bfDest = searchDest;
      if (bfAction.type === "add_activity" && bfAction.activity && !bfAction.activity.placeId && bfAction.activity.title) {
        backfillTargets.push({ target: bfAction.activity, dest: bfDest });
      } else if (bfAction.type === "replace_activity" && bfAction.newActivity && !bfAction.newActivity.placeId && bfAction.newActivity.title) {
        backfillTargets.push({ target: bfAction.newActivity, dest: bfDest });
      } else if (bfAction.type === "create_trip" && Array.isArray(bfAction.activities)) {
        var ctDest = (bfAction.trip && bfAction.trip.destination) || bfDest;
        for (var ctk = 0; ctk < bfAction.activities.length; ctk++) {
          var ctAct = bfAction.activities[ctk];
          if (!ctAct.placeId && ctAct.title) {
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
    var recNames = Array.isArray(chatResult.recommended_places) ? chatResult.recommended_places : [];
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
          // Fuzzy: count shared significant words (length > 2)
          var stopWords = ["the", "and", "of", "at", "in", "a", "an", "la", "le", "el", "los", "las", "de", "del", "di", "da"];
          var recWords = recName.split(/[\s&,]+/).filter(function(w) { return w.length > 2 && stopWords.indexOf(w) === -1; });
          var cpWords = cpCheckName.split(/[\s&,]+/).filter(function(w) { return w.length > 2 && stopWords.indexOf(w) === -1; });
          var sharedCount = 0;
          for (var wi = 0; wi < recWords.length; wi++) {
            for (var wj = 0; wj < cpWords.length; wj++) {
              if (recWords[wi] === cpWords[wj]) { sharedCount++; break; }
            }
          }
          // Match if 2+ significant words overlap, or 1 word for short names
          var minOverlap = Math.min(recWords.length, cpWords.length) <= 1 ? 1 : 2;
          isMatch = sharedCount >= minOverlap && sharedCount > 0;
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
        cardPlaces.push({
          name: cpName,
          address: cpAddr,
          rating: cpRating,
          ratingCount: cpRatingCount,
          placeId: cpId,
          lat: cpLat,
          lng: cpLng,
          types: cpTypes,
          photoRefs: cpPhotos,
          _srcIdx: ci,
        });
        break; // Found match for this recommended name, move to next
      }
    }
    // Fallback: if AI didn't return recommended_places but mentioned places in message, use text matching
    if (cardPlaces.length === 0) {
      var aiMsg = (chatResult.message || "").toLowerCase();
      for (var fi = 0; fi < chatPlaces.length && cardPlaces.length < 5; fi++) {
        var fp = chatPlaces[fi];
        var fpName = fp.displayName ? (fp.displayName.text || "").toLowerCase() : "";
        if (!fpName) continue;
        if (aiMsg.includes(fpName)) {
          var fpDisplayName = fp.displayName ? fp.displayName.text || "" : "";
          var fpPhotos = [];
          if (fp.photos && fp.photos.length > 0) fpPhotos.push(fp.photos[0].name || "");
          cardPlaces.push({
            name: fpDisplayName,
            address: fp.formattedAddress || "",
            rating: fp.rating || null,
            ratingCount: fp.userRatingCount || null,
            placeId: fp.id || "",
            lat: fp.location ? fp.location.latitude : null,
            lng: fp.location ? fp.location.longitude : null,
            types: fp.types || [],
            photoRefs: fpPhotos,
            _srcIdx: fi,
          });
        }
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
          fetchGooglePlaces(uQuery, chatGpKey),
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
          cardPlaces.push({
            name: upName,
            address: up.formattedAddress || "",
            rating: up.rating || null,
            ratingCount: up.userRatingCount || null,
            placeId: up.id || "",
            lat: up.location ? up.location.latitude : null,
            lng: up.location ? up.location.longitude : null,
            types: up.types || [],
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
    var fbNames = chatResult.recommended_places.slice(0, 5);
    var fbPromises = fbNames.map(function(fbName) {
      var fbQuery = searchDest ? (String(fbName) + " " + searchDest) : String(fbName);
      return Promise.race([
        fetchGooglePlaces(fbQuery, chatGpKey),
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
        fallbackCards.push({
          name: fbpName,
          address: fbp.formattedAddress || "",
          rating: fbp.rating || null,
          ratingCount: fbp.userRatingCount || null,
          placeId: fbp.id || "",
          lat: fbp.location ? fbp.location.latitude : null,
          lng: fbp.location ? fbp.location.longitude : null,
          types: fbp.types || [],
          photoRefs: fbpPhotos,
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
    "You are Travonal smart itinerary editor.",
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
      model: MODEL,
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
      multiSystem, multiUser, 2048
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
    singleSystem, singleUser, 512
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
            verified.category = "restaurant";
          } else if (/lodging|hotel|motel|resort/
              .test(gpTypes)) {
            verified.category = "hotel";
          } else if (/museum/.test(gpTypes)) {
            verified.category = "museum";
          } else if (/park|garden/.test(gpTypes)) {
            verified.category = "park";
          } else {
            verified.category = "attraction";
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
    sysLines.join("\n"), userPrompt, 512
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
    '    { "index": 0, "score": 95, "reason": "One sentence." }',
    "  ]",
    "}",
  ].join("\n");

  const userArr = [
    "TRAVELER:",
    "Pace: " + String(profile.pace) +
      ", Budget: " + String(profile.budget),
    "Interests: " + (profile.interests ?? []).join(", "),
    "Dislikes: " + (profile.dislikes ?? []).join(", "),
    "Dietary: " + (
      (profile.dietaryRestrictions ?? []).join(", ") || "none"
    ),
  ];
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

// --- Photo API Key (for client-side URL building) ---

async function handleGetPhotoKey() {
  var gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  if (!gKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");
  return { key: gKey };
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
    "regularOpeningHours",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "googleMapsUri",
    "photos",
    "editorialSummary",
    "reviews",
    "generativeSummary",
    "businessStatus",
    "outdoorSeating",
    "liveMusic",
    "reservable",
    "servesBreakfast",
    "servesLunch",
    "servesDinner",
    "servesBrunch",
    "servesBeer",
    "servesWine",
    "servesCocktails",
    "servesDessert",
    "servesCoffee",
    "servesVegetarianFood",
    "goodForChildren",
    "goodForGroups",
    "goodForWatchingSports",
    "allowsDogs",
    "restroom",
    "menuForChildren",
    "takeout",
    "delivery",
    "dineIn",
    "curbsidePickup",
    "accessibilityOptions",
    "parkingOptions",
    "paymentOptions",
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
    "places.location",
    "places.currentOpeningHours",
    "places.photos",
    "places.editorialSummary",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.googleMapsUri",
    "places.reservable",
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
    "You are Travonal AI, fixing a specific",
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
    // Fail open — allow the action
    return { allowed: true, remaining: 0 };
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

// Extract user ID from the JWT in the Authorization header
function getUserIdFromRequest(req) {
  var auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  var token = auth.slice(7);
  try {
    // Decode JWT payload (middle segment)
    var payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch (_e) {
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

  var result = await claude(system, user, 200, 10000);
  return { description: result.description || "" };
}

// --- Router ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action;
    const payload = body.payload;

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
    } else if (action === "google_places") {
      handler = handleGooglePlaces;
    } else if (action === "natural_search") {
      handler = handleNaturalSearch;
    } else if (action === "place_photo") {
      handler = handlePlacePhoto;
    } else if (action === "get_photo_key") {
      handler = handleGetPhotoKey;
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
        return { email: "bookings+" + uid + "@travonal.com" };
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

    if (false && userId && usageCategory) {
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
              ...corsHeaders,
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
      console.error("[ai-travonal:" + action + "]", hMsg);

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
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: data }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ai-travonal]", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
