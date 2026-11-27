import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { colorToRgb, parseColor, type RgbColorValue } from "@earendil-works/pi-tui";

export type HeaderColor = ThemeColor | RgbColorValue;
export type ThemeColorGuard = (token: string) => token is ThemeColor;

const HEX_RGB_PATTERN = /^#[0-9a-fA-F]{6}$/;
const NUMERIC_STRING_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

export function createThemeColorGuard(theme: Pick<Theme, "style">): ThemeColorGuard {
  return (token): token is ThemeColor => {
    try {
      // 由 Pi 校验色名是否属于前景色槽位。
      theme.style("", { fg: token as ThemeColor });
      return true;
    } catch {
      return false;
    }
  };
}

function parseRgb(value: string | number): RgbColorValue {
  return { kind: "rgb", ...colorToRgb(parseColor(value)) };
}

export function parseHeaderColor(value: unknown, path: string, isThemeColor: ThemeColorGuard): HeaderColor {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return parseRgb(value);
  }

  if (typeof value === "string" && value.length > 0) {
    if (value.startsWith("#")) {
      if (!HEX_RGB_PATTERN.test(value)) {
        throw new Error(`${path} must be a 6-digit #RRGGBB value`);
      }
      return parseRgb(value);
    }

    if (NUMERIC_STRING_PATTERN.test(value)) {
      throw new Error(`${path} must be an integer from 0 to 255, not a string: ${value}`);
    }

    if (isThemeColor(value)) return value;
    throw new Error(`${path} is not a theme color known to the running Pi: ${value}`);
  }

  throw new Error(`${path} must be a ThemeColor, #RRGGBB value, or integer from 0 to 255`);
}
