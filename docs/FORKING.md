# 이 코드로 새 서비스 시작하기 (fork 가이드)

이 저장소는 누구든 가져다 자기 지역·자기 사용자에 맞는 접근성 길찾기를 만들 수 있도록 MIT로 공개한다. 이 문서는 **"클론 → 내 서비스"** 사이에서 실제로 손봐야 하는 자리의 목록이다. 설계 규칙·함정은 [`CLAUDE.md`](../CLAUDE.md), 통합별 계약은 [`INTEGRATIONS.md`](INTEGRATIONS.md), 데이터 라이선스는 [`NOTICE.md`](../NOTICE.md)에 있다.

## 1. 가장 작은 실행: 웹만, 키 하나만

```bash
git clone <your fork>
cd gildongmu && npm install
cp .env.example .env.local
# KAKAO_REST_API_KEY 하나만 채워도 장소 검색·지오코딩·도보/자동차 경로가 켜진다
npm run dev
```

**키가 없는 기능은 오류가 아니라 노출되지 않는다**(게이트 패턴). 그래서 키를 하나씩 늘려 가며 기능이 열리는 것을 확인하는 식으로 시작할 수 있다. 어느 키가 어느 기능을 여는지는 [`.env.example`](../.env.example)의 주석과 `CLAUDE.md` "API 키 현황" 표가 정본이다. 전부 서버 전용 환경변수이고 클라이언트 번들에 나가지 않는다.

## 2. 반드시 바꿔야 하는 식별자

"길동무" 이름·아이콘·도메인·번들 ID·npm 패키지명은 이 프로젝트의 식별자라 fork에서는 바꾼다([`NOTICE.md`](../NOTICE.md) "이름과 아이콘").

| 무엇 | 어디 |
|---|---|
| 웹 도메인 | `src/lib/site.ts`의 `SITE_ORIGIN`(+ `APP_STORE_URL`·npm URL 상수), `public/llms.txt`, ODsay referer(`src/lib/providers/odsay.ts`. ODsay는 등록한 URI로 키를 식별하므로 새 도메인을 ODsay 콘솔에 URI 앱으로 등록해야 한다) |
| iOS가 부르는 API 주소 | `ios/Gildongmu/AppConfig.swift`의 `apiBaseURL`(개발 중엔 `GILDONGMU_API_BASE_URL` 환경변수로 덮어쓸 수 있다) |
| CLI·MCP 기본 API 주소 | `packages/cli/src/lib/config.ts`의 `DEFAULT_API_URL`, `packages/mcp/src/index.ts`의 `API_URL`. 배포하려면 두 `package.json`의 `name`도 바꾼다(`gildongmu`·`gildongmu-mcp`는 이 프로젝트가 쓴다) |
| iOS 번들 ID·팀 | `ios/Gildongmu.xcodeproj/project.pbxproj`의 `PRODUCT_BUNDLE_IDENTIFIER`(정식 `space.dodoplanet.gildongmu`, 실험판 `.dev`)와 `DEVELOPMENT_TEAM`, `ios/ExportOptions.plist`의 `teamID`, `ios/scripts/asc-submit.mjs`·`check-release-artifact.mjs`의 번들 ID 상수 |
| 딥링크 앱 식별자 | `.env.example`의 `NEXT_PUBLIC_APP_IDENTIFIER`(네이버 지도 `nmap://` appname), `ios/Gildongmu/AppConfig.swift`의 `appIdentifier` |
| 앱 이름·아이콘 | iOS 표시 이름은 `ios/Gildongmu/Resources/InfoPlist.xcstrings`, 아이콘은 `ios/Gildongmu/Assets.xcassets/AppIcon*`, 웹은 `src/app/manifest.ts`·`public/icons/`·`messages/*.json`의 앱 이름 키 |
| 연락처 | `messages/*.json`·`ios/Gildongmu/Resources/Localizable.xcstrings`의 메일 주소(문제 신고·OSM 사본 요청), `SECURITY.md`, `CITATION.cff` |
| 개인정보 처리방침 | `src/app/[locale]/privacy/page.tsx`(웹 카피) + `ios/Gildongmu/PrivacyInfo.xcprivacy` + App Store Connect 영양 라벨. 셋은 **동시에** 같아야 한다(`CLAUDE.md` "개인정보 3자 일치") |

## 3. 지역을 바꾸려면 (한국 밖·다른 도시)

이 앱의 데이터 층은 **대한민국 로컬 서비스**에 묶여 있다. 판정 로직·안내 문장·접근성 계약은 지역 중립이고, 바꾸는 것은 provider 층이다.

- **커버리지 판정**: `src/lib/coverage.ts`(`isInKorea`, iOS 미러 `Coverage.swift`)와 보행 인프라 seed의 국경 폴리곤. 다른 나라면 이 판정을 그 나라 경계로 바꾸거나 제거한다.
- **provider 추가 방식**: `src/lib/providers/`에 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider를 고른다. **provider 파일 → 진입점 선택 로직 → 게이트 함수(`hasXKey()`)** 세 단계가 한 통합이다. mock으로 조용히 폴백하지 않는다.
- **정적 seed**: 서울·전국 공공데이터 seed(`src/lib/data/`)는 `scripts/build-*.{mjs,py}`로 재생성한다. 다른 지역 데이터로 바꿀 때 [`NOTICE.md`](../NOTICE.md)의 라이선스 표도 함께 고친다. OSM 보행 노드는 `scripts/build-osm-walk-nodes.mjs`의 `area["ISO3166-1"="KR"]`를 바꾸면 된다(스크립트의 함정 셋은 파일 머리 주석).
- **언어**: `messages/*.json`(웹) → `ios/i18n`(변환 파이프라인, `CLAUDE.md` 데이터 언어 분리 절). 외부 API가 주는 언어(ko/en)와 UI 언어를 `data-locale.ts`가 분리한다.

## 4. 그대로 가져가도 되는 것 (이 프로젝트의 핵심 자산)

- **접근성 계약**: 한 줄 = 한 접근성 객체, 3-state(0건·정보 없음·조회 실패)+커버리지 밖, 키 게이트, 단일 polite live region, iOS 목록 포커스 착지 절차. `CLAUDE.md` "절대 원칙: 접근성"과 글로벌 헌장을 그대로 따르면 된다.
- **실시간 도보 안내 판정 계층**: 톤 계층·이탈 판정(수직거리+방위 축)·임박 큐·최종 접근·도착 추정이 전부 **순수 함수**이고 웹(`src/lib/`)↔iOS(`GildongmuKit`) 미러다. 공유 fixture로 드리프트를 막는다. 상수는 실보행 실측값이라 지역·사용자 집단이 바뀌면 재측정한다(`docs/BACKLOG.md`에 열린 판정이 있다).
- **CLI·MCP**: 공개 REST API를 그대로 중계하는 얇은 층. 카탈로그(`endpoint-catalog-shared.ts`) 한 벌을 두 패키지가 미러한다.

## 5. 배포

- 웹: Vercel(`vercel.json`) 또는 Node가 도는 어디든. env 변경 후 재배포.
- iOS: `ios/deploy-device.sh`(실기기), `ios/scripts/asc-submit.mjs`(App Store 제출). 구성 셋(Debug·Release·Experimental)의 의미는 `CLAUDE.md` "iOS 실험 기능은 빌드 구성이 가른다".
- CLI/MCP: `cli-v*` 태그 push → GitHub Actions npm Trusted Publishing. 자기 npm 계정·패키지명으로 바꾼다.

## 6. 공공데이터를 파일로 넣을 때

기관 자료를 내려받아 저장소에 넣기 전에 승인 화면·보안각서·이용약관의 **재배포·국외 반출·좌표 표시** 조항을 읽는다. 이 프로젝트가 행정안전부 내비게이션용 DB를 끝내 넣지 않은 이유가 그것이다(`docs/BACKLOG.md`). 런타임 API 호출은 이 문제가 없다.
