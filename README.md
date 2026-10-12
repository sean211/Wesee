# wesee

같은 두 가지 기능을 JavaScript와 Python으로 제공합니다.

## 폴더

- `js버전/`: 기존 JavaScript CLI, 설정 파일, 입력 사진 폴더
- `python버전/`: Python CLI와 Python 입력 사진 폴더

각 버전은 입력 사진 폴더에서 제품명과 소비기한을 읽거나, 상품 링크에서 이미지를 `crawl_img`에 저장하고 높이가 가장 큰 이미지를 요약해 터미널에 출력합니다. 제품 정보를 별도로 저장하지 않습니다.

## API 키

`js버전/config.js`의 `GEMINI_API_KEY` 값 또는 `GEMINI_API_KEY` 환경 변수를 사용합니다. 환경 변수가 있으면 우선합니다. Python 버전도 같은 `config.js`를 읽습니다. API 키가 저장된 파일은 Git에서 제외됩니다.

## JavaScript 실행

```powershell
cd js버전
npm install
npm run analyze:folder
npm run analyze:link -- "https://example.com/product"
```

폴더 분석에 다른 경로를 지정하려면 `node folder-to-terminal.js "C:\\사진 폴더"`를 실행합니다.

## Python 실행

Python 3.10 이상을 준비한 뒤:

```powershell
cd python버전
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python folder_to_terminal.py
python link_to_terminal.py "https://example.com/product"
```

폴더 분석에 다른 경로를 지정하려면 `python folder_to_terminal.py "C:\\사진 폴더"`를 실행합니다. Python 링크 결과는 `python버전/crawl_img/`에 저장됩니다.

두 크롤러는 공개 HTML에 포함된 이미지 주소를 읽습니다. 로그인이나 JavaScript 실행 후에만 표시되는 이미지는 찾지 못할 수 있습니다.
