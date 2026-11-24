import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "../app/src/main/assets/web", emptyOutDir: true, target: "chrome70", cssTarget: "chrome70" },
});
