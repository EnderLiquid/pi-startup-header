import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToRgb, type RgbColor, type RgbColorValue } from "@earendil-works/pi-tui";
import {
  resolveHeaderColorSettings,
  type EffectiveHeaderColorSettings,
  type StartupHeaderConfig,
} from "./header-config.ts";

export const LOGO_LINES = [
  "████████████╗",
  "████████████║",
  "████╔═══████║",
  "████║   ████║",
  "████████╬═══████╗",
  "████████║   ████║",
  "████╔═══╝   ████║",
  "████║       ████║",
  "╚═══╝       ╚═══╝",
];

const TAGLINE_LINE_1 = "There are many agent harnesses,";
const TAGLINE_LINE_2_PREFIX = "but this one is ";
const TAGLINE_LINE_2_HIGHLIGHT = "yours";
const TAGLINE_LINE_2_SUFFIX = ".";
const TAGLINE_LINE_2 = TAGLINE_LINE_2_PREFIX + TAGLINE_LINE_2_HIGHLIGHT + TAGLINE_LINE_2_SUFFIX;

export const LOGO_BLOCK_WIDTH = Math.max(...LOGO_LINES.map((line) => [...line].length));

const PALETTE_STEPS = 24;
const PALETTE_MAX_DARKEN = 0.18;
const PALETTE_MAX_LIGHTEN = 0.18;
const LOGO_ROW_PHASE_STEP = 0.12;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function interpolateChannel(start: number, end: number, factor: number): number {
  return Math.round(start + (end - start) * factor);
}

function darkenRgb({ r, g, b }: RgbColor, amount: number): RgbColor {
  return {
    r: clampByte(r * (1 - amount)),
    g: clampByte(g * (1 - amount)),
    b: clampByte(b * (1 - amount)),
  };
}

function lightenRgb({ r, g, b }: RgbColor, amount: number): RgbColor {
  return {
    r: clampByte(r + (255 - r) * amount),
    g: clampByte(g + (255 - g) * amount),
    b: clampByte(b + (255 - b) * amount),
  };
}

function buildGradientPalette(base: RgbColor): RgbColor[] {
  return Array.from({ length: PALETTE_STEPS }, (_, index) => {
    const progress = index / PALETTE_STEPS;
    const wave = -Math.cos(progress * Math.PI * 2);

    if (wave < 0) {
      return darkenRgb(base, PALETTE_MAX_DARKEN * -wave);
    }

    return lightenRgb(base, PALETTE_MAX_LIGHTEN * wave);
  });
}

function sampleGradientColor(palette: RgbColor[], position: number): RgbColorValue {
  const wrappedPosition = ((position % 1) + 1) % 1;
  const scaledPosition = wrappedPosition * palette.length;
  const baseIndex = Math.floor(scaledPosition) % palette.length;
  const nextIndex = (baseIndex + 1) % palette.length;
  const factor = scaledPosition - Math.floor(scaledPosition);
  const start = palette[baseIndex]!;
  const end = palette[nextIndex]!;

  return {
    kind: "rgb",
    r: interpolateChannel(start.r, end.r, factor),
    g: interpolateChannel(start.g, end.g, factor),
    b: interpolateChannel(start.b, end.b, factor),
  };
}

export function getLogoGradientPosition(index: number, phase: number): number {
  const span = Math.max(LOGO_BLOCK_WIDTH - 1, 1);
  return index / span + phase;
}

function renderLogoGradientText(
  text: string,
  theme: Theme,
  palette: RgbColor[],
  phase: number,
): string {
  return [...text]
    .map((character, index) => {
      if (character === " ") return character;
      const color = sampleGradientColor(palette, getLogoGradientPosition(index, phase));
      return theme.style(character, { fg: color });
    })
    .join("");
}

function renderCenteredLine(
  text: string,
  width: number,
  renderStyled: () => string,
  blockWidth?: number,
): string {
  const characters = [...text];
  if (characters.length > width) return characters.slice(0, width).join("");

  const leftPadding = Math.max(0, Math.floor((width - (blockWidth ?? characters.length)) / 2));
  return " ".repeat(leftPadding) + renderStyled();
}

function renderLogoLines(
  width: number,
  theme: Theme,
  { logoGradientBase }: EffectiveHeaderColorSettings,
): string[] {
  const color = typeof logoGradientBase === "string" ? theme.colors[logoGradientBase] : logoGradientBase;
  const palette = buildGradientPalette(colorToRgb(color));

  return LOGO_LINES.map((line, rowIndex) =>
    renderCenteredLine(
      line,
      width,
      () => renderLogoGradientText(line, theme, palette, rowIndex * LOGO_ROW_PHASE_STEP),
      LOGO_BLOCK_WIDTH,
    ),
  );
}

function renderTaglineLines(
  width: number,
  theme: Theme,
  { textBase, textHighlight }: EffectiveHeaderColorSettings,
): string[] {
  return [
    renderCenteredLine(TAGLINE_LINE_1, width, () => theme.style(TAGLINE_LINE_1, { fg: textBase })),
    renderCenteredLine(TAGLINE_LINE_2, width, () =>
      theme.style(TAGLINE_LINE_2_PREFIX, { fg: textBase }) +
      theme.style(TAGLINE_LINE_2_HIGHLIGHT, { fg: textHighlight, bold: true }) +
      theme.style(TAGLINE_LINE_2_SUFFIX, { fg: textBase }),
    ),
  ];
}

export function renderHeaderLines(
  width: number,
  theme: Theme,
  config: StartupHeaderConfig,
): string[] {
  const colors = resolveHeaderColorSettings(config, theme.name);
  const logoLines = renderLogoLines(width, theme, colors);
  const taglineLines = renderTaglineLines(width, theme, colors);

  return ["", ...logoLines, "", ...taglineLines, ""];
}
