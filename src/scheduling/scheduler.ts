import type { AirportConfig } from "../config/index.js";
import type { Flight } from "../domain/flight.js";
import type { ScheduledSlot } from "../domain/schedule.js";
import {
  PRIORITY_RANK,
  type FlightStatus,
  type OperationType,
} from "../domain/types.js";

export type FlightScheduleOutcome =
  | { status: "scheduled" }
  | { status: "unscheduled"; reason: string };

export interface ScheduleResult {
  slots: ScheduledSlot[];
  outcomes: Map<string, FlightScheduleOutcome>;
  /** Latest end minute among scheduled ops, or null if none. */
  completionMinute: number | null;
}

interface RunwayTrack {
  runwayId: number;
  lastEndMinute: number;
  lastOperation: OperationType | null;
}

interface GateTrack {
  gateId: number;
  availableFromMinute: number;
}

const SKIPPED_STATUSES: FlightStatus[] = ["cancelled", "blocked"];

export function generateSchedule(
  config: AirportConfig,
  flights: Flight[],
): ScheduleResult {
  const schedulable = flights.filter(
    (f) => !SKIPPED_STATUSES.includes(f.status),
  );
  const flightById = new Map(flights.map((f) => [f.flightNumber, f]));
  const outcomes = new Map<string, FlightScheduleOutcome>();
  const slots: ScheduledSlot[] = [];
  const endByFlight = new Map<string, number>();

  const order = topologicalOrder(schedulable);

  const runways: RunwayTrack[] = config.runways.map((r) => ({
    runwayId: r.id,
    lastEndMinute: 0,
    lastOperation: null,
  }));
  const gates: GateTrack[] = Array.from({ length: config.gateCount }, (_, i) => ({
    gateId: i + 1,
    availableFromMinute: 0,
  }));

  for (const flight of order) {
    const depReason = dependencyFailureReason(
      flight,
      flightById,
      outcomes,
      endByFlight,
    );
    if (depReason) {
      outcomes.set(flight.flightNumber, {
        status: "unscheduled",
        reason: depReason,
      });
      continue;
    }

    const duration = operationDurationMinutes(flight.operationType, config);
    const earliest = earliestStartMinute(flight, endByFlight, config);

    const eligibleRunways = config.runways.filter(
      (r) =>
        !flight.runwayRequirement ||
        r.lengthMeters >= flight.runwayRequirement.minLengthMeters,
    );
    if (eligibleRunways.length === 0) {
      outcomes.set(flight.flightNumber, {
        status: "unscheduled",
        reason: "No suitable runway available",
      });
      continue;
    }

    let best: ScheduledSlot | null = null;

    for (const runway of eligibleRunways) {
      const runwayTrack = runways.find((t) => t.runwayId === runway.id)!;
      for (const gate of gates) {
        const start = findFeasibleStart(
          earliest,
          duration,
          flight.operationType,
          runwayTrack,
          gate,
          slots,
          config,
        );
        if (start === null) {
          continue;
        }
        const candidate: ScheduledSlot = {
          flightNumber: flight.flightNumber,
          operationType: flight.operationType,
          runwayId: runway.id,
          gateId: gate.gateId,
          startMinute: start,
          endMinute: start + duration,
        };
        if (
          !best ||
          candidate.startMinute < best.startMinute ||
          (candidate.startMinute === best.startMinute &&
            (candidate.runwayId < best.runwayId ||
              (candidate.runwayId === best.runwayId &&
                candidate.gateId < best.gateId)))
        ) {
          best = candidate;
        }
      }
    }

    if (!best) {
      outcomes.set(flight.flightNumber, {
        status: "unscheduled",
        reason: resourceFailureReason(config),
      });
      continue;
    }

    if (best.endMinute > config.maxSchedulingHorizonMinutes) {
      outcomes.set(flight.flightNumber, {
        status: "unscheduled",
        reason: "Exceeds maximum scheduling horizon",
      });
      continue;
    }

    slots.push(best);
    outcomes.set(flight.flightNumber, { status: "scheduled" });
    endByFlight.set(flight.flightNumber, best.endMinute);

    const runwayTrack = runways.find((t) => t.runwayId === best!.runwayId)!;
    runwayTrack.lastEndMinute = best.endMinute;
    runwayTrack.lastOperation = flight.operationType;

    const gateTrack = gates.find((g) => g.gateId === best!.gateId)!;
    gateTrack.availableFromMinute =
      best.endMinute + config.gateTurnaroundMinutes;
  }

  slots.sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      a.flightNumber.localeCompare(b.flightNumber),
  );

  const completionMinute =
    slots.length > 0
      ? Math.max(...slots.map((s) => s.endMinute))
      : null;

  return { slots, outcomes, completionMinute };
}

function operationDurationMinutes(
  op: OperationType,
  config: AirportConfig,
): number {
  return op === "arrival"
    ? config.arrivalDurationMinutes
    : config.departureDurationMinutes;
}

function dependencyFailureReason(
  flight: Flight,
  flightById: Map<string, Flight>,
  outcomes: Map<string, FlightScheduleOutcome>,
  endByFlight: Map<string, number>,
): string | null {
  for (const depId of flight.dependencies) {
    const dep = flightById.get(depId);
    if (!dep) {
      return `Dependency ${depId} is unknown`;
    }
    if (dep.status === "cancelled") {
      return `Dependency ${depId} was cancelled`;
    }
    if (dep.status === "blocked") {
      return `Dependency ${depId} is blocked`;
    }
    const outcome = outcomes.get(depId);
    if (outcome?.status === "unscheduled") {
      return `Dependency ${depId} is unscheduled`;
    }
    if (!endByFlight.has(depId)) {
      return `Dependency ${depId} is not scheduled`;
    }
  }
  return null;
}

function earliestStartMinute(
  flight: Flight,
  endByFlight: Map<string, number>,
  config: AirportConfig,
): number {
  let start = 0;
  for (const depId of flight.dependencies) {
    const depEnd = endByFlight.get(depId)!;
    start = Math.max(start, depEnd + config.dependencyBufferMinutes);
  }
  return start;
}

function separationMinutes(
  previous: OperationType,
  next: OperationType,
  config: AirportConfig,
): number {
  if (previous === "arrival" && next === "arrival") {
    return config.separationLandingMinutes;
  }
  if (previous === "departure" && next === "departure") {
    return config.separationTakeoffMinutes;
  }
  return config.separationMixedMinutes;
}

function findFeasibleStart(
  earliest: number,
  duration: number,
  operationType: OperationType,
  runway: RunwayTrack,
  gate: GateTrack,
  existingSlots: ScheduledSlot[],
  config: AirportConfig,
): number | null {
  let start = Math.max(earliest, gate.availableFromMinute);
  if (runway.lastOperation !== null) {
    start = Math.max(
      start,
      runway.lastEndMinute +
        separationMinutes(runway.lastOperation, operationType, config),
    );
  }

  const horizon = config.maxSchedulingHorizonMinutes;
  const maxAttempts = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (start + duration > horizon) {
      return null;
    }
    if (!exceedsGroundCrewLimit(start, duration, existingSlots, config)) {
      return start;
    }
    start += 1;
    if (runway.lastOperation !== null) {
      start = Math.max(
        start,
        runway.lastEndMinute +
          separationMinutes(runway.lastOperation, operationType, config),
      );
    }
    start = Math.max(start, gate.availableFromMinute, earliest);
  }
  return null;
}

function exceedsGroundCrewLimit(
  start: number,
  duration: number,
  slots: ScheduledSlot[],
  config: AirportConfig,
): boolean {
  for (let t = start; t < start + duration; t++) {
    let count = 1;
    for (const s of slots) {
      if (s.startMinute <= t && t < s.endMinute) {
        count++;
      }
    }
    if (count > config.groundCrewCount) {
      return true;
    }
  }
  return false;
}

function resourceFailureReason(config: AirportConfig): string {
  return `No available runway, gate, or ground crew within ${config.maxSchedulingHorizonMinutes} minute horizon`;
}

/** Kahn topological sort; each wave sorted by priority then flight number. */
function topologicalOrder(flights: Flight[]): Flight[] {
  const flightSet = new Set(flights.map((f) => f.flightNumber));
  const inDegree = new Map<string, number>();
  const done = new Set<string>();

  for (const f of flights) {
    inDegree.set(f.flightNumber, 0);
  }
  for (const f of flights) {
    for (const dep of f.dependencies) {
      if (flightSet.has(dep)) {
        inDegree.set(
          f.flightNumber,
          (inDegree.get(f.flightNumber) ?? 0) + 1,
        );
      }
    }
  }

  const result: Flight[] = [];

  while (done.size < flights.length) {
    const ready = flights
      .filter(
        (f) =>
          !done.has(f.flightNumber) &&
          (inDegree.get(f.flightNumber) ?? 0) === 0,
      )
      .sort(compareSchedulingOrder);

    if (ready.length === 0) {
      for (const f of flights) {
        if (!done.has(f.flightNumber)) {
          result.push(f);
          done.add(f.flightNumber);
        }
      }
      break;
    }

    for (const flight of ready) {
      result.push(flight);
      done.add(flight.flightNumber);
      for (const other of flights) {
        if (other.dependencies.includes(flight.flightNumber)) {
          inDegree.set(
            other.flightNumber,
            (inDegree.get(other.flightNumber) ?? 1) - 1,
          );
        }
      }
    }
  }

  return result;
}

function compareSchedulingOrder(a: Flight, b: Flight): number {
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (pr !== 0) {
    return pr;
  }
  return a.flightNumber.localeCompare(b.flightNumber);
}
