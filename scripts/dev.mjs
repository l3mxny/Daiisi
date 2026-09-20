// Starts `next dev`, but never lets a stale terminal value beat .env.local for the Sentinel login.
//
// Next.js does not override variables that are already set in the terminal, so an old
// CDSE_CLIENT_ID / CDSE_CLIENT_SECRET exported by a shell profile or editor silently wins over the
// ones in .env.local. Copernicus then rejects the login ("invalid_client") and the app quietly
// falls back to sample pictures. Here, if the terminal's value differs from .env.local, the
// .env.local one is used. Values are never printed. Works the same on macOS, Linux and Windows.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const GUARDED = ["CDSE_CLIENT_ID", "CDSE_CLIENT_SECRET"];

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

// The environment to start Next with, and which names were dropped from the terminal's copy.
export function environmentForDev(shellEnv, fileEnv, names = GUARDED) {
  const env = { ...shellEnv };
  const ignored = [];
  for (const name of names) {
    const fromFile = fileEnv[name];
    if (fromFile && env[name] !== undefined && env[name] !== fromFile) {
      delete env[name];
      ignored.push(name);
    }
  }
  return { env, ignored };
}

function main() {
  const fileEnv = existsSync(".env.local") ? parseEnvFile(readFileSync(".env.local", "utf8")) : {};
  const { env, ignored } = environmentForDev(process.env, fileEnv);
  for (const name of ignored) {
    console.warn(`[dev] ${name} in your terminal differs from .env.local, so .env.local is being used.`);
  }

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], { stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
