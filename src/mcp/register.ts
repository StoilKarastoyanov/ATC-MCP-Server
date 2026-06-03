import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

export function registerAtcHandlers(server: McpServer, ctx: AppContext): void {
  registerTools(server, ctx);
  registerResources(server, ctx);
}

export type { AppContext } from "./context.js";
