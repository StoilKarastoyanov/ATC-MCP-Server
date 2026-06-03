import type { AirportConfig } from "../config/index.js";
import type { AirportState } from "../domain/airport-state.js";
import type { ScheduledSlot } from "../domain/schedule.js";
import type { FlightStatus, OperationType } from "../domain/types.js";

export interface ResourceUsage {
  capacity: number;
  /** Distinct resources with at least one scheduled operation. */
  inUse: number;
  /** Peak simultaneous usage across the active schedule. */
  peakConcurrent: number;
  utilizationPercent: number;
}

export interface FlightIssue {
  flightNumber: string;
  operationType: OperationType;
  status: FlightStatus;
  reason: string;
}

export interface AirportOperationalStatus {
  scheduleGenerated: boolean;
  scheduleCompletionMinute: number | null;
  flights: {
    total: number;
    byStatus: Record<FlightStatus, number>;
    byOperationType: Record<OperationType, number>;
  };
  resources: {
    runways: ResourceUsage;
    gates: ResourceUsage;
    groundCrew: ResourceUsage;
  };
  constraints: {
    scheduleNotGenerated: boolean;
    hasUnscheduledFlights: boolean;
    hasBlockedFlights: boolean;
    groundCrewAtCapacity: boolean;
    gatesFullyUtilizedAtPeak: boolean;
    runwaysFullyUtilizedAtPeak: boolean;
  };
  issues: {
    unscheduled: FlightIssue[];
    blocked: FlightIssue[];
  };
}

export function buildAirportStatus(
  config: AirportConfig,
  state: AirportState,
): AirportOperationalStatus {
  const slots = [...state.getSchedule()];
  const counts = state.getFlightCounts();
  const completionMinute = state.getScheduleCompletionMinute();

  const runwayPeak = peakUsageOnSingleResource(
    slots,
    config.runways.map((r) => r.id),
    (s) => s.runwayId,
  );
  const gatePeak = peakUsageOnSingleResource(
    slots,
    Array.from({ length: config.gateCount }, (_, i) => i + 1),
    (s) => s.gateId,
  );
  const crewPeak = peakConcurrentOperations(slots);

  const runwaysInUse = new Set(slots.map((s) => s.runwayId)).size;
  const gatesInUse = new Set(slots.map((s) => s.gateId)).size;

  const unscheduled = state
    .listFlights("unscheduled")
    .map((f) => flightIssue(f.flightNumber, f.operationType, f.status, f.unscheduledReason ?? "Unscheduled"));
  const blocked = state
    .listFlights("blocked")
    .map((f) => flightIssue(f.flightNumber, f.operationType, f.status, f.unscheduledReason ?? "Blocked"));

  const runwayCapacity = config.runways.length;
  const gateCapacity = config.gateCount;
  const crewCapacity = config.groundCrewCount;

  return {
    scheduleGenerated: state.hasSchedule(),
    scheduleCompletionMinute: completionMinute,
    flights: counts,
    resources: {
      runways: resourceUsage(runwayCapacity, runwaysInUse, runwayPeak),
      gates: resourceUsage(gateCapacity, gatesInUse, gatePeak),
      groundCrew: resourceUsage(crewCapacity, crewPeak, crewPeak),
    },
    constraints: {
      scheduleNotGenerated: !state.hasSchedule(),
      hasUnscheduledFlights: unscheduled.length > 0,
      hasBlockedFlights: blocked.length > 0,
      groundCrewAtCapacity: crewPeak >= crewCapacity,
      gatesFullyUtilizedAtPeak: gatePeak >= gateCapacity,
      runwaysFullyUtilizedAtPeak: runwayPeak >= runwayCapacity,
    },
    issues: { unscheduled, blocked },
  };
}

function resourceUsage(
  capacity: number,
  inUse: number,
  peakConcurrent: number,
): ResourceUsage {
  const utilizationPercent =
    capacity === 0 ? 0 : Math.round((peakConcurrent / capacity) * 100);
  return {
    capacity,
    inUse,
    peakConcurrent,
    utilizationPercent: Math.min(100, utilizationPercent),
  };
}

function flightIssue(
  flightNumber: string,
  operationType: OperationType,
  status: FlightStatus,
  reason: string,
): FlightIssue {
  return { flightNumber, operationType, status, reason };
}

function peakConcurrentOperations(slots: ScheduledSlot[]): number {
  if (slots.length === 0) {
    return 0;
  }
  const events: { t: number; delta: number }[] = [];
  for (const s of slots) {
    events.push({ t: s.startMinute, delta: 1 });
    events.push({ t: s.endMinute, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || b.delta - a.delta);
  let current = 0;
  let peak = 0;
  for (const e of events) {
    current += e.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/** Max peak concurrent usage on any single runway or gate. */
function peakUsageOnSingleResource(
  slots: ScheduledSlot[],
  resourceIds: number[],
  idOf: (slot: ScheduledSlot) => number,
): number {
  let max = 0;
  for (const id of resourceIds) {
    const onResource = slots.filter((s) => idOf(s) === id);
    max = Math.max(max, peakConcurrentOperations(onResource));
  }
  return max;
}
