import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@a2ui/core": fileURLToPath(
        new URL("../../packages/a2ui-core/src/index.ts", import.meta.url),
      ),
      "@a2ui/react": fileURLToPath(
        new URL("../../packages/a2ui-react/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
});
