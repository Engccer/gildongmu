> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 건너뛰며, --force 로 실행하면 덮어써집니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
# CLAUDE.md — 길동무 (gildongmu)

@~/.claude/ACCESSIBILITY.md

> Next.js 16 주의: 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).
>
> 이 파일은 **어디서나 통하는 항구 규칙과 영역 색인만** 담는다. 매 세션·매 리뷰어가 전량 읽어 **크기가 곧 토큰 비용**이고 상한은 `src/lib/__tests__/claude-md-budget.test.ts`가 강제한다. **영역별 함정은 `.claude/rules/*.md`**(경로 조건부: 그 경로의 파일을 열 때만 실린다, 아래 §영역별 규칙)에 두고, **항목은 규칙 한두 줄 + `→ INTEGRATIONS`/`→ PATTERNS`**, 근거·실사고·세부 함정은 그 문서의 **같은 제목 절**에 둔다(참조가 붙은 코드를 고치기 전에 그 절을 읽는다).

## 문서 체계 (어디에 무엇을 쓰는가)

| 파일 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `CLAUDE.md` | 어디서나 통하는 항구 규칙·패턴·함정과 영역 색인. **다음에 이 코드를 만질 사람이 모르면 틀리는 것** | 날짜 있는 서사, 진행 상황, 완료 보고, 한 영역에서만 통하는 함정(→ `.claude/rules/`) |
| `.claude/rules/*.md` | 영역별 항구 함정의 요지(규칙 한두 줄 + 참조). 머리 `paths`에 맞는 파일을 열 때만 실린다 | 근거·세부(→ INTEGRATIONS·PATTERNS), 어디서나 통하는 원칙(→ 이 파일) |
| `PROGRESS.md` | **지금** 무엇이 동작하고 어디까지 도달했는가. 배포 현황·운영 기능·env | 완료된 일의 경위, 검증 상세 |
| `CHANGELOG.md` | 날짜별로 **무엇이 바뀌었나**. 항목당 2~4줄 + spec 링크 | 설계 근거, 함정 재서술(CLAUDE.md·spec이 정본) |
| `docs/BACKLOG.md` | **아직 하지 않은 것**. 열린 판정·편승 대기·신규 후보·폐기 근거 | 종결 항목(→ CHANGELOG) |
| `docs/FIELD-TEST.md` | BACKLOG §2를 **실행하는 대본**. 실보행·실승차에서 **언제 무엇을 듣고 무엇을 답하는가**(시간 축). **소모품** — 끝난 행은 지운다 | 판정 결과(→ BACKLOG 종결·CHANGELOG), 값의 근거·설계 의도(→ spec) |
| `docs/INTEGRATIONS.md` | 외부 통합(provider·route·envelope·좌표·영문 응답·실시간 안내 세션·API 키)의 **상세 계약**. 이 파일의 `→ INTEGRATIONS` 항목 본문 | 통합과 무관한 내부 계약(→ PATTERNS) |
| `docs/PATTERNS.md` | 접근성 repo 디테일·위치·포커스·강등·검색·i18n·채팅·WebMCP·iOS 빌드 구성·안드로이드·CLI 릴리스·배포·운영 스크립트·공개 저장소 규율의 **상세 계약**. 이 파일의 `→ PATTERNS` 항목 본문 | 외부 통합 계약(→ INTEGRATIONS) |
| `docs/superpowers/specs`·`plans` | 설계 정본 + **그 마일스톤의 검증 상세**(실호출 게이트 결과·변이 주입·리뷰 판정) | 다른 마일스톤 이야기 |
| `docs/research/` | 조사 기록물. **시점 고정이라 낡는 것이 정상**(결론이 뒤집히면 머리에 한 줄 표기) | 코드를 구속하는 규칙(→ 위 문서들로) |
| `android/README.md` | 안드로이드 구조·이식 관용구·게이트의 정본 | 설계 판정(→ spec `2026-09-15-android-app-decisions.md`) |
| `docs/appstore/release-notes.md` | App Store 버전별 What's New | 제출 절차(→ `1.0-submission-draft.md`) |
| `packages/*/CHANGELOG.md` | npm 사용자가 보는 릴리스 노트 | 내부 구현 서사 |

**마일스톤을 닫는 마지막 단계는 이 분배다.** 서사는 `CHANGELOG.md`로, 남은 판정은 `docs/BACKLOG.md`로, 새로 배운 함정은 그 영역의 `.claude/rules/` 파일로(어디서나 통하면 이 파일로), 상태 한 줄만 `PROGRESS.md`로 보낸다. 새 함정은 **규칙 파일엔 규칙 한두 줄, 근거·세부는 `docs/INTEGRATIONS.md`(외부 통합) 또는 `docs/PATTERNS.md`(그 밖)의 같은 제목 절**로 나눠 적는다 — 규칙 파일이나 이 파일에 문단째 쓰는 것이 재팽창의 경로다. 영역이 둘 이상에 걸치면 그 함정이 실제로 깨지는 코드 쪽 파일에 두고, 그 코드의 경로가 어느 `paths`에도 없으면 그 파일의 `paths`에 더한다.

⚠ **재팽창은 "완료된 일이 현재 상태로 위장"해서 일어난다**(`PROGRESS.md`가 273KB까지 분 기제: 끝난 마일스톤을 "운영 중인 기능" 제목 아래 두면 정의를 통과한다).

**판별 질문**: *"이 문장은 지금도 참이라서 여기 있는가, 그때 그랬어서 여기 있는가?"* 후자면 `CHANGELOG.md`다. 완료 보고를 쓰고 싶어지면 그것이 신호다.

## 프로젝트 정체성

**국내 서비스 연동 실험실.** 네이버·카카오를 시작으로 대한민국 로컬 서비스 API(지도·내비·장소·예약·관광)를 계속 발굴·추가하며, 접근성 우선 미니멀 UI로 실험한다. 두 사용자 집단이 최우선 사용:

1. **스크린 리더 사용자** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**dodo-planet과의 관계**: 독자 배포 앱(웹+iOS+npm CLI/MCP)이고 `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)과 기능 이식이 **양방향**이라 **스택·컨벤션을 일치**시키고(next-intl 4, zod 4, Vitest 4, App Router) `src/lib/`는 React 비의존으로 둔다(Next 의존은 캐시 래퍼 `unstable_cache` 한 자리).

## 절대 원칙: 접근성

기준 정본은 글로벌 접근성 헌장 `~/.claude/ACCESSIBILITY.md`(과잉 ARIA 금지, WCAG 실질 요구는 100%, "한 줄=한 객체", landmark "발견 경로" 규칙). 아래는 그 헌장을 이 repo 코드에 구체화한 것 — 일반 원칙은 헌장이 정본이고 여기엔 repo 고유 디테일(구체 파일 경로·컴포넌트명·계층)만 남긴다:

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 지도 SDK는 캔버스라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 버그다.
- 상태 변화(검색 결과 수·오류·경로)는 단일 polite `aria-live`로 통지. 키보드 도달 + `:focus-visible` 필수. 터치 타깃 ≥44×44px(`min-h-11`). UI 라벨에 이모지 금지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 SR 사용자가 맥락 상실. 비동기 트리거는 **in-flight ref 가드**(`useRef(false)`+`finally`)를 병행(클로저 가드만으론 더블클릭 중복 호출 못 막음).
- **자동 등장 보조 섹션은 region 랜드마크 유지**(`<section aria-labelledby>`+`useId`+`<h3 id>`, `AirQuality`·`StationMeta` 류): 죽은 코드 청소 때 `aria-labelledby`·`useId` 제거 금지. **버튼으로 펼치는 패널은 `<div>`**. → PATTERNS
- **"내 주변" 결과 각 항목 이름은 `<h4>`**(계층 nearby 섹션 `h3` → 항목 `h4`, 장소 상세는 `h2`→`h3`→`h4`). 정적 정보 리스트라 heading이 유일한 빠른 점프 수단. 도착편·보행 인프라 항목은 무헤딩. → PATTERNS
- **한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지).** 시각용 인라인 `<span>` 대신 `joinText(...)`(`src/lib/format.ts`)로 합친다(구분자 쉼표, 가운뎃점 금지는 `i18n-messages.test.ts`가 6로케일 스캔). 배지는 텍스트로 흡수, 인터랙티브 요소는 합치지 않는다. → PATTERNS
- **definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지.** 평문 단일 텍스트 `<p>{`${라벨} ${값}`}</p>`(라벨 볼드 span도 분절이라 포기). → PATTERNS
- **polite 창구는 화면이 소유한다 — 자식 패널은 자기 live region을 두지 않는다**(A40, 웹 `DirectionsView.announce`, 자식은 기본값 없는 `announce` prop으로 게시). 빈 값 게시 금지, 같은 커밋의 두 문장은 대기 꼬리로 합친다. → PATTERNS
- **이미 보이는(SR 노출되는) 콘텐츠를 live region에 복제하지 말 것**(WAI-ARIA 모범). 채팅 답변 산문을 sr-only로 복제했다가 회전자에서 중복 낭독된 회귀가 있었다 — 답변은 보이는 `MessageBubble` 한 곳에만.

## 영역별 규칙 (경로 조건부)

아래 파일은 머리 `paths`에 맞는 파일을 열 때 Claude Code가 자동으로 싣는다. **파일을 열기 전 설계 단계이거나 Codex 등 다른 에이전트라면 그 영역 작업 전에 해당 파일을 직접 읽는다.** 여러 영역에 걸친 작업은 해당 파일을 모두 읽는다. ⚠ 형제 worktree(`~/gildongmu-wt/…`)의 파일에는 자동으로 실리지 않는다. 그 worktree에서 시작하지 않은 세션이 worktree 파일을 고치면 해당 파일을 직접 읽는다.

| 파일 | 영역 | 대표 경로 |
|---|---|---|
| `.claude/rules/integrations.md` | 외부 API·provider·route·좌표·envelope·영문 응답, 통합 카탈로그, API 키 | `src/lib/**`, `src/app/api/**`, `scripts/**`, Kit·`:kit` |
| `.claude/rules/guidance.md` | 실시간 안내(도보·자동차·대중교통·나들이·여정)와 길찾기 조회·브리핑 | 안내 `src/lib`·훅·컴포넌트, `ios/Gildongmu/Directions/**`, Kit, `android/**` |
| `.claude/rules/screens.md` | 검색·장소 상세·내 주변·위치·설정 화면, iOS 포커스·통지·진동 | `src/components/**`, `src/hooks/**`, `ios/Gildongmu/**`, `android/app/**` |
| `.claude/rules/webmcp.md` | WebMCP 도구층 | `src/lib/webmcp/**`, 브릿지를 게시하는 화면 |
| `.claude/rules/chat.md` | 채팅(Gemini)·받아쓰기 | `src/lib/chat/**`, `src/lib/gemini/**`, `ios/Gildongmu/Chat/**`, 받아쓰기 Swift |
| `.claude/rules/i18n.md` | 다국어 문자열(ICU plural·인자 순서·안드로이드 strings) | `messages/**`, `ios/i18n/**`, `*.xcstrings` |
| `.claude/rules/ios-build.md` | iOS 빌드 구성(Debug·Release·Experimental)·plist·pbxproj | `ios/**` |
| `.claude/rules/android.md` | 안드로이드 앱 구조·`:kit` 미러·착지·매니페스트 | `android/**` |
| `.claude/rules/cli.md` | npm CLI/MCP 릴리스 | `packages/**` |

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

### Provider 추상화 패턴 (신규 국내 서비스 추가 시 따른다)
- `src/lib/providers/`에 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider 자동 선택. **provider 파일 추가 → 진입점에 선택 로직 → 게이트(`hasXKey()`).**
- **게이트 패턴**: 키 없으면 도구·섹션·버튼·import **전부 0**(死기능·회귀 0). 채팅 declaration도 게이트(`availableDeclarations()`가 통과분만 Gemini 노출 → LLM이 호출 불가).
- **mock으로 조용히 폴백 금지**(가짜 실데이터 금지). 키 없는 부가 기능은 게이트로 숨기고, 장소 검색의 키 없음·upstream 장애는 throw→502. 데모는 `PLACES_PROVIDER=mock` 명시 지정으로만 제공한다.

### 어디서나 통하는 함정 (영역 무관)
- **3-state 불변식 (시각장애인 정합)**: "0대/없음"과 "정보 없음(`unknown`)"과 "조회 실패(throw→502)"를 **절대 뭉개지 않는다**. 도착·진료·공기질·날씨·시설 전반에 적용. 해석 불가한 수치는 숨기고 등급 단어를 정본으로. 판정선은 "그 값이 사용자의 행동을 가르는가"이고, 이미 안내되는 대상에 덧붙는 수식(횡단보도 차로 수)은 대상이 아니다(→ INTEGRATIONS §횡단보도 차로 수·도로 폭).
- ⚠ **정규식을 웹·Kit에 미러할 때 문자 클래스 안의 `[`는 반드시 이스케이프한다**(`[(\[]`): ICU는 중첩 집합으로 읽어 iOS만 전량을 놓친다. 공유 fixture를 Kit에서도 돌리는 것이 유일한 검출 수단. → PATTERNS
- **현재 위치는 공유 스토어 1곳에서만**(`src/lib/geolocation.ts` 싱글턴 + `useGeolocation`, `getCurrentPosition` 직접 호출 금지, `awaitGeolocation()`). **"새로고침"은 `awaitGeolocation({force:true})`**(`PRECISE_OPTS`)이고 ⚠ 실패하면 직전 `done` 데이터를 복원한다(`prevStatus`).
- ⚠ **위치 스토어에는 TTL이 없다 — "지금 어디 있는가"가 답의 일부인 조회는 전부 `{force:true}`다**(안내 시작·이탈 재조회·ETA 갱신). `useRouteGuide`의 `fetchGuideRoute(force)`는 기본값 없는 필수 인자. → PATTERNS
- **그 사이에 세 번째 축이 있다: 나이 상한**(`LocateOptions.maxAgeSeconds`, 길찾기는 3분 `DIRECTIONS_ORIGIN_MAX_AGE_SECONDS`; `Coord.at` 없으면 신선하지 않은 것으로). iOS는 스토어 자체의 `freshTTL` 60초. → PATTERNS
- ⚠ **화면이 요청하지 않은 측위는 표시 상태를 흔들지 않는다**(`silent` — `ready` 유지한 채 좌표만 갱신, 실패해도 직전 좌표). 나이 상한과 한 쌍이라 한쪽만 되돌리지 말 것. → PATTERNS
- **측위가 취득 실패로 끝났는데 직전 좌표가 있으면 "옛 위치"다**: "현재 위치"로 말하지 않고 옛 위치임과 시각을 밝히며 길찾기는 그 좌표로 계속한다(표식은 좌표를 스토어에 쓰는 자리 하나에서, 시각 비교 금지). → PATTERNS §측위 실패 뒤 직전 좌표는 "옛 위치"다
- **화면 배치를 바꾸면 그 자리를 지나가는 포커스 점프를 함께 점검한다**(조회 완료 시 첫 성공 수단 heading으로 1회 이동). → PATTERNS
- **값을 특정 경로에서 배제할 때 1선은 구조, 2선은 소스 가드, 브랜드 타입은 3선이다**(브랜드 타입은 함수 바꿔치기를 못 잡는다). → PATTERNS
- **런타임 판정이 있는 자리에 상시 고지 문장을 얹지 않는다**(`isBackgroundAudible` 판정 위에 얹힌 "화면이 꺼지면 멈춘다"가 거짓이 된 실사고; 웹은 참). 삭제 범위는 소비자 기준. → PATTERNS
- **스크린리더 통지에 뻔한 꼬리 문장을 넣지 않는다** — 판정선은 "뒷문장이 새 정보를 주는가"(원인·조건·한계는 유지). 정규식 스캔 말고 여러 문장인 문자열 전부를 판정. → PATTERNS
- **거리 표기는 `formatDistance`만 지난다**(웹 `format.ts`·Kit `Format.swift`·CLI `dist()`·`:kit` `Format.kt` 4벌 미러, 1km 미만 m·이상 소수 km). 소수 km 직접 조립 금지(`format-drift.test.ts`), 낭독 정정은 m만. → INTEGRATIONS
- **영문 원천 없는 이름의 병기는 서버 로마자(`romanize.ts` 한 곳) + 클라이언트 `bilingualName`이고, 괄호 한글은 접근성 객체의 마지막 노드다**(E28, `<KoTail>`을 줄 가운데 두지 말 것). 문장 틀 자리엔 1순위 이름만(한글이면 이름 없는 문구, A52), 웹 끝점의 로마자는 필수 인자(A53). → INTEGRATIONS
- **서버가 합성하는 한국어 문장은 구조화 원재료를 함께 싣고, 클라이언트가 자기 언어로 조립한다**(A26: 문자열 불변 + additive `parts`·`lineCore`·`key`·`guidanceLang`). 판정을 문장 부분 문자열에 걸지 말 것(`crossing` 플래그). → INTEGRATIONS
- **개인정보 3자 일치 불변식**: 수집·전송 항목을 바꾸면 웹 `/{locale}/privacy` + iOS `PrivacyInfo.xcprivacy` + ASC 영양 라벨을 **동시 갱신**한다(불일치는 심사 거절 사유). 받아쓰기 오디오는 세 곳 모두 미신고가 정본. → PATTERNS

## 배포

- **대외 정본 도메인**: https://gildongmu.dodoplanet.space (Vercel URL https://gildongmu.vercel.app 도 유효). GitHub `Engccer/gildongmu` 연결 — **push하면 자동 배포**. ⚠ ODsay Referer는 URI 키 묶임이라 `gildongmu.dodoplanet.space`(2026-09-23 Flex 앱 전환 때 교체 — 다시 바꾸려면 ODsay 콘솔 URI 등록 선행). → PATTERNS
- **env 변경 후 반드시 재배포**(키는 배포 시점 함수 주입). 수동 배포 `vercel deploy --prod --yes`.
- 비대화형 등록 `printf '%s' "$VALUE" | vercel env add <KEY> production`(`vercel@latest` 사용 — 구버전 빈값 버그 [[vercel-env-add-noninteractive-bug]]). Preview는 `git_branch_required` 결함이라 REST API/대시보드.
- ⚠ **배포 직후 React #418(hydration) transient**는 스테일 SW 캐시 탓이다(코드 결함 아님, 캐시 제거 먼저). → PATTERNS

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)
                   # ⚠ 루트 include는 `src/**`와 `scripts/**/*.test.mjs`뿐이다: `packages/cli`·`packages/mcp` 테스트는
                   # 여기서 이름을 넘겨도 "No test files found"로 **통과가 아니라 무실행**이 된다.
                   # 그 둘은 해당 디렉터리에서 `npx vitest run`으로 돌려야 실제로 돈다.

npm run test:a11y  # 실브라우저 접근성 게이트(axe, 빌드+Chromium). test:run과 별개 레인: PR·릴리스 직전, 접근성 변경 뒤 → PATTERNS

node scripts/usage-report.mjs   # API 과금·쿼터·키 만료 상태 (로컬 전용, 프로브 돈 6·가용성 13 — ODsay 1건만 과금)
```

**"API 비용·쿼터·키가 살아 있나"는 `usage-report.mjs`가 정본이다** — 벤더 콘솔을 손으로 훑지 말 것(돈·가용성·시한·걱정불필요 4섹션, 200에 오류를 담는 벤더 6종까지 judge). ⚠ **호출량**은 답하지 못한다 — 호출 건수·라우트 분포는 Vercel Observability. → PATTERNS

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반. Vitest 전역은 node-env지만 **컴포넌트 테스트는 파일 상단 `// @vitest-environment jsdom` 프라그마 + @testing-library/react 레인이 관례**(`PlaceDetail.test.tsx`·nearby 계약 스위트가 선례). 순수 로직은 node-env fixture 단위테스트, 외부 API 통합은 **실호출이 머지 게이트**.
- **외부 API 통합은 실호출(실데이터)을 머지 게이트로 박는다** — fixture green ≠ 실계약 검증(데이터 커버리지 현실은 정적 리뷰가 못 잡음).
- `package.json` `overrides`의 `postcss-selector-parser`는 보안 덮어쓰기다. `@tailwindcss/typography`가 6.0.10에 고정해 Dependabot 알림이 풀리지 않아 그 밑만 6.1.5 이상으로 올렸다. typography가 고정을 풀면 지운다.
- 커밋 이메일 `engccer@gmail.com`. 주석·커밋·문서 한국어, 변수/함수명 영어.
- a11y 변경 후 `a11y-auditor` 서브에이전트 점검(실브라우저 게이트는 위 명령어 절).
- **신규 국내 서비스는 대장과 작업 큐가 다른 문서다**: `docs/SPEC.md` §3 "실험 백로그"는 **조사한 서비스의 대장**(존재하는가·쓸 만한가)이고, `docs/BACKLOG.md` E는 **착수 후보 큐**(다음에 뭘 할까)다. 발굴하면 SPEC에 등록하고, 착수를 결정하면 BACKLOG로 올린다. 둘은 중복이 아니라 파이프라인이다.
- **마일스톤을 닫을 때 문서를 분배한다**(위 §문서 체계). iOS 릴리스는 What's New를 `docs/appstore/release-notes.md`에 남기고 `node scripts/build-release-notes.mjs`로 번들 JSON을 재생성한다(드리프트 테스트). ⚠ 번들은 아카이브 시점에 굳으므로 아카이브 뒤 고쳤으면 빌드 번호를 올린다. → PATTERNS
- **저장소는 공개 전제로 다룬다(2026-08-17 오픈소스 준비)**. **기준 절차의 정본은 `sanitize-for-release` 스킬**(공개 저장소 `Engccer/sanitize-for-release`)이며, gildongmu는 그 스킬의 **유형 C(원본 격리형)** 다. 유형별 절차·스윕 축은 스킬을 따르고 여기서는 이 저장소의 자리만 적는다.
  - ①**실기기 계측 로그(`guide-diag*.log*`)는 커밋하지 않는다**(게이트 테스트엔 익명화 fixture만, 좌표는 위경도를 함께 비공개 상수로). **자택·지인 주택은 어디서도 실주소·동 호수로 적지 않는다** — 자택 근처 상호·골목·정류소와 자택 출발·도착 구간의 이름·거리도 같다. → PATTERNS
  - ②**정적 seed를 추가·교체하면 `NOTICE.md` 표에 파일·원출처·이용 조건·재생성 스크립트를 함께 적는다** — 코드는 MIT지만 데이터는 원출처 조건이고, 표에 없으면 MIT로 오인된다. OSM 파생 파일과 공공데이터 파일은 한 파일로 합치지 않는다.
  - ③fork가 바꿔야 할 식별자(도메인·번들 ID·패키지명·연락처)를 새로 박으면 `docs/FORKING.md` 표에 그 자리를 더한다.
- gildongmu는 리뷰 게이트 통과 후 묻지 말고 commit+push(자동배포 포함, [[gildongmu-auto-commit-push]]). `git add -A` 금지, 의도 파일만([[commit-stage-explicit-files]]).
