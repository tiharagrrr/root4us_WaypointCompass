/**
 * orval input transformer. The MSW mocks use each schema's `example` (useExamples), so an example
 * whose JSON type contradicts its schema's `type` (say `type: object` with `example: 930`) would
 * generate mocks that do not type-check. This drops such examples and warns, so the contract bug
 * shows up at `pnpm api:gen` and gets fixed in the API's @ApiProperty instead of here.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const jsonType = (value: Json): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const matches = (schemaType: string, example: Json, nullable: boolean): boolean => {
  const actual = jsonType(example);
  if (actual === 'null') return nullable;
  if (schemaType === 'number') return actual === 'number' || actual === 'integer';
  return actual === schemaType;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const dropMistypedExamples = <T>(spec: T): T => {
  const dropped: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${path}[${i}]`));
      return;
    }
    if (!isObject(node)) return;
    if (typeof node.type === 'string' && 'example' in node) {
      const example = node.example as Json;
      if (!matches(node.type, example, node.nullable === true)) {
        dropped.push(`${path}: example ${JSON.stringify(example)} is not ${node.type}`);
        delete node.example;
      }
    }
    for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key);
  };
  visit(spec, '');
  if (dropped.length > 0) {
    console.warn(
      `api-client: dropped ${dropped.length} example(s) that contradict their schema type; fix them in the API DTOs:\n  ${dropped.join('\n  ')}`,
    );
  }
  return spec;
};
