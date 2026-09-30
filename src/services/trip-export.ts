/**
 * Trip PDF export service.
 * Generates a formatted HTML itinerary and exports it as a PDF via expo-print.
 */

import * as Print from 'expo-print';
import { Share } from 'react-native';
import type { Trip, Activity, Reservation } from '@/context/trips';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDayHeading(day: number, startDate?: string, datesKnown?: boolean): string {
  if (!datesKnown || !startDate) return `Day ${day}`;
  const base = new Date(startDate);
  base.setDate(base.getDate() + (day - 1));
  const label = base.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return `Day ${day} — ${label}`;
}

function formatTime(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function typeEmoji(type: Activity['type']): string {
  switch (type) {
    case 'flight': return '✈️';
    case 'hotel': return '🏨';
    case 'food': return '🍽️';
    default: return '📍';
  }
}

function costLabel(cost?: Activity['cost']): string {
  switch (cost) {
    case 'free': return 'Free';
    case 'budget': return '$';
    case 'moderate': return '$$';
    case 'premium': return '$$$';
    default: return '';
  }
}

// ─── HTML Generation ────────────────────────────────────────────────────────

export function generateTripHTML(trip: Trip): string {
  const totalDays = (() => {
    if (!trip.startDate || !trip.endDate) return 1;
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  })();

  // Group activities by day
  const byDay = new Map<number, Activity[]>();
  for (let d = 1; d <= totalDays; d++) byDay.set(d, []);
  for (const a of trip.activities) {
    const bucket = byDay.get(a.day) ?? [];
    bucket.push(a);
    byDay.set(a.day, bucket);
  }

  // Sort each day by time
  for (const [d, acts] of byDay) {
    byDay.set(d, acts.sort((a, b) => {
      const [ah, am] = (a.time || '00:00').split(':').map(Number);
      const [bh, bm] = (b.time || '00:00').split(':').map(Number);
      return (ah * 60 + am) - (bh * 60 + bm);
    }));
  }

  const activeReservations = (trip.reservations ?? []).filter(r => !r.cancelled);

  // ── Day rows ───────────────────────────────────────────────────────────────
  let daysHTML = '';
  for (let d = 1; d <= totalDays; d++) {
    const acts = byDay.get(d) ?? [];
    const heading = formatDayHeading(d, trip.startDate, trip.datesKnown);

    let activitiesHTML = '';
    if (acts.length === 0) {
      activitiesHTML = '<p style="color:#999;font-style:italic;margin:4px 0 0 28px;">No activities planned</p>';
    } else {
      for (const a of acts) {
        const costStr = costLabel(a.cost);
        activitiesHTML += `
          <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
            <span style="font-size:16px;margin-right:10px;margin-top:1px;">${typeEmoji(a.type)}</span>
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span style="font-weight:600;font-size:14px;color:#111;">${escapeHTML(a.title)}</span>
                ${a.time ? `<span style="font-size:12px;color:#888;">${formatTime(a.time)}</span>` : ''}
              </div>
              ${a.address ? `<div style="font-size:12px;color:#666;margin-top:2px;">📍 ${escapeHTML(a.address)}</div>` : ''}
              ${costStr ? `<div style="font-size:11px;color:#888;margin-top:1px;">${costStr}</div>` : ''}
              ${a.notes ? `<div style="font-size:12px;color:#555;margin-top:3px;font-style:italic;">${escapeHTML(a.notes)}</div>` : ''}
            </div>
          </div>`;
      }
    }

    daysHTML += `
      <div style="margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:#007AFF;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;padding-bottom:6px;border-bottom:1.5px solid #007AFF20;">
          ${escapeHTML(heading)}
        </div>
        ${activitiesHTML}
      </div>`;
  }

  // ── Reservations section ──────────────────────────────────────────────────
  let reservationsHTML = '';
  if (activeReservations.length > 0) {
    let rows = '';
    for (const r of activeReservations) {
      rows += `
        <div style="border:1px solid #e5e5ea;border-radius:10px;padding:12px;margin-bottom:10px;">
          <div style="font-weight:600;font-size:14px;color:#111;">${escapeHTML(r.title)}</div>
          ${r.confirmationNumber ? `<div style="font-size:12px;color:#555;margin-top:3px;">Confirmation: <strong>${escapeHTML(r.confirmationNumber)}</strong></div>` : ''}
          ${r.date ? `<div style="font-size:12px;color:#666;margin-top:2px;">${formatDate(r.date)}</div>` : ''}
          ${r.address ? `<div style="font-size:12px;color:#666;margin-top:2px;">📍 ${escapeHTML(r.address)}</div>` : ''}
          ${r.price ? `<div style="font-size:12px;color:#666;margin-top:2px;">💳 ${r.currency ?? ''}${r.price}</div>` : ''}
          ${r.notes ? `<div style="font-size:12px;color:#555;margin-top:4px;font-style:italic;">${escapeHTML(r.notes)}</div>` : ''}
        </div>`;
    }
    reservationsHTML = `
      <div style="margin-top:32px;">
        <div style="font-size:16px;font-weight:700;color:#111;margin-bottom:14px;">Reservations</div>
        ${rows}
      </div>`;
  }

  // ── Notes section ─────────────────────────────────────────────────────────
  const notesHTML = trip.notes ? `
    <div style="margin-top:32px;">
      <div style="font-size:16px;font-weight:700;color:#111;margin-bottom:10px;">Notes</div>
      <p style="font-size:14px;color:#444;line-height:1.6;margin:0;">${escapeHTML(trip.notes)}</p>
    </div>` : '';

  // ── Header ────────────────────────────────────────────────────────────────
  const title = escapeHTML(trip.title ?? trip.destination);
  const dateRange = trip.datesKnown
    ? `${formatDate(trip.startDate)} → ${formatDate(trip.endDate)}`
    : `${totalDays} day${totalDays !== 1 ? 's' : ''}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica Neue, Arial, sans-serif; background: #fff; color: #111; padding: 32px 28px; max-width: 680px; margin: 0 auto; }
  </style>
</head>
<body>
  <!-- Trip header -->
  <div style="margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #111;">
    <div style="font-size:28px;font-weight:800;color:#111;margin-bottom:6px;">${title}</div>
    <div style="font-size:15px;color:#555;">${escapeHTML(trip.destination)}${trip.country && trip.country !== trip.destination ? `, ${escapeHTML(trip.country)}` : ''}</div>
    <div style="font-size:14px;color:#888;margin-top:4px;">${dateRange}</div>
    <div style="font-size:11px;color:#bbb;margin-top:10px;text-transform:uppercase;letter-spacing:0.5px;">Created with Tripseek</div>
  </div>

  <!-- Itinerary -->
  <div style="font-size:16px;font-weight:700;color:#111;margin-bottom:16px;">Itinerary</div>
  ${daysHTML}

  ${reservationsHTML}
  ${notesHTML}
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Generate and share a PDF of the trip itinerary.
 * Opens the native share sheet so the user can save, print, or send it.
 */
export async function exportTripPDF(trip: Trip): Promise<void> {
  const html = generateTripHTML(trip);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const filename = `${(trip.title ?? trip.destination).replace(/[^a-z0-9]/gi, '_').toLowerCase()}_itinerary.pdf`;
  await Share.share({
    url: uri,
    title: filename,
  });
}
