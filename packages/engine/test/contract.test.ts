import { describe, expect, it } from 'vitest';
import { TOOL_ARG_SCHEMAS, TOOL_DEFS, TOOL_NAMES } from '@escape/contracts';

describe('tool contract parity', () => {
  it('every tool has a JSON schema and a zod validator with the same keys', () => {
    expect(TOOL_DEFS.map((t) => t.function.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const def of TOOL_DEFS) {
      const params = def.function.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      const zodShape = (TOOL_ARG_SCHEMAS[def.function.name] as unknown as { shape: Record<string, unknown> }).shape;
      expect(Object.keys(params.properties).sort(), def.function.name).toEqual(Object.keys(zodShape).sort());
      expect(params.additionalProperties).toBe(false);
      for (const req of params.required) expect(zodShape).toHaveProperty(req);
    }
  });
});
