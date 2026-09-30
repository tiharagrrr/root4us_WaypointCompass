// Jest transform for ESM-only packages in node_modules (better-auth and its
// dependencies). Jest on Node 22 can't require() ES modules, so these files are
// transpiled to CommonJS with the TypeScript compiler the app already uses.
// import.meta.url only feeds createRequire() in these packages, so it becomes
// the CommonJS file URL. Drop this once the repo moves to Node 24.9+, where
// Jest loads ESM through require() natively.
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

module.exports = {
  getCacheKey(source, filename) {
    return `${ts.version}:esm-to-cjs:v1:${filename}:${source.length}:${hash(source)}`;
  },
  process(source, filename) {
    const { outputText } = ts.transpileModule(
      source.replaceAll(
        'import.meta.url',
        JSON.stringify(pathToFileURL(filename).href),
      ),
      {
        // A .mjs name would force ESM output, so transpile it as plain .js.
        fileName: filename.replace(/\.mjs$/, '.js'),
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          allowJs: true,
          esModuleInterop: true,
        },
      },
    );
    return { code: outputText };
  },
};

function hash(text) {
  return require('node:crypto').createHash('sha1').update(text).digest('hex');
}
