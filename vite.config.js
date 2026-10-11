import { defineConfig } from "vite";
import { copyFileSync, existsSync } from "node:fs";
import { handleCrawlApi } from "./server/crawl-api.js";

export default defineConfig({
  plugins: [{
    name: "wesee-crawl-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url, "http://localhost").pathname;
        if (path === "/api/crawl" || path === "/api/image") handleCrawlApi(req, res);
        else next();
      });
    }
  }, {
    name: "copy-local-gemini-config",
    apply: "build",
    closeBundle() {
      if (existsSync("config.js")) copyFileSync("config.js", "dist/config.js");
    }
  }],
  build: {
    rollupOptions: {
      input: ["index.html", "voiceover.html"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        codeSplitting: true
      }
    }
  }
});
