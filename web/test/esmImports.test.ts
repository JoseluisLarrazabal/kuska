import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Vercel Functions transpilan cada api/*.ts SIN bundlear y preservan los
// specifiers relativos tal cual están escritos. Node ESM en producción exige
// extensión explícita (.js) para specifiers relativos -- si falta, el import
// revienta en runtime con ERR_MODULE_NOT_FOUND (ver docs/handoff.md). Este
// test recorre el grafo de imports real, empezando en cada web/api/*.ts, y
// falla si algún specifier relativo no trae extensión explícita o si el
// archivo al que apunta no existe.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_DIR = join(ROOT, "api");

// `from "specifier"` cubre tanto `import ... from` como `export ... from`
// (incluidos `import type` / `export type` / `export *`). Captura además un
// posible atributo de import (`with { type: "json" }` o el legacy `assert`)
// si aparece pegado al specifier.
const FROM_SPECIFIER_RE =
  /\bfrom\s*(['"])(\.\.?\/[^'"]+)\1(\s*(?:with|assert)\s*\{[^}]*\})?/g;
// `import("specifier")` dinámico.
const DYNAMIC_IMPORT_RE = /\bimport\(\s*(['"])(\.\.?\/[^'"]+)\1\s*(?:,\s*\{[^}]*\})?\)/g;
// Import por efecto de lado, sin `from` (`import "./polyfill";`). El `\s*`
// entre `import` y la comilla es lo que lo distingue de `import x from "./y"`
// (ahí sigue un identificador, no una comilla) y de `import("./y")` dinámico
// (ahí sigue un paréntesis, no una comilla), así que no se solapa con las
// otras dos regex. También captura el atributo de import opcional.
const SIDE_EFFECT_IMPORT_RE =
  /\bimport\s*(['"])(\.\.?\/[^'"]+)\1(\s*(?:with|assert)\s*\{[^}]*\})?/g;

interface FoundSpecifier {
  file: string;
  raw: string;
  hasJsonAttribute: boolean;
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"))
    .map((name) => join(dir, name));
}

function extractSpecifiers(file: string): FoundSpecifier[] {
  const content = readFileSync(file, "utf8");
  const specifiers: FoundSpecifier[] = [];

  for (const match of content.matchAll(FROM_SPECIFIER_RE)) {
    specifiers.push({ file, raw: match[2] ?? "", hasJsonAttribute: Boolean(match[3]) });
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
    specifiers.push({ file, raw: match[2] ?? "", hasJsonAttribute: false });
  }
  for (const match of content.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    specifiers.push({ file, raw: match[2] ?? "", hasJsonAttribute: Boolean(match[3]) });
  }

  return specifiers;
}

/**
 * Resuelve un specifier relativo escrito en `fromFile` al archivo fuente real
 * que debería referenciar, siguiendo la convención de este repo: un specifier
 * `./x.js` apunta al `./x.ts` hermano (Node ESM ejecuta el `.js` compilado;
 * nosotros seguimos el `.ts` que lo genera). Devuelve null si no resuelve a
 * un archivo existente.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const dir = dirname(fromFile);
  const target = resolve(dir, specifier);

  if (specifier.endsWith(".json")) {
    return existsSync(target) ? target : null;
  }

  if (specifier.endsWith(".js")) {
    const tsPath = target.replace(/\.js$/, ".ts");
    return existsSync(tsPath) ? tsPath : null;
  }

  // Specifier relativo sin extensión explícita: no lo resolvemos -- el
  // caller ya lo reporta como violación por falta de extensión.
  return null;
}

describe("grafo de imports ESM alcanzable desde web/api/*.ts", () => {
  it("todo specifier relativo trae extensión .js/.json explícita y resuelve a un archivo real", () => {
    const entryPoints = listTsFiles(API_DIR);
    expect(entryPoints.length).toBeGreaterThan(0);

    const visited = new Set<string>();
    const queue = [...entryPoints];
    const missingExtension: string[] = [];
    const missingTarget: string[] = [];
    const badJsonAttribute: string[] = [];

    while (queue.length > 0) {
      const file = queue.shift();
      if (!file || visited.has(file)) continue;
      visited.add(file);

      for (const spec of extractSpecifiers(file)) {
        const label = `${relative(ROOT, file)}: "${spec.raw}"`;
        const hasExplicitExt = spec.raw.endsWith(".js") || spec.raw.endsWith(".json");

        if (!hasExplicitExt) {
          missingExtension.push(label);
          continue;
        }

        if (spec.raw.endsWith(".json") && !spec.hasJsonAttribute) {
          badJsonAttribute.push(label);
        }

        const resolved = resolveSpecifier(file, spec.raw);
        if (!resolved) {
          missingTarget.push(label);
          continue;
        }

        if (!visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }

    expect(
      missingExtension,
      "specifiers relativos sin extensión .js/.json explícita (rompen en Node ESM producción)",
    ).toEqual([]);
    expect(
      missingTarget,
      "specifiers relativos cuyo archivo resuelto no existe",
    ).toEqual([]);
    expect(
      badJsonAttribute,
      'imports .json sin el atributo `with { type: "json" }` que exige Node ESM',
    ).toEqual([]);
    // Sanity check: si esto es 1, el recorrido no siguió ningún import y el
    // test de arriba pasaría vacío por accidente (falso positivo).
    expect(visited.size).toBeGreaterThan(1);
  });
});
