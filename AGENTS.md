> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 덮어쓰기 대상이 됩니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).
>
> 이 파일은 **항구 규칙·패턴·함정의 요지만** 담는다. 매 세션과 매 리뷰어 서브에이전트가 전량 읽으므로 **크기가 곧 토큰 비용**이다(2026-09-02 실측: 두 달 만에 26KB → 175KB로 불어 세션 시작 비용의 59%를 차지했고, 하루 26회 읽혀 수백만 토큰이 읽기에만 나갔다. 91개 항목의 상세를 옮겨 68KB로 축소). 상한 80KB는 `src/lib/__tests__/claude-md-budget.test.ts`가 강제한다. **항목은 규칙 한두 줄 + `→ INTEGRATIONS`/`→ PATTERNS` 참조**로 쓰고, 근거·실사고·세부 함정은 그 문서의 **같은 제목 절**에 둔다(참조가 붙은 코드를 수정하기 전에 그 절을 읽는다). 나머지는 아래 문서 지도를 따른다.

## 문서 체계 (어디에 무엇을 쓰는가)

| 파일 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `CLAUDE.md` | 항구 규칙·패턴·함정. **다음에 이 코드를 만질 사람이 모르면 틀리는 것** | 날짜 있는 서사, 진행 상황, 완료 보고 |
| `PROGRESS.md` | **지금** 무엇이 동작하고 어디까지 도달했는가. 배포 현황·운영 기능·env | 완료된 일의 경위, 검증 상세 |
| `CHANGELOG.md` | 날짜별로 **무엇이 바뀌었나**. 항목당 2~4줄 + spec 링크 | 설계 근거, 함정 재서술(CLAUDE.md·spec이 정본) |
| `docs/BACKLOG.md` | **아직 하지 않은 것**. 열린 판정·편승 대기·신규 후보·폐기 근거 | 종결 항목(→ CHANGELOG) |
| `docs/FIELD-TEST.md` | BACKLOG §2를 **실행하는 대본**. 실보행·실승차에서 **언제 무엇을 듣고 무엇을 답하는가**(시간 축). **소모품** — 끝난 행은 지운다 | 판정 결과(→ BACKLOG 종결·CHANGELOG), 값의 근거·설계 의도(→ spec) |
| `docs/INTEGRATIONS.md` | 외부 통합(provider·route·envelope·좌표·영문 응답·실시간 안내 세션)의 **상세 계약**. 이 파일의 `→ INTEGRATIONS` 항목 본문 | 통합과 무관한 내부 계약(→ PATTERNS) |
| `docs/PATTERNS.md` | 접근성 repo 디테일·위치·포커스·강등·검색·i18n·채팅·WebMCP·iOS 빌드 구성·CLI 릴리스의 **상세 계약**. 이 파일의 `→ PATTERNS` 항목 본문 | 외부 통합 계약(→ INTEGRATIONS) |
| `docs/superpowers/specs`·`plans` | 설계 정본 + **그 마일스톤의 검증 상세**(실호출 게이트 결과·변이 주입·리뷰 판정) | 다른 마일스톤 이야기 |
| `docs/research/` | 조사 기록물. **시점 고정이라 낡는 것이 정상**(결론이 뒤집히면 머리에 한 줄 표기) | 코드를 구속하는 규칙(→ 위 문서들로) |
| `docs/appstore/release-notes.md` | App Store 버전별 What's New | 제출 절차(→ `1.0-submission-draft.md`) |
| `packages/*/CHANGELOG.md` | npm 사용자가 보는 릴리스 노트 | 내부 구현 서사 |

**마일스톤을 닫는 마지막 단계는 이 분배다.** 서사는 `CHANGELOG.md`로, 남은 판정은 `docs/BACKLOG.md`로, 새로 배운 함정은 이 파일로, 상태 한 줄만 `PROGRESS.md`로 보낸다. 새 함정은 **이 파일엔 규칙 한두 줄, 근거·세부는 `docs/INTEGRATIONS.md`(외부 통합) 또는 `docs/PATTERNS.md`(그 밖)의 같은 제목 절**로 나눠 적는다 — 이 파일에 문단째 쓰는 것이 재팽창의 경로다.

⚠ **재팽창은 "완료된 일이 현재 상태로 위장"해서 일어난다.** `PROGRESS.md`가 273KB까지 불었던 기제가 정확히 그것이다 — 끝난 마일스톤을 "운영 중인 기능"이라는 제목 아래 두면 PROGRESS의 정의를 통과해 버리고, 그렇게 통과하면 막을 논거가 없어 매번 십수 KB씩 쌓인다. 그 사이 정작 현재 상태인 env 목록은 낡은 채 방치됐다(2026-08-08 재편에서 실측으로 발견).

**판별 질문**: *"이 문장은 지금도 참이라서 여기 있는가, 그때 그랬어서 여기 있는가?"* 후자면 `CHANGELOG.md`다. 완료 보고를 쓰고 싶어지면 그것이 신호다.

## 프로젝트 정체성

**국내 서비스 연동 실험실.** 네이버·카카오를 시작으로 대한민국 로컬 서비스 API(지도·내비·장소·예약·관광)를 계속 발굴·추가하며, 접근성 우선 미니멀 UI로 실험한다. 두 사용자 집단이 1급 시민:

1. **시각장애인** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**dodo-planet과의 관계(2026-08-03 위원장 정정)**: 인큐베이터로 시작했지만 지금은 **독자 배포·독립 운영되는 앱**(웹+iOS App Store+npm CLI/MCP)이다. `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)과는 **상호 보완적인 두 독립 프로젝트**로, 검증된 기능의 이식이 **양방향**으로 일어난다("dodo 통합이 궁극 목표"라는 종전 서술은 폐기). 그래서 **스택·컨벤션을 dodo-planet과 일치** 유지하고(next-intl 4, zod 4, Vitest 4, App Router), `src/lib/`는 React/Next 비의존으로 유지해 양방향 이식성을 보장한다.

## 절대 원칙: 접근성

기준 정본은 글로벌 접근성 헌장 `~/.claude/ACCESSIBILITY.md`(과잉 ARIA 금지, WCAG 실질 요구는 100%, "한 줄=한 객체", landmark "발견 경로" 규칙). 아래는 그 헌장을 이 repo 코드에 구체화한 것 — 일반 원칙은 헌장이 정본이고 여기엔 repo 고유 디테일(구체 파일 경로·컴포넌트명·계층)만 남긴다:

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 지도 SDK는 캔버스라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 버그다.
- 상태 변화(검색 결과 수·오류·경로)는 단일 polite `aria-live`로 통지. 키보드 도달 + `:focus-visible` 필수. 터치 타깃 ≥44×44px(`min-h-11`). UI 라벨에 이모지 금지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 SR 사용자가 맥락 상실. 비동기 트리거는 **in-flight ref 가드**(`useRef(false)`+`finally`)를 병행(클로저 가드만으론 더블클릭 중복 호출 못 막음).
- **자동 등장 보조 섹션은 region 랜드마크 유지**(`<section aria-labelledby>`+`useId`+`<h3 id>`). 버튼 없이 조용히 fetch되어 나타나는 섹션(`AirQuality`·`StationMeta` 류)은 region이 **유일한 발견 수단**이라 "불필요한 region" 아님. ⚠ 죽은 코드 청소 시 이 `aria-labelledby`·`useId` 제거 금지. **버튼으로 펼치는 패널은 버튼이 발견 경로라 `<div>` 유지**. 판단 규칙: "사용자가 직접 펼쳤나(버튼·div) vs 조용히 나타났나(자동·region)".
- **"내 주변" 결과 각 항목 이름은 `<h4>`**(계층 nearby 섹션 `h3` → 항목 `h4`, 장소 상세는 `h2`→`h3`→`h4`). 정적 정보 리스트라 heading이 유일한 빠른 점프 수단. 도착편·보행 인프라 항목은 무헤딩. → PATTERNS
- **한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지).** 한 항목의 한 줄을 시각용 인라인 `<span>`으로 쪼개지 말고 `joinText(...)`(`src/lib/format.ts`)로 단일 텍스트로 합친다(구분자 쉼표, 가운뎃점 금지 — `i18n-messages.test.ts`가 6로케일 스캔). 배지는 텍스트로 흡수, 인터랙티브 요소는 절대 합치지 않는다. → PATTERNS
- **definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지.** 평문 단일 텍스트 `<p>{`${라벨} ${값}`}</p>`(라벨 볼드 span도 분절이라 포기). → PATTERNS
- **이미 보이는(SR 노출되는) 콘텐츠를 live region에 복제하지 말 것**(WAI-ARIA 모범). 채팅 답변 산문을 sr-only로 복제했다가 회전자에서 중복 낭독된 회귀가 있었다 — 답변은 보이는 `MessageBubble` 한 곳에만.
- **iOS 채팅·받아쓰기 계약은 헌장 §6이 정본이다.** 여기엔 이 repo의 구현 위치와 헌장에 없는 판정만 남긴다.
  - 산문 블록 분할 `parseChatMarkdownBlocks`(Kit) + 블록별 `Text`(헤딩 `.isHeader`), 질문 말풍선 헤딩 trait. 포커스 계약 구현·계측은 `ios/Gildongmu/Chat/ChatConversationView.swift`·`ChatFocusDiag.swift`.
  - 받아쓰기는 **탭 토글이 기본**(2026-07-29 위원장 결정 — 비-VO 심사자가 짧게 탭하면 홀드가 무반응으로 보여 App Store 반려됐다), 홀드는 설정 선택지이고 짧은 탭에 3초 가시 안내(`ios.voice.holdHintVisible`)를 병행한다. 구현 `HoldDictationButton.swift`.
  - ⚠ **제스처 계층은 UIKit 인식기(`HoldGestureCatcher`)가 정본** — SwiftUI LongPress+Drag 조합은 List 스크롤 팬 경합·VO pass-through 드래그 유실로 실기기 불합격했다(재도입 금지).
  - ⚠ **"녹음 시작 순간 VO 낭독 차단"은 `SpeechService.start()`의 책임이다**(홀드 버튼이 아니라). 홀드 없이 시작되는 경로엔 그 차단이 없어 녹음 중 라벨이 낭독된 회귀가 있었다.
  - **받아쓰기 엔진은 OS 버전이 정하고 둘 다 온디바이스다**(`SpeechEngine` 계약, iOS 26+ `AnalyzerSpeechEngine`·그 아래 `LegacySpeechEngine`+`requiresOnDeviceRecognition = true`). ⚠ 그 옵션 한 줄이 개인정보 3자 일치의 근거다. 상태 전이·취소 세대·VO 차단·통지는 `SpeechService`에 남기고 엔진에 옮기지 말 것. `SFSpeechRecognizer` 콜백은 `@Sendable` 필수(SIGTRAP). → PATTERNS
  - 단축어 "음성 검색" 세션은 진입 시 VO 커서를 마이크 행에 선점한다(`SearchView.task`의 `micRowFocused`, `speech.start()` 전 + 완료 후 1회 재확정). 정지 수단이 그 행 탭인데 커서가 최상단이면 스와이프로 찾아가야 하기 때문이다.
  - 채팅 입력 필드의 지우기 버튼(`ios.chat.clear`)은 초안이 있을 때만 나타나고, 누르면 자신이 사라지므로 포커스를 입력 필드로 선점 이동한다.
  - **화면을 띄울지 말지를 가르는 판정은 동기로 한다**(도보 종료 화면 `WalkHealth.isMeaningfulWalk`). 스와이프·VO escape는 시트 최소화만, 소거는 `clearArrival()`뿐. → PATTERNS
  - **채팅 산문 블록은 언제나 한 접근성 객체이고, 장소 언급 수로 활성화 방식만 가른다**(1개=블록 전체 버튼, 2개 이상=인라인 링크+로터 액션). 새 nearby 도구에 렌더를 달면 `places` 투영(`nearby-place.ts` ↔ `PlaceProjection.swift`)도 함께 싣는다. 말풍선 안 구획은 헤딩(`sectionHeading`). → PATTERNS

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

### Provider 추상화 패턴 (신규 국내 서비스 추가 시 따른다)
- `src/lib/providers/`에 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider 자동 선택. **provider 파일 추가 → 진입점에 선택 로직 → 게이트(`hasXKey()`).**
- **게이트 패턴**: 키 없으면 도구·섹션·버튼·import **전부 0**(死기능·회귀 0). 채팅 declaration도 게이트(`availableDeclarations()`가 통과분만 Gemini 노출 → LLM이 호출 불가).
- **mock으로 조용히 폴백 금지**(가짜 실데이터 금지). 키 없음→null·섹션 미노출, upstream 장애→throw→502.

### 횡단 함정 (반복 적용 — 새 통합마다 점검)
- **좌표 쿼리 파라미터는 `src/lib/coord-param.ts`를 쓴다**(`latParam`/`lngParam`, 선택 좌표는 `.optional().catch(undefined)`) — `Number("")===0`이라 누락이 (0,0)으로 위장해 200 `outOfCoverage`가 된다. 가드 `coord-param-usage.test.ts`. 클라이언트(CLI `resolve-location.ts`)에도 같은 함정. → INTEGRATIONS
- **서비스 커버리지 마커**: 좌표 의존 라우트는 zod 범위 검증 후 `isInKorea`(`src/lib/coverage.ts`, 국경 폴리곤 `korea-boundary.json` 한 벌, Kit은 바이트 동일 사본) 판정 — 한국 밖이면 키 게이트보다 앞서 200 `{"outOfCoverage":true}`(upstream 미호출). 순서: 파싱→마커→키 게이트→upstream. 프리필터 사각형은 링에서 유도(상수 금지), 클라이언트도 같은 술어. → INTEGRATIONS
- **국내 지역별 미제공은 커버리지와 다른 층이다**: 한국 안이면 200 `{"unavailableHere":"seoulOnly"}`, 판정선은 그 도메인의 조회 반경(`metersOutsideSeoul`) — 행정경계로 자르지 말고, 연속량 도메인(지하철역 거리)엔 쓰지 말고 `nearest`를 싣는다. → INTEGRATIONS
- **역 seed는 타 역 좌표 혼입을 의심한다**(양원역·이촌역 실사고). `scripts/build-subway-stations.py`의 `COORD_FIXES` + 가드 2축(노선 내 연속성 30km·환승 쌍 거리)이 빌드를 중단한다. → INTEGRATIONS
- **좌표는 WGS84 십진 통일.** 단 외부 API별 변환 함정: 에어코리아 측정소=**TM중부원점 EPSG:2097**(proj4, ⚠ 카카오/네이버의 EPSG:5181 아님 — false E/N 같아 혼동, Δ300m+) / 기상청=**격자 nx,ny LCC**(`dfs_xy_conv` 직접 이식) / 네이버 `mapx/mapy`(×10⁷ 정수)는 provider 내부만.
- **data.go.kr envelope는 공용 파서를 쓴다**(`datagokr-envelope.ts`: `readItems`·`readResultCode`·`fetchDataGoKrJson`, 자체 추출 함수 신설 금지). 모양은 공용, 정책(허용 코드·throw)은 provider. ⚠ 단건 `items.item` 모양·JSON 파라미터 이름이 기관마다 다르고, `apis.data.go.kr`은 반드시 https(http는 hang). 가드 `datagokr-https-usage.test.ts`. → INTEGRATIONS
- **서울 열린데이터(`openapi.seoul.go.kr`) 본문은 `readSeoulOpenJson`으로 읽는다**(`seoul-open-json.ts` — 무효 키가 200+XML로 온다). 실시간 지하철은 호스트·키가 달라 계약 밖. → INTEGRATIONS
- **envelope 비표준 주의(공용 파서 스코프 밖 — `response` 래퍼가 없다)**: 서울버스(TOPIS)는 `msgHeader.headerCd`(0정상·4빈결과·그외 throw)+`msgBody.itemList`(ServiceResult 래퍼 없음) / 서울지하철 실시간은 정상/에러에서 code 위치가 다름(`errorMessage?.code || code`) / 서울 열린데이터는 `<서비스명>.row[]`(서비스명이 키). **봉투가 다르면 파서도 다르다** — 이 셋을 공용 모듈에 넣지 말 것.
- **경유지(`via`)는 응답 `waypoint{stepIndex,coord}` 하나로만 드러나고 스텝 문장은 불변이다**: provider가 경유지 표지를 못 찾으면 throw, 대중교통은 `unsupported:"waypoint"`. iOS 실시간 안내의 `via`·`waypoint`는 기본값 없는 필수 인자이고 요청·판정·상태 세 층이 갈린다. → INTEGRATIONS
- **단위 함정**: NCP Directions `duration`=**밀리초**(카카오·`durationSeconds`=초, 미변환 시 28분→468시간). ODsay `totalTime`=분·`payment`=원·`totalWalk`=미터.
- **거리 표기는 `formatDistance`만 지난다**(웹 `format.ts` ↔ Kit `Format.swift` ↔ CLI `dist()` 3벌 미러: 1km 미만 `m`, 이상 소수 km 원값). 낭독 정정은 m만(`spokenDistanceUnits`). 소수 km 직접 조립 금지 — `format-drift.test.ts`가 강제. → INTEGRATIONS
- **3-state 불변식 (시각장애인 정합)**: "0대/없음"과 "정보 없음(`unknown`)"과 "조회 실패(throw→502)"를 **절대 뭉개지 않는다**. 도착·진료·공기질·날씨·시설 전반에 적용. 해석 불가한 수치는 숨기고 등급 단어를 정본으로.
- **도착 낭독 정본은 완성 문장 필드**: 서울버스 `arrmsg1`·지하철 `arvlMsg2`("곧 도착"·"전역 출발"). ⚠ `traTime1`/`barvlDt`를 슬롯형으로 환산하면 운행종료에도 비0이라 오발화. 한 도착 항목이 1·2번째 버스를 슬롯 페어(`arrmsg1`·`arrmsg2`)로 주므로 둘 다 투영(슬롯2는 메시지가 다를 때만).
- **역명 매칭은 확장 정규화가 정본**(`station-match.ts` `normalizeStationName`+`lineHintMatches` 재사용, 자체 정규화 금지). → INTEGRATIONS
- **음성 전사를 검색어로 쓰기 전 `normalizeVoiceQuery` 필수**(웹 `format.ts` ↔ Kit `VoiceQuery.swift`) — STT 후행 마침표에 juso가 0건이 된다. 소비 여부 판정은 별개 층 `hasSpeechContent`(Kit, `SpeechService.stop()` 한 곳). 채팅은 미적용. → INTEGRATIONS
- **"내 주변" 거리순 정렬은 코드 책임**(Haversine, `totalCount` 신뢰 금지). ⚠ 검색 탭은 거리순이 아니라 정확도순+근접 블렌딩 — 거리 표기만 `annotateDistances`, 재정렬 금지. → INTEGRATIONS
- **캐시**: 실시간(지하철·버스 도착)=`no-store`+`force-dynamic`, 준정적=`revalidate`(역메타 86400·공기질 600·날씨 1800·주소 3600).
- **실시간 안내의 표시는 조인과 타입 수준에서 갈려 있다**(E27 잔여 ①): 조인 필드(노선·역명)는 en 세션에서도 한국어로 동결, 문장 계층은 조인 필드가 없는 투영(`transit-display.ts` ↔ `TransitDisplayProjection.swift`)만 받고, 문장 판정은 공유 descriptor `transit-guide-text.ts` ↔ `TransitGuideText.swift`. 이벤트는 ko·en을 함께 나른다. → INTEGRATIONS
- **대중교통·역 정보의 영문은 `lang=en` 응답의 additive `*En`이고 한국어 필드는 어느 응답에서도 그대로다**(E27, `langParam()` — 누락=ko·미지 값 400, 자체 `catch("ko")` 금지). 표 미지·미매칭은 필드 부재(폴백 금지), 한 줄 안에서 언어를 섞지 않는다(`pickLine`). → INTEGRATIONS
- **서버가 합성하는 한국어 문장은 구조화 원재료를 함께 싣고, 클라이언트가 자기 언어로 조립한다**(A26: 문자열 필드 불변 + additive `parts`·`lineCore`·`key`·`guidanceLang`). 판정을 문장 부분 문자열에 걸지 말 것(`crossing` 플래그). 노선 이름만 예외로 표(`subwayLineNameEn`)가 정본. → INTEGRATIONS
- **영문 원천 없는 이름의 병기는 서버 로마자(`romanize.ts` 한 곳) + 클라이언트 `bilingualName`이고, 괄호 한글은 접근성 객체의 마지막 노드다**(E28 — `<KoTail>` `aria-hidden`을 줄 가운데 두지 말 것). → INTEGRATIONS
- **카카오 분류 경로의 영문은 세그먼트 사전(`kakao-category-en.json`) + 서버 `categoryEn`이고 "전부-아니면-원문"이다**(A28). 표시는 `pickCategory` 한 자리, 판정 축은 원문 `category`만(소스 가드). 사전은 실호출 스냅샷. → INTEGRATIONS

### UI·상태 패턴
- **신규 "내 주변" 도메인은 공유 계층으로 만든다**(2026-07-30 중복 추출): 상태 머신 `useNearbyFetch`(요청 ID latest-wins — 닫힌 패널의 늦은 응답 폐기 포함)+렌더 골격 `NearbyPanelShell`+통지 `nearbyLiveMessage`+단계 공개 `useRevealMore`. 골격 복붙 금지 — 계약은 `src/components/__tests__/nearby-contract.tsx` 스위트로 못 박는다(신규 도메인도 이 스위트 적용). 도메인 고유물(항목 렌더·parse·fetch URL)만 컴포넌트에 남긴다.
- **iOS "내 주변" 화면도 공유 상태 머신으로 만든다**(Kit `NearbyLoadCore`+`RevealWindow`+앱 `nearbyAnnouncer`·`NearbyOverlayDescriptor`; `load()` 복붙 금지, 계약은 `NearbyLoadCoreTests`). → PATTERNS
- **현재 위치는 공유 스토어 1곳에서만**(`src/lib/geolocation.ts` 모듈 싱글턴 + `useGeolocation`). 신규 "내 주변"은 `getCurrentPosition` 직접 호출 금지, `awaitGeolocation()` 사용(권한 팝업 세션 1회). **"새로고침"은 `awaitGeolocation({force:true})`**로 정밀 재취득(`PRECISE_OPTS`), ⚠ 실패 시 직전 `done` 데이터 복원(`prevStatus`, 새로고침=재조회이지 데이터 포기 아님).
- ⚠ **위치 스토어에는 TTL이 없다 — "지금 어디 있는가"가 답의 일부인 조회는 전부 `{force:true}`다**(안내 시작·이탈 재조회·ETA 갱신). `useRouteGuide`의 `fetchGuideRoute(force)`는 기본값 없는 필수 인자. → PATTERNS
- **그 사이에 세 번째 축이 있다: 나이 상한**(`LocateOptions.maxAgeSeconds`, 길찾기는 3분 `DIRECTIONS_ORIGIN_MAX_AGE_SECONDS`; `Coord.at` 없으면 신선하지 않은 것으로). iOS는 스토어 자체의 `freshTTL` 60초. → PATTERNS
- ⚠ **화면이 요청하지 않은 측위는 표시 상태를 흔들지 않는다**(`silent` — `ready` 유지한 채 좌표만 갱신, 실패해도 직전 좌표). 나이 상한과 한 쌍이라 한쪽만 되돌리지 말 것. → PATTERNS
- **"내 주변" 섹션들(현재 10개)은 허브 뷰(`NearbyHub`, `?panel=nearby`)에 있고 패널은 `nearby-panel-store.ts` 싱글턴으로 접는다**(직접 닫기·Esc는 `restoreFocus=true`, 자동 닫힘은 `false`). → PATTERNS
- **둘러보기는 세 요청(조망·장면·목록)을 한 fetch로 묶어 한 번에 커밋한다**(iOS `AroundNearbyModel` ↔ 웹 `fetchAround` 합성 Response). 반경은 `OVERVIEW_RADIUS_M` 한 상수, 불릿 문장은 `overview-lines.ts` ↔ Kit ↔ CLI 3벌 미러. 종전 "현재 위치 확인"은 웹·Kit에서 삭제(되살리지 말 것). → PATTERNS
- **iOS 목록 포커스 이동은 "가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도"가 정본**(`SearchView.landFirstRowFocus`; 동기 대입 한 줄은 실패). Bool 바인딩 다중 부착 금지·`scrollTo` 인자는 포커스 키와 다름·시뮬레이터 검출 불가. "내 주변"은 `nearbyFocusOnLoad`/`NearbyFocusLander` 공유. → PATTERNS
- **화면 배치를 바꾸면 그 자리를 지나가는 포커스 점프를 함께 점검한다**(조회 완료 시 첫 성공 수단 heading으로 1회 이동, 계단 회피 재조회는 도보 heading). → PATTERNS
- **실시간 안내 판정 계층은 전부 순수 함수이고 웹·Kit 미러다**(`toneLayerStep`·`motionStep`·`trendStep`·`guideAudioStep`, 공유 fixture가 동조 강제). 톤은 **배타적 계층 순서**(신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축)로 하나만 나고, 정지 판정은 **도플러 3-state**이며, fix 부재는 **타이머 워치독**이 잡는다(fix 경로에만 걸면 권한 철회 시 영구 침묵). 오디오 카테고리 승격은 `didPromote`일 때만 원복한다(세션이 프로세스 전역 자원이라 무조건 원복하면 다른 소비자를 깬다). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §실시간 길 안내** — 이 코드를 수정하기 전에 읽는다.
- **안내 경로 origin은 "신선한가"가 아니라 "정확한가"로 고른다**(A18, Kit `routeOriginStep`만 지난다 — 세션 첫 fix가 곧 가장 나쁜 fix). `isUsableFix`를 조이지 말고 재측위 의존을 되살리지 말 것. `routeOrigin` 로그 1줄 필수. → INTEGRATIONS
- **소리와 음성은 같은 청각 채널이다 — 톤 뒤 발화 계약**(`speechDeferStep`, Kit `GuideSpeechGate.swift` ↔ 웹 `guide-speech-gate.ts`, 단일 슬롯 latest-wins). 새 통지 경로는 `announce` 창구를 지나야 한다 — 직접 게시 금지. → INTEGRATIONS
- **대중교통 승차 추세 톤은 이벤트 소유가 신뢰 불가보다 앞이고, 앵커는 "마지막으로 전달된 잔여"다**(E15 ②, `transitToneStep` ↔ `transit-guide-tone.ts`; 도보 순서로 되돌리지 말 것). → INTEGRATIONS
- **승차 후보의 활성화 차단 술어는 `unreachable` 하나이고 급행 판정은 ID가 정본이다**(A16 L1, `expressVerdict` — 차단 근거는 조인된 이름·ID에서만, 그 외 `unknown`). 근사 잠금은 `needsExpressPrompt`로 급행 여부를 묻는다. 출구 번호는 확정 도착과 하차역 행에만. → INTEGRATIONS
- **소리를 낸 직후 세션을 끝내면 그 소리가 잘린다 — 순서가 아니라 대기가 답이다**(`BeaconTonePlayer.endSession()`이 잔여 시간만큼 원복을 미루고, `beginSession()`은 그 예약을 취소, `shutdown()`은 즉시 원복). 전경에선 증상이 없다. → INTEGRATIONS
- **결정 지점 안내는 두 층이고 거리가 다르다**: 40m `announceSteps` 전문 + `imminent` 짧은 명령형(walk 20·15·10m 삼중 큐, 문장은 첫 번만; car는 반복 없음). 분류기 `walkStepAction`은 서버 `attachStepActions`에서만 돌고 리듀서는 `step.action`을 읽는다(클라이언트 폴백 금지). 임박 큐 소리는 행동별 5종 `imminentTone(action)`, 파일은 `scripts/build-guide-tones.py`. 래치·하한·순서 함정이 많다. → INTEGRATIONS
- **자동차 임박 큐는 문장이 아니라 서버 `turnType` 투영(`action`)으로 행동을 고르고, 없으면 침묵이다**(K2, 표 정본 `car-action.ts` ↔ `CarAction.swift`). 임계 `max(15m, v×6초)`·표본 부족 60m, 공백 뒤 따라잡기는 `silentCatchUp` 세 항이 한 묶음. 운전자 모드는 `BeaconModel`이 `TtsPlayer.speakGuidance`로 발화. → INTEGRATIONS
- **잊힌 도보 세션은 국면 무관 안전망이 끝낸다**(A23, `sessionIdleStep` ↔ `session-idle.ts`: fix 두절 10분·무이동 20분). 도착 추정 게이트를 느슨하게 해서 메우지 말 것. 자동차는 `GuideTuning` 데이터(`entersFinalApproachWithoutGeometry`·`presumedArrival`·`sessionIdleStationaryAxis`)로 갈린다 — `sessionKind` switch 금지. → INTEGRATIONS
- **도착 추정의 국면 게이트는 "도착 창"이고 간략 창의 자격은 Kit 리듀서 `briefArrivalWindowStep`이다**(A31 — `nearby` 래치를 창 근거로 읽지 말 것). 창 에피소드 상태는 `resetArrivalWindow()` 한 곳이 지운다. 종료 화면 30분 만료는 백그라운드를 거친 복귀에서만. → INTEGRATIONS
- **이탈 판정은 축이 둘(수직거리+방위)이고 확정은 OR, 복귀는 활성 축 전체 해제다.** 방위는 위치 이력 유도(`course-derivation.ts` ↔ `CourseDerivation.swift`), 유도기는 그 한 곳뿐, `unknown`은 해제가 아니다, 표결·확정은 최종 접근 진입보다 앞. walk만 `courseAxisEnabled`. 상수는 전부 잠정(A6). → INTEGRATIONS
- **띠바는 탭 콘텐츠 안에 두지, TabView 자체에 걸지 않는다**(K1: 26.1+ `tabViewBottomAccessory`, 18~25 `withGuideBand` safeAreaInset, 배경 `ignoresSafeAreaEdges: []`). 착지 바인딩은 `bandFocusedTab: AppTab?`. 접기 버튼은 제목 행 `GuideMinimizeButton`, "안내 종료"는 목록 밖 최하단 고정, 시트 앵커는 제목 행. → INTEGRATIONS
- **`outputSuppressed`는 공유 Bool이라 받아쓰기 억제의 종료는 `이전 값 ∧ 현재 값`이다**(`GuideSession.setDictationActive(_, owner:)` 소유자 집합; 취소된 세대는 풀지 않는다). → INTEGRATIONS
- **안내 조망은 수단별 시트가 아니라 능력 단위로 공유한다**(E15-1, `GuideOverviewSheet`+`GuideOverviewCapability` 조망 전용 봉인; 판정은 `transitProgressOverview` ↔ `transit-progress-overview.ts`). "현재 위치" 표식은 신선한 추적 관측에서만, 조망 안 착지는 닫힌 뒤 `onDismiss`(`pendingFollowUp`), "다른 경로"는 현재 위치 기준 재조회. → INTEGRATIONS
- **안내 세션은 앱 수명이고 시트를 내리는 제스처는 최소화다**(N1: `GuideSession.shared`가 모델 소유, 루트 `.sheet(item:)` 하나, 시작은 전부 `startBeacon/startTransit` — `guidance-gate-drift.test.ts`가 호출 수를 센다). dismiss 콜백은 무조건 `isMinimized = true`, 소거는 "닫기" 버튼의 `clearArrival()`·`clearWalkHandoff()`뿐. → INTEGRATIONS
- **승차 국면 지하철 상태줄은 `arvlMsg2` 원문을 "{stop}까지" 틀에 넣지 않는다**(A27, `subwayRidingMessage(arrivalCode)` 웹 ↔ Kit 공유 fixture). 버스 승차·대기 후보·내 주변 목록은 완성 문장 그대로. → INTEGRATIONS
- **승차 전 도보(prewalk)는 대중교통 세션이 아니라 그 앞의 도보 세션이고, 종료 화면을 남기지 않는다**(A25: `transitPrewalkTarget` → `BeaconModel.markPrewalk` → `onSessionEnd(reason)`). `prewalkTarget`은 `stop()` 앞에서 캡처, 콜백 발화점은 둘뿐, 잊힌 세션 안전망 비적용, `destinationLabel`은 대중교통 문구와 같은 언어. → INTEGRATIONS
- **iOS 통지 우선순위의 판별선은 "포커스가 움직이고, 그 통지가 착지 라벨로 대체될 수 없을 때 `.high`"다**(`BeaconModel.performReroute` 실사고). 한 함수에서 실패만 `.high`이고 성공이 기본값이면 그 비대칭이 결함 신호. → PATTERNS
- **직선거리는 고를 수 있는 모드가 아니라 이름 없는 내부 강등이다**(E16 축2 — 웹에 단독 진입점·모드 전환 버튼 재도입 금지, 시작 가능 수단 0이면 버튼 0). 기능을 지울 땐 소비자 기준(웹·iOS 공유 i18n 키·이벤트)으로 자른다. → PATTERNS
- **모드 이름을 지운 대가는 강등 사유가 유일한 단서가 되는 것이다**: `fetchGuideRoute`는 `{ok:false, failure}` 태그(`noLocation`·`retryable`·`unavailable`·`outOfCoverage`) — 비-200 전부를 재시도 가능으로 접지 말 것. 통지는 사유, 상시 표시는 동작 서술(`degradedNote`), 강등 문구에 모드 이름 금지. → PATTERNS
- **현위치 수동 지정: 유효 위치를 소비하는 화면과 표시줄을 함께 옮긴다**(우선순위 장소 앵커 > 수동 위치 > GPS, 실시간 안내만 실좌표). 표시줄은 "이 화면의 조회 기준"이라는 약속 — 라벨은 `isManualLocationVerified`까지 본다, 비-ko 병기 `labelRoman`은 지정 시점 저장, 가드 `manual-location-copy.test.ts`. → PATTERNS
- **값을 특정 경로에서 배제할 때 1선은 구조, 2선은 소스 가드, 브랜드 타입은 3선이다**(브랜드 타입은 함수 바꿔치기를 못 잡는다). → PATTERNS
- **런타임 판정이 있는 자리에 상시 고지 문장을 얹지 않는다**(`isBackgroundAudible` 판정 위에 얹힌 "화면이 꺼지면 멈춘다"가 거짓이 된 실사고; 웹은 참). 삭제 범위는 소비자 기준. → PATTERNS
- **스크린리더 통지에 뻔한 꼬리 문장을 넣지 않는다** — 판정선은 "뒷문장이 새 정보를 주는가"(원인·조건·한계는 유지). 정규식 스캔 말고 여러 문장인 문자열 전부를 판정. → PATTERNS
- **"내 주변" 장소 목록 5종은 "더 보기" 단계 공개**(10건 + 회당 10; 라우트는 기본 상한 + 옵트인 `limit`≤50 + `total`, 웹 `NEARBY_LIMIT_MAX` ↔ Kit `fetchLimit`). 포커스는 첫 새 항목, 별도 통지 금지. 정본 `NightClinicsNearby.tsx`·`ClinicNearbyView.swift`. → PATTERNS
- **검색→상세 흐름**: 단일 검색창, 카테고리 칩 필터, 장소 선택 시 **History API 뷰 전환**(카카오는 ID 단건조회 없어 메모리 `Place`로 상세). `?q=` URL 동기화 + request-id ref로 stale 응답 폐기.
- **검색창 3섹션 결정론 병렬**(장소+주소 매 검색 병렬, 웹은 둘 다 0건일 때만, 결과는 정확도순 플랫 리스트). ⚠ 부활 금지 3종: Gemini 자연어 라우터·명소 별도 섹션·버킷 섹션 그룹핑 — 버킷(`category.ts` ↔ `SearchFilters.swift`)은 칩 필터 축으로만. → PATTERNS
- **딥링크(`nmap://`·`kakaomap://`)는 장소 상세의 보조 출구이고, 브리핑 진입점은 길찾기 뷰(`DirectionsView`·`DirectionsTab`)와 채팅 렌더 카드로 일원화**(장소 상세 단일 수단 브리핑 재도입 금지). 대안·최단은 disclosure, 서버 `withStepFree`가 스텝 0을 삽입하며 경유지 인덱스를 +1 밀어 두므로, 본문에서 그 스텝을 뗄 때(`omitNoticeStep`) 한 칸 되돌린다. → PATTERNS
- **수량 문구는 ICU plural이고 iOS는 카탈로그의 ICU 블록을 Kit `formatLocalized`가 푼다**(A29; xcstrings 네이티브 `variations.plural` 금지, 수량 인자는 `Int`, 회피 표기 `(s)` 금지). 변환 스크립트는 지원 밖 ICU에 exit 1. → PATTERNS
- **ko 문장의 플레이스홀더 순서는 iOS 위치 인자 ABI이고 `ios/i18n/arg-order.json`이 그것을 잠근다** — 기존 키 순서 변경은 exit 1, 호출부 인자와 함께 고친 뒤 `--update-arg-order`. 키 개명은 게이트 밖이라 눈으로 본다. → PATTERNS
- **데이터 언어 분리**(`src/lib/data-locale.ts`): 외부 fetch·영문 분기에 `useLocale()` 원시값 금지, `dataLocale`/`prefersEnglish` 경유. iOS 문장 안 수치는 앱 선택 언어로 포맷. → PATTERNS

### 채팅 (Gemini function-calling)
- `src/lib/chat`·`src/lib/gemini`는 **React 비의존**(dodo 이식성). 진입은 두 갈래: **장소 상세의 "이 장소에 관해 물어보기" 오버레이**(`ChatOverlay` 모달, `canShowChat`=`hasGeminiKey()`, 장소마다 새 대화) + **홈 옴니박스의 [AI에게 질문] 범용 진입**(2026-07-30, `SearchBar`의 `onAsk` prop → `place` 없는 `ChatOverlay`, 검색 `?q=`와 분리된 경로라 URL 미기록). ⚠ 과거 메인 페이지 검색⇄채팅 모드 토글은 폐기(`ModeToggle`·`mode-state.ts` 전부 제거).
- **에이전트 루프**(`agent-loop.ts` `runAgentLoop`, maxIterations=6): functionCall→`Promise.allSettled` 병렬→관찰 반복, renders·sources 누적. `/api/chat`은 **NDJSON 스트리밍**(`maxDuration=120`). 도구 throw가 루프 안 죽임, 빈 text는 1회 폴백, 카드는 done에서 1회 마운트(중복 낭독 차단).
- **장소·주소 카드 탭=상세 진입**(`place-open-request` 브릿지, 상세 열림 중엔 같은 히스토리 엔트리 교체): `requestOpenPlace`를 `PlaceSearch`가 구독해 상세를 연다. 다른 카드로 갈아탈 땐 새 `pushState` 대신 `openSeq` 증가로 상세 뷰를 재마운트(뒤로가기 1회로 채팅까지 복귀). 주소 카드는 탭 시 `/api/geocode`로 좌표를 확보한 뒤 여는데, 왕복 중 오버레이가 닫히면(`aliveRef`) 도착 응답을 폐기한다(헌장 §6 ⑨ 이탈 게이트 동형).
- **장소 앵커 불변식**: `placeContext` 있으면 주변 도구는 `anchorOf(ctx)`=장소좌표 기준, 단 **길찾기 출발지는 실제 `userLocation`**(장소로 안 덮음). 장소 앵커 시 기기위치 nearby 카드는 render 생략(산문이 정본). `placeContext` 없으면 동작 byte-identical.
- **⚠ 장소 특징 날조 금지**: 도구가 준 필드만 — Gemini가 카페 분위기·평판을 사전지식으로 날조하면 시각장애 사용자가 검증 불가([[agentic-llm-fabricates-unstated-fields]], systemInstruction에 명시). 도구는 provider 직접 import 호출(`ToolResult{data,render?,source?}`), self-fetch 카드+출처(`SourceList`) 노출, `data`는 LLM에만(PII 누수 차단).
- **마크다운 답변**(`react-markdown`+`remark-gfm`): 헤딩은 강조 단락으로 다운그레이드(아웃라인 오염 방지). ⚠ **loose list `remarkTightLists`로 tight 강제** — `<li><p>` 중첩이 iOS VoiceOver 이중 낭독([[markdown-loose-list-voiceover-double-read]]). 완료 통지는 효과음(`playReceive`)+포커스 이동(진행만 live region).
- **채팅 도구는 24개이고 목록 정본은 코드다**(`declarations.ts`, 실행은 `router.ts`). 산문 정본 도구 8종은 카드 없음, 한눈에 보기만 예외로 `places` 카드. 지명·장소 앵커 조회는 기기 위치 self-fetch 카드를 내지 않고(`placeMode`), 지명→좌표는 `resolveCoord` 한 곳 + `resolvedPlace` 회신, 실패는 `placeNotFound`. → PATTERNS
- **모델 교체는 `npm run eval:ab`로 판정한다 — 벤더 벤치마크로 올리지 말 것**(날조 축은 `src/__ab__/grounding.ts` 자동 판정, pass^k 게이트). systemInstruction 정본은 `system-instruction.ts` 하나. 비용은 `candidatesTokenCount`+`thoughtsTokenCount`. → PATTERNS
- **iOS 채팅 AI 동의 게이트**(`ChatConsentView` + `ChatModel.send` 가드 이중 방어 — 새 전송 경로는 우회 여부 확인). `/api/chat` 60초 10회, follow-up 칩 `/api/chat/suggestions`는 별도 리밋·실패는 200 빈 배열. → PATTERNS
- **개인정보 3자 일치 불변식**: 수집·전송 항목을 바꾸면(새 데이터 유형·새 제3자) 웹 `/{locale}/privacy` 카피 + iOS `PrivacyInfo.xcprivacy` + ASC 영양 라벨(`docs/appstore/1.0-submission-draft.md` §7)을 **동시 갱신** — 불일치는 심사 거절·앱 제거 사유. iOS 받아쓰기는 온디바이스라 오디오는 세 곳 모두 미신고가 정본.

### WebMCP 도구층 (앱 루트가 브라우저 에이전트에게 상시 선언하는 도구 7개)

설계 정본은 spec `docs/superpowers/specs/2026-08-29-webmcp-wave2-design.md`(W2, 공통 계약은 W1 `2026-08-27-webmcp-tool-layer-design.md` §3.0·§4·§6). 여기엔 그 코드를 만질 때 모르면 틀리는 것만 남긴다.

- **도구 목록 정본은 코드다**(`src/lib/webmcp/manifest.ts` 7개; 루트 `PlaceSearch`가 `useWebMcpTools`로 상시 등록, 미가용 도구도 등록하고 실행 시 `notConfigured`. 화면별 등록·`open_*`·`focus_item`은 삭제됐고 `webmcp-removal.test.ts`가 막는다). 도구가 필요한 화면으로 스스로 옮긴다(`ensure-view.ts`). → PATTERNS
- **화면은 브릿지를 뷰 레지스트리에 게시하고 도구는 실행 시점에 읽는다**(`view-registry.ts`): `PlaceSearch`→`HomeBridge`(상시), `PlaceDetail`→`PlaceBridge`(identity=`place.id`), `DirectionsView`→`DirectionsBridge`. 이동 뒤 대기는 뷰 이름이 아니라 **정체성**(`placeId`·`publishedAfter` 순번)에 결박한다 — 장소 A 게시 중 B 요청이 조기 성공하지 않게. withdraw는 자기 브릿지일 때만 지운다(`key` 리마운트의 옛 cleanup 방어).
- **도구층은 한 번에 하나만 실행한다**(`tool-lock.ts`): 화면을 옮기는 도구는 `withOp`로 `op` 토큰을 받고(잠겨 있으면 `busy{running}`), 이동·축 실행·정착 대기 전부를 그 `op`에 결박한다. 전체 상한 30초, 만료·release된 `op`의 늦은 완료는 결과에 반영되지 않는다(`isLive()`). ⚠ 이미 끊긴 호스트 signal로는 잠금을 잡지 않는다(끊긴 signal엔 abort 이벤트가 다시 오지 않아 30초 봉쇄가 됐다, 리뷰 검출). `describe_app`·`read_current_view`는 잠금을 지나지 않는다.
- **사용자 조작이 언제나 도구를 이긴다**: 검색·정렬·축 닫기·새 조회는 새 세대를 발급하고 앞 세대 도구 대기자는 `superseded`. 모달(채팅·현재 위치 지정 — 허브의 것은 `markModal`로 표식)이 열려 있으면 `modalOpen`으로 거절하고 닫지 않는다.
- **손잡이는 불투명 `ref`**(`place-refs.ts`: 문서 nonce·검색 세대·출처·순번 base36). 해석은 `runSearch` **정착 시 동결한 스냅샷**(`HomeBridge.snapshotFor`)에서 한 번이고 가변 화면 상태를 다시 읽지 않는다. nonce 불일치·세대 불일치는 `staleResult`(복구는 `search_places` 재호출 — 실패 출력에 `recovery`+`query`), 순번 밖은 `notFound`.
- **장소 정보 축은 화면 소유 명령이다**(`place-axes.ts`+`useAxisSource`; `present`는 게시 시점 props로 확정, 정착은 명령 세대에 결박). 마운트 축 초기 `loading` 세대는 1, 정착 통지는 자식이 커밋 뒤, StrictMode는 `arm()` 재무장. → PATTERNS
- **검색은 트랜잭션이다**(`PlaceSearch`): 세대(`attempt`)와 세 분기(장소·주소·웹, `pending|done|empty|error|skipped`)를 ref로 들고 정착은 **커밋 뒤 effect**가 커밋 상태 일치를 보고 판정한다. `busy` 판정은 커밋 뒤에 갱신되는 `statusRef`가 아니라 동기 갱신되는 분기 표로(연속 호출에서 statusRef는 아직 idle이다). `toHome`은 popstate **또는** 1초 중 먼저 오는 것을 기다리고 상태로 진전을 재판정한다(3회 상한 `viewChanging`, popstate 귀속 없음, 상태 직접 대입 없음).
- **도구층이 능동적으로 옮기는 포커스는 0이고 한 호출에 착지는 최종 화면의 기존 착지 하나뿐이다**(spec §6). 언와인드 중간 착지는 두 신호로 억제한다 — `PlaceSearch`의 복귀 착지(`suppressFocusRef`)와 **재마운트되는 자식 뷰의 마운트 착지**(`isUnwinding()` — `PlaceDetail`·`DirectionsView`의 제목 focus effect가 본다). 이동 표시(`markChanging`)와 다른 축이다: 상세·길찾기로 **가는** 이동의 마운트 착지는 최종 착지라 해야 한다.
- **출력은 `finish(value, SHAPE)`만 지난다**(`output.ts` allowlist + `assertNoCoordinates`; 1,500자 상한은 항목 단위 생략). `get_place_info`는 축 순서로 빼고 단일 축 + `offset` page 모드. 예산 버킷은 upstream 단위. → PATTERNS
- **사람 문장은 화면과 같은 함수에서 나온다**(`place-lines/*`·`route-step-items.ts`·`transitRouteLabel`). 공유 헬퍼는 컴포넌트 모듈이 아니라 lib에(컴포넌트 테스트가 모듈째 목킹). → PATTERNS
- **도구의 길찾기 조회는 화면 정본 `runQuery(request)`를 부르고 세대 결박 대기자로 기다린다**(`DirectionsView`): 종단 phase의 resolve는 **커밋 뒤 effect**(`settleAfterCommit` → `pendingOutcomeRef`)에서, `bridgeRef` 갱신 effect **뒤에** 선언되고 커밋된 `results.planId`·`phase`가 일치할 때만 푼다. 안내 세션이 살아 있으면 `sessionActive`로 거절하고 **세션을 끊지 않는다**(화면의 사용자 조회는 끊는다 — 그 차이가 의도다). 새 세대 시작이 앞 대기자를 `superseded`로 끝낸다.
- privacy `agent` 절은 웹 전용이라 iOS `PrivacyInfo`·ASC 라벨 3자 일치 대상이 아니다. 단 도구 출력에 새 데이터 유형을 실으면 그 문장(6로케일)을 함께 고친다.

### 통합 카탈로그 (provider · route · 핵심 함정)
세부 구현·검증은 각 spec(`docs/superpowers/specs`) 참조. 새 통합 추가 시 위 횡단 함정·게이트 패턴을 적용.

| 도메인 | provider / route | 핵심 함정·정본 |
|---|---|---|
| 장소 검색 | kakao-local(+naver-local ko 병합) / `/api/places` | **정확도순+좌표 블렌딩**(`sort` 미지정), ko는 카카오+네이버 병합·재정렬 금지, 거리 표기는 `annotateDistances`. 리뷰순(`sort=review`)은 네이버 단독·3금지(병합·재정렬·폴백). 명소 전용 라우트는 폐지. → INTEGRATIONS |
| 목적지 출입구 승격 | kakao-local `searchEntranceCandidatesKakao` + `entrance.ts`(순수) / `/api/places/entrance` | 넓은 부지는 검색 좌표가 본관이라 정문으로 승격(질의 `"{목적지명} 출입구"`, 카테고리 `입출구`+이름 잔여 토큰 2중, 잔여가 비면 후보 아님=멱등, 이득 게이트 200m/300m). 승격본은 좌표 층 이름만, 승격 고지 문장 재도입 금지. → INTEGRATIONS |
| en 장소 | `searchPlacesMergedEn` | 카카오+TourAPI 병렬 병합, 중복=좌표 4자리. 영문주소 juso→NCP 폴백 |
| 주소·우편번호 | juso `searchJusoAddresses` / `/api/address/search` | 좌표는 카카오 `/api/geocode` 재사용. `engAddr`는 국가명 미포함 |
| 역지오코딩(현위치 주소) | kakao-address `coordToAddress`+ncp-geocode `reverseRoadAddress` / `/api/geocode/reverse` | "현재 위치" 라벨 병기용 경량 라우트. **도로명 보장 3단 체인**: 카카오 road → (null이면) NCP 최근접 도로명 → 지번(정직 최후 폴백). ⚠ 카카오 coord2address는 도로명 건물 미매핑 좌표(공터·블록 내부, GPS 빈발)에서 road_address null(실측 2026-07-22) — 지번 우선 회귀 금지 |
| 코레일 역시설 | korail-facilities / `/api/station/facilities` | 406역 전체 받아 `normalizeStationName` 클라 매칭, `stn_cd` 조인 |
| 서울 지하철역 시설 | seoul-metro-facilities (9 op)+voice-guides seed+seoul-elevator / `/api/station/metro-facilities` | 도시철도 보완, `stnNm` 포함필터→정확매칭, `totalCount>300` throw. 보강 2종(음성유도기 seed·엘리베이터 위치 폴백 — wksn 엘베 부재 시만), 보강 실패는 `supplementFailed`로 표기(은폐 금지). → INTEGRATIONS |
| 역 첫차·막차 (전국) | tago-subway (SubwayInfo 15098554) / `/api/station/timetable` | depTime HHMMSS·00시대 심야가 배열 앞(03:00 경계 보정)·당역종착 제외·정확매칭 코드 책임. ⚠ `00`+`totalCount 0`은 "없음"의 증거가 아니다 — `coverage`(`ok`/`noTrains`/`unknown`/`unavailable`)로 가른다(A19). 실호출 게이트 `verify-korea-subway-timetable.mjs`. → INTEGRATIONS |
| 도시철도역 메타 | subway-stations (정적 seed) / `/api/station/meta` | XLSX→JSON 연1회 갱신(`scripts/build-subway-stations.py`), 서버 전용 import |
| 서울 지하철 실시간 | seoul-subway-arrival / `…/subway-arrival[/nearby]` | `arvlMsg2` 정본, 부분실패 보존. ⚠ `INFO-200`은 "운행 시간 밖"과 "미제공 역"이 공유하는 코드 — 역은 어떤 상태에서도 빼지 않고 4-state로 가른다. → INTEGRATIONS |
| 시내버스 | tago-bus + seoul-bus → `src/lib/bus.ts` 병합 | 지방=TAGO·서울=TOPIS `mergeBusStops`. TAGO 0건은 대부분 반경 밖, 미커버 정본 `isUncoveredBusRegion`(라우트·채팅 공용) — **이 마커만 upstream 뒤에 온다**. ⚠ `arrmsg1` 재작성(`rewriteBusArrivalMessage`)은 승차 국면뿐 — `slotToItem` 국면 인자에 기본값 없음. → INTEGRATIONS |
| 따릉이 | seoul-bike / `/api/bike/nearby` | 전체 페이지루프+서버 Haversine, row 수<1000이 종료조건 |
| 실시간 혼잡도 | seoul-congestion + `congestion-area.ts`(순수 판정) → `congestion.ts` / `/api/congestion/nearby` | 서울 `citydata_ppltn`, seed 116영역. ⚠ **중심-반경 원 금지** — 판정은 최근접 구성 지점 ≤300m, 중첩 시 중심 최근접 1개. 봉투가 3형째라 공용 파서 스코프 밖. 캐시는 좌표가 아니라 **영역 코드** 단위 5분이고 `area:null`은 오류가 아니다(서울의 91%). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §실시간 혼잡도** — 이 코드를 수정하기 전에 읽는다.
| 문화행사 | seoul-culture-events → `culture-events.ts` / `/api/events/nearby` | ⚠ `DATE` 파라미터 금지(부분일치), 진행 판정은 코드. 안전한 절단선이 없어 전수 20페이지를 일자 키 `unstable_cache`(6h)로, 거리·반경은 캐시 바깥. `INFO-200`은 끝 신호. → INTEGRATIONS |
| 소아 야간진료 | night-clinic NMC / `/api/clinic/nearby` | 달빛 명부(20km)+일반 소아과 보완(3km) 병합(`clinics.ts`), `findNightClinicsNow` 진료중 우선 정렬 후 캡 50, 절단 전 수 `total`. 공휴일 `fetchIsHoliday`, 실패는 요일 폴백+`basis`. → INTEGRATIONS |
| 공기질·날씨 | air-quality + weather → `LocalConditions` | 단일 region, 두 fetch 독립(allSettled), 좌표계 TM/격자(위 참조) |
| 아이 놀 곳 | kids-places / `/api/places/kids` | 카카오 키워드→`category_name` 화이트리스트(키워드 매칭≠키즈), 실내/외 3-state |
| 둘러보기 | surroundings / `/api/places/around` | 카카오 카테고리(10종)+8방위(`bearing.ts`), ⚠ heading 없어 정면-상대 방향 금지 |
| 보행 인프라 | audio-signals(정적 seed)+osm-walk-nodes(정적 seed) → `walk-infra.ts` / `/api/walk/nearby` | 음향신호기 OA-15543(EPSG:5186)+OSM 전국 정적 seed(`build-osm-walk-nodes.mjs`, 연 1회 — 국경 판정 `area["ISO3166-1"="KR"]`·`out body`·위도 밴드 분할, 가드 G1~G11). OSM seed는 공공데이터와 한 파일로 합치지 않는다(ODbL). 제공 지역 밖은 `unsupported: outsideKorea`(`isInKorea`). `getWalkInfrastructure()`만 호출. → INTEGRATIONS |
| 현재 위치 정위 | where-am-i / `/api/where-am-i` | 4조각 allSettled 조립, 산문은 결정론 템플릿(LLM 아님), `stripRegionPrefix` 중복제거 |
| 부근 상황 재구성(M1) | road-address+geo/road-axis(순수)+road-axis-service → `surroundings-scene.ts` / `/api/surroundings/scene` | 좌우는 도로명 홀짝+juso 건물 축(POI로 세우지 말 것), 맞은편은 같은 도로+본번+홀짝 반대. `SurroundingsScene`은 임베드 전용(live region 없음). 축 실패=방위 폴백 200. → INTEGRATIONS |
| 무장애 여행 정보 | tour-barrier-free / `/api/places/barrier-free[/detail/match]` | 한국관광공사 KorWithService2(B551011). 편의시설 화이트리스트 라벨링(⚠ 필드 철자는 실호출 확정), 장소상세 매칭 좌표50m∩이름(코드 거리 가드 병행). **게이트·인증 모두 `DATA_GO_KR_API_KEY`로 일치**(split-brain 금지). ⚠ 활용신청 별도(API별 독립 승인) |
| 자동차 경로 | **tmap-car(기본)+kakao-navi(폴백)** → `car-route.ts`(ko) / `ncp-directions`(en) / `/api/route/car` | ko 기본 Tmap(완성 문장), 낭독 문장은 `rewriteCarGuidance`(117/118은 회전이 아니라 갈래). 수치 0은 미제공. 게이트 `hasCarRouteKey`. → INTEGRATIONS |
| 도보 경로 | **kakao-walk(기본)+tmap-pedestrian(폴백)** → `walk-route.ts` / `/api/route/walk` | 경로는 목적지까지 가지 않는다(`finalApproach`). 문장은 서버 `rewriteWalkGuidance`(소비자 재조합 금지), `getWalkRoute`만 호출. `accessible` 요청은 좌표 반올림 금지, 토글 라벨은 "계단 회피 경로". 비-ko는 Tmap 단독 en 문장(`pedestrian-action.ts` 표 하나, 미지 turnType은 throw), `lang`은 필수 인자, 비-ko에 계단 회피 컨트롤 미노출. `action`은 서버 `attachStepActions` 전량 투영. 경로 축 `variant=shortest`·`alternatives=1`. → INTEGRATIONS |
| 횡단보도 차로 수·도로 폭 | crosswalks(정적 seed 15028201) → `walk-route.ts` `annotateCrosswalkInfo` / 별도 라우트 없음 | 단일 횡단보도 스텝 끝에 `, N차로, 도로 폭 Mm` — 있는 곳만, 3중 게이트 전부 통과일 때만, Tmap·병합 스텝은 침묵. 파이프라인 마지막 단계. → INTEGRATIONS |
| 대중교통 | odsay + odsay-select + bus-service-hours / `/api/route/transit` | **파이프라인 순서가 계약: 정규화 → 강등 → 선정(5) → 축 라벨.** error 봉투 2형·무효 키도 200(`odsay-envelope.ts`). 강등 정렬 키는 `outside` 유무 하나(A21). 급행은 `(급행)` 한 토큰만 벗긴다. iOS `routeKey` 필수 디코딩이라 **웹 배포가 앱보다 먼저**. 상태 머신의 "탑승"은 차량 선택, riding 승격은 앱(N3). → INTEGRATIONS |
| 지하철 빠른하차 | subway-quick-exit(정적 seed) → `quick-exit.ts` / 별도 라우트 없음(`TransitLeg.quickExit`) | 거리는 열차 선형 위치, 엘베×계단 쌍 최적화, 방향은 방면 1개 확정일 때만. ⚠ 환승 leg는 ODsay `subPath.door`가 정본(A20, 긍정 정규식만 통과). → INTEGRATIONS |
| 장소 영업시간(E24, 웹·iOS 장소 상세) | google-places → `place-hours.ts`(순수) / `/api/places/hours` | Google Places(New). 어떤 실패도 `{hours:null}`. `place_id`는 무기한 캐시·영업시간은 캐시 금지(약관). 예산은 GCP 쿼터. ⚠ 약관 TTS 금지 — VoiceOver만, `place-hours-tts-drift.test.ts`. 매칭은 이름+50m/도로명 키(좌표만으로는 안 한다). attribution "Google Maps"는 번역·변형 금지. → INTEGRATIONS |
| STT | Deepgram nova-3 / `/api/speech-to-text` | ⚠ `detect_language` 금지(ko→vi 오인식), `language` 명시. 효과음으로 시작/정지 통지 |
| 채팅 웹검색 | perplexity-search / `search_web` 도구 | `ToolResult{data,render,source}`, 결과 카드+출처 노출 |

## API 키 현황

전부 **서버 전용 env**(클라 노출 금지). 게이트 함수가 키 유무를 판정해 死기능을 막는다.

| 키 | 게이트 | 용도·비고 |
|---|---|---|
| `KAKAO_REST_API_KEY` | `hasKakaoKey` | 로컬검색+지오코딩+카카오모빌리티 자동차경로 (dodo 앱 공유, 1개로 전부) |
| `TOUR_API_KEY` = `DATA_GO_KR_API_KEY` | `hasDataGoKrKey` | **동일값** — data.go.kr 계정당 단일키. 코레일·TAGO·서울지하철역시설·소아진료·공기질·날씨·무장애여행정보 공유. 신규 추가는 활용신청만. ⚠ 신규 provider 인증은 게이트와 같은 `DATA_GO_KR_API_KEY`로(`TOUR_API_KEY`로 인증하면 게이트와 split-brain — 거짓 "없음" 음성 위험) |
| `NCP_MAPS_CLIENT_ID/SECRET` | `hasNcpMapsKeys` | en 영문주소 보강 폴백 + en 자동차경로. 헤더 `x-ncp-apigw-api-key-id`/`-key` |
| `JUSO_CONFM_KEY` | `hasJusoKey` | 행안부 도로명주소 검색(영문주소+우편번호), 무료·무제한 |
| `SEOUL_OPEN_DATA_KEY` | `hasSeoulOpenDataKey` | 서울 열린데이터(따릉이·문화행사·실시간 혼잡도). 일 1,000회를 셋이 **공유**하므로 신규 소비자는 캐시 설계가 필수. ⚠ 실시간 지하철은 별도 키 |
| `SEOUL_SUBWAY_REALTIME_KEY` | `hasSeoulSubwayRealtimeKey` | "실시간 데이터 인증키"(일반키로 호출 시 `ERROR-338`), 일 1,000회 |
| `ODSAY_API_KEY` | `hasOdsayKey` | ODsay 대중교통 — URI 전용 앱 `gildongmuweb` 키(~2027-01-04, 일 1,000회). ⚠ `+`/`/` 포함이라 **URL 인코딩 형태로 저장**(provider가 raw로 URL에 붙임), 만료 갱신·dodo 이식 시 해당 도메인 URI 앱 등록 |
| `DEEPGRAM_API_KEY` | — | STT nova-3 (dodo 공유). ⚠ prod 502면 키 유효성 먼저([[deepgram-prod-key-401]]) |
| `GOOGLE_CLOUD_TTS_API_KEY` | — (게이트 함수 없음) | iOS TtsPlayer 낭독의 **폴백**(Chirp 3 HD MP3). 정본은 온디바이스 `AVSpeechSynthesizer`(2026-07-27 승격 — 지연 적고 비용 0, 위원장 판정으로 서버·온디바이스 주종 반전). 서버 경로는 현재 로케일 보이스가 기기에 없을 때만이라 지원 6개 로케일에선 사실상 미도달 |
| `GEMINI_API_KEY` | `hasGeminiKey` | 채팅 FC 엔진(모델은 env가 아니라 코드 상수 `GEMINI_MODEL`=`gemini-3.6-flash`, `src/lib/gemini/client.ts`, 2026-07-31 교체). **길동무 전용 GCP 프로젝트 `gildongmu-prod`**(2026-07-31 신설, 결제 연결·`generativelanguage.googleapis.com`만 허용하는 API 제한 키). ⚠ **dodo와 공유하지 않는다** — 종전 공유 프로젝트는 Converters의 TTS·이미지와 dodo가 섞여 사용량·비용 귀속이 불가능했고, dodo도 같은 모델을 써서 model 라벨 분리조차 성립하지 않았다. 키 교체 시 로컬·Vercel prod·리포트 상수 3곳 동조 |
| `GOOGLE_PLACES_API_KEY` | `hasGooglePlacesKey` | Google Places API (New) — 장소 상세 영업시간 한 줄(E24, 웹·iOS 장소 상세 — 2026-09-02 정식판 승격). `gildongmu-prod` 키 `gildongmu-places`(Places API만 허용). 무료분(Details Enterprise 1,000/월·Text Search Pro 5,000/월)을 GCP 일일 쿼터로 상한 — 초과는 429라 과금이 구조적으로 0 |
| `PERPLEXITY_API_KEY` | `hasPerplexityKey` | 검색창 웹섹션 + 채팅 `search_web`. 유료($5/1,000req). dodo 공유 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | `hasNaverLocalKeys` | 네이버 지역검색(ko 장소 병합 보강). 2026-07-18 발급(수동 — Claude in Chrome이 naver 도메인 차단). 일 25,000회, 결과 최대 5건. ⚠ 2027-06-30 NAVER API Hub(NCP 키) 이관 데드라인(PROGRESS) |
| `TMAP_APP_KEY` | `hasTmapKey`(도보 노출 게이트는 `hasWalkRouteKey`, 자동차 노출 게이트는 `hasCarRouteKey`) | SK open API 앱 `gildongmu`(2026-07-21 발급, T아이디). **보행자 폴백 + 자동차 기본**(2026-07-29 도보 카카오 기본 전환·2026-07-30 자동차 ko 기본 Tmap 전환)으로 확장, POI도 동일 키 커버. 일 1,000건 무료(경로안내 그룹)를 도보 폴백·자동차 기본이 공유, IPS "Any IP allowed" 유지(IP 제한 금지 — Vercel 가변 egress). ⚠ **2026-08-27부로 dodo-planet과 공유하지 않는다** — dodo가 전용 앱 `Dodoplanet`(pjtSeq 1000055509)으로 분리했다(dodo `d08d5b63`·`ab1e15a5`, 프로덕션 실호출 확인). 이 1,000건은 이제 길동무 단독이다 |

상세 키 발급 경로·실호출 검증 이력은 `PROGRESS.md`, API 생태계 조사는 `docs/research/RESEARCH-2026-06-*.md`.

⚠ **prod 채팅/STT가 502면 코드보다 키 등록 유효성을 먼저 의심**([[vercel-env-add-noninteractive-bug]]·[[deepgram-prod-key-401]]). 검증은 `env pull` 길이가 아니라 실호출로([[vercel-prod-env-pull-redacts-encrypted]]).

## 배포

- **대외 정본 도메인**: https://gildongmu.dodoplanet.space (2026-07-27 확정, DNS는 Cloudflare 와일드카드 CNAME — 상세는 PROGRESS). Vercel 프로젝트 URL https://gildongmu.vercel.app 도 유효(팀 `hunyong-kims-projects`). GitHub `Engccer/gildongmu` 연결 — **push하면 자동 배포**. ⚠ ODsay Referer는 URI 키 묶임이라 `gildongmu.vercel.app` 유지(교체하려면 ODsay 콘솔에 새 도메인 URI 등록 선행).
- **env 변경 후 반드시 재배포**(키는 배포 시점 함수 주입). 수동 배포 `vercel deploy --prod --yes`.
- 비대화형 등록 `printf '%s' "$VALUE" | vercel env add <KEY> production`(`vercel@latest` 사용 — 구버전 빈값 버그 [[vercel-env-add-noninteractive-bug]]). Preview는 `git_branch_required` 결함이라 REST API/대시보드.
- ⚠ **배포 직후 React #418(hydration) transient**는 스테일 SW 캐시 탓, 코드 결함 아님([[pwa-stale-sw-deploy-hydration-418]]) — dev 클린·캐시제거 먼저 확인. PWA는 수제 서비스워커(`public/sw.js`, Serwist가 Next 16 Turbopack 미지원이라 폴백), document network-first·`/api/` 비캐시.

### iOS 실험 기능은 빌드 구성이 가른다 (2026-08-04 신설)

검증 전 기능을 릴리스에서 빼는 방법은 **플래그 값을 손으로 고치는 것이 아니라 빌드 구성을 고르는 것**이다. 구성은 셋: `Debug`(개발) · `Release`(App Store, 실험 제외) · `Experimental`(실기기 실험판, 실험 포함).

- **`Experimental`이 한꺼번에 정하는 것**: `EXPERIMENTAL` 컴파일 조건 · 번들 ID `space.dodoplanet.gildongmu.dev` · 표시 이름 `…실험` · 아이콘 `AppIconExperimental`. 번들 ID가 달라 **공식판과 한 기기에 공존**한다(설정·동의는 앱별로 분리). ⚠ 위치 권한 문구는 2026-08-15부터 이 목록에 없다(도보 안내 졸업으로 거리 안내 절이 정식 문구 ko에 들어가, 같은 값의 이중 관리를 끊었다).
- **실기기 배포**: 실험판 `CONFIGURATION=Experimental ./ios/deploy-device.sh`, 공식 번들 `CONFIGURATION=Release`. ⚠ 미지정 `Debug`는 공식 번들 ID에 진단 UI를 켜 "정식판에 실험 섹션이 보인다"로 나타난다. → PATTERNS
- **코드 게이트**: `AppConfig.experimentalGuidanceEnabled`·`experimentalTabOrderEnabled`가 `#if EXPERIMENTAL`로 갈린다. 검증되면 `#if`를 **삭제**한다(항상 참 상수를 남기는 것이 곧 쌓임). → PATTERNS
- ⚠ **봉인의 판정 축은 플래그 참조 목록이 아니라 세션을 시작시키는 호출 전수다** — `guidance-gate-drift.test.ts`가 네 형태의 호출 수(현재 8곳)를 센다. → PATTERNS
- ⚠ **한 버튼이 두 역할을 겸하면 봉인이 그 버튼을 통째로 지우거나 통째로 남기지 못한다**(2026-08-15). 안내 시작 섹션의 버튼은 추적 중엔 "중지"(항상 유효), 비추적이면 직선거리 안내 시작(봉인 대상, `beacon.briefGuideStart`)이라, 섹션 표시 조건만 막으면 **실패 상태 경로**로 섹션이 떠서 봉인이 뚫린다. 조건은 역할별로 쓴다(`beacon.isTracking || experimentalGuidanceEnabled`).
- ⚠ **`INFOPLIST_KEY_*` 빌드 설정만으로는 구성별 분기가 안 된다**(xcstrings가 이긴다): 로컬라이즈 문자열은 `ios/scripts/experimental-infoplist.sh` 후처리(검증 실패 시 빌드 중단), 비로컬라이즈 키는 `Support/Info-Experimental.plist`. → PATTERNS
- ⚠ **두 plist 계약의 의도된 예외: Bluetooth 권한 문구와 CoreBluetooth 심볼** — `NSBluetoothAlwaysUsageDescription`은 실험판 plist에만이고 CoreBluetooth는 앱 타깃 `#if DEBUG || EXPERIMENTAL` 안(Kit에 `import CoreBluetooth` 금지 — Apple은 바이너리 심볼을 본다, `check-release-artifact.mjs`가 잡는다). BLE 실측은 반드시 Experimental로. → PATTERNS
- ⚠ **졸업 때 옮겨야 하는 것은 코드 게이트만이 아니다** — 백그라운드 모드도 정식 plist로 함께 승격(전경은 정상인데 화면을 끄면 죽는다). 산출물 Info.plist 검사 `check-release-artifact.mjs`. → PATTERNS
- ⚠ **새 게이트는 그것을 실제로 부르는 경로로 한 번 밟아 본다**(1.7 제출을 막은 두 건이 검사 자신의 결함이었다). → PATTERNS
- ⚠ **아이콘 표식은 시각 구분이라 그것만으로 부족하다.** 스크린 리더 사용자에겐 **표시 이름이 유일한 구분 수단**이므로 이름 접미사를 반드시 유지한다.
- ⚠ **번들 ID가 다르면 UserDefaults도 새로 시작한다.** 그래서 실험판 첫 실행은 언어 미선택 상태이고, 기기 시스템 언어가 영어면 `dataLocale`이 `en`이 되어 **ko 전용 게이트(현재 자동차 실시간 안내·계단 회피 토글)가 막힌다** — 검증하려고 깐 기능이 안 보인다(2026-08-04 실측). `AppLanguage.current`가 `#if EXPERIMENTAL`에서 **미선택 폴백만 ko로 고정**해 막았다(사용자 선택은 여전히 1순위). AI 동의·받아쓰기 설정도 같은 이유로 실험판에서 다시 물어본다(정상).
- ⚠ **pbxproj 객체 ID는 파일 전체에서 유일해야 한다.** 기존 ID를 재사용하면 그 객체를 덮어써 프로젝트가 열리지 않는다(`B30001`을 재사용해 `Project object`를 가린 실사고). **`plutil -lint`는 이것을 못 잡는다**(plist 문법은 유효하다) — 편집 후 검증은 `xcodebuild -list`로.

### CLI/MCP 릴리스 (`packages/cli`=npm `gildongmu`, `packages/mcp`=npm `gildongmu-mcp`)

- 발행은 `cli-v*` 태그 push → `.github/workflows/cli-publish.yml`이 두 패키지를 npm Trusted Publishing(OIDC)으로 자동 발행. 토큰·환경변수 불필요.
- 릴리스 절차: **버전 4곳 + CHANGELOG 2곳 동조 갱신** → 커밋 → `git tag cli-v<버전> && git push origin main --tags`. index.ts 버전은 하드코딩 — `version-drift.test.ts`가 강제. → PATTERNS
- ⚠ **CHANGELOG는 `files`에 적어야 tarball에 들어간다.** npm이 무조건 포함하는 것은 `package.json`·README·LICENSE뿐이고 CHANGELOG는 그 목록에 없다(2026-08-08 `npm pack --dry-run` 실측). npm 페이지에서 사용자가 보는 유일한 변경 이력이라 빠지면 곧 정보 부재다.
- `--provenance`는 켜 둔다(2026-08-25 cli-v0.9.0 실발행으로 両패키지에 SLSA v1 증명 확인). ⚠ private repo 시절엔 404로 위장된 422로 실패했다(dodo Round 119 실측) — repo를 다시 비공개로 돌리면 이 플래그부터 뺀다. 카탈로그(`endpoint-catalog-shared.ts`) 수정 시 cli·mcp 両미러 동일 유지(drift 테스트가 byte 해시로 강제).
- **카탈로그에 항목을 더하면 `FORMATTERS`(cli `lib/formatters.ts`)에도 등록한다.** 빠뜨리면 `runEndpoint`가 조용히 `JSON.stringify` 폴백으로 떨어져 **text 모드에서만** 통짜 JSON이 나온다 — 파이프로 돌린 실호출 검증은 비-TTY라 JSON 모드가 정상이므로 이것을 못 잡는다(2026-08-01 실사고). `formatter-coverage.test.ts`가 강제하고, 폴백이 맞는 항목은 그 파일의 예외 목록에 근거와 함께 적는다.
- **`lang` 같은 선택 파라미터는 카탈로그가 정본이고 인자 선언·전달 판정이 같은 술어(`catalogSupportsLang`)를 쓴다**(E26). `runEndpoint`의 `lang`은 필수 인자, `langArgs`는 받는 명령에만, `allSettled` 묶음은 400을 즉시 종료로. 포매터 라벨은 한국어 고정. → PATTERNS

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)
                   # ⚠ 루트 include는 `src/**`와 `scripts/**/*.test.mjs`뿐이다: `packages/cli`·`packages/mcp` 테스트는
                   # 여기서 이름을 넘겨도 "No test files found"로 **통과가 아니라 무실행**이 된다.
                   # 그 둘은 해당 디렉터리에서 `npx vitest run`으로 돌려야 실제로 돈다.

node scripts/usage-report.mjs   # API 과금·쿼터·키 만료 상태 (로컬 전용, 무과금 프로브 — 돈 5·가용성 13)
```

**"API 비용·쿼터·키가 살아 있나"는 `usage-report.mjs`가 정본이다** — Vercel 대시보드나 각 벤더 콘솔을 손으로 훑지 말 것. 돈·가용성·시한·걱정불필요 4섹션을 평문으로 내고, 200에 오류를 담는 벤더 6종(ODsay·서울지하철·따릉이·juso·공공데이터포털·NCP 지오코딩)까지 judge로 가른다(설계 근거는 spec `2026-07-31-usage-cost-report-design.md`). ⚠ 이 스크립트가 답하지 **못하는** 것은 **호출량**이다(Vercel Hobby는 런타임 로그 보존 1시간·Observability 조회 12시간이 상한). 호출 건수·라우트 분포가 필요하면 Vercel Observability의 External APIs·Functions를 본다.

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반. Vitest 전역은 node-env지만 **컴포넌트 테스트는 파일 상단 `// @vitest-environment jsdom` 프라그마 + @testing-library/react 레인이 관례**(`PlaceDetail.test.tsx`·nearby 계약 스위트가 선례). 순수 로직은 node-env fixture 단위테스트, 외부 API 통합은 **실호출이 머지 게이트**.
- **외부 API 통합은 실호출(실데이터)을 머지 게이트로 박는다** — fixture green ≠ 실계약 검증(데이터 커버리지 현실은 정적 리뷰가 못 잡음).
- 커밋 이메일 `engccer@gmail.com`. 주석·커밋·문서 한국어, 변수/함수명 영어.
- a11y 변경 후 `a11y-auditor` 서브에이전트 점검.
- **신규 국내 서비스는 대장과 작업 큐가 다른 문서다**: `docs/SPEC.md` §3 "실험 백로그"는 **조사한 서비스의 대장**(존재하는가·쓸 만한가)이고, `docs/BACKLOG.md` E는 **착수 후보 큐**(다음에 뭘 할까)다. 발굴하면 SPEC에 등록하고, 착수를 결정하면 BACKLOG로 올린다. 둘은 중복이 아니라 파이프라인이다.
- **마일스톤을 닫을 때 문서를 분배한다**(위 §문서 체계): 서사 → `CHANGELOG.md`, 남은 판정 → `docs/BACKLOG.md`, 새 함정 → `CLAUDE.md`, 상태 한 줄 → `PROGRESS.md`. iOS 릴리스는 `docs/appstore/release-notes.md`에 What's New를 함께 남긴다(ASC에 입력한 문구 그대로가 정본). 노트를 적으면 `node scripts/build-release-notes.mjs`로 번들 JSON(설정>업데이트 이력 소스)을 재생성한다 — 잊으면 release-notes-bundle 드리프트 테스트가 잡는다. ⚠ **그 번들은 앱 리소스라 아카이브 시점에 바이너리로 굳는다**(2026-08-17 실측): ASC의 What's New는 API 입력이라 업로드 뒤에도 고칠 수 있지만, 같은 문장이 앱 안 업데이트 이력에서는 그 버전에 영영 남는다. **아카이브 후 노트를 고쳤으면 빌드 번호를 올려 다시 올린다**(1.8이 빌드 14를 버리고 15로 갔다 — 판정을 검증하다 "대중교통 브리핑 문장을 다듬었다"가 실제로는 Kit 이관이라 문장 무변화임을 발견한 자리). 확인은 업로드본을 직접 읽는 것뿐이다: `.xcarchive/Products/Applications/Gildongmu.app/release-notes.json`.
- **저장소는 공개 전제로 다룬다(2026-08-17 오픈소스 준비)**. **기준 절차의 정본은 `sanitize-for-release` 스킬**(공개 저장소 `Engccer/sanitize-for-release`)이며, gildongmu는 그 스킬의 **유형 C(원본 격리형)** 다. 유형별 절차·스윕 축은 스킬을 따르고 여기서는 이 저장소의 자리만 적는다.
  - ①**실기기 계측 로그(`guide-diag*.log*`)는 커밋하지 않는다** — 초 단위 위경도는 개발자의 실제 이동 경로다. `.gitignore`가 막고, 원본은 `~/gildongmu-private/field-logs/`에, 색인만 `docs/superpowers/specs/logs/README.md`에 둔다. 게이트 테스트가 로그를 필요로 하면 필요한 축만 익명화 fixture로 뗀다(경도 평행이동은 haversine·방위를 보존한다, 좌표가 불필요하면 t·event만). **자택·지인 주택은 문서·테스트·커밋 메시지 어디서도 실주소·동 호수로 적지 않는다** — "자택"·"주택 A/B"로 쓰고 대응표는 `~/gildongmu-private/places.md`에 둔다(공개 전 이력째 치환한 자리이며, 실보행 코스 설명이 이 규칙을 가장 자주 어긴다).
  - ②**정적 seed를 추가·교체하면 `NOTICE.md` 표에 파일·원출처·이용 조건·재생성 스크립트를 함께 적는다** — 코드는 MIT지만 데이터는 원출처 조건이고, 표에 없으면 MIT로 오인된다. OSM 파생 파일과 공공데이터 파일은 한 파일로 합치지 않는다.
  - ③fork가 바꿔야 할 식별자(도메인·번들 ID·패키지명·연락처)를 새로 박으면 `docs/FORKING.md` 표에 그 자리를 더한다.
- gildongmu는 리뷰 게이트 통과 후 묻지 말고 commit+push(자동배포 포함, [[gildongmu-auto-commit-push]]). `git add -A` 금지, 의도 파일만([[commit-stage-explicit-files]]).
