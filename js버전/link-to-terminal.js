import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";
const target = process.argv[2];
const configPath = new URL("./config.js", import.meta.url);
const configText = await readFile(configPath, "utf8").catch(() => "");
const configKey = configText.match(/GEMINI_API_KEY\s*:\s*(["'])(.*?)\1/s)?.[2];
const apiKey = process.env.GEMINI_API_KEY || configKey;
const outDir = resolve("crawl_img");
const headers = { "user-agent": "Mozilla/5.0 (compatible; wesee/1.0)", accept: "text/html,image/*,*/*;q=0.8" };
if (!target) throw new Error("사용법: node link-to-terminal.js <페이지 URL>");
if (!apiKey) throw new Error("Gemini API 키를 config.js에 입력하거나 GEMINI_API_KEY 환경 변수로 설정해 주세요.");
const pageUrl = new URL(target);
if (!/^https?:$/.test(pageUrl.protocol)) throw new Error("http 또는 https 페이지 주소를 입력해 주세요.");
const response = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`페이지 요청 실패 (${response.status})`);
const html = await response.text();
const candidates = new Set();
for (const tag of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
  const attrs = tag[0];
  for (const match of attrs.matchAll(/\b(?:src|data-src|data-original|data-lazy-src|data-image)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = match[1] || match[2] || match[3];
    try { const url = new URL(value, pageUrl); if (/^https?:$/.test(url.protocol)) candidates.add(url.href); } catch {}
  }
  const srcset = attrs.match(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (srcset) for (const item of (srcset[1] || srcset[2]).split(",")) {
    try { const url = new URL(item.trim().split(/\s+/)[0], pageUrl); if (/^https?:$/.test(url.protocol)) candidates.add(url.href); } catch {}
  }
}
for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
  try { candidates.add(new URL(match[1], pageUrl).href); } catch {}
}
if (!candidates.size) throw new Error("페이지에서 이미지를 찾지 못했습니다.");
await mkdir(outDir, { recursive: true });

function dimensions(buffer, mime) {
  if (mime === "image/png" && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (mime === "image/gif" && buffer.toString("ascii", 0, 3) === "GIF") return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (mime === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF") {
    const kind = buffer.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") return { width: 1 + (((buffer[22] & 0x3f) << 8) | buffer[21]), height: 1 + (((buffer[24] & 0x0f) << 10) | (buffer[23] << 2) | (buffer[22] >> 6)) };
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i++] !== 0xff) continue;
      const marker = buffer[i++];
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: buffer.readUInt16BE(i + 3), width: buffer.readUInt16BE(i + 5) };
      const length = buffer.readUInt16BE(i); if (length < 2) break; i += length;
    }
  }
  return null;
}

const images = [];
let index = 0;
for (const url of candidates) {
  try {
    const imageResponse = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!imageResponse.ok || !(imageResponse.headers.get("content-type") || "").startsWith("image/")) continue;
    const mime = imageResponse.headers.get("content-type").split(";")[0].toLowerCase();
    const data = Buffer.from(await imageResponse.arrayBuffer());
    if (data.length > 15 * 1024 * 1024) continue;
    const size = dimensions(data, mime); if (!size?.height) continue;
    const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" })[mime] || extname(new URL(url).pathname) || ".img";
    const path = join(outDir, `${String(++index).padStart(3, "0")}${ext}`);
    await writeFile(path, data); images.push({ path, mime, data, ...size });
  } catch {}
}
if (!images.length) throw new Error("이미지를 내려받지 못했거나 크기를 확인할 수 없습니다.");
images.sort((a, b) => b.height - a.height);
const selected = images[0];
const result = await new GoogleGenAI({ apiKey }).models.generateContent({
  model: MODEL,
  contents: [{ role: "user", parts: [
    { inlineData: { mimeType: selected.mime, data: selected.data.toString("base64") } },
    { text: "당신은 시각 장애인을 위한 한국어 쇼핑 상품 안내자입니다. 이 상품 상세 이미지에 실제로 보이는 내용을 핵심 위주로 자연스러운 존댓말 문장 3~6개로 요약하세요. 상품 종류와 특징, 소재나 구성, 크기, 사용법, 가격·혜택, 주의사항이 읽힐 때만 포함하고 불확실한 정보는 추측하지 마세요. 음성으로 바로 읽기 좋은 문장만 반환하세요." }
  ] }]
});
console.log(`이미지 ${images.length}개를 ${outDir}에 저장했습니다.`);
console.log(`가장 높은 이미지: ${selected.path} (${selected.width} × ${selected.height})`);
console.log("\n" + (result.text?.trim() || "이미지에서 상품 설명을 읽지 못했습니다."));
