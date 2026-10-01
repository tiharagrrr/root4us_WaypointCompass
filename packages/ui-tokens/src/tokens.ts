/**
 * Compass design tokens, read from the Figma variables and text styles of file
 * F22bpXWBPLlXkXwA89XHfQ (admin frames A0, A1, A2, A6, plus dispatcher, dock and
 * driver frames for the status colours).
 *
 * This object is the source of truth. `pnpm --filter @compass/ui-tokens build`
 * renders it into src/tokens.css (custom properties and text-style classes) and
 * src/tailwind.css (the Tailwind 4 theme). Hex values live only in this package.
 */

/** Raw colour scales. Keys follow the Figma variable names (slate/700 → slate['700']). */
export const palette = {
  base: {
    white: '#ffffff', // base/white
    black: '#000000', // base/black (touch outline button text)
    ink: '#040404', // base/ink, hsl(var(--default)): the black "Default" button
  },
  slate: {
    '50': '#f8fafc', // hsl(var(--page))
    '100': '#f1f5f9',
    '200': '#e2e8f0',
    '300': '#cbd5e1',
    '400': '#94a3b8',
    '500': '#64748b',
    '600': '#475569',
    '700': '#334155',
    '800': '#1e293b',
    '900': '#0f172a',
  },
  /** hsl(var(--border)) is zinc-200 in Figma, not slate-200. */
  zinc: {
    '200': '#e4e4e7',
  },
  blue: {
    '50': '#eff6ff', // hsl(var(--accent))
    '200': '#bfdbfe',
    '700': '#1d4ed8', // hsl(var(--primary))
    '800': '#1e40af', // primary hover
    '900': '#1e3a8a', // primary pressed
  },
  red: {
    '50': '#fef2f2',
    '100': '#fee2e2', // hsl(var(--destructive))
    '200': '#fecaca',
    '600': '#dc2626',
    '700': '#b91c1c', // hsl(var(--destructive-foreground))
  },
  emerald: {
    '50': '#ecfdf5', // status/success/bg
    '200': '#a7f3d0', // status/success/border
    '700': '#047857', // status/success/fg and icon
  },
  /** Compass's own amber from status/warning/*; these are not Tailwind's amber values. */
  amber: {
    '50': '#fffaeb', // status/warning/bg
    '200': '#f6dfa0', // status/warning/border
    '500': '#d08a0b', // status/warning/icon
    '700': '#a15c07', // status/warning/fg
  },
  teal: {
    '700': '#0f766e',
  },
  /** The AT RISK chip text in 19a uses a raw #c2410c; it has no Figma variable. */
  orange: {
    '700': '#c2410c',
  },
  brand: {
    'tech-200': '#fed7aa', // brand/tech-200
  },
} as const;

/** shadcn semantic colours. The Figma file names them hsl(var(--primary)) and so on. */
export const semantic = {
  background: palette.base.white,
  foreground: palette.slate['900'],
  card: palette.base.white,
  cardForeground: palette.slate['900'],
  popover: palette.base.white,
  popoverForeground: palette.slate['900'],
  primary: palette.blue['700'],
  primaryForeground: palette.base.white,
  secondary: palette.slate['100'],
  secondaryForeground: palette.slate['800'],
  muted: palette.slate['100'],
  mutedForeground: palette.slate['500'],
  accent: palette.blue['50'],
  accentForeground: palette.blue['700'],
  /** Soft two-tone red: red-100 fill with red-700 text. */
  destructive: palette.red['100'],
  destructiveForeground: palette.red['700'],
  border: palette.zinc['200'],
  input: palette.slate['400'],
  /** Not a Figma variable: focus rings use the primary blue. */
  ring: palette.blue['700'],
  /** Page background behind cards (sign-in, table headers). */
  page: palette.slate['50'],
  /** The black "Default" button. */
  default: palette.base.ink,
  defaultForeground: palette.base.white,
} as const;

/** Raw colour values that are not hex (the dialog scrim in A2). */
export const effects = {
  overlay: 'rgb(0 0 0 / 0.4)',
} as const;

/** status/<tone>/<part>. Tones the Figma file does not define fully are filled from its scales. */
export const status = {
  neutral: {
    bg: palette.base.white,
    border: palette.slate['200'],
    fg: palette.slate['700'], // status/neutral/fg
    icon: palette.slate['500'],
  },
  info: {
    bg: palette.blue['50'],
    border: palette.blue['200'], // status/info/border
    fg: palette.blue['700'],
    icon: palette.blue['700'],
  },
  success: {
    bg: palette.emerald['50'], // status/success/bg
    border: palette.emerald['200'], // status/success/border
    fg: palette.emerald['700'], // status/success/fg
    icon: palette.emerald['700'], // status/success/icon
  },
  warning: {
    bg: palette.amber['50'], // status/warning/bg
    border: palette.amber['200'], // status/warning/border
    fg: palette.amber['700'], // status/warning/fg
    icon: palette.amber['500'], // status/warning/icon
  },
  danger: {
    bg: palette.red['50'], // status/danger/bg
    border: palette.red['200'], // status/danger/border
    fg: palette.red['700'], // status/danger/fg
    icon: palette.red['600'], // status/danger/icon
  },
  /** The AT RISK chip in 19a: brand/tech-200 border, raw orange text. */
  atRisk: {
    bg: palette.base.white,
    border: palette.brand['tech-200'],
    fg: palette.orange['700'],
    icon: palette.orange['700'],
  },
} as const;

export type StatusTone = keyof typeof status;

/** radius/sm|md|lg, plus radius-xs. */
export const radius = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  full: '9999px',
} as const;

/** space/* and theme(spacing.*): a 4 px grid, the same as Tailwind's default spacing. */
export const space = {
  '0.5': '2px',
  '1': '4px',
  '1.5': '6px',
  '2': '8px',
  '2.5': '10px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '8': '32px',
} as const;

/** size/icon-* plus the control heights used by inputs and buttons. */
export const size = {
  iconSm: '14px', // size/icon-sm
  iconLg: '20px', // size/icon-lg
  control: '36px', // Button default, Input
  controlSm: '32px', // Button sm, toolbar search and select
  controlLg: '44px', // Button lg
  /** Minimum touch target on dock and driver shells (data-density="touch"). */
  touchTarget: '44px',
} as const;

/** Compass/shadow-sm and Compass/shadow-md; segment is the active segment's raw drop shadow. */
export const shadow = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  segment: '0 1px 1px 0 rgb(0 0 0 / 0.08)',
} as const;

/**
 * Figma's "auto" line height. Measured on the A1 frame it is 1.25 × the size for Google Sans Flex
 * and Code (13 px → 16, 24 px → 30, 11 px → 14); CSS `normal` would give 1.5.
 */
export const leading = {
  auto: '1.25',
} as const;

export const font = {
  sans: '"Google Sans Flex", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Google Sans Code", ui-monospace, SFMono-Regular, Menlo, monospace',
  /** The waypoint wordmark is set in Inter Extra Bold. */
  brand: '"Inter", "Google Sans Flex", system-ui, sans-serif',
} as const;

export type FontFamily = keyof typeof font;

export interface TextStyle {
  /** The Figma text style, or null when the value is used raw in frames and has no style. */
  figma: string | null;
  family: FontFamily;
  /** px */
  size: number;
  weight: 400 | 500 | 600 | 700;
  /** px, or 'auto' for Figma's auto line height (leading.auto). */
  lineHeight: number | 'auto';
  /** px */
  letterSpacing: number;
}

/** Compass text styles. Each renders as a `.type-<name>` class in tokens.css. */
export const textStyles = {
  'body-small': { figma: 'Compass/Body small', family: 'sans', size: 13, weight: 400, lineHeight: 19.5, letterSpacing: 0 },
  'body-medium': { figma: 'Compass/Body medium', family: 'sans', size: 14, weight: 500, lineHeight: 'auto', letterSpacing: 0 },
  'body-strong': { figma: 'Compass/Body strong', family: 'sans', size: 14, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  'field-label': { figma: 'Compass/Field label', family: 'sans', size: 13, weight: 500, lineHeight: 'auto', letterSpacing: 0 },
  caption: { figma: 'Compass/Caption', family: 'sans', size: 12, weight: 400, lineHeight: 'auto', letterSpacing: 0 },
  label: { figma: 'Compass/Label', family: 'mono', size: 11, weight: 400, lineHeight: 'auto', letterSpacing: 0.44 },
  'mono-small': { figma: 'Compass/Mono small', family: 'mono', size: 11, weight: 400, lineHeight: 'auto', letterSpacing: 0 },
  metadata: { figma: 'Compass/Metadata', family: 'mono', size: 12, weight: 400, lineHeight: 'auto', letterSpacing: 0 },
  data: { figma: 'Compass/Data', family: 'mono', size: 13, weight: 500, lineHeight: 'auto', letterSpacing: 0 },
  'data-bold': { figma: 'Compass/Data bold', family: 'mono', size: 13, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  'card-title': { figma: 'Compass/Card title', family: 'sans', size: 15, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  section: { figma: 'Compass/Section', family: 'sans', size: 16, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  heading: { figma: 'Compass/Heading', family: 'sans', size: 20, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  'kpi-value': { figma: 'Compass/KPI value', family: 'sans', size: 28, weight: 700, lineHeight: 30.8, letterSpacing: -0.56 },
  /** Raw in frames: descriptions and table cells (13/18.85). */
  body: { figma: null, family: 'sans', size: 13, weight: 400, lineHeight: 18.85, letterSpacing: 0 },
  /** Raw in frames: dialog titles and settings section titles (A2, A6). */
  title: { figma: null, family: 'sans', size: 18, weight: 700, lineHeight: 'auto', letterSpacing: 0 },
  /** Raw in frames: the page title in every desktop header (A1 "Users"). */
  'page-title': { figma: null, family: 'sans', size: 24, weight: 700, lineHeight: 'auto', letterSpacing: -0.24 },
} as const satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;

/** Google Fonts stylesheet for the Compass families; link it from index.html. */
export const googleFontsHref =
  'https://fonts.googleapis.com/css2?family=Google+Sans+Code:wght@300..800&family=Google+Sans+Flex:opsz,wght@6..144,1..1000&family=Inter:ital,wght@0,800;1,800&display=swap';

export const compassTokens = {
  palette,
  semantic,
  effects,
  status,
  radius,
  space,
  size,
  shadow,
  leading,
  font,
  textStyles,
} as const;
