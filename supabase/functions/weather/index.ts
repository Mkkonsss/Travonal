/**
 * Supabase Edge Function — WeatherKit proxy.
 *
 * Signs a JWT for Apple WeatherKit REST API using env-provided credentials,
 * fetches a daily forecast, and returns data in the shape the client expects.
 *
 * Required env vars:
 *   APPLE_WEATHER_TEAM_ID      – Apple Developer Team ID
 *   APPLE_WEATHER_SERVICE_ID   – WeatherKit Service ID (e.g. com.example.weatherkit-client)
 *   APPLE_WEATHER_KEY_ID       – Key ID for the .p8 private key
 *   APPLE_WEATHER_PRIVATE_KEY  – PEM-encoded ES256 private key (the .p8 contents)
 */

import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.2.2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Map WeatherKit conditionCode strings → WMO weather codes so the client
// icon/label mapping stays unchanged.
const CONDITION_TO_WMO: Record<string, number> = {
  Clear: 0,
  MostlyClear: 1,
  PartlyCloudy: 2,
  MostlyCloudy: 3,
  Cloudy: 3,
  Haze: 45,
  Smoky: 45,
  Foggy: 45,
  Drizzle: 51,
  FreezingDrizzle: 57,
  Rain: 61,
  FreezingRain: 66,
  HeavyRain: 65,
  Snow: 71,
  Flurries: 71,
  HeavySnow: 75,
  Blizzard: 75,
  BlowingSnow: 77,
  Sleet: 67,
  Hail: 99,
  Thunderstorms: 95,
  IsolatedThunderstorms: 95,
  ScatteredThunderstorms: 95,
  SevereThunderstorm: 99,
  TropicalStorm: 99,
  Hurricane: 99,
  Windy: 2,
  Breezy: 1,
};

let cachedKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const pem = Deno.env.get("APPLE_WEATHER_PRIVATE_KEY")!;
  cachedKey = await importPKCS8(pem, "ES256");
  return cachedKey;
}

async function makeJWT(): Promise<string> {
  const teamId = Deno.env.get("APPLE_WEATHER_TEAM_ID")!;
  const serviceId = Deno.env.get("APPLE_WEATHER_SERVICE_ID")!;
  const keyId = Deno.env.get("APPLE_WEATHER_KEY_ID")!;
  const key = await getSigningKey();

  return new SignJWT({ sub: serviceId })
    .setProtectedHeader({ alg: "ES256", kid: keyId, id: `${teamId}.${serviceId}` })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lat, lng, startDate, endDate } = await req.json();
    if (lat == null || lng == null || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "lat, lng, startDate, endDate required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await makeJWT();
    const url =
      `https://weatherkit.apple.com/api/v1/weather/en/${lat}/${lng}` +
      `?dataSets=forecastDaily&dailyStart=${startDate}&dailyEnd=${endDate}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("WeatherKit error:", resp.status, body);
      return new Response(JSON.stringify({ error: "WeatherKit request failed", status: resp.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const days = (data.forecastDaily?.days ?? []).map((d: Record<string, unknown>) => ({
      date: (d.forecastStart as string).split("T")[0],
      precipitationProbability: Math.round(((d.precipitationChance as number) ?? 0) * 100),
      weatherCode: CONDITION_TO_WMO[d.conditionCode as string] ?? 0,
      temperatureMax: d.temperatureMax ?? 0,
      temperatureMin: d.temperatureMin ?? 0,
    }));

    return new Response(JSON.stringify({ days }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Weather function error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
