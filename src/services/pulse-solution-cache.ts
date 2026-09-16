/**
 * In-memory cache for prepared pulse solutions.
 * Solutions are ephemeral — regenerated when the itinerary changes.
 * The pulse engine re-detects problems deterministically on every evaluation;
 * only the AI-generated fix is cached here.
 */

import type { Activity } from '@/context/trips';

export interface PreparedSolution {
  activities: Activity[];
  summary: string;
  changes: string[];
}

const solutionCache = new Map<string, PreparedSolution>();
const preparingSet = new Set<string>();

export function setPreparedSolution(alertId: string, solution: PreparedSolution): void {
  solutionCache.set(alertId, solution);
}

export function getPreparedSolution(alertId: string): PreparedSolution | undefined {
  return solutionCache.get(alertId);
}

export function clearPreparedSolution(alertId: string): void {
  solutionCache.delete(alertId);
}

export function hasPreparedSolution(alertId: string): boolean {
  return solutionCache.has(alertId);
}

export function markPreparing(alertId: string): void {
  preparingSet.add(alertId);
}

export function clearPreparing(alertId: string): void {
  preparingSet.delete(alertId);
}

export function isPreparing(alertId: string): boolean {
  return preparingSet.has(alertId);
}

/** Clear all cached solutions (e.g. when itinerary revision changes). */
export function clearAllSolutions(): void {
  solutionCache.clear();
  preparingSet.clear();
}
