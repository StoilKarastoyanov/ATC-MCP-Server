import type { AirportConfig } from "../config/index.js";
import { generateSchedule, type ScheduleResult } from "../scheduling/index.js";
import { DomainError } from "./errors.js";
import type { Flight, FlightQueueEntry, SubmitFlightInput } from "./flight.js";
import type { ScheduledSlot } from "./schedule.js";
import type { FlightStatus, OperationType, Priority } from "./types.js";

export interface FlightCountSummary {
  total: number;
  byStatus: Record<FlightStatus, number>;
  byOperationType: Record<OperationType, number>;
}

export class AirportState {
  private readonly flights = new Map<string, Flight>();
  private schedule: ScheduledSlot[] = [];
  private scheduleGenerated = false;

  /** Submit a new flight into the queue. */
  submitFlight(input: SubmitFlightInput): Flight {
    const flightNumber = normalizeFlightNumber(input.flightNumber);
    if (this.flights.has(flightNumber)) {
      throw new DomainError(`Flight ${flightNumber} already exists`);
    }

    const dependencies = normalizeDependencies(input.dependencies);
    if (dependencies.includes(flightNumber)) {
      throw new DomainError(`Flight ${flightNumber} cannot depend on itself`);
    }
    for (const dep of dependencies) {
      if (!this.flights.has(dep)) {
        throw new DomainError(
          `Dependency ${dep} is unknown; submit it before ${flightNumber}`,
        );
      }
    }
    if (wouldCreateDependencyCycle(this.flights, flightNumber, dependencies)) {
      throw new DomainError(
        `Adding ${flightNumber} would create a circular dependency`,
      );
    }

    const flight: Flight = {
      flightNumber,
      operationType: input.operationType,
      priority: input.priority,
      dependencies,
      runwayRequirement: input.runwayRequirement,
      status: "queued",
      submittedAt: new Date().toISOString(),
    };
    this.flights.set(flightNumber, flight);
    return flight;
  }

  getFlight(flightNumber: string): Flight | undefined {
    return this.flights.get(normalizeFlightNumber(flightNumber));
  }

  listFlights(status?: FlightStatus): Flight[] {
    const all = [...this.flights.values()];
    if (status === undefined) {
      return all.sort(byFlightNumber);
    }
    return all.filter((f) => f.status === status).sort(byFlightNumber);
  }

  /** Snapshot for MCP resources and status tools. */
  getFlightQueue(): FlightQueueEntry[] {
    const slotByFlight = new Map(
      this.schedule.map((s) => [s.flightNumber, s] as const),
    );
    return this.listFlights().map((f) => {
      const slot = slotByFlight.get(f.flightNumber);
      const entry: FlightQueueEntry = {
        flightNumber: f.flightNumber,
        operationType: f.operationType,
        priority: f.priority,
        dependencies: [...f.dependencies],
        runwayRequirement: f.runwayRequirement,
        status: f.status,
        unscheduledReason: f.unscheduledReason,
        submittedAt: f.submittedAt,
      };
      if (f.status === "scheduled" && slot) {
        entry.scheduledSlot = {
          runwayId: slot.runwayId,
          gateId: slot.gateId,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
        };
      }
      return entry;
    });
  }

  getSchedule(): readonly ScheduledSlot[] {
    return this.schedule;
  }

  hasSchedule(): boolean {
    return this.scheduleGenerated;
  }

  /** Replace the active schedule (called by scheduler in a later step). */
  applySchedule(
    slots: ScheduledSlot[],
    flightOutcomes: Map<
      string,
      { status: "scheduled" } | { status: "unscheduled"; reason: string }
    >,
  ): void {
    this.schedule = [...slots].sort(
      (a, b) => a.startMinute - b.startMinute || a.flightNumber.localeCompare(b.flightNumber),
    );
    this.scheduleGenerated = true;

    for (const flight of this.flights.values()) {
      if (flight.status === "cancelled" || flight.status === "blocked") {
        continue;
      }
      const outcome = flightOutcomes.get(flight.flightNumber);
      if (!outcome) {
        flight.status = "queued";
        flight.unscheduledReason = undefined;
        continue;
      }
      if (outcome.status === "scheduled") {
        flight.status = "scheduled";
        flight.unscheduledReason = undefined;
      } else {
        flight.status = "unscheduled";
        flight.unscheduledReason = outcome.reason;
      }
    }
  }

  /** Clear schedule; queued flights return to queued unless cancelled/blocked. */
  resetSchedule(): void {
    this.schedule = [];
    this.scheduleGenerated = false;
    for (const flight of this.flights.values()) {
      if (flight.status === "cancelled" || flight.status === "blocked") {
        continue;
      }
      flight.status = "queued";
      flight.unscheduledReason = undefined;
    }
  }

  /**
   * Cancel a flight and block dependents that relied on it.
   * Returns flight numbers whose status changed (including the cancelled flight).
   */
  cancelFlight(flightNumber: string): string[] {
    const id = normalizeFlightNumber(flightNumber);
    const flight = this.flights.get(id);
    if (!flight) {
      throw new DomainError(`Flight ${id} not found`);
    }
    if (flight.status === "cancelled") {
      return [];
    }

    const affected = new Set<string>([id]);
    flight.status = "cancelled";
    flight.unscheduledReason = undefined;
    this.schedule = this.schedule.filter((s) => s.flightNumber !== id);

    const dependents = this.collectDependents(id);
    for (const depId of dependents) {
      const dep = this.flights.get(depId)!;
      if (dep.status === "cancelled") {
        continue;
      }
      dep.status = "blocked";
      dep.unscheduledReason = `Dependency ${id} was cancelled`;
      this.schedule = this.schedule.filter((s) => s.flightNumber !== depId);
      affected.add(depId);
    }

    return [...affected].sort();
  }

  /**
   * Compute a fresh schedule from the current queue and replace the active schedule.
   */
  runGenerateSchedule(config: AirportConfig): ScheduleResult {
    const result = generateSchedule(config, this.listFlights());
    this.applySchedule(result.slots, result.outcomes);
    return result;
  }

  getScheduleCompletionMinute(): number | null {
    if (this.schedule.length === 0) {
      return null;
    }
    return Math.max(...this.schedule.map((s) => s.endMinute));
  }

  getFlightCounts(): FlightCountSummary {
    const byStatus: Record<FlightStatus, number> = {
      queued: 0,
      scheduled: 0,
      unscheduled: 0,
      cancelled: 0,
      blocked: 0,
    };
    const byOperationType: Record<OperationType, number> = {
      arrival: 0,
      departure: 0,
    };
    for (const f of this.flights.values()) {
      byStatus[f.status]++;
      byOperationType[f.operationType]++;
    }
    return {
      total: this.flights.size,
      byStatus,
      byOperationType,
    };
  }

  private collectDependents(root: string): Set<string> {
    const blocked = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const flight of this.flights.values()) {
        if (blocked.has(flight.flightNumber) || flight.status === "cancelled") {
          continue;
        }
        if (flight.dependencies.some((d) => d === root || blocked.has(d))) {
          if (!blocked.has(flight.flightNumber)) {
            blocked.add(flight.flightNumber);
            changed = true;
          }
        }
      }
    }
    return blocked;
  }
}

export function createAirportState(): AirportState {
  return new AirportState();
}

function normalizeFlightNumber(raw: string): string {
  const id = raw.trim().toUpperCase();
  if (!id) {
    throw new DomainError("flightNumber is required");
  }
  return id;
}

function normalizeDependencies(deps: string[] | undefined): string[] {
  if (!deps?.length) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of deps) {
    const id = d.trim().toUpperCase();
    if (!id) {
      throw new DomainError("dependencies must not contain empty flight numbers");
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function byFlightNumber(a: Flight, b: Flight): number {
  return a.flightNumber.localeCompare(b.flightNumber);
}

/**
 * Adding `target` depending on `dependencies` creates a cycle if any dependency
 * already (transitively) depends on `target` (must complete before target).
 */
/** @internal Exported for unit tests of cycle detection logic. */
export function wouldCreateDependencyCycle(
  flights: Map<string, Flight>,
  target: string,
  dependencies: string[],
): boolean {
  return dependencies.some((dep) =>
    hasDependencyPathTo(flights, dep, target),
  );
}

function hasDependencyPathTo(
  flights: Map<string, Flight>,
  from: string,
  to: string,
  visiting = new Set<string>(),
): boolean {
  if (from === to) {
    return true;
  }
  if (visiting.has(from)) {
    return false;
  }
  visiting.add(from);
  const flight = flights.get(from);
  if (!flight) {
    visiting.delete(from);
    return false;
  }
  for (const dep of flight.dependencies) {
    if (hasDependencyPathTo(flights, dep, to, visiting)) {
      return true;
    }
  }
  visiting.delete(from);
  return false;
}
