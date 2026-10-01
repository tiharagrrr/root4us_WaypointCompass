export {
  compassTokens,
  effects,
  font,
  googleFontsHref,
  leading,
  palette,
  radius,
  semantic,
  shadow,
  size,
  space,
  status,
  textStyles,
} from './tokens.ts';
export type { FontFamily, StatusTone, TextStyle, TextStyleName } from './tokens.ts';

/** A CSS variable reference for a token rendered in tokens.css, e.g. cssVar('primary'). */
export const cssVar = (name: string): string => `var(--${name})`;
