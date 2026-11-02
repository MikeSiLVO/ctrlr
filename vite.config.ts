import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Windows locks the running .exe; a watched Rust rebuild kills the dev server
      ignored: ["**/target/**", "**/crates/**"],
    },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
  },
});
