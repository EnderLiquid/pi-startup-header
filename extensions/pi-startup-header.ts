import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createThemeColorGuard } from "./shared/header-color.ts";
import {
  EMPTY_STARTUP_HEADER_CONFIG,
  configurationWarning,
  loadStartupHeaderConfig,
} from "./shared/header-config.ts";
import { renderHeaderLines } from "./shared/header-renderer.ts";

const CONFIG_FILE_NAME = "pi-startup-header.json";

export default function piStartupHeader(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    let config = EMPTY_STARTUP_HEADER_CONFIG;

    try {
      config = await loadStartupHeaderConfig(
        join(getAgentDir(), CONFIG_FILE_NAME),
        createThemeColorGuard(ctx.ui.theme),
      );
    } catch (error) {
      ctx.ui.notify(configurationWarning(error), "warning");
    }

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        return renderHeaderLines(width, theme, config);
      },
      invalidate() {},
    }));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setHeader(undefined);
  });
}
