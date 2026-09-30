# packages/engine

Pure TypeScript. No Nest, no database, no I/O, no Date.now, no Math.random.
The same input gives the same output, byte for byte.

## Layout
- time/      trip minutes (booklet formula) and the arrival schedule
- rules/     one file per rule: export const CAP_WEIGHT: Rule = { code, severity, check(ctx) }
- validate.ts runs every rule over a plan or a proposed edit
- allocate/  pre-screen, rank, group, pack, sequence, repair, validate (specs/engine/rules.md section 5)
- explain.ts turns violations and unplanned orders into sentences
- fixtures/  small hand-built instances, including the booklet's 101, 112 and 213-minute examples

The rule reference, with codes, checks, messages and reasons, is specs/engine/rules.md.

## Rules
- Sort every collection by a stable key before iterating: orders by priority descending, then
  earliest window close, then order ref; everything else by id.
- Compare numbers with lte(a, b) (1e-6 tolerance), never <= on floats.
- A new rule needs a passing and a failing fixture, an entry in rules/index.ts and one in
  specs/engine/rules.md (use the engine-rule skill).
- validate(allocate(x)) must never contain a hard violation; the property test checks it.
- Bump ENGINE_VERSION whenever output can change; every EngineRun records it.
- Fixtures are hand-built from specs/data/datasets.md. The golden S1 test reads SEED_DATA_DIR in CI
  only; never open data/seed/ to build or debug a fixture.
