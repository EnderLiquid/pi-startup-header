import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { HeaderColor, createThemeColorGuard } from "../extensions/shared/header-color.ts";
import {
  DEFAULT_HEADER_COLORS,
  EMPTY_STARTUP_HEADER_CONFIG,
  configurationWarning,
  loadStartupHeaderConfig,
  parseStartupHeaderConfig,
  resolveHeaderColorSettings,
} from "../extensions/shared/header-config.ts";
import {
  FALLBACK_LOGO_GRADIENT_BASE_RGB,
  LOGO_BLOCK_WIDTH,
  LOGO_LINES,
  getLogoGradientPosition,
  resolveLogoGradientBaseRgb,
} from "../extensions/shared/header-renderer.ts";

function createTheme(
  colors: Partial<Record<ThemeColor, string>> = {},
  name = "test-theme",
): Theme {
  const getFgAnsi = (color: ThemeColor): string => {
    const ansi = colors[color];
    if (ansi === undefined) {
      // 与 Pi 的 Theme#getFgAnsi 一致：未知 token 抛错。
      throw new Error(`Unknown theme color: ${color}`);
    }
    return ansi;
  };

  return {
    name,
    getFgAnsi,
    fg(color: ThemeColor, text: string): string {
      getFgAnsi(color);
      return `<${color}>${text}</${color}>`;
    },
    bold(text: string): string {
      return `<bold>${text}</bold>`;
    },
  } as unknown as Theme;
}

/**
 * 一个只认识给定 token 的主题，用于模拟特定 Pi 版本的色名集合。
 *
 * 参数取 string[] 而非 ThemeColor[]：测试需要用到当前开发基线尚未定义、
 * 但后续版本已加入的 token，这正是版本探测机制要处理的情形。
 */
function createLimitedTheme(known: readonly string[], name = "test-theme"): Theme {
  return createTheme(
    Object.fromEntries(known.map((token) => [token, "\x1b[39m"])) as Partial<
      Record<ThemeColor, string>
    >,
    name,
  );
}

/** 接受任意非空 token 的 guard，用于只关心形状校验的用例。 */
const acceptsAll = () => true;

/** 模拟特定 Pi 版本认识的 token 集合。 */
function limitedGuard(known: readonly string[]) {
  return createThemeColorGuard(createLimitedTheme(known));
}

const tempConfigPaths: string[] = [];

/**
 * 生成一次性配置文件路径，测试结束后统一清理。
 * 有些用例只借路径不落盘（缺失文件本身也是一种输入），因此用 force 删除。
 */
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

test("未配置时使用既有的三种默认 ThemeColor", () => {
  const theme = createLimitedTheme(["accent", "mdLink"]);
  const colors = resolveHeaderColorSettings(EMPTY_STARTUP_HEADER_CONFIG, "test-theme");

  assert.equal(colors.logoGradientBase, DEFAULT_HEADER_COLORS.logoGradientBase);
  assert.equal(colors.textBase.paint(theme, "text"), "<accent>text</accent>");
  assert.equal(colors.textHighlight.paint(theme, "text"), "<mdLink>text</mdLink>");
});

test("不存在配置文件时静默使用默认配置", async () => {
  const path = createTempConfigPath();

  assert.equal(await loadStartupHeaderConfig(path, acceptsAll), EMPTY_STARTUP_HEADER_CONFIG);
});

test("general 与主题专属配置按字段合并", () => {
  const guard = limitedGuard(["success", "thinkingMax", "mdHeading"]);
  const config = parseStartupHeaderConfig({
    general: {
      logoGradientBase: "success",
      textBase: "#112233",
      textHighlight: 117,
    },
    themeOverrides: [
      {
        theme: "test-theme",
        logoGradientBase: "thinkingMax",
        textHighlight: "mdHeading",
      },
    ],
  }, guard);
  const theme = createLimitedTheme(["success", "thinkingMax", "mdHeading"]);
  const matched = resolveHeaderColorSettings(config, "test-theme");
  const unmatched = resolveHeaderColorSettings(config, "other-theme");

  assert.equal(matched.logoGradientBase.paint(theme, "text"), "<thinkingMax>text</thinkingMax>");
  assert.equal(matched.textBase.paint(theme, "text"), "\x1b[38;2;17;34;51mtext\x1b[0m");
  assert.equal(matched.textHighlight.paint(theme, "text"), "<mdHeading>text</mdHeading>");
  assert.equal(unmatched.logoGradientBase.paint(theme, "text"), "<success>text</success>");
  assert.deepEqual(unmatched.textHighlight.toRgb(theme), [135, 215, 255]);
  assert.equal(resolveHeaderColorSettings(config, undefined).logoGradientBase.paint(theme, "text"), "<success>text</success>");
});

test("无效的字符串颜色值在解析时被拒绝", () => {
  // 数字写成字符串属于形状错误，在 guard 表态前就拒绝，并提示应写成 JSON 数字。
  assert.throws(
    () => parseStartupHeaderConfig({ general: { textBase: "39" } }, acceptsAll),
    /general\.textBase must be an integer from 0 to 255, not a string: 39/,
  );
  // 主题变量名这类字符串无法在不知道 Pi 版本的情况下区分，合法性完全交给 guard；
  // guard 不认识就报错并带上字段路径。
  assert.throws(
    () => parseStartupHeaderConfig({ general: { textBase: "primary" } }, limitedGuard([])),
    /is not a theme color known to the running Pi: primary/,
  );
});

test("当前 Pi 新增的 token 无需升级插件即可使用", () => {
  // 静态名单做不到的部分：guard 认识 scrollbarTrack / searchMatchText 就应通过。
  const guard = limitedGuard(["scrollbarTrack", "searchMatchText"]);
  const config = parseStartupHeaderConfig(
    { general: { logoGradientBase: "scrollbarTrack", textBase: "searchMatchText" } },
    guard,
  );

  const theme = createLimitedTheme(["scrollbarTrack", "searchMatchText"]);
  assert.equal(config.general?.logoGradientBase?.paint(theme, "text"), "<scrollbarTrack>text</scrollbarTrack>");
  assert.equal(config.general?.textBase?.paint(theme, "text"), "<searchMatchText>text</searchMatchText>");
  // guard 拒绝的 token 则报错，且不会因为“当前基线恰好含有”而放行。
  assert.throws(() => parseStartupHeaderConfig({ general: { textBase: "accent" } }, guard));
});

test("解析失败时错误信息包含具体字段路径", () => {
  assert.throws(
    () =>
      parseStartupHeaderConfig(
        { themeOverrides: [{ theme: "t", logoGradientBase: "bogus" }] },
        limitedGuard([]),
      ),
    /themeOverrides\[0\]\.logoGradientBase is not a theme color known to the running Pi: bogus/,
  );
});

test("配置加载失败时保留底层错误信息", async () => {
  const path = createTempConfigPath();
  writeFileSync(path, '{ not json');

  await assert.rejects(
    () => loadStartupHeaderConfig(path, acceptsAll),
    /is not valid JSON/,
  );

  writeFileSync(path, JSON.stringify({ general: { textBase: "bogus" } }));
  await assert.rejects(
    () => loadStartupHeaderConfig(path, limitedGuard([])),
    /general\.textBase is not a theme color known to the running Pi: bogus/,
  );

  // 展示用警告需要把底层原因带出去。
  const warning = configurationWarning(new Error("general.textBase must be a 6-digit #RRGGBB value"));
  assert.match(warning, /Failed to load pi-startup-header configuration/);
  assert.match(warning, /general\.textBase must be a 6-digit #RRGGBB value/);
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
    {
      themeOverrides: [
        { theme: "duplicate", textBase: "accent" },
        { theme: "duplicate", textHighlight: "mdLink" },
      ],
    },
  ];

  for (const config of invalidConfigs) {
    assert.throws(() => parseStartupHeaderConfig(config, acceptsAll));
  }
});

test("HeaderColor 在解析时统一转换 Hex 与 256 色输入", () => {
  const theme = createTheme();

  assert.deepEqual(HeaderColor.parse("#12AbEf", "color", acceptsAll).toRgb(theme), [18, 171, 239]);
  assert.deepEqual(HeaderColor.parse(39, "color", acceptsAll).toRgb(theme), [0, 175, 255]);
  assert.deepEqual(HeaderColor.parse(255, "color", acceptsAll).toRgb(theme), [238, 238, 238]);
});

test("Logo base 保留 ThemeColor ANSI 解析失败时的 fallback", () => {
  const resolvableTheme = createLimitedTheme(["accent"]);
  const resolvable = createTheme({ accent: "\x1b[38;2;12;34;56m" });
  const unresolvedTheme = createTheme();

  assert.deepEqual(
    resolveLogoGradientBaseRgb(resolvable, HeaderColor.parse("accent", "color", acceptsAll)),
    [12, 34, 56],
  );
  assert.deepEqual(
    resolveLogoGradientBaseRgb(resolvableTheme, HeaderColor.parse("#abcdef", "color", acceptsAll)),
    [171, 205, 239],
  );
  assert.deepEqual(
    resolveLogoGradientBaseRgb(resolvableTheme, HeaderColor.parse(39, "color", acceptsAll)),
    [0, 175, 255],
  );
  assert.deepEqual(
    resolveLogoGradientBaseRgb(unresolvedTheme, HeaderColor.parse("accent", "color", acceptsAll)),
    FALLBACK_LOGO_GRADIENT_BASE_RGB,
  );
});

test("HeaderColor 委托 ThemeColor 和直接 RGB 的文本渲染", () => {
  const theme = createTheme({ accent: "\x1b[38;2;12;34;56m" });

  assert.equal(HeaderColor.parse("accent", "color", acceptsAll).paint(theme, "text"), "<accent>text</accent>");
  assert.equal(
    HeaderColor.parse("#010203", "color", acceptsAll).paint(theme, "text"),
    "\x1b[38;2;1;2;3mtext\x1b[0m",
  );
  assert.equal(
    HeaderColor.parse(39, "color", acceptsAll).paint(theme, "text"),
    "\x1b[38;2;0;175;255mtext\x1b[0m",
  );
});

test("文本渲染在 ThemeColor 取值失败时返回原文", () => {
  // 渲染期兜底：配置校验通过后，主题仍可能不再认识该 token，此时不能抛进 render()。
  const theme = createTheme();

  assert.equal(HeaderColor.parse("accent", "color", acceptsAll).paint(theme, "text"), "text");
});

test("Logo 渐变始终以最大行宽计算横向位置", () => {
  assert.equal(LOGO_BLOCK_WIDTH, 17);
  assert.equal(LOGO_BLOCK_WIDTH, Math.max(...LOGO_LINES.map((line) => [...line].length)));
  assert.equal(getLogoGradientPosition(12, 0), 0.75);
  assert.equal(getLogoGradientPosition(16, 0), 1);
});
