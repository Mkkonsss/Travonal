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

const ALLOWED_ORIGINS = [
  'https://tripseekapp.com',
  'https://www.tripseekapp.com',
  'http://localhost:8081',
  'http://localhost:19006',
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('origin') || '';
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return origin || '*';
  return ALLOWED_ORIGINS[0];
}

function makeCorsHeaders(req: Request) {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

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
  const emoji = trip.emoji || '✈️';
  const startDate = trip.startDate || '';
  const endDate = trip.endDate || '';
  const activities: any[] = trip.activities || [];
  const reservations: any[] = (trip.reservations || []).filter((r: any) => !r.cancelled);
  const prepItems: any[] = trip.prepItems || [];
  const expenses: any[] = trip.expenses || [];
  const notes = trip.notes || '';
  const budgetTotal = trip.budgetTotal;
  const budgetCurrency = trip.budgetCurrency || 'USD';

  // Group activities by day
  const dayMap = new Map<number, any[]>();
  for (const a of activities) {
    const day = a.day || 1;
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(a);
  }
  for (const [, acts] of dayMap) {
    acts.sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
  }

  const totalDays = dayMap.size > 0
    ? Math.max(...Array.from(dayMap.keys()))
    : Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);

  const dateRange = startDate && endDate
    ? `${formatDate(startDate)} – ${formatDate(endDate)}`
    : '';

  // Type icons/colors
  const TYPE_ICON: Record<string, string> = { food: '🍽️', flight: '✈️', hotel: '🛏️', activity: '📍' };
  const BOOKING_ICON: Record<string, string> = { flight: '✈️', hotel: '🛏️', restaurant: '🍽️', car: '🚗', train: '🚂', activity: '🎟️', other: '📋' };
  const COST_LABEL: Record<string, string> = { free: 'Free', budget: '$', moderate: '$$', premium: '$$$' };

  // ── ITINERARY TAB ──
  let itineraryHtml = '';
  for (let d = 1; d <= totalDays; d++) {
    const dayActivities = dayMap.get(d) || [];
    const dayDate = startDate ? formatDate(addDays(startDate, d - 1)) : '';
    let actsHtml = dayActivities.length === 0
      ? `<div class="empty-day">No activities planned for this day</div>`
      : dayActivities.map((a: any) => {
          const time = a.time ? formatTime12(a.time) : '';
          const icon = TYPE_ICON[a.type] || '📍';
          const cost = a.cost && a.cost !== 'free' ? COST_LABEL[a.cost] || a.cost : '';
          const booked = a.bookingStatus === 'booked';
          return `<div class="act-row">
            <div class="act-time-col">${time ? `<span class="act-time">${escapeHtml(time)}</span>` : ''}</div>
            <div class="act-card">
              <div class="act-icon-wrap"><span class="act-icon">${icon}</span></div>
              <div class="act-info">
                <div class="act-title-row">
                  <span class="act-title">${escapeHtml(a.title || 'Untitled')}</span>
                  ${booked ? '<span class="booked-badge">Booked</span>' : ''}
                </div>
                ${a.description ? `<div class="act-desc">${escapeHtml(a.description)}</div>` : ''}
                <div class="act-meta-row">
                  ${a.rating ? `<span class="act-rating">★ ${a.rating}${a.reviewCount ? ` (${a.reviewCount})` : ''}</span>` : ''}
                  ${cost ? `<span class="act-cost">${escapeHtml(cost)}</span>` : ''}
                  ${a.notes ? `<span class="act-note">${escapeHtml(a.notes)}</span>` : ''}
                </div>
              </div>
            </div>
          </div>`;
        }).join('');
    itineraryHtml += `<div class="day-block" id="day-${d}">
      <div class="day-label">
        <span class="day-num-pill">Day ${d}</span>
        ${dayDate ? `<span class="day-date-text">${escapeHtml(dayDate)}</span>` : ''}
        <span class="day-count">${dayActivities.length} ${dayActivities.length === 1 ? 'activity' : 'activities'}</span>
      </div>
      <div class="acts-list">${actsHtml}</div>
    </div>`;
  }

  // ── BOOKINGS TAB ──
  const groupedBookings: Record<string, any[]> = {};
  for (const r of reservations) {
    const t = r.type || 'other';
    if (!groupedBookings[t]) groupedBookings[t] = [];
    groupedBookings[t].push(r);
  }
  const BOOKING_TYPE_LABEL: Record<string, string> = { flight: 'Flights', hotel: 'Hotels', restaurant: 'Restaurants', car: 'Car Rentals', train: 'Trains', activity: 'Activities', other: 'Other' };
  let bookingsHtml = reservations.length === 0
    ? `<div class="tab-empty">No bookings yet</div>`
    : Object.entries(groupedBookings).map(([type, items]) => {
        const groupRows = items.map((r: any) => {
          const icon = BOOKING_ICON[r.type] || '📋';
          const conf = r.confirmationNumber ? `<div class="b-conf">Confirmation: <strong>${escapeHtml(r.confirmationNumber)}</strong></div>` : '';
          const dates = r.date ? `<div class="b-meta">${escapeHtml(formatDate(r.date))}${r.checkOutDate ? ` – ${escapeHtml(formatDate(r.checkOutDate))}` : ''}</div>` : '';
          const flight = r.flightNumber ? `<div class="b-meta">Flight ${escapeHtml(r.flightNumber)}${r.origin ? ` · ${escapeHtml(r.origin)}` : ''}${r.destination ? ` → ${escapeHtml(r.destination)}` : ''}</div>` : '';
          const price = r.price ? `<div class="b-meta">${r.currency || budgetCurrency} ${r.price}</div>` : '';
          const bNotes = r.notes ? `<div class="b-notes">${escapeHtml(r.notes)}</div>` : '';
          return `<div class="booking-card">
            <div class="b-icon">${icon}</div>
            <div class="b-body">
              <div class="b-title">${escapeHtml(r.title || 'Booking')}</div>
              ${dates}${flight}${conf}${price}${bNotes}
            </div>
          </div>`;
        }).join('');
        return `<div class="booking-group">
          <div class="group-label">${BOOKING_TYPE_LABEL[type] || type}</div>
          ${groupRows}
        </div>`;
      }).join('');

  // ── BUDGET TAB ──
  const totalSpent = expenses.reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const budgetPct = budgetTotal ? Math.min(100, Math.round((totalSpent / budgetTotal) * 100)) : 0;
  const EXPENSE_ICON: Record<string, string> = { food: '🍽️', transport: '🚗', accommodation: '🏨', activities: '🎟️', shopping: '🛍️', other: '📦' };
  let budgetHtml = '';
  if (budgetTotal || expenses.length > 0) {
    budgetHtml = `
      ${budgetTotal ? `<div class="budget-summary-card">
        <div class="budget-row"><span class="budget-label">Budget</span><span class="budget-amount">${budgetCurrency} ${budgetTotal.toLocaleString()}</span></div>
        <div class="budget-row"><span class="budget-label">Spent</span><span class="budget-amount">${budgetCurrency} ${totalSpent.toLocaleString()}</span></div>
        <div class="progress-bar-wrap"><div class="progress-bar" style="width:${budgetPct}%;background:${budgetPct > 90 ? '#ef4444' : '#111'}"></div></div>
        <div class="budget-pct">${budgetPct}% used</div>
      </div>` : ''}
      ${expenses.length > 0 ? `<div class="group-label" style="margin-top:16px">Expenses</div>
        ${expenses.map((e: any) => `<div class="expense-row">
          <span class="exp-icon">${EXPENSE_ICON[e.category] || '📦'}</span>
          <span class="exp-name">${escapeHtml(e.name || e.title || 'Expense')}</span>
          <span class="exp-amount">${budgetCurrency} ${(e.amount || 0).toLocaleString()}</span>
        </div>`).join('')}` : ''}`;
  } else {
    budgetHtml = `<div class="tab-empty">No budget set</div>`;
  }

  // ── PREP TAB ──
  const doneItems = prepItems.filter((p: any) => p.done);
  let prepHtml = prepItems.length === 0
    ? `<div class="tab-empty">No prep items</div>`
    : `<div class="prep-progress">${doneItems.length} of ${prepItems.length} done</div>
       <div class="prep-progress-bar-wrap"><div class="prep-progress-bar" style="width:${prepItems.length ? Math.round(doneItems.length / prepItems.length * 100) : 0}%"></div></div>
       ${prepItems.map((p: any) => `<div class="prep-row ${p.done ? 'done' : ''}">
         <span class="prep-check">${p.done ? '✓' : '○'}</span>
         <span class="prep-text">${escapeHtml(p.text || p.title || '')}</span>
       </div>`).join('')}`;

  // Determine which tabs to show
  const showBookings = reservations.length > 0;
  const showBudget = !!(budgetTotal || expenses.length > 0);
  const showPrep = prepItems.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${emoji} ${title} — Tripseek</title>
<meta name="description" content="${destination}${dateRange ? ` · ${dateRange}` : ''}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f2f2f7;color:#111;-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-decoration:none}

/* Sticky top bar */
.topbar{background:#fff;border-bottom:1px solid rgba(0,0,0,.08);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:20}
.topbar-brand{font-size:14px;font-weight:700;letter-spacing:-.2px;color:#111}
.perm-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#111;color:#fff;letter-spacing:.2px}
.perm-badge.edit{background:#16a34a}

/* Hero */
.hero{background:#111;color:#fff;padding:28px 20px 20px;text-align:center}
.hero-emoji{font-size:36px;margin-bottom:8px}
.hero-title{font-size:26px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px;line-height:1.2}
.hero-sub{font-size:13px;color:rgba(255,255,255,.5);margin-bottom:16px}
.hero-stats{display:flex;justify-content:center;gap:0}
.stat-item{padding:0 20px;text-align:center;border-right:1px solid rgba(255,255,255,.12)}
.stat-item:last-child{border-right:none}
.stat-num{font-size:20px;font-weight:700}
.stat-label{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.6px;font-weight:600;margin-top:1px}

/* Notes strip */
.notes-strip{background:rgba(255,255,255,.08);margin:16px 0 0;padding:10px 16px;border-radius:10px;font-size:13px;color:rgba(255,255,255,.65);text-align:left;white-space:pre-wrap;line-height:1.5}

/* Tabs */
.tab-bar{background:#fff;border-bottom:1px solid rgba(0,0,0,.07);display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;position:sticky;top:49px;z-index:19;scrollbar-width:none}
.tab-bar::-webkit-scrollbar{display:none}
.tab-btn{padding:12px 18px;font-size:14px;font-weight:600;color:#888;border:none;background:none;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;flex-shrink:0;-webkit-tap-highlight-color:transparent}
.tab-btn.active{color:#111;border-bottom-color:#111}

/* Tab panels */
.tab-panel{display:none;padding:16px 16px 80px;max-width:540px;margin:0 auto}
.tab-panel.active{display:block}

/* Day blocks */
.day-block{margin-bottom:20px}
.day-label{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:0 2px}
.day-num-pill{font-size:11px;font-weight:700;background:#111;color:#fff;padding:3px 9px;border-radius:20px;letter-spacing:.3px}
.day-date-text{font-size:13px;font-weight:600;color:#333}
.day-count{font-size:12px;color:#aaa;margin-left:auto}

/* Activity rows */
.acts-list{display:flex;flex-direction:column;gap:1px}
.act-row{display:flex;gap:10px;align-items:flex-start}
.act-time-col{width:56px;flex-shrink:0;padding-top:14px;text-align:right}
.act-time{font-size:11px;font-weight:600;color:#999}
.act-card{flex:1;background:#fff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.act-icon-wrap{width:32px;height:32px;border-radius:8px;background:#f2f2f7;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.act-info{flex:1;min-width:0}
.act-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:2px}
.act-title{font-size:15px;font-weight:600;line-height:1.3;flex:1}
.booked-badge{font-size:10px;font-weight:700;background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;flex-shrink:0;margin-top:2px}
.act-desc{font-size:13px;color:#777;line-height:1.4;margin-bottom:4px}
.act-meta-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.act-rating{font-size:12px;color:#f59e0b;font-weight:600}
.act-cost{font-size:12px;color:#888;font-weight:600}
.act-note{font-size:12px;color:#aaa;font-style:italic}
.empty-day{background:#fff;border-radius:14px;padding:14px 16px;font-size:13px;color:#bbb;font-style:italic;box-shadow:0 1px 2px rgba(0,0,0,.04)}

/* Bookings */
.booking-group{margin-bottom:20px}
.group-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#888;margin-bottom:8px;padding:0 2px}
.booking-card{background:#fff;border-radius:14px;padding:14px 16px;display:flex;gap:12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.b-icon{font-size:22px;flex-shrink:0;width:32px;text-align:center;margin-top:1px}
.b-body{flex:1;min-width:0}
.b-title{font-size:15px;font-weight:600;margin-bottom:4px}
.b-meta{font-size:13px;color:#777;margin-bottom:2px}
.b-conf{font-size:13px;color:#555;margin-bottom:2px}
.b-notes{font-size:12px;color:#aaa;margin-top:4px;font-style:italic}

/* Budget */
.budget-summary-card{background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 1px 2px rgba(0,0,0,.05);margin-bottom:16px}
.budget-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.budget-label{font-size:14px;color:#666;font-weight:500}
.budget-amount{font-size:16px;font-weight:700}
.progress-bar-wrap{height:6px;background:#f2f2f7;border-radius:10px;overflow:hidden;margin:10px 0 6px}
.progress-bar{height:100%;border-radius:10px;transition:width .3s}
.budget-pct{font-size:12px;color:#aaa;font-weight:600;text-align:right}
.expense-row{background:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.exp-icon{font-size:18px;width:28px;text-align:center}
.exp-name{flex:1;font-size:14px;font-weight:500}
.exp-amount{font-size:14px;font-weight:700}

/* Prep */
.prep-progress{font-size:13px;font-weight:600;color:#555;margin-bottom:6px}
.prep-progress-bar-wrap{height:4px;background:#e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:14px}
.prep-progress-bar{height:100%;background:#111;border-radius:10px}
.prep-row{background:#fff;border-radius:12px;padding:13px 16px;display:flex;align-items:center;gap:12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.prep-row.done .prep-text{color:#aaa;text-decoration:line-through}
.prep-check{font-size:16px;color:#16a34a;font-weight:700;width:20px;text-align:center;flex-shrink:0}
.prep-row:not(.done) .prep-check{color:#ccc}
.prep-text{font-size:15px;font-weight:500}

/* Empty states */
.tab-empty{background:#fff;border-radius:14px;padding:24px;text-align:center;font-size:14px;color:#bbb;font-style:italic;box-shadow:0 1px 2px rgba(0,0,0,.04)}

/* CTA footer */
.get-app{text-align:center;padding:40px 20px 60px}
.get-app-text{font-size:13px;color:#aaa;margin-bottom:12px}
.get-app-btn{display:inline-flex;align-items:center;gap:8px;background:#111;color:#fff;font-size:14px;font-weight:600;padding:13px 28px;border-radius:100px}

@media(prefers-color-scheme:dark){
  body{background:#000;color:#f5f5f5}
  .topbar{background:#1c1c1e;border-bottom-color:rgba(255,255,255,.08)}
  .topbar-brand{color:#f5f5f5}
  .tab-bar{background:#1c1c1e;border-bottom-color:rgba(255,255,255,.07)}
  .tab-btn{color:#555}
  .tab-btn.active{color:#f5f5f5;border-bottom-color:#f5f5f5}
  .day-date-text{color:#ddd}
  .act-card,.booking-card,.budget-summary-card,.expense-row,.prep-row,.empty-day{background:#1c1c1e;box-shadow:none}
  .act-icon-wrap{background:#2c2c2e}
  .act-title,.b-title,.exp-name,.budget-amount,.prep-text{color:#f5f5f5}
  .act-desc,.b-meta,.b-conf{color:#888}
  .progress-bar-wrap,.prep-progress-bar-wrap{background:#2c2c2e}
  .prep-progress-bar{background:#f5f5f5}
  .get-app-btn{background:#f5f5f5;color:#111}
  .tab-empty{background:#1c1c1e}
  .notes-strip{background:rgba(255,255,255,.06)}
}
</style>
</head>
<body>

<div class="topbar">
  <span class="topbar-brand">Tripseek</span>
  <span class="perm-badge${permission === 'edit' ? ' edit' : ''}">${permission === 'edit' ? 'Can Edit' : 'View Only'}</span>
</div>

<div class="hero">
  <div class="hero-emoji">${emoji}</div>
  <div class="hero-title">${title}</div>
  <div class="hero-sub">${destination}${dateRange ? ` · ${escapeHtml(dateRange)}` : ''}</div>
  <div class="hero-stats">
    <div class="stat-item"><div class="stat-num">${totalDays}</div><div class="stat-label">Days</div></div>
    <div class="stat-item"><div class="stat-num">${activities.length}</div><div class="stat-label">Activities</div></div>
    ${reservations.length > 0 ? `<div class="stat-item"><div class="stat-num">${reservations.length}</div><div class="stat-label">Bookings</div></div>` : ''}
    ${prepItems.length > 0 ? `<div class="stat-item"><div class="stat-num">${doneItems.length}/${prepItems.length}</div><div class="stat-label">Prep</div></div>` : ''}
  </div>
  ${notes ? `<div class="notes-strip">${escapeHtml(notes)}</div>` : ''}
</div>

<div class="tab-bar">
  <button class="tab-btn active" onclick="showTab('itinerary',this)">Itinerary</button>
  ${showBookings ? `<button class="tab-btn" onclick="showTab('bookings',this)">Bookings</button>` : ''}
  ${showBudget ? `<button class="tab-btn" onclick="showTab('budget',this)">Budget</button>` : ''}
  ${showPrep ? `<button class="tab-btn" onclick="showTab('prep',this)">Prep</button>` : ''}
</div>

<div id="tab-itinerary" class="tab-panel active">${itineraryHtml}</div>
${showBookings ? `<div id="tab-bookings" class="tab-panel">${bookingsHtml}</div>` : ''}
${showBudget ? `<div id="tab-budget" class="tab-panel">${budgetHtml}</div>` : ''}
${showPrep ? `<div id="tab-prep" class="tab-panel">${prepHtml}</div>` : ''}

<div class="get-app">
  <p class="get-app-text">Shared via Tripseek</p>
  <a href="https://tripseekapp.com" class="get-app-btn">✦ Get Tripseek</a>
</div>

<script>
function showTab(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
  btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = makeCorsHeaders(req);

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
