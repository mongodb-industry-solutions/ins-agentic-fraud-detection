/**
 * Registers the resolve hooks, then runs the check script named in argv[2].
 *
 * A separate entry point because Node applies loader hooks only to modules
 * imported *after* registration — a script that registered them itself would
 * already have had its own imports resolved.
 *
 * Usage:
 *   node scripts/with-aliases.mjs scripts/check-correlations.mjs
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

register("./resolve-hooks.mjs", import.meta.url);

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/with-aliases.mjs <script.mjs>");
  process.exit(2);
}

await import(pathToFileURL(resolve(process.cwd(), target)).href);
