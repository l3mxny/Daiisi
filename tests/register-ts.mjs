// Lets Node's built-in test runner import the project's TypeScript files directly (no extra dependency):
//   npm test      (runs: node --import ./tests/register-ts.mjs --test tests/)
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
