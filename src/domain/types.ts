/** Inbound (landing) or outbound (takeoff). */
export type OperationType = "arrival" | "departure";

export type Priority = "high" | "medium" | "low";

/**
 * Lifecycle of a flight in the queue.
 * - queued: submitted, not yet placed (or schedule cleared)
 * - scheduled: present in the current generated schedule
 * - unscheduled: schedule attempted but could not place (see unscheduledReason)
 * - cancelled: explicitly cancelled
 * - blocked: cannot proceed (e.g. depends on cancelled flight)
 */
export type FlightStatus =
  | "queued"
  | "scheduled"
  | "unscheduled"
  | "cancelled"
  | "blocked";

export const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export interface RunwayRequirement {
  minLengthMeters: number;
}
