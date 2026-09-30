/**
 * Supabase Edge Function: share-trip
 *
 * POST /share-trip — Create a shared trip link (requires auth)
 *   Body: { tripId, permission, tripData }
 *   Returns: { id, url }
 *
 * GET /share-trip/:id — Render the shared trip as an HTML page (public)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime12(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function renderTripHtml(trip: any, permission: string): string {
  const title = escapeHtml(trip.title || trip.destination || 'Trip');
  const destination = escapeHtml(trip.destination || '');
  const startDate = trip.startDate || '';
  const endDate = trip.endDate || '';
  const activities: any[] = trip.activities || [];
  const reservations: any[] = (trip.reservations || []).filter((r: any) => !r.cancelled);
  const notes = trip.notes || '';

  // Group activities by day
  const dayMap = new Map<number, any[]>();
  for (const a of activities) {
    const day = a.day || 1;
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(a);
  }

  // Sort each day by time
  for (const [, acts] of dayMap) {
    acts.sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
  }

  const totalDays = dayMap.size > 0
    ? Math.max(...Array.from(dayMap.keys()))
    : Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);

  let daysHtml = '';
  for (let d = 1; d <= totalDays; d++) {
    const dayActivities = dayMap.get(d) || [];
    const dayDate = startDate ? formatDate(addDays(startDate, d - 1)) : '';
    const dayLabel = dayDate ? `Day ${d} — ${dayDate}` : `Day ${d}`;

    daysHtml += `<div class="day">`;
    daysHtml += `<h2>${escapeHtml(dayLabel)}</h2>`;

    if (dayActivities.length === 0) {
      daysHtml += `<p class="empty">No activities planned</p>`;
    } else {
      for (const a of dayActivities) {
        const time = a.time ? formatTime12(a.time) : '';
        const actTitle = escapeHtml(a.title || 'Untitled');
        const desc = a.description ? `<span class="desc">${escapeHtml(a.description)}</span>` : '';
        daysHtml += `<div class="activity"><span class="time">${escapeHtml(time)}</span><span class="title">${actTitle}</span>${desc}</div>`;
      }
    }
    daysHtml += `</div>`;
  }

  let bookingsHtml = '';
  if (reservations.length > 0) {
    bookingsHtml = `<div class="section"><h2>Bookings</h2>`;
    for (const r of reservations) {
      const rTitle = escapeHtml(r.title || 'Booking');
      const conf = r.confirmationNumber ? ` — <span class="conf">#${escapeHtml(r.confirmationNumber)}</span>` : '';
      const time = r.time ? ` at ${escapeHtml(formatTime12(r.time))}` : '';
      bookingsHtml += `<div class="activity"><span class="title">${rTitle}${time}</span>${conf}</div>`;
    }
    bookingsHtml += `</div>`;
  }

  const notesHtml = notes
    ? `<div class="section"><h2>Notes</h2><p>${escapeHtml(notes)}</p></div>`
    : '';

  const permBadge = permission === 'edit'
    ? '<span class="badge edit">Can Edit</span>'
    : '<span class="badge view">View Only</span>';

  const dateRange = startDate && endDate
    ? `${formatDate(startDate)} – ${formatDate(endDate)}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Toveli</title>
<meta name="description" content="${title} — ${destination}. ${dateRange}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f8f9fa;
    color: #111827;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 600px; margin: 0 auto; padding: 0 16px 40px; }
  .header {
    text-align: center;
    padding: 32px 16px 24px;
    border-bottom: 1px solid #e5e7eb;
    margin-bottom: 24px;
  }
  .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .header .meta { font-size: 14px; color: #6b7280; margin-bottom: 8px; }
  .badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: 12px;
  }
  .badge.view { background: #dbeafe; color: #1d4ed8; }
  .badge.edit { background: #d1fae5; color: #065f46; }
  .day { margin-bottom: 24px; }
  .day h2 {
    font-size: 15px;
    font-weight: 700;
    color: #374151;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  .activity {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid #f3f4f6;
  }
  .activity:last-child { border-bottom: none; }
  .time {
    font-size: 13px;
    font-weight: 600;
    color: #6b7280;
    min-width: 80px;
    flex-shrink: 0;
  }
  .title { font-size: 15px; font-weight: 500; }
  .desc {
    width: 100%;
    font-size: 13px;
    color: #6b7280;
    padding-left: 88px;
  }
  .conf { font-size: 13px; color: #6b7280; }
  .empty { font-size: 14px; color: #9ca3af; font-style: italic; padding: 8px 0; }
  .section { margin-bottom: 24px; }
  .section h2 {
    font-size: 15px;
    font-weight: 700;
    color: #374151;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  .section p { font-size: 14px; color: #4b5563; }
  .footer {
    text-align: center;
    padding: 24px 16px;
    border-top: 1px solid #e5e7eb;
    margin-top: 16px;
  }
  .footer p { font-size: 13px; color: #9ca3af; }
  .footer a {
    color: #111827;
    font-weight: 600;
    text-decoration: none;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #09090f; color: #f9fafb; }
    .header { border-bottom-color: #1f1f35; }
    .day h2, .section h2 { color: #d1d5db; border-bottom-color: #1f1f35; }
    .activity { border-bottom-color: #131320; }
    .time { color: #9ca3af; }
    .desc, .conf { color: #9ca3af; }
    .empty { color: #6b7280; }
    .section p { color: #9ca3af; }
    .footer { border-top-color: #1f1f35; }
    .footer p { color: #6b7280; }
    .footer a { color: #f9fafb; }
    .badge.view { background: #1e3a5f; color: #93c5fd; }
    .badge.edit { background: #064e3b; color: #6ee7b7; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${title}</h1>
    <p class="meta">${escapeHtml(destination)}${dateRange ? ` · ${escapeHtml(dateRange)}` : ''}</p>
    ${permBadge}
  </div>
  ${daysHtml}
  ${bookingsHtml}
  ${notesHtml}
  <div class="footer">
    <p>Shared from <a href="https://toveli.com">Toveli</a></p>
  </div>
</div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // GET — serve shared trip HTML
  // Path will be like /share-trip/abc123 or ?id=abc123
  if (req.method === 'GET') {
    const pathParts = url.pathname.split('/');
    const shareId = pathParts[pathParts.length - 1] || url.searchParams.get('id');

    if (!shareId || shareId === 'share-trip') {
      return new Response('Missing share ID', { status: 400, headers: corsHeaders });
    }

    const { data, error } = await supabase
      .from('shared_trips')
      .select('trip_data, permission')
      .eq('id', shareId)
      .single();

    if (error || !data) {
      return new Response(
        '<html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>Trip not found</h1><p>This shared trip link may have expired or been removed.</p></body></html>',
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const html = renderTripHtml(data.trip_data, data.permission);
    return new Response(html, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  }

  // POST — create a shared trip
  if (req.method === 'POST') {
    // Extract user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { tripId, permission, tripData } = body;

    if (!tripId || !tripData) {
      return new Response(JSON.stringify({ error: 'Missing tripId or tripData' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const id = generateId();
    const { error: insertError } = await supabase.from('shared_trips').insert({
      id,
      user_id: user.id,
      trip_id: tripId,
      permission: permission || 'view',
      trip_data: tripData,
    });

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use custom domain if configured, otherwise fall back to Supabase function URL
    const baseUrl = Deno.env.get('SHARE_BASE_URL') || `${supabaseUrl}/functions/v1/share-trip`;
    const shareUrl = `${baseUrl}/${id}`;

    return new Response(JSON.stringify({ id, url: shareUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders });
});
