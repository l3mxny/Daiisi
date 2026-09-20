import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// TypeScript files import each other without extensions ("./noteDates"); find the .ts file for them.
export async function resolve(specifier, context, next) {
  // The app's "@/..." alias points at the project root.
  if (specifier.startsWith("@/")) specifier = new URL("../" + specifier.slice(2), import.meta.url).href;
  try {
    return await next(specifier, context);
  } catch (err) {
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && err.code === "ERR_MODULE_NOT_FOUND") {
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return await next(specifier + suffix, context);
        } catch {
          // try the next form
        }
      }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (!url.endsWith(".ts")) return next(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
