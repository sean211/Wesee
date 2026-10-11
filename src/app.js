import { GoogleGenAI } from "@google/genai";

const STORAGE_KEY = "wesee-products-v1";
function addDays(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
const demoProducts = [
  { id: "sample-1", name: "서울우유 나 100%", expiry: addDays(2) },
  { id: "sample-2", name: "대추방울토마토", expiry: addDays(5) },
  { id: "sample-3", name: "플레인 요거트", expiry: addDays(10) },
  { id: "sample-4", name: "유기농 달걀", expiry: addDays(-1) },
];
let products = loadProducts();
let selectedFiles = [];
let activeFilter = "all";
let cameraStream = null;
let installPrompt = null;
const GEMINI_MODEL = "gemini-3.5-flash-lite";
function loadProducts() {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved !== null) return JSON.parse(saved); localStorage.setItem(STORAGE_KEY, JSON.stringify(demoProducts)); return demoProducts; }
  catch { return demoProducts; }
}
function persistProducts() { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)); }
function dayDelta(expiry) { const today = new Date(); today.setHours(0,0,0,0); return Math.round((new Date(expiry + "T00:00:00") - today) / 86400000); }
function statusFor(product) { const days = dayDelta(product.expiry); if (days < 0) return { key: "expired", label: "기한 지남" }; if (days <= 7) return { key: "soon", label: days === 0 ? "오늘까지" : days + "일 남음" }; return { key: "fresh", label: "여유 있어요" }; }
function formatDate(value) { const date = value.split("-").map(Number); return date[0] + "년 " + date[1] + "월 " + date[2] + "일"; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function renderProducts() {
  const query = document.querySelector("#product-search").value.trim().toLocaleLowerCase("ko");
  document.querySelector("#filter-all-count").textContent = products.length;
  const filtered = products.filter((p) => (activeFilter === "all" || statusFor(p).key === activeFilter) && p.name.toLocaleLowerCase("ko").includes(query)).sort((a,b) => a.expiry.localeCompare(b.expiry));
  const list = document.querySelector("#product-list");
  if (!filtered.length) {
    const isEmpty = products.length === 0;
    const msg = isEmpty ? ["아직 등록한 제품이 없어요.", "제품 사진을 올려 첫 제품을 등록해 보세요."] : ["해당하는 제품이 없어요.", "검색어나 필터를 바꿔서 다시 확인해 보세요."];
    list.innerHTML = '<div class="empty-state"><strong>' + msg[0] + '</strong><p>' + msg[1] + '</p>' + (isEmpty ? '<button class="button button-primary" data-go="upload">제품 등록하기</button>' : "") + "</div>";
    return;
  }
  list.innerHTML = filtered.map((p) => {
    const status = statusFor(p);
    return '<article class="product-row"><div class="product-main"><div class="product-name">' + escapeHtml(p.name) + '</div></div><time class="expiry-date" datetime="' + escapeHtml(p.expiry) + '">' + formatDate(p.expiry) + '</time><span class="status-pill ' + status.key + '">' + status.label + '</span><button class="delete-button" aria-label="' + escapeHtml(p.name) + ' 삭제" data-delete="' + escapeHtml(p.id) + '">×</button></article>';
  }).join("");
}
function navigate(page) {
  const titles = { home: "내 제품", upload: "제품 등록", result: "정보 확인", success: "저장 완료" };
  document.querySelectorAll(".page-view").forEach((view) => view.classList.add("hidden"));
  document.querySelector("#" + page + "-page").classList.remove("hidden");
  document.querySelector("#crumb-current").textContent = titles[page];
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === (page === "home" ? "home" : "upload")));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function setFiles(files) { selectedFiles = selectedFiles.concat(Array.from(files).filter((file) => file.type.startsWith("image/"))); renderPreviews(); }
function renderPreviews() {
  document.querySelector("#preview-list").innerHTML = selectedFiles.map((file, i) => '<div class="preview-card"><img src="' + URL.createObjectURL(file) + '" alt="선택한 제품 사진 ' + (i+1) + '" /><button class="preview-remove" type="button" aria-label="사진 ' + (i+1) + ' 삭제" data-remove-file="' + i + '">×</button></div>').join("");
  document.querySelector("#analyze-button").disabled = selectedFiles.length === 0;
}
function showResult() {
  document.querySelector("#photo-count-label").textContent = selectedFiles.length ? "사진 " + selectedFiles.length + "장을 확인했어요." : "제품 정보를 직접 입력할 수 있어요.";
  const photo = document.querySelector("#result-photo");
  photo.innerHTML = selectedFiles.length ? '<img src="' + URL.createObjectURL(selectedFiles[0]) + '" alt="제품 사진 미리보기" />' : "▧";
  document.querySelector("#product-name").value = "";
  document.querySelector("#product-expiry").value = "";
  navigate("result");
  document.querySelector("#product-name").focus({ preventScroll: true });
  if (selectedFiles.length) recognizeProduct();
}
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}
async function makeGeminiImagePart(file) {
  let imageBlob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    imageBlob = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("사진을 처리하지 못했어요.")), "image/jpeg", 0.82));
  } catch (error) {
    if (!file.type.startsWith("image/")) throw new Error("지원하지 않는 사진 형식이에요.");
  }
  return { type: "image", mime_type: imageBlob.type || file.type || "image/jpeg", data: await fileAsBase64(imageBlob) };
}
async function recognizeProduct() {
  const apiKey = window.WESEE_CONFIG && window.WESEE_CONFIG.GEMINI_API_KEY;
  const nameInput = document.querySelector("#product-name");
  const dateInput = document.querySelector("#product-expiry");
  const error = document.querySelector("#result-error");
  const analyzeButton = document.querySelector("#analyze-button");
  const retryButton = document.querySelector("#retry-ocr");
  error.classList.add("hidden");
  if (!apiKey || apiKey === "여기에_API_키를_입력하세요") {
    console.error("[wesee][Gemini] 요청을 보내지 않았습니다: config.js에 API 키가 없습니다.");
    error.textContent = "Gemini API 키가 아직 설정되지 않았어요. config.js에 키를 입력하면 사진 인식을 사용할 수 있어요. 제품 정보는 직접 입력해 저장할 수 있습니다.";
    error.classList.remove("hidden");
    return;
  }
  analyzeButton.disabled = true;
  analyzeButton.innerHTML = '<span class="loading-spinner"></span> 사진을 읽고 있어요';
  retryButton.disabled = true;
  retryButton.textContent = "사진을 읽고 있어요…";
  nameInput.placeholder = "제품명을 인식하고 있어요…";
  let stage = "요청 준비";
  console.groupCollapsed("[wesee][Gemini] OCR 요청");
  console.info("요청 시작", {
    model: GEMINI_MODEL,
    stream: true,
    photos: selectedFiles.map((file) => ({ name: file.name, type: file.type, size: file.size }))
  });
  try {
    const input = await Promise.all(selectedFiles.map(makeGeminiImagePart));
    const prompt = "당신은 한국 식품 포장 사진에서 제품명과 소비기한을 읽는 OCR 도우미입니다. 제공된 모든 사진을 살펴보고 가장 신뢰할 수 있는 제품명과 소비기한을 반환하세요. 날짜는 포장에 소비기한, 유통기한, 품질유지기한 등으로 표시된 날짜를 읽되, 추측하지 말고 읽을 수 없으면 빈 문자열을 반환하세요. 날짜는 YYYY-MM-DD 형식입니다. 반드시 JSON 객체 하나만 반환하세요: {\"name\":\"제품명\",\"expiry\":\"YYYY-MM-DD\"}.";
    input.push({ type: "text", text: prompt });
    const ai = new GoogleGenAI({ apiKey });
    stage = "Gemini 요청";
    const stream = await ai.interactions.create({
      model: GEMINI_MODEL,
      input,
      stream: true,
      response_format: [{
        type: "text",
        mime_type: "application/json",
        schema: {
          type: "object",
          properties: { name: { type: "string" }, expiry: { type: "string" } },
          required: ["name", "expiry"]
        }
      }]
    });
    console.info("스트림 응답 시작");
    stage = "스트림 수신";
    let outputText = "";
    for await (const event of stream) {
      console.debug("Gemini 스트림 이벤트", event);
      if (event.event_type === "step.delta" && event.delta?.type === "text") outputText += event.delta.text || "";
    }
    console.info("스트림 완료, 원문 응답", outputText);
    stage = "응답 파싱";
    const data = JSON.parse(outputText);
    console.info("JSON 파싱 결과", data);
    stage = "화면 반영";
    if (data.name) nameInput.value = data.name;
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.expiry || "")) dateInput.value = data.expiry;
    console.info("입력칸 반영 결과", { productName: nameInput.value, expiry: dateInput.value });
    if (!data.name || !data.expiry) {
      error.textContent = "일부 정보를 읽지 못했어요. 사진에 표시된 내용을 확인하고 직접 입력해 주세요.";
      error.classList.remove("hidden");
    }
  } catch (err) {
    console.error("[wesee][Gemini] " + stage + " 단계에서 실패했습니다.", err);
    error.textContent = "사진을 인식하지 못했어요. " + (err.message || "잠시 후 다시 시도하거나 정보를 직접 입력해 주세요.");
    error.classList.remove("hidden");
  } finally {
    console.groupEnd();
    analyzeButton.disabled = selectedFiles.length === 0;
    analyzeButton.innerHTML = "다시 인식하기 <span>↻</span>";
    retryButton.disabled = false;
    retryButton.textContent = "사진 다시 인식";
  }
}
function saveProduct(event) {
  event.preventDefault();
  const name = document.querySelector("#product-name").value.trim(); const expiry = document.querySelector("#product-expiry").value;
  if (!name || !expiry) return;
  const product = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, expiry, createdAt: Date.now() };
  products.unshift(product); persistProducts(); renderProducts();
  const status = statusFor(product);
  document.querySelector("#saved-preview").innerHTML = '<div><strong>' + escapeHtml(product.name) + '</strong><small>소비기한 · ' + formatDate(product.expiry) + '</small></div><span class="status-pill ' + status.key + '">' + status.label + '</span>';
  navigate("success");
}
document.addEventListener("click", (event) => {
  const go = event.target.closest("[data-go], [data-page]");
  if (go) { event.preventDefault(); navigate(go.dataset.go || go.dataset.page); }
  const filter = event.target.closest("[data-filter]");
  if (filter) { activeFilter = filter.dataset.filter; document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("selected", chip === filter)); renderProducts(); }
  const remove = event.target.closest("[data-delete]");
  if (remove) { products = products.filter((p) => p.id !== remove.dataset.delete); persistProducts(); renderProducts(); }
  const removeFile = event.target.closest("[data-remove-file]");
  if (removeFile) { selectedFiles.splice(Number(removeFile.dataset.removeFile), 1); renderPreviews(); }
});
document.querySelector("#product-search").addEventListener("input", renderProducts);
document.querySelector("#choose-files").addEventListener("click", () => document.querySelector("#file-input").click());
async function openCamera() {
  const dialog = document.querySelector("#camera-dialog");
  const video = document.querySelector("#camera-video");
  const cameraError = document.querySelector("#camera-error");
  cameraError.classList.add("hidden");
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("이 환경에서는 실시간 카메라를 사용할 수 없어요. HTTPS 또는 localhost에서 열어 주세요.");
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = cameraStream;
    dialog.showModal();
    await video.play();
  } catch (err) {
    cameraError.textContent = err.name === "NotAllowedError" ? "카메라 접근이 차단되어 있어요. 브라우저 권한을 허용하거나 사진 파일을 선택해 주세요." : (err.message || "카메라를 열지 못했어요.");
    cameraError.classList.remove("hidden");
    if (!dialog.open) dialog.showModal();
  }
}
function closeCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  document.querySelector("#camera-video").srcObject = null;
  const dialog = document.querySelector("#camera-dialog");
  if (dialog.open) dialog.close();
}
function capturePhoto() {
  const video = document.querySelector("#camera-video");
  if (!cameraStream || !video.videoWidth) return;
  const canvas = document.querySelector("#camera-canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) { const stamp = new Date().toISOString().replace(/[:.]/g, "-"); setFiles([new File([blob], "wesee-" + stamp + ".jpg", { type: "image/jpeg" })]); }
    closeCamera();
  }, "image/jpeg", 0.92);
}
document.querySelector("#take-photo").addEventListener("click", openCamera);
document.querySelector("#camera-close").addEventListener("click", closeCamera);
document.querySelector("#camera-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeCamera(); });
document.querySelector("#camera-dialog").addEventListener("cancel", closeCamera);
document.querySelector("#capture-photo").addEventListener("click", capturePhoto);
document.querySelector("#camera-fallback").addEventListener("click", () => { closeCamera(); document.querySelector("#camera-input").click(); });
document.querySelector("#file-input").addEventListener("change", (event) => { setFiles(event.target.files); event.target.value = ""; });
document.querySelector("#camera-input").addEventListener("change", (event) => { setFiles(event.target.files); event.target.value = ""; });
document.querySelector("#drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
document.querySelector("#drop-zone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
document.querySelector("#drop-zone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); setFiles(event.dataTransfer.files); });
document.querySelector("#analyze-button").addEventListener("click", showResult);
document.querySelector("#product-form").addEventListener("submit", saveProduct);
document.querySelector("#retry-ocr").addEventListener("click", recognizeProduct);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); installPrompt = event;
  document.querySelector("#install-app").classList.remove("hidden");
});
document.querySelector("#install-app").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.querySelector("#install-app").classList.add("hidden");
});
window.addEventListener("appinstalled", () => document.querySelector("#install-app").classList.add("hidden"));
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
renderProducts();
