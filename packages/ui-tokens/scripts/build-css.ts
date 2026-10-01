// Writes src/tokens.css and src/tailwind.css from src/tokens.ts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTailwindCss, renderTokensCss } from '../src/render-css.ts';

const out = (file: string): string => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

writeFileSync(out('tokens.css'), renderTokensCss());
writeFileSync(out('tailwind.css'), renderTailwindCss());
console.log('ui-tokens: wrote src/tokens.css and src/tailwind.css');
