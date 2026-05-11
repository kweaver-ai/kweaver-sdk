/**
 * Convert a rubric YAML's `output_schema` (a JSON-Schema-ish blob) into a
 * zod schema the agent provider validates LLM responses against.
 *
 * We don't pull in a full JSON-Schema-to-Zod converter — rubric YAMLs use
 * a deliberately narrow subset: `type: object` with `required[]` and
 * `properties{type, enum, items}`. Anything richer is rejected at load
 * time so authors don't accidentally rely on full JSON Schema semantics
 * we haven't implemented.
 *
 * Supported per-property `type` values: `string`, `number`, `boolean`,
 * `array` (homogeneous items by `items.type`), `object` (recursive).
 * `enum` (string-only) is supported on `string` properties.
 *
 * Unsupported / rejected at conversion time: `type: integer` (use number),
 * `anyOf`/`oneOf`, `$ref`, `additionalProperties: false`, `format`.
 */

import { z } from "zod";

import type { RubricYaml } from "./schemas.js";

export class OutputSchemaConversionError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${message} (at ${path})`);
    this.name = "OutputSchemaConversionError";
  }
}

type PropSpec = Record<string, unknown>;

function convertProp(spec: PropSpec, path: string): z.ZodTypeAny {
  const t = spec.type;
  if (typeof t !== "string") {
    throw new OutputSchemaConversionError(`property is missing 'type' string`, path);
  }
  switch (t) {
    case "string": {
      if (Array.isArray(spec.enum)) {
        if (spec.enum.length === 0) {
          throw new OutputSchemaConversionError(`empty enum`, path);
        }
        for (const v of spec.enum) {
          if (typeof v !== "string") {
            throw new OutputSchemaConversionError(`enum supports string values only`, path);
          }
        }
        return z.enum(spec.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case "number": return z.number();
    case "boolean": return z.boolean();
    case "array": {
      const items = spec.items as PropSpec | undefined;
      if (!items) {
        throw new OutputSchemaConversionError(`array property requires 'items'`, path);
      }
      return z.array(convertProp(items, `${path}.items`));
    }
    case "object": {
      const subProps = (spec.properties as Record<string, PropSpec>) ?? {};
      const subRequired = (spec.required as string[]) ?? [];
      return buildObject(subProps, subRequired, path);
    }
    default:
      throw new OutputSchemaConversionError(`unsupported type '${t}'`, path);
  }
}

function buildObject(
  properties: Record<string, PropSpec>,
  required: string[],
  path: string,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredSet = new Set(required);
  for (const [key, spec] of Object.entries(properties)) {
    const sub = convertProp(spec, `${path}.${key}`);
    shape[key] = requiredSet.has(key) ? sub : sub.optional();
  }
  for (const req of required) {
    if (!(req in properties)) {
      throw new OutputSchemaConversionError(
        `required key '${req}' is not present in properties`,
        path,
      );
    }
  }
  return z.object(shape);
}

export function rubricOutputToZod(rubric: RubricYaml): z.ZodTypeAny {
  return buildObject(
    rubric.output_schema.properties as Record<string, PropSpec>,
    rubric.output_schema.required,
    "output_schema",
  );
}
