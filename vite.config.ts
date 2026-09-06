import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * One dev server for both halves: the page is served by Vite and the worker
 * runs in workerd beside it with the real D1 and R2 bindings, so local
 * development exercises the same code and the same SQL that ships.
 *
 * The plugin resolves both the wrangler config and its local state beside the
 * Vite root, and the Vite root is web/, so both have to be pointed back at
 * the project. Sharing one state directory is what lets `wrangler d1 execute`
 * and the dev server see the same rows.
 */
export default defineConfig({
  root: "web",
  // The plugin fans out per environment, so this is the parent of dist/client
  // (the page) and dist/social-graph (the worker).
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [
    react(),
    cloudflare({
      configPath: fileURLToPath(new URL("wrangler.jsonc", import.meta.url)),
      persistState: { path: fileURLToPath(new URL(".wrangler/state", import.meta.url)) },
    }),
  ],
});
