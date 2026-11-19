import { spawn } from "node:child_process";
import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";

const [entry, ...args] = process.argv.slice(2);
const env = { ...process.env };
const options = new Map([
  ["--data-root", "HORTINIS_DATA_ROOT"],
  ["--cache-root", "HORTINIS_CACHE_ROOT"],
  ["--output-root", "HORTINIS_OUTPUT_ROOT"],
]);
const optionValues = new Set();
const forwarded = [];

for (let index = 0; index < args.length; index++) {
  const option = args[index];
  if (option === "--") continue;
  const key = options.get(option);
  if (!key) {
    forwarded.push(option);
    continue;
  }
  const value = args[++index];
  if (!value || value.startsWith("--") || optionValues.has(key))
    throw new Error(`Pass ${option} once with a directory path`);
  optionValues.add(key);
  env[key] = resolve(value);
}

const child = spawn(process.execPath, [entry, ...forwarded], {
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? 1;
  if (signal) process.kill(process.pid, signal);
});
