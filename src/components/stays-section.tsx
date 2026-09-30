/**
 * Shared types for stays data. Used by stays-strip, stay-card, night-timeline, etc.
 */
import type { Activity, Reservation } from '@/context/trips';

export interface StayBlock {
  hotel: Activity;
  reservation?: Reservation;
  checkInDay: number;
  checkOutDay: number;
  nights: number[];
}

export interface StaysData {
  blocks: StayBlock[];
  uncoveredRanges: { start: number; end: number }[];
  hasAnyStay: boolean;
}
