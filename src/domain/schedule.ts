import type { OperationType } from "./types.js";

/** One timed operation on runway + gate in the active schedule. */
export interface ScheduledSlot {
  flightNumber: string;
  operationType: OperationType;
  runwayId: number;
  gateId: number;
  startMinute: number;
  endMinute: number;
}
