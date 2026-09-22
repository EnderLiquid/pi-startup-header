import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export type Rgb = [number, number, number];
export type HeaderColorConfigValue = ThemeColor | `#${string}` | number;

type HeaderColorSource =
  | {
      kind: "theme";
      token: ThemeColor;
    }
  | {
      kind: "rgb";
      value: Rgb;
    };

const ANSI_RESET = "\x1b[0m";
const HEX_RGB_PATTERN = /^#[0-9a-fA-F]{6}$/;
const NUMERIC_STRING_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

const ANSI_16_RGB_TABLE: Rgb[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function isHexRgb(value: unknown): value is `#${string}` {
  return typeof value === "string" && HEX_RGB_PATTERN.test(value);
}

/**
 * 判定某个前景色 token 是否被当前 Pi 认识。
 *
 * Pi 的 ThemeColor 联合体会随版本增删，扩展发布后无法通过编译期检查发现这种变化，
 * 因此不用静态名单，改为向主题实例探测。判定依据是 Theme#getFgAnsi 对未知 token
 * 会抛错，这与 HeaderColor.toRgb() 取值走的是同一个方法，两边判断标准一致。
 *
 * 该抛错行为未写入类型契约，属于实现细节；若 Pi 将来改为静默回退，非空校验能挡住
 * 一部分情形，但无法完全区分，因此渲染期仍保留取值兜底。
 */
export type ThemeColorGuard = (token: string) => boolean;

export function createThemeColorGuard(theme: Theme): ThemeColorGuard {
  return (token) => {
    try {
      return theme.getFgAnsi(token as ThemeColor).length > 0;
    } catch {
      return false;
    }
  };
}

function ansi16ToRgb(index: number): Rgb {
  return ANSI_16_RGB_TABLE[index] ?? [255, 255, 255];
}

function ansi256ToRgb(index: number): Rgb {
  if (index < 16) return ansi16ToRgb(index);

  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return [gray, gray, gray];
  }

  const cubeIndex = index - 16;
  const redIndex = Math.floor(cubeIndex / 36);
  const greenIndex = Math.floor((cubeIndex % 36) / 6);
  const blueIndex = cubeIndex % 6;
  const values = [0, 95, 135, 175, 215, 255];

  return [values[redIndex]!, values[greenIndex]!, values[blueIndex]!];
}

function parseHexRgb(hex: `#${string}`): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function parseTruecolorAnsi(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseAnsi256Foreground(ansi: string): Rgb | undefined {
  const match = ansi.match(/38;5;(\d+)/);
  if (!match) return undefined;

  return ansi256ToRgb(Number(match[1]));
}

function parseAnsi16Foreground(ansi: string): Rgb | undefined {
  const normalMatch = ansi.match(/(?:\[|;)(3[0-7])(?:;|m)/);
  if (normalMatch) {
    return ansi16ToRgb(Number(normalMatch[1]) - 30);
  }

  const brightMatch = ansi.match(/(?:\[|;)(9[0-7])(?:;|m)/);
  if (brightMatch) {
    return ansi16ToRgb(Number(brightMatch[1]) - 90 + 8);
  }

  return undefined;
}

function parseForegroundRgbFromAnsi(ansi: string): Rgb | undefined {
  return parseTruecolorAnsi(ansi) ?? parseAnsi256Foreground(ansi) ?? parseAnsi16Foreground(ansi);
}

export function paintRgb(rgb: Rgb, text: string): string {
  const [red, green, blue] = rgb;
  return `\x1b[38;2;${red};${green};${blue}m${text}${ANSI_RESET}`;
}

export class HeaderColor {
  private constructor(private readonly source: HeaderColorSource) {}

  static fromThemeColor(token: ThemeColor): HeaderColor {
    return new HeaderColor({ kind: "theme", token });
  }

  /**
   * 按配置值的形状解析颜色。
   *
   * token 是否合法由调用方传入的 guard 判定：合法性取决于运行时 Pi 版本，
   * 扩展无法在编译期得知。Hex 与 256 色索引与版本无关，只做格式校验。
   */
  static parse(value: unknown, path: string, guard: ThemeColorGuard): HeaderColor {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
      return new HeaderColor({ kind: "rgb", value: ansi256ToRgb(value) });
    }

    if (isHexRgb(value)) {
      return new HeaderColor({ kind: "rgb", value: parseHexRgb(value) });
    }

    if (typeof value === "string" && value.length > 0) {
      if (value.startsWith("#")) {
        throw new Error(`${path} must be a 6-digit #RRGGBB value`);
      }

      // 256 色索引写成字符串是最常见的误用；若直接落进 token 判定，
      // 报错会被引向"色名拼错"的方向，这里单独提示应写成 JSON 数字。
      if (NUMERIC_STRING_PATTERN.test(value)) {
        throw new Error(`${path} must be an integer from 0 to 255, not a string: ${value}`);
      }

      if (!guard(value)) {
        throw new Error(`${path} is not a theme color known to the running Pi: ${value}`);
      }

      return HeaderColor.fromThemeColor(value as ThemeColor);
    }

    throw new Error(`${path} must be a ThemeColor, #RRGGBB value, or integer from 0 to 255`);
  }

  toRgb(theme: Theme): Rgb | undefined {
    if (this.source.kind === "rgb") {
      return this.source.value;
    }

    try {
      return parseForegroundRgbFromAnsi(theme.getFgAnsi(this.source.token));
    } catch {
      return undefined;
    }
  }

  paint(theme: Theme, text: string): string {
    if (this.source.kind === "rgb") {
      return paintRgb(this.source.value, text);
    }

    try {
      return theme.fg(this.source.token, text);
    } catch {
      return text;
    }
  }
}
