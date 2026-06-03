import { z } from "zod";

/** Runway with 1-based id matching scheduling assignment order. */
export interface Runway {
  id: number;
  lengthMeters: number;
}

export interface AirportConfig {
  runways: Runway[];
  gateCount: number;
  groundCrewCount: number;
  /** Minutes between consecutive takeoffs on the same runway. */
  separationTakeoffMinutes: number;
  /** Minutes between consecutive landings on the same runway. */
  separationLandingMinutes: number;
  /** Minutes when mixing takeoff then landing (or vice versa) on same runway. */
  separationMixedMinutes: number;
  gateTurnaroundMinutes: number;
  dependencyBufferMinutes: number;
  maxSchedulingHorizonMinutes: number;
  /** Default block time for arrivals (used by scheduler in later steps). */
  arrivalDurationMinutes: number;
  /** Default block time for departures (used by scheduler in later steps). */
  departureDurationMinutes: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

const configSchema = z
  .object({
    runwayLengths: z
      .array(positiveInt)
      .min(1, "at least one runway length is required"),
    gateCount: positiveInt,
    groundCrewCount: positiveInt,
    separationTakeoffMinutes: nonNegativeInt,
    separationLandingMinutes: nonNegativeInt,
    separationMixedMinutes: nonNegativeInt,
    gateTurnaroundMinutes: positiveInt,
    dependencyBufferMinutes: nonNegativeInt,
    maxSchedulingHorizonMinutes: positiveInt,
    arrivalDurationMinutes: positiveInt,
    departureDurationMinutes: positiveInt,
  })
  .superRefine((data, ctx) => {
    if (data.separationMixedMinutes < data.separationTakeoffMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ATC_SEPARATION_MIXED_MINUTES must be >= ATC_SEPARATION_TAKEOFF_MINUTES",
        path: ["separationMixedMinutes"],
      });
    }
    if (data.separationMixedMinutes < data.separationLandingMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ATC_SEPARATION_MIXED_MINUTES must be >= ATC_SEPARATION_LANDING_MINUTES",
        path: ["separationMixedMinutes"],
      });
    }
  });

function parseRunwayLengths(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigError(
      "ATC_RUNWAY_LENGTHS is required (comma-separated meters, e.g. 2500,3000,3500)",
    );
  }
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => p === "")) {
    throw new ConfigError(
      "ATC_RUNWAY_LENGTHS must be comma-separated positive integers without empty entries",
    );
  }
  const lengths: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ConfigError(
        `ATC_RUNWAY_LENGTHS: invalid value "${part}" (expected positive integer meters)`,
      );
    }
    lengths.push(n);
  }
  return lengths;
}

function readOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

/**
 * Build config from a plain key/value map (process.env or test fixtures).
 * Throws ConfigError with a clear message on invalid or missing values.
 */
export function loadAirportConfig(
  env: NodeJS.ProcessEnv = process.env,
): AirportConfig {
  let runwayLengths: number[];
  try {
    runwayLengths = parseRunwayLengths(env.ATC_RUNWAY_LENGTHS);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(String(err));
  }

  const runwayCountCheck = readOptional(env, "ATC_RUNWAY_COUNT");
  if (runwayCountCheck !== undefined) {
    const expected = Number(runwayCountCheck);
    if (!Number.isInteger(expected) || expected <= 0) {
      throw new ConfigError(
        "ATC_RUNWAY_COUNT must be a positive integer when set",
      );
    }
    if (expected !== runwayLengths.length) {
      throw new ConfigError(
        `ATC_RUNWAY_COUNT (${expected}) must match the number of values in ATC_RUNWAY_LENGTHS (${runwayLengths.length})`,
      );
    }
  }

  const requiredKeys = [
    "ATC_GATE_COUNT",
    "ATC_GROUND_CREW_COUNT",
    "ATC_SEPARATION_TAKEOFF_MINUTES",
    "ATC_SEPARATION_LANDING_MINUTES",
    "ATC_SEPARATION_MIXED_MINUTES",
    "ATC_GATE_TURNAROUND_MINUTES",
    "ATC_DEPENDENCY_BUFFER_MINUTES",
    "ATC_MAX_SCHEDULING_HORIZON_MINUTES",
  ] as const;

  for (const key of requiredKeys) {
    if (env[key] === undefined || String(env[key]).trim() === "") {
      throw new ConfigError(`${key} is required`);
    }
  }

  const raw = {
    runwayLengths,
    gateCount: env.ATC_GATE_COUNT,
    groundCrewCount: env.ATC_GROUND_CREW_COUNT,
    separationTakeoffMinutes: env.ATC_SEPARATION_TAKEOFF_MINUTES,
    separationLandingMinutes: env.ATC_SEPARATION_LANDING_MINUTES,
    separationMixedMinutes: env.ATC_SEPARATION_MIXED_MINUTES,
    gateTurnaroundMinutes: env.ATC_GATE_TURNAROUND_MINUTES,
    dependencyBufferMinutes: env.ATC_DEPENDENCY_BUFFER_MINUTES,
    maxSchedulingHorizonMinutes: env.ATC_MAX_SCHEDULING_HORIZON_MINUTES,
    arrivalDurationMinutes:
      readOptional(env, "ATC_ARRIVAL_DURATION_MINUTES") ?? "30",
    departureDurationMinutes:
      readOptional(env, "ATC_DEPARTURE_DURATION_MINUTES") ?? "25",
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => {
        const field = i.path.join(".") || "config";
        return `${field}: ${i.message}`;
      })
      .join("; ");
    throw new ConfigError(`Invalid airport configuration: ${detail}`);
  }

  const data = result.data;
  const runways: Runway[] = data.runwayLengths.map((lengthMeters, index) => ({
    id: index + 1,
    lengthMeters,
  }));

  return {
    runways,
    gateCount: data.gateCount,
    groundCrewCount: data.groundCrewCount,
    separationTakeoffMinutes: data.separationTakeoffMinutes,
    separationLandingMinutes: data.separationLandingMinutes,
    separationMixedMinutes: data.separationMixedMinutes,
    gateTurnaroundMinutes: data.gateTurnaroundMinutes,
    dependencyBufferMinutes: data.dependencyBufferMinutes,
    maxSchedulingHorizonMinutes: data.maxSchedulingHorizonMinutes,
    arrivalDurationMinutes: data.arrivalDurationMinutes,
    departureDurationMinutes: data.departureDurationMinutes,
  };
}

/** Summary safe to expose via MCP (no secrets). */
export function configSummary(config: AirportConfig) {
  return {
    runwayCount: config.runways.length,
    runways: config.runways,
    gateCount: config.gateCount,
    groundCrewCount: config.groundCrewCount,
    separationTakeoffMinutes: config.separationTakeoffMinutes,
    separationLandingMinutes: config.separationLandingMinutes,
    separationMixedMinutes: config.separationMixedMinutes,
    gateTurnaroundMinutes: config.gateTurnaroundMinutes,
    dependencyBufferMinutes: config.dependencyBufferMinutes,
    maxSchedulingHorizonMinutes: config.maxSchedulingHorizonMinutes,
    arrivalDurationMinutes: config.arrivalDurationMinutes,
    departureDurationMinutes: config.departureDurationMinutes,
  };
}
