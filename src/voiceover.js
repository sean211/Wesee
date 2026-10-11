import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.5-flash-lite";
const form = document.querySelector("#crawl-form");
const input = document.querySelector("#shop-url");
const crawlButton = document.querySelector("#crawl-button");
const status = document.querySelector("#status-message");
const error = document.querySelector("#error-message");
const summaryPanel = document.querySelector("#summary-panel");
const summaryText = document.querySelector("#summary-text");
const speakButton = document.querySelector("#speak-button");
const stopButton = document.querySelector("#stop-button");
const detailImage = document.querySelector("#detail-image");
let selectedSummary = "";
let imageObjectUrl = "";

function setError(message) { error.textContent = message; error.classList.remove("hidden"); }
function setProgress(message) { status.textContent = message; status.classList.add("loading"); }
function proxyImage(url) { return "/api/image?url=" + encodeURIComponent(url); }

async function imageHeight(url) {
  const response = await fetch(proxyImage(url));
  if (!response.ok) throw new Error("이미지 파일을 가져오지 못했어요.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("이미지 파일이 아니에요.");
  const localUrl = URL.createObjectURL(blob);
  try {
    const dimensions = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => reject(new Error("이미지 크기를 확인하지 못했어요.")); img.src = localUrl;
    });
    return { url, blob, ...dimensions };
  } finally { URL.revokeObjectURL(localUrl); }
}

async function summarize(blob) {
  const apiKey = window.WESEE_CONFIG?.GEMINI_API_KEY;
  if (!apiKey || apiKey === "여기에_API_키를_입력하세요") throw new Error("Gemini API 키가 설정되지 않았어요. config.js에 키를 입력해 주세요.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const imageData = btoa(binary);
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: blob.type || "image/jpeg", data: imageData } },
      { text: "당신은 시각 장애인을 위한 한국어 쇼핑 상세 페이지 음성 안내자입니다. 이 상품 상세 이미지에 실제로 보이는 내용을 핵심 위주로 자연스러운 존댓말 문장 3~6개로 요약하세요. 상품 종류와 특징, 소재나 구성, 크기, 사용법, 가격·혜택, 주의사항이 읽힐 때만 포함하고 불확실한 정보는 추측하지 마세요. 화면 배치나 글자색을 설명하지 말고, 이미지에 정보가 없으면 지어내지 마세요. 음성으로 바로 읽기 좋은 문장만 반환하세요." }
    ] }]
  });
  return response.text?.trim() || "이미지에서 상품 설명을 읽지 못했어요.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.classList.add("hidden"); summaryPanel.classList.add("hidden"); status.classList.remove("loading");
  window.speechSynthesis?.cancel();
  const value = input.value.trim();
  try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) throw new Error(); }
  catch { setError("http:// 또는 https://로 시작하는 페이지 주소를 입력해 주세요."); return; }
  crawlButton.disabled = true; crawlButton.textContent = "살펴보는 중…";
  try {
    setProgress("쇼핑몰 페이지에서 이미지를 찾고 있어요.");
    const response = await fetch("/api/crawl?url=" + encodeURIComponent(value));
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("크롤링 API 응답이 HTML로 돌아왔어요. 개발 서버를 다시 실행하거나 배포 서버의 API 설정을 확인해 주세요.");
    const page = await response.json();
    if (!response.ok) throw new Error(page.error || "페이지를 불러오지 못했어요.");
    if (!page.images?.length) throw new Error("페이지에서 상품 이미지를 찾지 못했어요.");
    setProgress("이미지 " + page.images.length + "개 중 세로 길이가 가장 긴 이미지를 찾고 있어요.");
    const results = await Promise.allSettled(page.images.map(imageHeight));
    const valid = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (!valid.length) throw new Error("페이지의 이미지를 읽지 못했어요.");
    valid.sort((a, b) => b.height - a.height);
    const selected = valid[0];
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = URL.createObjectURL(selected.blob);
    detailImage.src = imageObjectUrl;
    document.querySelector("#image-size").textContent = selected.width + " × " + selected.height + " · 가장 긴 이미지";
    setProgress("선택한 이미지의 상품 정보를 요약하고 있어요.");
    selectedSummary = await summarize(selected.blob);
    summaryText.textContent = selectedSummary;
    summaryPanel.classList.remove("hidden");
    status.classList.remove("loading");
    status.textContent = "요약을 준비했어요. 아래 버튼을 눌러 들어 보세요.";
    summaryPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    status.classList.remove("loading"); status.textContent = "";
    setError(err.message || "페이지를 처리하지 못했어요. 링크를 확인하고 다시 시도해 주세요.");
  } finally { crawlButton.disabled = false; crawlButton.textContent = "페이지 살펴보기"; }
});

speakButton.addEventListener("click", () => {
  if (!selectedSummary || !("speechSynthesis" in window)) { setError("이 브라우저에서는 음성 읽기를 지원하지 않아요."); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(selectedSummary);
  utterance.lang = "ko-KR"; utterance.rate = 0.95;
  utterance.onstart = () => { speakButton.disabled = true; stopButton.disabled = false; };
  utterance.onend = utterance.onerror = () => { speakButton.disabled = false; stopButton.disabled = true; };
  window.speechSynthesis.speak(utterance);
});
stopButton.addEventListener("click", () => { window.speechSynthesis.cancel(); speakButton.disabled = false; stopButton.disabled = true; });
window.addEventListener("pagehide", () => { window.speechSynthesis?.cancel(); if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl); });
