/**
 * Lets plain `node` load this project's source modules.
 *
 * The app's sources are written for a bundler, which resolves two things Node's
 * ESM loader does not: extensionless relative specifiers (`./claimsPresenter`)
 * and the `@/` root alias from jsconfig.json. The check scripts import presenter
 * modules directly so they can assert on the real functions rather than a copy,
 * so this hook fills those two gaps and nothing else.
 *
 * Registered by scripts/with-aliases.mjs. Not used by the app itself.
 */

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTEND_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  // `@/x` -> <frontend>/x, matching jsconfig.json's paths mapping.
  if (specifier.startsWith("@/")) {
    const target = resolvePath(FRONTEND_ROOT, specifier.slice(2));
    return nextResolve(pathToFileURL(withExtension(target)).href, context);
  }

  // Extensionless relative import: try the `.js` file the bundler would find.
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : FRONTEND_ROOT;
    const candidate = withExtension(resolvePath(dirname(parentPath), specifier));
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  return nextResolve(specifier, context);
}

function withExtension(path) {
  if (/\.[a-z]+$/i.test(path)) return path;
  for (const extension of [".js", ".mjs", ".jsx"]) {
    if (existsSync(`${path}${extension}`)) return `${path}${extension}`;
  }
  // Fall through unchanged so Node reports the real missing-module path rather
  // than a guessed one.
  return path;
}
