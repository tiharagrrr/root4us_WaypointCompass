import { join, relative } from 'node:path';
import * as ts from 'typescript';

/**
 * The engine's purity guard, as an allowlist: it fails closed. A new import or a new global has to be
 * added here on purpose, with a reason, instead of someone remembering to ban it.
 */

/** Bare import specifiers the engine may use. Relative imports inside src are always fine. */
export const ALLOWED_IMPORTS: Readonly<Record<string, string>> = {
  zod: 'validates EngineParams',
  '@waypoint/shared/domain': 'brands, dock types and the other enums; pure, imports nothing',
  '@waypoint/shared/business-time': 'day of week and HH:MM labels; pure, imports nothing',
};

/** Globals (values) the engine may use. Anything else, Date and process included, is refused. */
export const ALLOWED_GLOBALS: Readonly<Record<string, string>> = {
  Error: 'EngineInputError extends it',
  JSON: 'quotes values in error messages; stringify is deterministic',
  Map: 'lookups by id; never iterated unsorted',
  Number: 'Number.POSITIVE_INFINITY as a sort sentinel',
  Math: 'arithmetic only; Math.random is refused below',
  Object: 'fromEntries and entries over sorted or fixed keys',
  Set: 'membership checks (has); iteration order is insertion order, so it is deterministic',
  String: 'padStart and String(value) in messages',
};

/** Members refused even on an allowed global. */
const FORBIDDEN_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  Math: ['random'],
};

const isGlobalDeclaration = (sf: ts.SourceFile) =>
  sf.isDeclarationFile && /[\\/](typescript[\\/]lib|@types)[\\/]/.test(sf.fileName);

/** An identifier that names something, as opposed to a property or a declaration's own name. */
function isReference(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
  if (ts.isQualifiedName(p) && p.right === node) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === node) return false;
  if (ts.isShorthandPropertyAssignment(p) && p.name === node) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if ((p as ts.NamedDeclaration).name === node) return false; // the name a declaration introduces
  return true;
}

/**
 * `engineRoot` is where the engine's node_modules live (for the Node types); `reportRoot` is what
 * file names in the messages are relative to.
 */
export function checkPurity(files: readonly string[], engineRoot: string, reportRoot = engineRoot): string[] {
  const program = ts.createProgram([...files], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts'],
    types: ['node'],
    typeRoots: [join(engineRoot, 'node_modules', '@types')],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    resolveJsonModule: true,
    esModuleInterop: true,
  });
  const checker = program.getTypeChecker();
  const problems: string[] = [];

  for (const sf of program.getSourceFiles()) {
    if (!files.includes(sf.fileName)) continue;
    const name = relative(reportRoot, sf.fileName);
    const at = (node: ts.Node) => {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      return `${name}:${line + 1}:${character + 1}`;
    };
    const checkSpecifier = (node: ts.Node, specifier: string) => {
      if (specifier.startsWith('.') || specifier in ALLOWED_IMPORTS) return;
      problems.push(
        `${at(node)} imports "${specifier}", which is not on the allowlist (allowed: ${Object.keys(ALLOWED_IMPORTS).join(', ')}, or a relative path)`,
      );
    };

    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node, node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) {
          problems.push(`${at(node)} uses a dynamic import(), which hides what the engine depends on`);
        } else if (ts.isIdentifier(callee) && callee.text === 'require') {
          problems.push(`${at(node)} calls require(), which hides what the engine depends on`);
        }
      } else if (ts.isImportEqualsDeclaration(node)) {
        problems.push(`${at(node)} uses "import = require()", which is not allowed in the engine`);
      } else if (ts.isIdentifier(node) && isReference(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol === undefined) {
          // Fail closed: a name the checker cannot resolve cannot be shown to be pure.
          problems.push(`${at(node)} uses "${node.text}", which cannot be resolved, so it cannot be shown to be pure`);
        } else {
          const isValue = (symbol.flags & ts.SymbolFlags.Value) !== 0;
          const global = isValue && (symbol.declarations ?? []).some((d) => isGlobalDeclaration(d.getSourceFile()));
          if (global) {
            if (!(node.text in ALLOWED_GLOBALS)) {
              problems.push(`${at(node)} uses the global "${node.text}", which is not on the allowlist`);
            } else if (
              ts.isPropertyAccessExpression(node.parent) &&
              node.parent.expression === node &&
              FORBIDDEN_MEMBERS[node.text]?.includes(node.parent.name.text)
            ) {
              problems.push(`${at(node)} uses ${node.text}.${node.parent.name.text}, which is not deterministic`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return problems;
}

