import type {
  FlightStatus,
  OperationType,
  Priority,
  RunwayRequirement,
} from "./types.js";

export interface Flight {
  flightNumber: string;
  operationType: OperationType;
  priority: Priority;
  /** Flight numbers that must complete before this one (e.g. connecting inbound). */
  dependencies: string[];
  runwayRequirement?: RunwayRequirement;
  status: FlightStatus;
  /** Why scheduling failed or why the flight is blocked. */
  unscheduledReason?: string;
  submittedAt: string;
}

export interface SubmitFlightInput {
  flightNumber: string;
  operationType: OperationType;
  priority: Priority;
  dependencies?: string[];
  runwayRequirement?: RunwayRequirement;
}

export interface FlightQueueEntry {
  flightNumber: string;
  operationType: OperationType;
  priority: Priority;
  dependencies: string[];
  runwayRequirement?: RunwayRequirement;
  status: FlightStatus;
  unscheduledReason?: string;
  submittedAt: string;
  /** Present when status is scheduled and a schedule exists. */
  scheduledSlot?: ScheduledSlotSummary;
}

export interface ScheduledSlotSummary {
  runwayId: number;
  gateId: number;
  startMinute: number;
  endMinute: number;
}
