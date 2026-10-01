import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderTailwindCss, renderTokensCss } from '../render-css.ts';
import { semantic, status, textStyles } from '../tokens.ts';

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

describe('generated stylesheets', () => {
  it('tokens.css matches src/tokens.ts (run `pnpm --filter @compass/ui-tokens build`)', () => {
    expect(read('tokens.css')).toBe(renderTokensCss());
  });

  it('tailwind.css matches src/tokens.ts (run `pnpm --filter @compass/ui-tokens build`)', () => {
    expect(read('tailwind.css')).toBe(renderTailwindCss());
  });

  it('declares hex values only in the palette; semantic and status colours reference it', () => {
    const css = renderTokensCss();
    const hexDeclarations = [...css.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => m[1]);
    for (const name of hexDeclarations) {
      expect(name).not.toMatch(/^(primary|foreground|border|status-)/);
    }
    expect(css).toContain('--primary: var(--blue-700);');
    expect(css).toContain('--status-danger-fg: var(--red-700);');
  });

  it('keeps Tailwind theme names free of cycles', () => {
    const tw = renderTailwindCss();
    for (const [, name, value] of tw.matchAll(/--([a-z0-9-]+): (var\(--[a-z0-9-]+\));/g)) {
      expect(value).not.toBe(`var(--${name})`);
    }
  });
});

describe('Figma values', () => {
  it('maps the shadcn semantic colours from the admin frames', () => {
    expect(semantic.primary).toBe('#1d4ed8');
    expect(semantic.foreground).toBe('#0f172a');
    expect(semantic.border).toBe('#e4e4e7');
    expect(semantic.input).toBe('#94a3b8');
    expect(semantic.page).toBe('#f8fafc');
    expect(semantic.destructiveForeground).toBe('#b91c1c');
    expect(status.warning.fg).toBe('#a15c07');
  });

  it('renders Compass/Label and Compass/Body small as text-style classes', () => {
    expect(textStyles.label).toMatchObject({ family: 'mono', size: 11, letterSpacing: 0.44 });
    const css = renderTokensCss();
    expect(css).toMatch(/\.type-label \{[^}]*font-family: var\(--compass-font-mono\);[^}]*letter-spacing: 0\.44px;/);
    expect(css).toMatch(/\.type-body-small \{[^}]*font-size: 13px;[^}]*line-height: 19\.5px;/);
  });
});
