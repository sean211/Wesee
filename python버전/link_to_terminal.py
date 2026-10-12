import argparse
import io
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from google import genai
from google.genai import types
from PIL import Image, UnidentifiedImageError

MODEL = "gemini-3.5-flash-lite"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; wesee/1.0)", "Accept": "text/html,image/*,*/*;q=0.8"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024


def get_api_key() -> str | None:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    config_file = Path(__file__).resolve().parent.parent / "js버전" / "config.js"
    try:
        source = config_file.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"GEMINI_API_KEY\s*:\s*(['\"])(.*?)\1", source, re.DOTALL)
    return match.group(2) if match else None


class ImageFinder(HTMLParser):
    def __init__(self, page_url: str):
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.urls: set[str] = set()

    def add(self, value: str | None) -> None:
        if not value or value.startswith(("data:", "blob:", "javascript:")):
            return
        url = urljoin(self.page_url, value.strip())
        if urlparse(url).scheme in ("http", "https"):
            self.urls.add(url)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value for key, value in attrs}
        if tag.lower() in ("img", "source"):
            for key in ("src", "data-src", "data-original", "data-lazy-src", "data-image"):
                self.add(values.get(key))
            for candidate in (values.get("srcset") or "").split(","):
                if candidate.strip():
                    self.add(candidate.strip().split()[0])
        if tag.lower() == "meta" and (values.get("property") or values.get("name") or "").lower() in ("og:image", "twitter:image"):
            self.add(values.get("content"))


def main() -> None:
    parser = argparse.ArgumentParser(description="페이지 이미지를 저장하고 가장 세로로 긴 이미지를 요약합니다.")
    parser.add_argument("url", help="상품 페이지 URL")
    args = parser.parse_args()
    if urlparse(args.url).scheme not in ("http", "https"):
        raise SystemExit("http 또는 https 페이지 주소를 입력해 주세요.")
    api_key = get_api_key()
    if not api_key:
        raise SystemExit("Gemini API 키를 js버전/config.js에 입력하거나 GEMINI_API_KEY 환경 변수로 설정해 주세요.")

    session = requests.Session()
    session.headers.update(HEADERS)
    page = session.get(args.url, timeout=20)
    page.raise_for_status()
    if "html" not in page.headers.get("content-type", "").lower():
        raise SystemExit("HTML 상품 페이지 링크를 입력해 주세요.")
    finder = ImageFinder(page.url)
    finder.feed(page.text)
    if not finder.urls:
        raise SystemExit("페이지에서 이미지를 찾지 못했습니다.")

    out_dir = Path(__file__).resolve().parent / "crawl_img"
    out_dir.mkdir(exist_ok=True)
    images = []
    for image_url in finder.urls:
        try:
            response = session.get(image_url, timeout=20, stream=True)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if not content_type.startswith("image/"):
                continue
            data = bytearray()
            for chunk in response.iter_content(64 * 1024):
                data.extend(chunk)
                if len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("image too large")
            image_data = bytes(data)
            with Image.open(io.BytesIO(image_data)) as image:
                width, height = image.size
                image_format = (image.format or "jpg").lower()
            extension = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif", "bmp": ".bmp", "tiff": ".tif"}.get(image_format, ".img")
            path = out_dir / f"{len(images) + 1:03d}{extension}"
            path.write_bytes(image_data)
            images.append({"path": path, "data": image_data, "mime": content_type, "width": width, "height": height})
        except (requests.RequestException, UnidentifiedImageError, OSError, ValueError):
            continue
    if not images:
        raise SystemExit("이미지를 내려받지 못했거나 이미지 크기를 확인할 수 없습니다.")

    selected = max(images, key=lambda item: item["height"])
    prompt = (
        "당신은 시각 장애인을 위한 한국어 쇼핑 상품 안내자입니다. 이 상품 상세 이미지에 실제로 보이는 내용을 "
        "핵심 위주로 자연스러운 존댓말 문장 3~6개로 요약하세요. 상품 종류와 특징, 소재나 구성, 크기, 사용법, "
        "가격·혜택, 주의사항이 읽힐 때만 포함하고 불확실한 정보는 추측하지 마세요. 음성으로 바로 읽기 좋은 문장만 반환하세요."
    )
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=MODEL,
        contents=[types.Part.from_bytes(data=selected["data"], mime_type=selected["mime"]), prompt],
    )
    print(f"이미지 {len(images)}개를 {out_dir}에 저장했습니다.")
    print(f"가장 높은 이미지: {selected['path']} ({selected['width']} × {selected['height']})")
    print("\n" + (response.text or "이미지에서 상품 설명을 읽지 못했습니다."))


if __name__ == "__main__":
    main()
