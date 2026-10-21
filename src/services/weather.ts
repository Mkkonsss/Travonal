/**
 * Weather service using Apple WeatherKit via Supabase Edge Function.
 * Fetches daily forecasts for trip destinations to power weather-aware alerts.
 *
 * Apple requires attribution: "Weather data provided by Apple Weather."
 */

export interface DayWeather {
  date: string;
  precipitationProbability: number; // 0-100
  weatherCode: number; // WMO weather code (mapped from WeatherKit conditionCode)
  temperatureMax: number; // Celsius
  temperatureMin: number; // Celsius
}

export interface TripWeatherForecast {
  days: DayWeather[];
  fetchedAt: number;
}

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/Weather`;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// In-memory cache: key = "lat,lng" truncated to 2 decimals
const weatherCache = new Map<string, TripWeatherForecast>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Weather codes that indicate rain/storm (WMO standard).
 * 51-67: drizzle/rain, 80-82: rain showers, 95-99: thunderstorm
 */
export function isRainyWeatherCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

/**
 * Check if a specific day has bad weather (high rain probability or rainy weather code).
 */
export function isBadWeatherDay(day: DayWeather): boolean {
  return day.precipitationProbability >= 60 || isRainyWeatherCode(day.weatherCode);
}

/**
 * Fetch weather forecast for a location and date range.
 * Returns cached data if available and fresh.
 */
export async function fetchWeatherForecast(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<TripWeatherForecast | null> {
  const key = cacheKey(lat, lng);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached;
  }

  try {
    const resp = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ lat, lng, startDate, endDate }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();

    const days: DayWeather[] = (data.days ?? []).map((d: Record<string, unknown>) => ({
      date: d.date as string,
      precipitationProbability: (d.precipitationProbability as number) ?? 0,
      weatherCode: (d.weatherCode as number) ?? 0,
      temperatureMax: (d.temperatureMax as number) ?? 0,
      temperatureMin: (d.temperatureMin as number) ?? 0,
    }));

    const forecast: TripWeatherForecast = { days, fetchedAt: Date.now() };
    weatherCache.set(key, forecast);
    return forecast;
  } catch {
    return null;
  }
}

/**
 * Get the weather for a specific trip day number.
 * Returns null if forecast isn't available for that day.
 */
export function getWeatherForDay(
  forecast: TripWeatherForecast | null,
  startDate: string,
  dayNumber: number,
): DayWeather | null {
  if (!forecast) return null;
  const start = new Date(startDate + 'T00:00:00');
  const target = new Date(start);
  target.setDate(target.getDate() + dayNumber - 1);
  const targetStr = target.toISOString().split('T')[0];
  return forecast.days.find((d) => d.date === targetStr) ?? null;
}

/**
 * Fetch with a shorter cache TTL — used for active trips where
 * weather data should refresh more frequently (every hour).
 */
export async function fetchWeatherForecastActive(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<TripWeatherForecast | null> {
  const key = cacheKey(lat, lng);
  const cached = weatherCache.get(key);
  const ACTIVE_TTL = 60 * 60 * 1000; // 1 hour
  if (cached && Date.now() - cached.fetchedAt < ACTIVE_TTL) {
    return cached;
  }
  // Clear stale cache entry so fetchWeatherForecast re-fetches
  weatherCache.delete(key);
  return fetchWeatherForecast(lat, lng, startDate, endDate);
}

/** Clear cached weather data. */
export function clearWeatherCache(): void {
  weatherCache.clear();
}
