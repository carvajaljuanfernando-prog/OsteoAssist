import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo, /api va al backend local que guarda la API key.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
