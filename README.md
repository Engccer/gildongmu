# 길동무 (Gildongmu)

**한국어** | [English](README.en.md)

**접근성 우선 대한민국 길찾기.** 스크린 리더만으로 검색부터 길찾기까지 완결되는 것을 1급 요구사항으로 두고, 국내 로컬 서비스 API(카카오·네이버·공공데이터·서울 열린데이터 등)를 계속 발굴해 붙인다.

두 사용자 집단이 1급 시민이다.

1. **시각장애인** — 지도 없이, 텍스트와 음성만으로 전체 흐름이 닫힌다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 UI(6개 언어).

## 써 보기

| 채널 | 주소 |
|---|---|
| 웹 | https://gildongmu.dodoplanet.space |
| iOS | [App Store](https://apps.apple.com/app/id6792234349) — "길동무: 텍스트 기반 접근성 길찾기 앱" |
| CLI | `npm install -g gildongmu` → [문서](packages/cli/README.md) |
| MCP | `claude mcp add gildongmu -- npx -y gildongmu-mcp` → [문서](packages/mcp/README.md) |

CLI·MCP는 계정도 토큰도 필요 없다. 공개 REST API를 그대로 중계한다.

```bash
gil nearby subway --near "강동역"     # 주변 지하철역 실시간 도착
gil route walk "길동역" "강남역" --accessible true   # 계단 회피 도보 경로
```

## 브라우저 에이전트에 도구로 노출 (WebMCP)

앱 루트에서 WebMCP 도구 7개를 상시 선언한다. ChatGPT 인앱 브라우저나 WebMCP를 켠 Chrome에서 열면 에이전트가 DOM을 추측하는 대신 장소 검색·역 정보·길찾기를 도구로 호출하고, **화면이 보여 주는 것과 같은 문장**을 돌려받는다. 화면도 같은 상태로 따라 움직이므로 사용자가 그 자리에서 이어받는다.

스크린 리더 사용자에게 비싼 것은 화면에 **도달**하는 일이 아니라 그 화면을 **훑는** 일이다. 경로 하나가 수십 개의 접근성 객체인데 도구로는 한 번의 답이 된다. 좌표는 브라우저 밖으로 나가지 않는다(출력 allowlist가 구조적으로 막는다).

구현·계약·검증 근거는 [`docs/WEBMCP.md`](docs/WEBMCP.md)(영문), 코드를 만질 때의 함정은 [`CLAUDE.md`](CLAUDE.md) §WebMCP 도구층에 있다.

## 핵심 설계

- **정보의 정본은 리스트·텍스트다.** 지도 SDK는 캔버스라 스크린 리더가 읽을 수 없으므로, 지도에만 존재하는 정보가 있으면 그것은 버그다. "출발 전 미리 듣기" 텍스트 브리핑과 **실시간 안내**(도보 정식판, 자동차·대중교통은 실험판)를 자체 구현하고, 지도 앱 딥링크(`nmap://`·`kakaomap://`)는 장소 상세의 보조 출구로만 둔다.
- **3-state를 뭉개지 않는다.** "0건"과 "정보 없음"과 "조회 실패"는 화면으로 구분할 수 없으므로 텍스트로 갈라야 한다. 여기에 "서비스 지역 밖"이 네 번째 정직한 상태로 더해진다.
- **키가 없으면 그 기능은 아예 노출되지 않는다.** 죽은 버튼도, 가짜 데이터도 만들지 않는다(장소 검색만 예외적으로 개발 편의를 위한 mock 폴백을 갖는다. `PLACES_PROVIDER`로 provider를 강제 지정해 A/B 비교도 할 수 있다).
- **한 줄 = 한 접근성 객체.** 시각 스타일용 인라인 `<span>`으로 한 줄을 쪼개면 VoiceOver가 조각마다 멈춘다.

접근성 규칙의 정본은 글로벌 접근성 헌장이고, 이 저장소 고유의 구현 디테일은 [`CLAUDE.md`](CLAUDE.md)에 있다.

## 이 코드로 새 서비스 시작하기

이 프로젝트는 누구든 가져다 자기 지역·자기 사용자에 맞는 접근성 길찾기를 만들 수 있도록 공개한다. 클론에서 자기 서비스까지 바꿔야 할 자리(도메인·번들 ID·이름·provider·seed)와 그대로 가져가도 되는 핵심 자산(접근성 계약·순수 함수 판정 계층)은 [`docs/FORKING.md`](docs/FORKING.md)에 정리했다. 키 하나(카카오)만 채워도 장소 검색과 경로가 켜진다.

## 개발

```bash
npm install
npm run dev          # localhost:3000
npm run test:run     # Vitest (매 커밋 통과 필수)
npm run lint
```

실데이터 연동은 `.env.example`을 `.env.local`로 복사한 뒤 키를 채운다. 키가 없는 기능은 조용히 빠지므로 일부만 채워도 개발할 수 있다.

```bash
node scripts/usage-report.mjs   # API 비용·쿼터·키 만료 상태(무과금 프로브)
```

## 문서

| 문서 | 내용 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 항구 규칙·패턴·함정. 코드를 만지기 전에 읽는다 |
| [`PROGRESS.md`](PROGRESS.md) | 지금 무엇이 동작하고 어디까지 도달했는가 |
| [`CHANGELOG.md`](CHANGELOG.md) | 날짜별 변경 이력 |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | 아직 하지 않은 것(폐기 근거 포함) |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | 외부 통합의 상세 계약. 요지만으로는 지킬 수 없는 것 |
| [`docs/PATTERNS.md`](docs/PATTERNS.md) | UI·상태·채팅·도구층·빌드 구성의 상세 계약 |
| [`docs/WEBMCP.md`](docs/WEBMCP.md) | WebMCP 도구층 영문 개요(도구 7개·구현·시험 방법) |
| `docs/superpowers/specs`·`plans` | 기능별 설계 정본과 검증 기록 |
| `docs/research/RESEARCH-*.md` | 국내 API 생태계 조사 |

## 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · next-intl 4 · zod 4 · Vitest 4
iOS는 SwiftUI + GildongmuKit(SPM), 판정 로직은 웹과 미러링해 공유 fixture로 드리프트를 막는다.

## 라이선스

코드는 [MIT](LICENSE). 저장소에 번들된 공공데이터·OpenStreetMap 파생 파일은 각 원출처의 조건(공공누리 제1유형·ODbL 1.0)을 따르며 목록은 [`NOTICE.md`](NOTICE.md)에 있다. "길동무"라는 이름·아이콘·도메인·npm 패키지명은 프로젝트 식별자라 fork는 다른 이름을 쓴다.

기여는 [`CONTRIBUTING.md`](CONTRIBUTING.md), 취약점 신고는 [`SECURITY.md`](SECURITY.md), 연구 인용은 [`CITATION.cff`](CITATION.cff).

## 관련 프로젝트

[dodo-planet](https://www.dodoplanet.space)(가족 여행 가이드 PWA)과는 상호 보완적인 두 독립 프로젝트로, 검증된 기능의 이식이 **양방향**으로 일어난다. 그래서 스택·컨벤션을 맞추고 `src/lib/`는 React·Next 비의존으로 유지한다.
