import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif" };
const folder = resolve(process.argv[2] || "photos");
const configPath = new URL("./config.js", import.meta.url);
const configText = await readFile(configPath, "utf8").catch(() => "");
const configKey = configText.match(/GEMINI_API_KEY\s*:\s*(["'])(.*?)\1/s)?.[2];
const apiKey = process.env.GEMINI_API_KEY || configKey;

if (!apiKey) throw new Error("Gemini API 키를 config.js에 입력하거나 GEMINI_API_KEY 환경 변수로 설정해 주세요.");
const files = (await readdir(folder, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && MIME[extname(entry.name).toLowerCase()])
  .map((entry) => join(folder, entry.name));
if (!files.length) throw new Error(`이미지 파일이 없습니다: ${folder}`);

const input = [];
for (const file of files) input.push({ type: "image", mime_type: MIME[extname(file).toLowerCase()], data: (await readFile(file)).toString("base64") });
input.push({ type: "text", text: "사진들에서 식품 제품명과 포장에 표시된 소비기한을 읽어 주세요. 여러 사진이 같은 제품이면 정보를 합치고, 모르는 내용은 추측하지 마세요. 날짜는 YYYY-MM-DD로 적고, 읽을 수 없으면 '확인 불가'라고 하세요. 제품별로 제품명과 소비기한을 한국어로 출력하세요." });
const result = await new GoogleGenAI({ apiKey }).models.generateContent({ model: MODEL, contents: [{ role: "user", parts: input.map((part) => part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mime_type, data: part.data } }) }] });
console.log(result.text?.trim() || "제품 정보를 읽지 못했습니다.");
