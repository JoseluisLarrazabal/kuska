import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split de vendors: `viem` (+ sus deps de criptografía: @noble,
        // @scure, abitype, ox) es casi todo el peso del bundle y cambia poco
        // entre deploys; separarlo de react/react-router deja que el
        // navegador cachee cada uno por separado en vez de invalidar todo el
        // bundle en cada build. Las páginas quedan en sus propios chunks por
        // el `React.lazy` de App.tsx (no hace falta listarlas acá).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            /node_modules\/(viem|@noble|@scure|abitype|ox|isows)\//.test(id)
          ) {
            return "vendor-viem";
          }
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "vendor-react";
          }
          if (/node_modules\/react-router(-dom)?\//.test(id)) {
            return "vendor-router";
          }
          if (/node_modules\/(qr-scanner|qrcode\.react)\//.test(id)) {
            return "vendor-qr";
          }
          return "vendor";
        },
      },
    },
  },
});
