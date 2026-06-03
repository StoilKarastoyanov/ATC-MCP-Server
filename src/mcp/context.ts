import type { AirportConfig } from "../config/index.js";
import type { AirportState } from "../domain/index.js";

export interface AppContext {
  config: AirportConfig;
  state: AirportState;
  serverName: string;
  serverVersion: string;
}
