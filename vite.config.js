import { defineConfig } from "vite";
import { museumApi } from "./server/api.js";

export default defineConfig({
  plugins: [museumApi()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2020",
    sourcemap: false,
  },
});
