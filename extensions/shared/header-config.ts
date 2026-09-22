import { readFile } from "node:fs/promises";
import {
  HeaderColor,
  type HeaderColorConfigValue,
  type ThemeColorGuard,
} from "./header-color.ts";

const HEADER_COLOR_KEYS = ["logoGradientBase", "textBase", "textHighlight"] as const;
const THEME_OVERRIDE_KEYS = ["theme", ...HEADER_COLOR_KEYS] as const;
const CONFIGURATION_KEYS = ["general", "themeOverrides"] as const;

type HeaderColorKey = (typeof HEADER_COLOR_KEYS)[number];

export type HeaderColorConfig = Partial<Record<HeaderColorKey, HeaderColorConfigValue>>;
type HeaderColorSettings = Partial<Record<HeaderColorKey, HeaderColor>>;
export type EffectiveHeaderColorSettings = Required<HeaderColorSettings>;
type ThemeOverride = HeaderColorSettings & {
  theme: string;
};
export type StartupHeaderConfig = {
  general?: HeaderColorSettings;
  themeOverrides?: ThemeOverride[];
};

const CONFIGURATION_WARNING =
  "Failed to load pi-startup-header configuration. Using default colors.";

const DEFAULT_HEADER_COLOR_CONFIG = {
  logoGradientBase: "accent",
  textBase: "accent",
  textHighlight: "mdLink",
} as const satisfies Required<HeaderColorConfig>;

export const DEFAULT_HEADER_COLORS = {
  logoGradientBase: HeaderColor.fromThemeColor(DEFAULT_HEADER_COLOR_CONFIG.logoGradientBase),
  textBase: HeaderColor.fromThemeColor(DEFAULT_HEADER_COLOR_CONFIG.textBase),
  textHighlight: HeaderColor.fromThemeColor(DEFAULT_HEADER_COLOR_CONFIG.textHighlight),
} as const satisfies EffectiveHeaderColorSettings;

export const EMPTY_STARTUP_HEADER_CONFIG: StartupHeaderConfig = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${path} contains an unknown field: ${key}`);
    }
  }
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return value;
}

function parseHeaderColorSettings(
  value: unknown,
  path: string,
  guard: ThemeColorGuard,
): HeaderColorSettings {
  const settings = expectRecord(value, path);
  assertKnownKeys(settings, HEADER_COLOR_KEYS, path);

  const result: HeaderColorSettings = {};
  for (const key of HEADER_COLOR_KEYS) {
    if (Object.hasOwn(settings, key)) {
      result[key] = HeaderColor.parse(settings[key], `${path}.${key}`, guard);
    }
  }

  return result;
}

function parseThemeOverride(
  value: unknown,
  index: number,
  guard: ThemeColorGuard,
): ThemeOverride {
  const path = `themeOverrides[${index}]`;
  const override = expectRecord(value, path);
  assertKnownKeys(override, THEME_OVERRIDE_KEYS, path);

  if (typeof override.theme !== "string" || override.theme.length === 0) {
    throw new Error(`${path}.theme must be a non-empty string`);
  }

  const colors: HeaderColorSettings = {};
  for (const key of HEADER_COLOR_KEYS) {
    if (Object.hasOwn(override, key)) {
      colors[key] = HeaderColor.parse(override[key], `${path}.${key}`, guard);
    }
  }

  return { theme: override.theme, ...colors };
}

export function parseStartupHeaderConfig(
  value: unknown,
  guard: ThemeColorGuard,
): StartupHeaderConfig {
  const config = expectRecord(value, "configuration");
  assertKnownKeys(config, CONFIGURATION_KEYS, "configuration");

  const result: StartupHeaderConfig = {};

  if (Object.hasOwn(config, "general")) {
    result.general = parseHeaderColorSettings(config.general, "general", guard);
  }

  if (Object.hasOwn(config, "themeOverrides")) {
    if (!Array.isArray(config.themeOverrides)) {
      throw new Error("themeOverrides must be an array");
    }

    const themeNames = new Set<string>();
    result.themeOverrides = config.themeOverrides.map((override, index) => {
      const parsedOverride = parseThemeOverride(override, index, guard);
      if (themeNames.has(parsedOverride.theme)) {
        throw new Error(`themeOverrides contains a duplicate theme: ${parsedOverride.theme}`);
      }
      themeNames.add(parsedOverride.theme);
      return parsedOverride;
    });
  }

  return result;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/**
 * 组合配置失败警告，保留底层错误信息。
 */
export function configurationWarning(error: unknown): string {
  return `${CONFIGURATION_WARNING} (${errorMessage(error)})`;
}

export async function loadStartupHeaderConfig(
  path: string,
  guard: ThemeColorGuard,
): Promise<StartupHeaderConfig> {
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return EMPTY_STARTUP_HEADER_CONFIG;
    }

    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${errorMessage(error)}`);
  }

  return parseStartupHeaderConfig(json, guard);
}

export function resolveHeaderColorSettings(
  config: StartupHeaderConfig,
  themeName: string | undefined,
): EffectiveHeaderColorSettings {
  const themeOverride = themeName
    ? config.themeOverrides?.find((override) => override.theme === themeName)
    : undefined;

  return {
    logoGradientBase:
      themeOverride?.logoGradientBase ??
      config.general?.logoGradientBase ??
      DEFAULT_HEADER_COLORS.logoGradientBase,
    textBase: themeOverride?.textBase ?? config.general?.textBase ?? DEFAULT_HEADER_COLORS.textBase,
    textHighlight:
      themeOverride?.textHighlight ??
      config.general?.textHighlight ??
      DEFAULT_HEADER_COLORS.textHighlight,
  };
}
