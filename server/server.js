import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleCrawlApi } from "./crawl-api.js";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/crawl" || pathname === "/api/image") { handleCrawlApi(req, res); return; }
  let relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  relative = normalize(relative).replace(/^([.][.][/\\])+/, "").replace(/^[/\\]+/, "");
  const path = join(root, relative);
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "content-type": types[extname(path).toLowerCase()] || "application/octet-stream" });
  createReadStream(path).pipe(res);
});
server.listen(Number(process.env.PORT || 4173), "0.0.0.0", () => console.log("wesee listening on http://localhost:" + (process.env.PORT || 4173)));
