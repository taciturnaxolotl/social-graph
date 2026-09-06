/**
 * The app on your machine, the data on Cloudflare.
 *
 *   bun run dev:remote        then http://localhost:8787/auth/dev?email=you@cedarville.edu
 *
 * Testing against production without Google means signing in without Google,
 * and `/auth/dev` refuses to exist anywhere but loopback — which is the point
 * of it, and not something to relax on a public URL holding ten thousand real
 * names.
 *
 * `wrangler dev --remote` does not help. It proxies through the edge, so the
 * worker sees a public hostname and the route stays shut. What works is the
 * other way round: run the worker locally, where the hostname is localhost and
 * `.dev.vars` applies, and mark the *bindings* remote so D1 and R2 are the
 * real ones. Plain `wrangler dev` honours that; `--local` is the flag that
 * turns it off.
 *
 * Two details this handles for you. The generated config is written beside
 * wrangler.jsonc so every relative path inside it still resolves. And ORIGIN
 * is overridden to the local address, because the deployed value is https and
 * a session cookie marked Secure never comes back over http.
 *
 * The writes are real. Placing somebody here places them in production.
 */

import { spawn } from "node:child_process";

const SOURCE = "wrangler.jsonc";
const GENERATED = "wrangler.remote.jsonc";
const PORT = "8787";

/** JSONC to JSON, without mangling the `//` inside a URL. */
function stripComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  // Trailing commas are legal in jsonc and not in json.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const config = JSON.parse(stripComments(await Bun.file(SOURCE).text())) as {
  d1_databases?: Record<string, unknown>[];
  r2_buckets?: Record<string, unknown>[];
};

for (const binding of [...(config.d1_databases ?? []), ...(config.r2_buckets ?? [])]) {
  binding.remote = true;
}
await Bun.write(GENERATED, `${JSON.stringify(config, null, 2)}\n`);

const vars = await Bun.file(".dev.vars")
  .text()
  .catch(() => "");
if (!/^DEV_LOGIN=1/m.test(vars)) {
  console.error("put DEV_LOGIN=1 in .dev.vars, or there is no way to sign in without Google");
  process.exit(1);
}

// wrangler dev serves the page out of dist/, so it has to exist and be current.
const built = spawn("bunx", ["vite", "build"], { stdio: ["inherit", "ignore", "inherit"] });
if ((await new Promise<number>((r) => built.on("close", (c) => r(c ?? 0)))) !== 0) process.exit(1);

console.log(`\nD1 and R2 are the production ones. Writes are real.`);
console.log(`sign in: http://localhost:${PORT}/auth/dev?email=you@cedarville.edu\n`);

const child = spawn(
  "bunx",
  [
    "wrangler",
    "dev",
    "--config",
    GENERATED,
    "--port",
    PORT,
    `--var`,
    `ORIGIN:http://localhost:${PORT}`,
  ],
  { stdio: "inherit" },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.exit(await new Promise<number>((r) => child.on("close", (code) => r(code ?? 0))));
