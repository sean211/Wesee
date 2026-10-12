import argparse
import os
import re
from pathlib import Path

from google import genai
from google.genai import types

MODEL = "gemini-3.5-flash-lite"
IMAGE_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif",
}


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


def main() -> None:
    parser = argparse.ArgumentParser(description="사진 폴더에서 제품명과 소비기한을 읽어 터미널에 표시합니다.")
    parser.add_argument("folder", nargs="?", default=str(Path(__file__).resolve().parent / "photos"))
    args = parser.parse_args()
    api_key = get_api_key()
    if not api_key:
        raise SystemExit("Gemini API 키를 js버전/config.js에 입력하거나 GEMINI_API_KEY 환경 변수로 설정해 주세요.")
    folder = Path(args.folder).expanduser().resolve()
    files = sorted(path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_TYPES)
    if not files:
        raise SystemExit(f"이미지 파일이 없습니다: {folder}")

    parts = [types.Part.from_bytes(data=path.read_bytes(), mime_type=IMAGE_TYPES[path.suffix.lower()]) for path in files]
    parts.append(types.Part.from_text(text=(
        "사진들에서 식품 제품명과 포장에 표시된 소비기한을 읽어 주세요. 여러 사진이 같은 제품이면 정보를 합치고, "
        "모르는 내용은 추측하지 마세요. 날짜는 YYYY-MM-DD로 적고, 읽을 수 없으면 '확인 불가'라고 하세요. "
        "제품별로 제품명과 소비기한을 한국어로 출력하세요."
    )))
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(model=MODEL, contents=parts)
    print(response.text or "제품 정보를 읽지 못했습니다.")


if __name__ == "__main__":
    main()
