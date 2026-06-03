import type { AirportConfig } from "../config/index.js";
import type { Flight } from "../domain/flight.js";
import type { ScheduledSlot } from "../domain/schedule.js";
import type { OperationType } from "../domain/types.js";

export interface BottleneckFlightStep {
  flightNumber: string;
  operationType: OperationType;
  startMinute: number;
  endMinute: number;
  operationDurationMinutes: number;
  /** Minutes after the previous flight in the chain ends (0 for the first). */
  dependencyBufferMinutes: number;
  waitAfterDependencyMinutes: number;
}

export interface BottleneckAnalysis {
  hasChain: boolean;
  /** Flights in dependency order (earliest predecessor first). */
  chain: BottleneckFlightStep[];
  totalElapsedMinutes: number;
  /** Wall-clock span from first operation start to last operation end in the chain. */
  chainStartMinute: number | null;
  chainEndMinute: number | null;
  message?: string;
}

interface ChainCandidate {
  flights: string[];
  startMinute: number;
  endMinute: number;
}

/**
 * Longest dependency chain among scheduled flights, using actual schedule times.
 * Elapsed = last end − first start (includes buffers and resource waits).
 */
export function analyzeBottleneck(
  config: AirportConfig,
  flights: Flight[],
  slots: readonly ScheduledSlot[],
): BottleneckAnalysis {
  const slotByFlight = new Map(slots.map((s) => [s.flightNumber, s]));
  const scheduledIds = new Set(
    flights
      .filter((f) => f.status === "scheduled" && slotByFlight.has(f.flightNumber))
      .map((f) => f.flightNumber),
  );

  if (scheduledIds.size === 0) {
    return {
      hasChain: false,
      chain: [],
      totalElapsedMinutes: 0,
      chainStartMinute: null,
      chainEndMinute: null,
      message: "No scheduled flights in the active schedule",
    };
  }

  const flightById = new Map(flights.map((f) => [f.flightNumber, f]));
  const bestEndingAt = new Map<string, ChainCandidate>();

  const byIdSorted = [...scheduledIds].sort();
  for (const id of byIdSorted) {
    const slot = slotByFlight.get(id)!;
    const flight = flightById.get(id)!;
    const scheduledDeps = flight.dependencies.filter((d) => scheduledIds.has(d));

    let best: ChainCandidate = {
      flights: [id],
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
    };

    for (const depId of scheduledDeps) {
      const depChain = bestEndingAt.get(depId);
      if (!depChain) {
        continue;
      }
      const candidate: ChainCandidate = {
        flights: [...depChain.flights, id],
        startMinute: depChain.startMinute,
        endMinute: slot.endMinute,
      };
      if (
        candidate.endMinute - candidate.startMinute >
        best.endMinute - best.startMinute
      ) {
        best = candidate;
      }
    }

    bestEndingAt.set(id, best);
  }

  let longest: ChainCandidate | null = null;
  for (const candidate of bestEndingAt.values()) {
    if (
      !longest ||
      candidate.endMinute - candidate.startMinute >
        longest.endMinute - longest.startMinute
    ) {
      longest = candidate;
    }
  }

  if (!longest || longest.flights.length === 0) {
    return {
      hasChain: false,
      chain: [],
      totalElapsedMinutes: 0,
      chainStartMinute: null,
      chainEndMinute: null,
      message: "No active dependency chain found",
    };
  }

  const chain = buildChainSteps(
    longest.flights,
    slotByFlight,
    flightById,
    config,
  );
  const totalElapsed = longest.endMinute - longest.startMinute;

  return {
    hasChain: true,
    chain,
    totalElapsedMinutes: totalElapsed,
    chainStartMinute: longest.startMinute,
    chainEndMinute: longest.endMinute,
  };
}

function buildChainSteps(
  flightIds: string[],
  slotByFlight: Map<string, ScheduledSlot>,
  flightById: Map<string, Flight>,
  config: AirportConfig,
): BottleneckFlightStep[] {
  const steps: BottleneckFlightStep[] = [];
  for (let i = 0; i < flightIds.length; i++) {
    const id = flightIds[i]!;
    const slot = slotByFlight.get(id)!;
    const flight = flightById.get(id)!;
    const duration = slot.endMinute - slot.startMinute;
    let buffer = 0;
    let wait = 0;
    if (i > 0) {
      const prevId = flightIds[i - 1]!;
      const prevSlot = slotByFlight.get(prevId)!;
      buffer = config.dependencyBufferMinutes;
      wait = Math.max(0, slot.startMinute - prevSlot.endMinute - buffer);
    }
    steps.push({
      flightNumber: id,
      operationType: flight.operationType,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      operationDurationMinutes: duration,
      dependencyBufferMinutes: buffer,
      waitAfterDependencyMinutes: wait,
    });
  }
  return steps;
}
