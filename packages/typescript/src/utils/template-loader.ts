import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";

export interface TemplateManifest {
  name: string;
  type: "dataset" | "bkn" | "dataflow";
  description: string;
  arguments: Array<{
    name: string;
    required: boolean;
    description: string;
    type: "string" | "integer" | "boolean" | "array";
    default?: unknown;
  }>;
}

export interface LoadedTemplate {
  template: Record<string, unknown>;
  manifest: TemplateManifest;
  templatePath: string;
}

/**
 * Generate a unique source identifier with prefix
 */
export function generateSourceIdentifier(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Replace {{placeholder}} with actual values in a string
 */
function replacePlaceholders(str: string, values: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (values[key] !== undefined) {
      return String(values[key]);
    }
    return `{{${key}}}`;
  });
}

/**
 * Deep replace placeholders in an object
 */
function deepReplace(obj: unknown, values: Record<string, unknown>): unknown {
  if (typeof obj === "string") {
    return replacePlaceholders(obj, values);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepReplace(item, values));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepReplace(value, values);
    }
    return result;
  }
  return obj;
}

/**
 * Render template with arguments, applying defaults and validation
 */
export function renderTemplate(
  template: Record<string, unknown>,
  manifest: TemplateManifest,
  args: Record<string, unknown>
): Record<string, unknown> {
  // Merge args with defaults
  const merged: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const arg of manifest.arguments) {
    if (args[arg.name] !== undefined) {
      merged[arg.name] = args[arg.name];
    } else if (arg.default !== undefined) {
      merged[arg.name] = arg.default;
    } else if (arg.required) {
      missing.push(arg.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  }

  // Deep replace placeholders
  return deepReplace(template, merged) as Record<string, unknown>;
}

/**
 * Load template from directory
 */
export async function loadTemplate(
  templateName: string,
  templateType: "dataset" | "bkn" | "dataflow",
  templatesDir: string
): Promise<LoadedTemplate | null> {
  const templateDir = join(templatesDir, templateType, templateName);

  try {
    await access(templateDir, constants.R_OK);
  } catch {
    return null;
  }

  const templatePath = join(templateDir, "template.json");
  const manifestPath = join(templateDir, "manifest.json");

  try {
    const [templateContent, manifestContent] = await Promise.all([
      readFile(templatePath, "utf-8"),
      readFile(manifestPath, "utf-8"),
    ]);

    return {
      template: JSON.parse(templateContent),
      manifest: JSON.parse(manifestContent),
      templatePath: templateDir,
    };
  } catch {
    return null;
  }
}

/**
 * List all available templates of a given type
 */
export async function listTemplates(
  templateType: "dataset" | "bkn" | "dataflow",
  templatesDir: string
): Promise<Array<{ name: string; description: string }>> {
  const { readdir } = await import("node:fs/promises");
  const typeDir = join(templatesDir, templateType);

  try {
    const entries = await readdir(typeDir, { withFileTypes: true });
    const templates: Array<{ name: string; description: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const loaded = await loadTemplate(entry.name, templateType, templatesDir);
      if (loaded) {
        templates.push({
          name: loaded.manifest.name,
          description: loaded.manifest.description,
        });
      }
    }

    return templates;
  } catch {
    return [];
  }
}

/**
 * Get the templates directory path (relative to dist or src)
 */
export function getTemplatesDir(): string {
  // When running from dist, templates are copied to dist/templates
  // When running from src (tsx), templates are in src/templates
  const { url } = import.meta;
  const baseDir = join(new URL(url).pathname, "..", "..", "templates");
  return baseDir;
}
