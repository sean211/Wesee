# wesee

식품 사진에서 제품명과 소비기한을 @google/genai SDK의 스트리밍 Interactions API로 읽고, 수정한 정보를 브라우저에 저장하는 데모 웹앱입니다.

## 프로젝트 구조

```text
.
├── index.html                 # 내 제품 페이지
├── voiceover.html             # 쇼핑 페이지 음성 안내 페이지
├── src/
│   ├── app.js                  # 기존 제품 등록 및 소비기한 관리
│   ├── voiceover.js            # 링크 크롤링, 상세 이미지 선택, 음성 안내
│   └── styles/                 # 공통 및 페이지별 스타일
├── server/
│   ├── server.js               # 빌드 파일 제공 및 API 서버
│   └── crawl-api.js            # 쇼핑몰 페이지와 이미지 수집
├── public/
│   ├── icons/
│   ├── manifest.webmanifest
│   └── service-worker.js
├── config.js                   # 로컬 Gemini API 키 (Git 제외)
├── vite.config.js
└── package.json
```

`dist/`, `node_modules/`, 로컬 API 키, 크롤링 검토용 `test_img/`는 `.gitignore`로 Git에서 제외됩니다.

## 실행

Vite 개발 서버로 실행해 주세요. 카메라와 PWA 설치 기능은 보안 연결(HTTPS) 또는 localhost에서 동작합니다.

    npm install
    npm run dev

그다음 브라우저에서 터미널에 표시된 주소(기본값: http://localhost:5173)를 여세요. 배포용 파일은 npm run build로 생성합니다.

## Gemini API 키

config.js에서 빈 문자열에 Gemini API 키를 입력하세요.

    window.WESEE_CONFIG = {
      GEMINI_API_KEY: "여기에_발급받은_키"
    };

config.js는 .gitignore에 등록되어 있어 Git에 포함되지 않습니다. 이 데모는 브라우저에서 Gemini API를 직접 호출하므로 API 키를 가진 사람은 개발자 도구에서 키를 볼 수 있습니다. 공개 배포 시에는 키를 서버 환경 변수에 보관하고 서버를 통해 Gemini를 호출해야 합니다.

Gemini SDK는 프로젝트의 npm 의존성으로 번들링됩니다.

## 쇼핑 페이지 음성 안내

`/voiceover.html`에서 공개 쇼핑몰 상품 링크를 입력하면 서버가 페이지의 이미지를 수집하고, 실제 높이가 가장 큰 이미지를 선택해 Gemini로 요약합니다. 요약은 브라우저의 한국어 음성으로 들을 수 있습니다. 로컬 개발에서는 기존과 같이 `npm run dev`로 실행하면 됩니다. 배포 환경에서 크롤링을 사용하려면 `npm start`로 빌드와 API 서버를 함께 실행하세요(기본 포트 4173, `PORT` 환경 변수로 변경 가능).

이 기능은 공개 HTML에 포함된 이미지 주소를 읽습니다. JavaScript 실행 후에만 상품 이미지를 불러오는 쇼핑몰이나 로그인 전용 페이지는 이미지가 발견되지 않을 수 있습니다. 링크로 전달한 공개 페이지와 선택된 이미지는 서버에서 가져오며, 선택된 이미지는 Gemini API로 전송됩니다.

## 웹앱

브라우저 메뉴의 설치 기능 또는 지원되는 브라우저에서 화면에 표시되는 앱 설치 버튼으로 설치할 수 있습니다. 앱 화면과 리소스는 오프라인에서도 열 수 있고, 제품 정보는 해당 브라우저의 localStorage에 저장됩니다. OCR 요청에는 선택한 사진이 Gemini API로 전송됩니다.
