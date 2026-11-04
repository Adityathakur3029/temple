import { defineConfig } from "vite";
import { bootHtml } from "./vite-plugins/boot-html.ts";

export default defineConfig({
  plugins: [bootHtml()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    // tools/check/size.ts reads dist/.vite/manifest.json for the spec 10 budgets.
    manifest: true,
    // Three.js alone is ~530 kB minified. The real limits are the gzip budgets in spec 10,
    // enforced by `npm run check`.
    chunkSizeWarningLimit: 800,
  },
});
