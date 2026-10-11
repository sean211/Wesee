const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function allowedUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP 또는 HTTPS 링크를 입력해 주세요.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("내부 네트워크 주소는 사용할 수 없어요.");
  return url;
}

async function fetchPublic(url, limit) {
  let current = allowedUrl(url);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, { redirect: "manual", headers: { "user-agent": "wesee-accessibility/1.0", accept: "text/html,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("페이지 이동 주소를 확인할 수 없어요.");
      current = allowedUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error("쇼핑몰 페이지에서 오류가 발생했어요 (" + response.status + ").");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("페이지 또는 이미지 용량이 너무 커서 처리할 수 없어요."); }
      chunks.push(value);
    }
    return { response, url: current, bytes: Buffer.concat(chunks) };
  }
  throw new Error("페이지 이동이 너무 많아요.");
}

function pageAssets(html, baseUrl) {
  const found = new Set();
  const frames = new Set();
  const add = (value) => {
    if (!value || /^(data:|blob:|javascript:)/i.test(value)) return;
    try { const url = new URL(value, baseUrl); if (["http:", "https:"].includes(url.protocol)) found.add(url.href); } catch {}
  };
  const addFrame = (value) => {
    if (!value || /^(data:|blob:|javascript:|about:)/i.test(value)) return;
    try { const url = new URL(value, baseUrl); if (["http:", "https:"].includes(url.protocol)) frames.add(url.href); } catch {}
  };
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    for (const attr of ["src", "data-src", "data-original", "data-lazy-src", "data-image"]) {
      const matchAttr = tag.match(new RegExp("\\b" + attr + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
      if (matchAttr) add(matchAttr[1] || matchAttr[2] || matchAttr[3]);
    }
    const srcset = tag.match(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (srcset) for (const part of (srcset[1] || srcset[2]).split(",")) add(part.trim().split(/\s+/)[0]);
  }
  for (const match of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = match[0];
    const descriptor = ["id", "title", "class"].map((name) => tag.match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"))).map((value) => value?.[1] || value?.[2] || "").join(" ");
    if (!/(?:detail|desc|notice|상품상세|상품공지)/i.test(descriptor)) continue;
    const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (src) addFrame(src[1] || src[2] || src[3]);
  }
  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(match[1]);
  return { images: [...found], frames: [...frames].slice(0, 10) };
}

export async function handleCrawlApi(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const target = url.searchParams.get("url");
    if (!target) { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "쇼핑몰 링크를 입력해 주세요." })); return; }
    if (url.pathname === "/api/crawl") {
      const result = await fetchPublic(target, MAX_PAGE_BYTES);
      if (!(result.response.headers.get("content-type") || "").includes("text/html")) throw new Error("HTML 쇼핑몰 페이지 링크를 입력해 주세요.");
      const html = result.bytes.toString("utf8");
      const { images, frames } = pageAssets(html, result.url.href);
      const detailFrames = new Set(frames);
      const elevenStreetProduct = result.url.hostname.endsWith("11st.co.kr") && result.url.pathname.match(/^\/products\/(\d+)/);
      if (elevenStreetProduct) detailFrames.add(new URL("/products/" + elevenStreetProduct[1] + "/view-desc", result.url).href);
      for (const frameUrl of detailFrames) {
        try {
          const frame = await fetchPublic(frameUrl, MAX_PAGE_BYTES);
          if ((frame.response.headers.get("content-type") || "").includes("text/html")) {
            const nested = pageAssets(frame.bytes.toString("utf8"), frame.url.href);
            images.push(...nested.images);
          }
        } catch {}
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").trim() || result.url.hostname, images: [...new Set(images)].slice(0, 200) }));
      return;
    }
    if (url.pathname === "/api/image") {
      const result = await fetchPublic(target, MAX_IMAGE_BYTES);
      const type = result.response.headers.get("content-type") || "application/octet-stream";
      if (!type.startsWith("image/")) throw new Error("이미지 주소가 아니에요.");
      res.writeHead(200, { "content-type": type, "content-length": result.bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(result.bytes);
      return;
    }
    res.writeHead(404); res.end();
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: error.message || "페이지를 가져오지 못했어요." }));
  }
}
