// 실브라우저 접근성 회귀 게이트(D27, webfortd@606d16e 이식) — chromium 단일, 프로덕션 빌드 자동 기동.
// 레인은 `test:run`과 별개다(빌드+크롬이라 무겁다). PR·릴리스 직전, 접근성 변경 뒤에 돌린다.
import { defineConfig } from "@playwright/test";

// 개발 서버(3000)를 재사용하면 그 서버의 키 구성으로 화면이 달라진다 — 게이트 전용 포트.
const PORT = 3100;

// 키 게이트(`src/lib/env.ts`)는 값의 유무만 본다. 더미 값으로 전 섹션을 켠 화면을 결정론적으로
// 만든다(`.env.local` 유무와 무관, 프로세스 env가 .env 파일보다 우선). 브라우저의 `/api/**`는
// 전부 fixture로 가로채므로 이 값이 upstream에 닿는 경로는 없다.
const GATE_KEYS = [
  "KAKAO_REST_API_KEY",
  "NAVER_LOCAL_CLIENT_ID",
  "NAVER_LOCAL_CLIENT_SECRET",
  "NCP_MAPS_CLIENT_ID",
  "NCP_MAPS_CLIENT_SECRET",
  "TOUR_API_KEY",
  "DATA_GO_KR_API_KEY",
  "DEEPGRAM_API_KEY",
  "SEOUL_OPEN_DATA_KEY",
  "SEOUL_SUBWAY_REALTIME_KEY",
  "ODSAY_API_KEY",
  "JUSO_CONFM_KEY",
  "TMAP_APP_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "GOOGLE_CLOUD_TTS_API_KEY",
  "GOOGLE_PLACES_API_KEY",
];

export default defineConfig({
  testDir: "./tests/a11y",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // 서비스 워커가 가로챈 요청은 page.route에 보이지 않는다 — fixture 격리가 새지 않게 막는다.
    serviceWorkers: "block",
    locale: "ko-KR",
    // 서울시청(공공 장소). "내 주변"·현재 위치가 권한 팝업 없이 결정론적으로 선다.
    geolocation: { latitude: 37.5663, longitude: 126.9779 },
    permissions: ["geolocation"],
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/ko`,
    timeout: 600_000,
    reuseExistingServer: !process.env.CI,
    env: Object.fromEntries(GATE_KEYS.map((k) => [k, "a11y-gate-dummy"])),
  },
});
