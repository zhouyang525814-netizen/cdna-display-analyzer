// Central tool registry. Every analysis pipeline that ships in the app
// exports a Tool from its module and is listed here. The header switcher
// (App.tsx) renders one entry per tool in this array.

import type { Tool } from "./types";
import { cdnaDisplayTool } from "./cdna-display";
import { nanoporeSsmTool } from "./nanopore-ssm";

export const tools: ReadonlyArray<Tool> = [cdnaDisplayTool, nanoporeSsmTool];
export const DEFAULT_TOOL_ID = "cdna-display";

export function toolById(id: string): Tool {
  return tools.find((t) => t.id === id) ?? tools[0]!;
}
