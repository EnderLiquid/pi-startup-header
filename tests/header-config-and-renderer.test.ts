import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Theme } from "@earendil-works/pi-coding-agent";
import { colorToRgb, rgbColor, type TerminalColorMode } from "@earendil-works/pi-tui";
import { createThemeColorGuard, parseHeaderColor } from "../extensions/shared/header-color.ts";
import {
  EMPTY_STARTUP_HEADER_CONFIG,
  configurationWarning,
  loadStartupHeaderConfig,
  parseStartupHeaderConfig,
  resolveHeaderColorSettings,
} from "../extensions/shared/header-config.ts";
import {
  LOGO_BLOCK_WIDTH,
  LOGO_LINES,
  getLogoGradientPosition,
  renderHeaderLines,
} from "../extensions/shared/header-renderer.ts";

function createTheme(mode: TerminalColorMode = "truecolor"): Theme {
  // 主题只定义测试涉及的色名和 Pi 可选色的回退来源。
  return new Theme(
    {
      accent: "#90adb1",
      success: "#33ff66",
      muted: 8,
      text: "",
      thinkingXhigh: 13,
      mdHeading: "#aa44ff",
      mdLink: "#7aa2f7",
    } as ConstructorParameters<typeof Theme>[0],
    { selectedBg: 8 } as ConstructorParameters<typeof Theme>[1],
    mode,
    { name: "test-theme", appearance: "dark" },
  );
}

const theme = createTheme();
const isThemeColor = createThemeColorGuard(theme);
const tempConfigPaths: string[] = [];

function createTempConfigPath(): string {
  const path = join(tmpdir(), `pi-startup-header-${randomUUID()}.json`);
  tempConfigPaths.push(path);
  return path;
}

after(() => {
  for (const path of tempConfigPaths) {
    rmSync(path, { force: true });
  }
});

test("未配置时使用主题的 accent 与 mdLink", () => {
  assert.deepEqual(resolveHeaderColorSettings(EMPTY_STARTUP_HEADER_CONFIG, theme.name), {
    logoGradientBase: "accent",
    textBase: "accent",
    textHighlight: "mdLink",
  });
});

test("不存在配置文件时静默使用默认配置", async () => {
  const path = createTempConfigPath();

  assert.equal(await loadStartupHeaderConfig(path, isThemeColor), EMPTY_STARTUP_HEADER_CONFIG);
});

test("主题覆盖、通用配置和默认颜色按字段合并", () => {
  const config = parseStartupHeaderConfig({
    general: { logoGradientBase: "success", textBase: "#112233" },
    themeOverrides: [{ theme: "test-theme", logoGradientBase: "thinkingMax", textHighlight: "mdHeading" }],
  }, isThemeColor);

  assert.deepEqual(resolveHeaderColorSettings(config, theme.name), {
    logoGradientBase: "thinkingMax",
    textBase: rgbColor(17, 34, 51),
    textHighlight: "mdHeading",
  });
  for (const name of ["other-theme", "Test-theme", undefined]) {
    assert.deepEqual(resolveHeaderColorSettings(config, name), {
      logoGradientBase: "success",
      textBase: rgbColor(17, 34, 51),
      textHighlight: "mdLink",
    });
  }
});

test("配置保留 Pi 识别的前景色名", () => {
  const config = parseStartupHeaderConfig({
    general: { logoGradientBase: "scrollbarTrack", textBase: "searchMatchText" },
  }, isThemeColor);

  assert.deepEqual(config.general, { logoGradientBase: "scrollbarTrack", textBase: "searchMatchText" });
});

test("配置只接受主题的前景色名", () => {
  assert.ok(Object.hasOwn(theme.colors, "selectedBg"));
  assert.throws(
    () => parseStartupHeaderConfig({ general: { textBase: "selectedBg" } }, isThemeColor),
    /general\.textBase is not a theme color known to the running Pi: selectedBg/,
  );
  assert.throws(
    () => parseStartupHeaderConfig({ themeOverrides: [{ theme: "test-theme", logoGradientBase: "bogus" }] }, isThemeColor),
    /themeOverrides\[0\]\.logoGradientBase is not a theme color known to the running Pi: bogus/,
  );
});

test("写成字符串的数字色给出配置字段和写法提示", () => {
  assert.throws(
    () => parseStartupHeaderConfig({ general: { textBase: "39" } }, isThemeColor),
    /general\.textBase must be an integer from 0 to 255, not a string: 39/,
  );
});

test("配置加载失败时保留底层错误信息", async () => {
  const path = createTempConfigPath();
  writeFileSync(path, "{ not json");

  await assert.rejects(() => loadStartupHeaderConfig(path, isThemeColor), /is not valid JSON/);

  writeFileSync(path, JSON.stringify({ general: { textBase: "#fff" } }));
  await assert.rejects(() => loadStartupHeaderConfig(path, isThemeColor), (error: Error) => {
    const warning = configurationWarning(error);
    assert.match(warning, /Failed to load pi-startup-header configuration/);
    assert.match(warning, /general\.textBase must be a 6-digit #RRGGBB value/);
    return true;
  });
});

test("拒绝无效颜色形状、未知字段和重复主题覆盖", () => {
  const invalidConfigs = [
    { general: { textBase: "#fff" } },
    { general: { textBase: -1 } },
    { general: { textBase: 256 } },
    { general: { textBase: "#" } },
    { general: { textBase: "" } },
    { general: { textBase: 1.5 } },
    { general: { selectedBg: "accent" } },
    { themeOverrides: [{ theme: "duplicate", textBase: "accent" }, { theme: "duplicate", textHighlight: "mdLink" }] },
  ];

  for (const config of invalidConfigs) {
    assert.throws(() => parseStartupHeaderConfig(config, isThemeColor));
  }
});

test("Hex 和 xterm 调色板索引解析为固定 RGB", () => {
  assert.deepEqual(parseHeaderColor("#12AbEf", "color", isThemeColor), rgbColor(18, 171, 239));
  assert.deepEqual(parseHeaderColor(0, "color", isThemeColor), rgbColor(0, 0, 0));
  assert.deepEqual(parseHeaderColor(1, "color", isThemeColor), rgbColor(128, 0, 0));
  assert.deepEqual(parseHeaderColor(39, "color", isThemeColor), rgbColor(0, 175, 255));
  assert.deepEqual(parseHeaderColor(255, "color", isThemeColor), rgbColor(238, 238, 238));
});

test("Logo 渐变使用 Pi 解析后的终端默认前景色", () => {
  const config = parseStartupHeaderConfig({ general: { logoGradientBase: "text" } }, isThemeColor);
  const { r, g, b } = colorToRgb(theme.colors.text);
  const firstColor = rgbColor(Math.round(r * 0.82), Math.round(g * 0.82), Math.round(b * 0.82));
  const lines = renderHeaderLines(80, theme, config);

  assert.ok(lines[1]?.trimStart().startsWith(theme.style("█", { fg: firstColor })));
});

test("Logo 渐变与标语在绘制时按终端模式输出 256 色", () => {
  const theme = createTheme("256color");
  const config = parseStartupHeaderConfig({ general: { textBase: "#abcdef", textHighlight: 117 } }, isThemeColor);
  const lines = renderHeaderLines(80, theme, config);

  // 第一格以主题中的 #90adb1 为基色计算渐变，再由 Pi 量化。
  const firstCharacter = theme.style("█", { fg: rgbColor(118, 142, 145) });
  const textBase = theme.style("There are many agent harnesses,", { fg: rgbColor(171, 205, 239) });
  const highlight = theme.style("yours", { fg: rgbColor(135, 215, 255), bold: true });
  assert.ok(lines[1]?.trimStart().startsWith(firstCharacter));
  assert.equal(lines.at(-3)?.trimStart(), textBase);
  assert.ok(lines.at(-2)?.includes(highlight));
  assert.match(lines.join("\n"), /\x1b\[38;5;\d+m/);
  assert.doesNotMatch(lines.join("\n"), /\x1b\[38;2;/);
});

test("Logo 渐变始终以最大行宽计算横向位置", () => {
  assert.equal(LOGO_BLOCK_WIDTH, 17);
  assert.equal(LOGO_BLOCK_WIDTH, Math.max(...LOGO_LINES.map((line) => [...line].length)));
  assert.equal(getLogoGradientPosition(12, 0), 0.75);
  assert.equal(getLogoGradientPosition(16, 0), 1);
});

test("Logo 按整块居中，窄窗口按行截断", () => {
  const wideLines = renderHeaderLines(80, theme, EMPTY_STARTUP_HEADER_CONFIG);
  const narrowLines = renderHeaderLines(8, theme, EMPTY_STARTUP_HEADER_CONFIG);
  const padding = " ".repeat(Math.floor((80 - LOGO_BLOCK_WIDTH) / 2));

  assert.deepEqual(wideLines.slice(1, 1 + LOGO_LINES.length).map(stripVTControlCharacters), LOGO_LINES.map((line) => padding + line));
  assert.deepEqual(narrowLines.slice(1, 1 + LOGO_LINES.length), LOGO_LINES.map((line) => line.slice(0, 8)));
  assert.equal(narrowLines.at(-3), "There ar");
});
