# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).
>
> 이 파일은 **항구 규칙·패턴·함정만** 담는다(매 세션 컨텍스트에 전량 로드되므로 비대화 금지). 나머지는 아래 문서 지도를 따른다.

## 문서 체계 (어디에 무엇을 쓰는가)

| 파일 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `CLAUDE.md` | 항구 규칙·패턴·함정. **다음에 이 코드를 만질 사람이 모르면 틀리는 것** | 날짜 있는 서사, 진행 상황, 완료 보고 |
| `PROGRESS.md` | **지금** 무엇이 동작하고 어디까지 도달했는가. 배포 현황·운영 기능·env | 완료된 일의 경위, 검증 상세 |
| `CHANGELOG.md` | 날짜별로 **무엇이 바뀌었나**. 항목당 2~4줄 + spec 링크 | 설계 근거, 함정 재서술(CLAUDE.md·spec이 정본) |
| `docs/BACKLOG.md` | **아직 하지 않은 것**. 열린 판정·편승 대기·신규 후보·폐기 근거 | 종결 항목(→ CHANGELOG) |
| `docs/INTEGRATIONS.md` | 통합별 **상세 계약**. 요지만으로는 지킬 수 없고 어기면 조용히 실패하는 것 | 도메인 무관 규칙(→ 이 파일 횡단 함정) |
| `docs/superpowers/specs`·`plans` | 설계 정본 + **그 마일스톤의 검증 상세**(실호출 게이트 결과·변이 주입·리뷰 판정) | 다른 마일스톤 이야기 |
| `docs/research/` | 조사 기록물. **시점 고정이라 낡는 것이 정상**(결론이 뒤집히면 머리에 한 줄 표기) | 코드를 구속하는 규칙(→ 위 문서들로) |
| `docs/appstore/release-notes.md` | App Store 버전별 What's New | 제출 절차(→ `1.0-submission-draft.md`) |
| `packages/*/CHANGELOG.md` | npm 사용자가 보는 릴리스 노트 | 내부 구현 서사 |

**마일스톤을 닫는 마지막 단계는 이 분배다.** 서사는 `CHANGELOG.md`로, 남은 판정은 `docs/BACKLOG.md`로, 새로 배운 함정은 이 파일로, 상태 한 줄만 `PROGRESS.md`로 보낸다.

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
- **"내 주변" 결과 각 항목 이름은 `<h4>`**(6종 nearby). 정적 정보 리스트라 발견 경로(버튼)가 없어 heading이 유일한 빠른 점프 수단(자동 등장 섹션과 동형). 계층: nearby 섹션 헤더 `h3` → 항목 `h4`(장소 상세는 장소명 `h2`→nearby `h3`→항목 `h4`). 정류소·역은 이름만 `h4`, 도착편 목록엔 heading 미부여(과잉). **신규 nearby 항목 이름은 `<h4>`로.** 예외: 보행 인프라 패널은 항목이 이름 없는 인프라 점이라 그룹 헤더만 `h4` 3개(음향신호기·횡단보도·점자블록), 항목 무헤딩(도착편 관례 동형).
- **한 줄 = 한 접근성 객체 (시각 목적 인라인 분절 금지).** 한 항목의 한 줄(역명+노선+거리, 라벨+값)을 시각 스타일용 인라인 `<span>`(`opacity-70` 흐림, `text-xs` 작게, `font-medium` 라벨, `bg-accent` 배지, `ml-N` 간격)으로 쪼개면 **각 span이 별도 접근성 객체**가 되어 VoiceOver가 조각마다 멈춘다 — 한 항목 읽는 데 스와이프 여러 번(가운뎃점까지 별도 객체). Chrome 접근성 트리로 실측 확정. **수정 정본: `joinText(...)`(`src/lib/format.ts`)로 한 줄을 단일 텍스트로 합친다** — falsy 조각 자동 제거(선택 항목은 `cond && text`), 구분자는 쉼표(가운뎃점은 일부 SR이 단어로 낭독해 금지). 의미 있는 배지(급행·환승·실내/외)는 장식이 아니라 정보이므로 **텍스트로 흡수**(제거가 아니라 합침). **인터랙티브 요소(`tel:` 전화 `<a>`·버튼·입력)는 별도 객체가 정상 — 절대 합치지 말 것.** 글로벌 CLAUDE.md "한 줄 = 한 접근성 객체" 정본.
- **definition list(`<dl>/<dt>/<dd>`)는 단순 라벨-값에 금지.** SR이 항목마다 "용어/정의" 역할과 콜론을 별도 낭독해 "표처럼" 읽힘. **평문 단일 텍스트** `<p>{`${라벨} ${값}`}</p>`로(콜론 제거). ⚠ 과거엔 `<span class="font-medium">라벨</span>`로 라벨만 볼드 처리했으나 **그 라벨 span도 별도 객체로 분절**되므로(위 "한 줄 = 한 객체") 라벨 볼드를 포기하고 라벨+값을 한 텍스트로 합친다. `<html lang={locale}>`가 있어 콘텐츠 언어 == 로케일이면 `lang` 속성 불필요, 다국어는 `prefersEnglish`로 현재 언어 하나만.
- **이미 보이는(SR 노출되는) 콘텐츠를 live region에 복제하지 말 것**(WAI-ARIA 모범). 채팅 답변 산문을 sr-only로 복제했다가 회전자에서 중복 낭독된 회귀가 있었다 — 답변은 보이는 `MessageBubble` 한 곳에만.
- **iOS 채팅·받아쓰기 계약은 헌장 §6이 정본이다.** 여기엔 이 repo의 구현 위치와 헌장에 없는 판정만 남긴다.
  - 산문 블록 분할 `parseChatMarkdownBlocks`(Kit) + 블록별 `Text`(헤딩 `.isHeader`), 질문 말풍선 헤딩 trait. 포커스 계약 구현·계측은 `ios/Gildongmu/Chat/ChatConversationView.swift`·`ChatFocusDiag.swift`.
  - 받아쓰기는 **탭 토글이 기본**(2026-07-29 위원장 결정 — 비-VO 심사자가 짧게 탭하면 홀드가 무반응으로 보여 App Store 반려됐다), 홀드는 설정 선택지이고 짧은 탭에 3초 가시 안내(`ios.voice.holdHintVisible`)를 병행한다. 구현 `HoldDictationButton.swift`.
  - ⚠ **제스처 계층은 UIKit 인식기(`HoldGestureCatcher`)가 정본** — SwiftUI LongPress+Drag 조합은 List 스크롤 팬 경합·VO pass-through 드래그 유실로 실기기 불합격했다(재도입 금지).
  - ⚠ **"녹음 시작 순간 VO 낭독 차단"은 `SpeechService.start()`의 책임이다**(홀드 버튼이 아니라). 홀드 없이 시작되는 경로엔 그 차단이 없어 녹음 중 라벨이 낭독된 회귀가 있었다.
  - 단축어 "음성 검색" 세션은 진입 시 VO 커서를 마이크 행에 선점한다(`SearchView.task`의 `micRowFocused`, `speech.start()` 전 + 완료 후 1회 재확정). 정지 수단이 그 행 탭인데 커서가 최상단이면 스와이프로 찾아가야 하기 때문이다.
  - 채팅 입력 필드의 지우기 버튼(`ios.chat.clear`)은 초안이 있을 때만 나타나고, 누르면 자신이 사라지므로 포커스를 입력 필드로 선점 이동한다.

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
- **좌표 쿼리 파라미터는 `src/lib/coord-param.ts`를 쓴다**(`latParam`/`lngParam`, 범위가 다르면 `coordParam(min,max,label)`, 2026-08-01 백포트): `searchParams.get("lat") ?? ""`를 `z.coerce.number()`에 직접 태우면 `Number("")===0`이라 **파라미터 누락이 (0,0)이 되고 그 좌표는 한국 밖이라 400이어야 할 요청이 `200 {"outOfCoverage":true}`로 위장**한다. 200에 그럴듯한 안내 문장이라 CLI 소비자는 자기가 해외에 있다고 읽는다. 커버리지 마커가 없는 라우트(`walk/nearby` 등 OSM 전 지구)에선 같은 함정이 **널 아일랜드 실조회**가 된다. 좌표가 선택인 라우트는 `latParam().optional().catch(undefined)`(400이 아니라 "좌표 없음"이 정답). 가드는 `src/app/api/__tests__/coord-param-usage.test.ts`. ⚠ **클라이언트에도 같은 함정이 따로 있다**: CLI `resolve-location.ts`가 `Number("")`를 유한값으로 통과시키면 (0,0)이 서버엔 정상 좌표로 도착해 서버 가드로 못 막는다.
- **서비스 커버리지 마커(2026-07-29 심사 반려 대응)**: 좌표 의존 라우트는 zod 전지구 범위 검증 후 `isInKorea`(`src/lib/coverage.ts` 정본, iOS Kit `Coverage.swift` 미러 — 31.43~44.35/122.37~132.0) 판정. 한국 밖이면 **키 게이트보다 앞서** 200 `{"outOfCoverage":true}` 반환(오류 아님 — 3-state에 더한 4번째 정직 상태, upstream 미호출로 쿼터 보호). 신규 좌표 라우트는 파싱→마커→키 게이트→upstream 순서를 따르고, 소비자는 기존 감지 계층 재사용: 웹 `isOutOfCoverageBody`+선분기, iOS `APIError.outOfCoverage`+선분기, CLI/MCP `isOutOfCoverage`, 채팅 `coverageGate`(**앵커 좌표 기준** — 장소 앵커가 한국이면 해외 사용자도 정상, 길찾기만 userLocation). 안내 문구는 "위치 기반 기능만 제한" 톤(`common.outOfCoverage`·`ios.common.outOfCoverage`), 이름 기반 기능(검색·역 정보·목적지 길찾기·장소 앵커 채팅)은 전 세계 유효.
- **국내 지역별 미제공은 커버리지와 다른 층이다**(2026-08-02): 한국 **안**이지만 그 도메인 데이터가 그 지역에 없으면 200 `{"unavailableHere":"seoulOnly"}`(마커 자리·순서는 위와 동일, upstream 미호출). 소비자: 웹 `unavailableHereReason`→`useNearbyFetch`의 `unavailableHere` 상태→`tCommon("unavailableHere")`, iOS `APIError.unavailableHere`→`NearbyLoadPhase.unavailableHere`, CLI/MCP `isUnavailableHere`, 채팅 `SEOUL_ONLY`. **판정선은 임의로 고르지 말고 그 도메인의 조회 반경을 그대로 쓴다** — `metersOutsideSeoul`(coverage.ts)에 따릉이는 1km(`MAX_DISTANCE_METERS`), 문화행사는 3km(`RADIUS_METERS`)를 넘긴다. 반경 밖엔 대상이 존재할 수 없으므로 판정이 정의상 틀리지 않고, 상수를 복제하지 않아 drift도 없다. ⚠ **행정경계로 자르지 말 것**: 반경이 서울 경계를 넘어 하남 미사·과천에서 실제로 서울 행사가 잡힌다(실측 각 1건). ⚠ **연속량인 도메인에 이 판정을 쓰지 말 것**: 최근접 지하철역 거리는 전국에 간격 없이 분포해(울산 3.5·세종 10.0·창원 17.3·원주 26.6km, 6~26km에 국토 격자 15.7%) 어떤 임계값도 자의적이다 — 지하철은 판정 대신 0건일 때 **최근접 역을 그대로 실어**(`nearest`) 거리로 사용자가 판단하게 한다(1.5km면 걸어가고 90km면 도시철도가 없는 지역이다).
- **역 seed는 동명이역 좌표 혼입을 의심한다**(2026-08-02 실사고): 표준데이터 XLSX가 경의중앙선 양원역(서울 중랑구) 레코드에 **영동선 양원역(경북 봉화)의 좌표**를 담고 있었다. 주소 컬럼은 서울인데 좌표만 198km 밖이라, 중랑구에서는 그 역이 영영 검색되지 않고 봉화 산간에서는 있지도 않은 수도권 전철역이 1km 안에 잡혔다. 증상이 "그 역이 안 나온다"뿐이라 지역별 처리 작업 중 최근접 역을 노출하기 전까지 드러나지 않았다. `scripts/build-subway-stations.py`가 `COORD_FIXES`로 보정하고 `line_outliers` 가드가 새 혼입에 **빌드를 중단**한다. 판정 축은 **노선 내 연속성**(같은 노선 최근접 역까지 30km 초과) — 주소 컬럼으로 보면 형식 차이로 커버리지가 뚫린다(대구 94역은 시도 접두가 없어 매칭 0%, 경기 268건은 광역시가 아니라 대상 밖). 임계값 근거: 정상 최대 11.1km(대경선 경산역) vs 양원역 오류 141.4km(변이 주입 실측), 주소 형식과 무관하게 1,098건 전부 검사.
- **좌표는 WGS84 십진 통일.** 단 외부 API별 변환 함정: 에어코리아 측정소=**TM중부원점 EPSG:2097**(proj4, ⚠ 카카오/네이버의 EPSG:5181 아님 — false E/N 같아 혼동, Δ300m+) / 기상청=**격자 nx,ny LCC**(`dfs_xy_conv` 직접 이식) / 네이버 `mapx/mapy`(×10⁷ 정수)는 provider 내부만.
- **data.go.kr envelope는 공용 파서를 쓴다**(`src/lib/providers/datagokr-envelope.ts`, 2026-08-01 공용화): `readItems`·`readResultCode`·`readResultMsg`·`readTotalCount`+`fetchDataGoKrJson`. **자체 추출 함수 신설 금지** — 종전 9벌이 같은 모양을 다르게 읽어 원시값 `item`을 감싼 유령 항목(전 필드 `undefined` = SR에 "이름 없는 항목")과 `items` 직접 배열의 조용한 전멸을 만들었다. 경계는 **모양은 공용, 정책은 provider**: 허용 resultCode(`"00"`/`"0"`/`"0000"`/`"03"`)·throw vs null·totalCount 가드는 서비스 계약이라 각 provider에 남기고 공용 fetch는 resultCode를 보지 않는다(합치면 `okCodes` 분기 주머니가 된다). `fetchDataGoKrJson`은 `res.json()`을 쓰지 않는 이유가 있다 — 키 만료·미신청이면 `_type=json`이어도 **HTTP 200 + XML 본문**이 와서 `Unexpected token '<'`라는 원인 없는 SyntaxError가 된다(`OpenAPI_ServiceResponse` 게이트웨이 에러도 함께 감지). ⚠ **`items.item` 단건 모양은 기관코드마다 다르다**(실측 2026-08-01 `numOfRows=1`): B551011(TourAPI)·B551457(코레일)은 1건에도 **배열 유지**, B552657(NMC 응급의료)·1613000(TAGO)은 **단일 객체**. 새 API는 호출해 봐야 알고, 틀리면 런타임 TypeError나 조용한 누락이라 두 모양을 다 받는 공용 파서가 그 질문 자체를 없앤다. ⚠ **JSON 파라미터 이름도 기관마다 다르다**: 빠른하차(B553766)는 `_type=json`을 **무시하고 XML을 준다** — `dataType=json`이어야 한다(`type`·`resultType`도 XML). 이때 `resultCode 00`에 실데이터가 실려 오므로 키 문제로 오진하기 쉽다. 새 기관코드는 첫 호출에서 파라미터 이름부터 확인할 것(실측 2026-08-08). ⚠ **`apis.data.go.kr`은 반드시 https로 부른다**: 평문 http는 **TCP 연결까지 되고 응답이 오지 않는다**(read ETIMEDOUT, 같은 요청이 https로는 0.07초). 프로덕션 대중교통 길찾기가 71초 걸려 앱 타임아웃으로 실패한 실사고가 있었고(2026-08-04), 원인은 한 provider만 https로 고치고 같은 호스트를 쓰는 셋을 빠뜨린 것이었다. hang이라 `revalidate` 캐시가 영영 안 채워져 두 번째 호출도 71초로 일관된다는 점이 진단 단서였다. 가드는 `datagokr-https-usage.test.ts`. ⚠ TOPIS(`ws.bus.go.kr`)는 http에서 정상이고 https 지원 근거가 없어 건드리지 않는다.
- **서울 열린데이터(`openapi.seoul.go.kr`) 본문은 `readSeoulOpenJson`으로 읽는다**(`src/lib/providers/seoul-open-json.ts`, 2026-08-01 공용화. 소비자 4종: 따릉이·문화행사·혼잡도·엘리베이터): 인증키가 무효하면 `/json/` 경로여도 **HTTP 200 + XML 본문**이 와서 `res.json()`이 `Unexpected token '<'`로 죽는다. 키를 넷이 공유하므로 **키가 죽으면 동시에 같은 방식으로 오진**되고, 원인이 키라는 사실이 SyntaxError에 가려진다(`fetchDataGoKrJson` 동형 함정). 경계는 datagokr과 같다: **모양은 공용, 봉투 정책(정상 코드 판정)은 provider**. 가드는 `src/lib/providers/__tests__/seoul-open-json-usage.test.ts`. ⚠ 실시간 지하철은 `swopenapi.seoul.go.kr`로 **호스트도 키도 다르므로 이 계약 밖**이다.
- **envelope 비표준 주의(공용 파서 스코프 밖 — `response` 래퍼가 없다)**: 서울버스(TOPIS)는 `msgHeader.headerCd`(0정상·4빈결과·그외 throw)+`msgBody.itemList`(ServiceResult 래퍼 없음) / 서울지하철 실시간은 정상/에러에서 code 위치가 다름(`errorMessage?.code || code`) / 서울 열린데이터는 `<서비스명>.row[]`(서비스명이 키). **봉투가 다르면 파서도 다르다** — 이 셋을 공용 모듈에 넣지 말 것.
- **단위 함정**: NCP Directions `duration`=**밀리초**(카카오·`durationSeconds`=초, 미변환 시 28분→468시간). ODsay `totalTime`=분·`payment`=원·`totalWalk`=미터.
- **거리 표기는 `formatDistance`만 지난다**(웹 `src/lib/format.ts` ↔ Kit `Format.swift` ↔ CLI `formatters.ts` `dist()` 3벌 미러): 1,000m 미만은 `"{m}m"`, 이상은 **소수 km 원값**(`"1.1km"`·`"6.285km"`, 후행 0 없이. 위원장 실사용 판정 2026-08-02로 종전 `"1km 200m"` 나눠쓰기를 대체. ⚠ Swift `String(Double)`은 정수에 `"1.0"`을 남기므로 1,000 배수는 정수 분기). **낭독 정정은 m만**: VO가 소수 포함 km는 정확히 kilometers로 발화하지만 숫자+`m`은 minutes로 오독한다(실기기 확정). iOS 낭독 채널(`distanceText`·통지)은 Kit `spokenDistanceUnits`로 m만 로케일 단어로 풀고(`(\d)m(?![A-Za-z])`, `\b`는 한글 직결에서 불성립), 시각 표기는 불변. ⚠ **어디서도 소수 km를 직접 조립하지 말 것**: 가드가 없던 동안 지역 사본 4곳이 갈렸고 그중 CLI·iOS 도보 요약은 1km 미만 분기를 건너뛰어 **850m를 "0.8km"로** 냈다(표기 불일치보다 나쁜 실제 결함). 3벌 동조와 사본 금지는 `src/lib/__tests__/format-drift.test.ts`(웹↔Swift 표 대조 + 전 소스 스캔)와 `packages/cli/src/__tests__/format-drift.test.ts`(웹↔CLI 실행 대조)가 강제한다. i18n 문구는 단위 없이 `{distance}` 하나만 받는다(로케일별 공백 관례 불필요). **예외는 오차 반경**(비콘 `nearby`의 `±{meters}m`)이다. 거리가 아닌 축이라 태우지 않는다.
- **3-state 불변식 (시각장애인 정합)**: "0대/없음"과 "정보 없음(`unknown`)"과 "조회 실패(throw→502)"를 **절대 뭉개지 않는다**. 도착·진료·공기질·날씨·시설 전반에 적용. 해석 불가한 수치는 숨기고 등급 단어를 정본으로.
- **도착 낭독 정본은 완성 문장 필드**: 서울버스 `arrmsg1`·지하철 `arvlMsg2`("곧 도착"·"전역 출발"). ⚠ `traTime1`/`barvlDt`를 슬롯형으로 환산하면 운행종료에도 비0이라 오발화. 한 도착 항목이 1·2번째 버스를 슬롯 페어(`arrmsg1`·`arrmsg2`)로 주므로 둘 다 투영(슬롯2는 메시지가 다를 때만).
- **역명 매칭은 확장 정규화가 정본**(`station-match.ts`, 2026-07-22): 카카오 역 place_name은 "강동역 5호선" 형태라 괄호 부가명·후행 노선 토큰(`…선`/`…철도`/`GTX-…`)을 벗겨야 seed·wksn·korail·arrival과 매칭된다(미적용 시 역 섹션 전체 死 — 실측 회귀). 노선 토큰은 버리지 않고 `parseStationQuery`의 `lineHint`로 보존(동명이역 양평 5호선 vs 경의중앙선 분리, 숫자 코어는 완전 일치만). 신규 역 데이터 소스는 `normalizeStationName`+`lineHintMatches`를 재사용하고 자체 정규화 금지.
- **음성 전사를 검색어로 쓰기 전 `normalizeVoiceQuery` 필수**(웹 `src/lib/format.ts` ↔ Kit `VoiceQuery.swift` 미러, 2026-07-26): STT가 붙이는 후행 마침표에 juso가 **0건으로 전멸**한다(마지막 토큰을 건물번호로 파싱하기 때문. 실측 "강동구 성내로 12" 15건 → "…12." 0건, 주소는 대부분 숫자로 끝나 주소 검색만 유독 죽는다). 카카오도 4,663→19건 열화. **엔진에서 끄는 길은 막혀 있다**: iOS 온디바이스 `SpeechTranscriber`엔 문장부호 옵션이 없고(`TranscriptionOption`은 `etiquetteReplacements` 하나뿐), Deepgram `punctuate=false`는 같은 STT 라우트를 쓰는 채팅 입력까지 망친다. **신규 음성 검색 소비 지점은 반드시 이 함수를 태운다**(통지 문자열도 정규화본으로. 들은 것과 검색된 것이 어긋나면 SR 사용자는 원인을 알 수 없다). 채팅 소비 지점은 미적용(문장부호가 정보). ⚠ 정규화는 **부호만 남은 전사를 구제하지 못한다** — 다 지우면 빈 문자열이라 "정규화는 파괴가 아니다" 규칙이 원문을 되돌린다(무발화 릴리스 전사 "." 실측 2026-08-01, 그대로 두면 채팅은 "."을 전송하고 검색은 "."으로 조회). *검색어를 다듬는* 정규화와 *소비할지 가르는* 판정은 다른 계층이라 후자는 `hasSpeechContent`(Kit, 글자·숫자 유무)가 맡고 **iOS는 `SpeechService.stop()` 한 곳에서 태워 nil로 돌린다** — 소비 지점 4곳(검색·길찾기·채팅 전송·잠금)에 가드 분산 금지. 내용 없는 전사는 빈 전사와 같은 침묵 경로(새 통지 없음).
- **"내 주변" 거리순 정렬은 코드 책임**(Haversine). 좌표 필터 없는 목록 API(따릉이·소아진료)는 전체 받아 서버 정렬→cap. ⚠ `totalCount`/`list_total_count`는 "그 페이지 row 수"일 수 있어 **신뢰 금지** — 종료조건은 받은 row 수. ⚠ **검색 탭은 거리순이 아니다**: 카카오 키워드는 `x`/`y`만 붙이고 `sort`·radius 미지정 — 정확도순에 근접이 블렌딩된다(실호출 확정 2026-07-20: 맥도날드=근처 지점 상위, 경복궁=15km 밖 본체·부속 최상단). 거리 **표기**는 `searchPlaces` 진입점의 `annotateDistances`(정렬 없는 주석)가 일원 담당 — 클라·provider 재정렬 금지(정확도 축 파괴, 랜드마크 매몰 회귀).
- **캐시**: 실시간(지하철·버스 도착)=`no-store`+`force-dynamic`, 준정적=`revalidate`(역메타 86400·공기질 600·날씨 1800·주소 3600).

### UI·상태 패턴
- **신규 "내 주변" 도메인은 공유 계층으로 만든다**(2026-07-30 중복 추출): 상태 머신 `useNearbyFetch`(요청 ID latest-wins — 닫힌 패널의 늦은 응답 폐기 포함)+렌더 골격 `NearbyPanelShell`+통지 `nearbyLiveMessage`+단계 공개 `useRevealMore`. 골격 복붙 금지 — 계약은 `src/components/__tests__/nearby-contract.tsx` 스위트로 못 박는다(신규 도메인도 이 스위트 적용). 도메인 고유물(항목 렌더·parse·fetch URL)만 컴포넌트에 남긴다.
- **iOS "내 주변" 화면도 공유 상태 머신으로 만든다**(2026-07-31 골격 추출, 위 웹 규칙의 iOS 판): Kit `NearbyLoadCore<Payload>`(좌표 소스 `.current`/`.none`·`coverage` `.korea`/`.none`·`fetch`·`willCommit`·`onEvent` 주입)+`RevealWindow`(더 보기 창)+앱 `nearbyAnnouncer`(이벤트→VO 통지)·`NearbyOverlayDescriptor`(`.list`/`.plain`/`.absentCapable` 팩토리, init 봉인)·`NearbyStateOverlayView`. **`load()` 상태 머신 복붙 금지** — 모델은 core 껍데기(phase 포워딩+load 위임)이고 도메인 고유물(fetch·통지 문구·부가 상태)만 남긴다. 전이표 정본은 스펙 `docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md` §5, 계약은 `NearbyLoadCoreTests`가 못 박는다(신규 도메인도 이 스위트에 케이스 추가). ⚠ 취소는 코어가 2겹(오류형+`Task.isCancelled` 커밋 게이트)으로 흡수해 상태·통지를 억제한다 — 껍데기에서 재구현 금지. descriptor는 `.nearbyStateOverlay { }` 안에서 매 렌더 생성(캐싱하면 언어 전환 고착).
- **현재 위치는 공유 스토어 1곳에서만**(`src/lib/geolocation.ts` 모듈 싱글턴 + `useGeolocation`). 신규 "내 주변"은 `getCurrentPosition` 직접 호출 금지, `awaitGeolocation()` 사용(권한 팝업 세션 1회). **"새로고침"은 `awaitGeolocation({force:true})`**로 정밀 재취득(`PRECISE_OPTS`), ⚠ 실패 시 직전 `done` 데이터 복원(`prevStatus`, 새로고침=재조회이지 데이터 포기 아님).
- ⚠ **이 스토어에는 TTL이 없다 — "지금 어디 있는가"가 답의 일부인 조회는 전부 `{force:true}`다**(2026-08-08 실보행 발견). 한 번 `ready`가 되면 force 없이는 세션 내내 **같은 좌표**가 나오므로, 사용자가 이동한 뒤의 조회는 조용히 옛 자리를 출발지로 삼는다. 오류도 빈 결과도 아니라 그럴듯한 응답이 와서 실패가 보이지 않는다(이탈해서 누른 재조회가 출발점에서 같은 경로를 다시 받아 온 실사고). 판별선은 "이 조회의 답이 사용자 위치에 의존하는가"이지 "새로고침 버튼인가"가 아니다 — 안내 시작·이탈 재조회·ETA 갱신이 전부 여기 해당한다. 그래서 `useRouteGuide`의 `fetchGuideRoute(force)`는 **기본값 없는 필수 인자**다([[no-default-for-safety-parameters]]). 반대로 순위 가중용 근접 블렌딩처럼 정밀도 요구가 낮은 조회는 캐시가 옳다.
- **"내 주변" 10개 섹션은 홈이 아니라 허브 뷰(`NearbyHub`, `?panel=nearby` URL+History 연동)에 있다**(2026-07-30 옴니박스 IA 재편 — 홈은 "길찾기"·"내 주변" 칩 2개로 축소). 허브 안 각 패널은 닫기·Esc·아코디언으로 접는다(`nearby-panel-store.ts` 싱글턴 + `useNearbyPanel`). `claim()`/`close(restoreFocus)`. **포커스 비대칭**: 직접 닫기·Esc는 `restoreFocus=true`(trigger 복귀), 다른 패널이 점유 가져가 자동 닫힐 땐 `false`. ⚠ 채팅 오버레이가 열린 동안은 `engaged:false`로 패널 Esc 비활성(스택된 전역 Esc 경합 — [[stacked-global-esc-listener-conflict]]. 현재 허브 안 채팅 경로 없음 — 재도입 시 적용).
- **iOS 목록 포커스 이동은 "가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도"가 정본**(정본 구현 `SearchView.landFirstRowFocus`·`DirectionsEndpointSearchView.landFirstCandidateFocus`, 선례 `ChatConversationView`). **동기 대입 한 줄은 실패한다** — `List`의 오프스크린 행은 AX 트리에서 컬링되고, 대상이 트리에 없으면 SwiftUI가 대입을 조용히 되돌린다(대상이 화면 밖이면 무이동, 걸치면 엉뚱한 행 착지라 증상이 갈려 원인이 안 보인다). ⚠ **함정 셋**: ①`.accessibilityFocused($binding, equals:)`에 **`Bool` 바인딩을 여러 행에 붙이지 말 것**(나머지 행 전부가 포커스를 주장한다 — **항목 정체성 옵셔널 바인딩**이 정본) ②**`scrollTo` 인자는 포커스 키와 다르다**(포커스는 복합 키, `ForEach` 정체성은 원시 id라 복합 키를 넘기면 가시화가 조용히 실패한다) ③**시뮬레이터로는 검출 불가**(AX 트리는 어느 행이 포커스를 주장하는지 보여 주지 않는다) — 실패 시 가설 패치를 반복하지 말고 `ChatFocusDiag` 로그로 실착지를 확정한다. **"내 주변"·"이 장소 주변"은 공유 계층 `nearbyFocusOnLoad`/`NearbyFocusLander`를 쓴다**(복붙 금지). 그 계층의 계약 셋: **첫 로드에만 착지**(새로고침은 사용자가 그 버튼에 커서를 둔 채 일으키는 행동이다), **`anchor` 미지정**(`.top`을 주면 sticky 섹션 헤더가 네비게이션 바 뒤로 잘린다), **결과 통지 완료를 기다리지 않는다**(`awaitAnnouncementFinish` 부활 금지).
- **화면 배치를 바꾸면 그 자리를 지나가는 포커스 점프를 함께 점검한다**(2026-08-02): 길찾기 조회 완료 시 첫 성공 수단 heading으로 보내던 계약은 그 자체로 옳았는데, 거리 추적 섹션이 조회 버튼과 수단 섹션 **사이**에 생기자 그 점프가 새 섹션을 통째로 건너뛰게 됐다. 지금은 조회 후 포커스를 옮기지 않는다(위원장 판정). 계단 회피 토글 재조회는 예외로 도보 heading 이동을 유지한다(사용자가 그 섹션 안에서 조작했다).
- **실시간 안내 판정 계층은 전부 순수 함수이고 웹·Kit 미러다**(`toneLayerStep`·`motionStep`·`trendStep`·`guideAudioStep`, 공유 fixture가 동조 강제). 톤은 **배타적 계층 순서**(신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축)로 하나만 나고, 정지 판정은 **도플러 3-state**이며, fix 부재는 **타이머 워치독**이 잡는다(fix 경로에만 걸면 권한 철회 시 영구 침묵). 오디오 카테고리 승격은 `didPromote`일 때만 원복한다(세션이 프로세스 전역 자원이라 무조건 원복하면 다른 소비자를 깬다). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §실시간 길 안내** — 이 코드를 수정하기 전에 읽는다.
- **소리를 낸 직후 세션을 끝내면 그 소리가 잘린다 — 순서가 아니라 대기가 답이다**(2026-08-09 실사용 발견). `playTone` 뒤에 `endSession()`을 두는 순서 규칙은 톤의 *시작*만 `.playback` 아래에 두고, 한 줄 뒤의 카테고리 변경은 재생 **도중**에 떨어진다. 백그라운드에서 `.ambient`는 정의상 무음인 데다 오디오 백그라운드 모드의 근거도 함께 사라져, 2.2초짜리 도착 종이 거의 들리지 않은 채 끊긴다(정지 톤 1.3초도 같은 경로였다). 지금은 `BeaconTonePlayer.endSession()`이 재생 잔여 시간만큼 원복을 미룬다. ⚠ **`beginSession()`은 미뤄 둔 원복을 반드시 취소하고**(안 하면 새 세션 한복판에 `.ambient`가 떨어져 그 세션이 통째로 잠금 무음), **`shutdown()`은 취소한 뒤 즉시 원복을 마친다**(안 하면 화면을 떠난 뒤에도 공유 세션이 `.playback`에 남아 무음 스위치를 무시). ⚠ **전경에서는 증상이 없다** — 손에 들고 하는 시험은 이 계열을 통과시킨다.
- **결정 지점 안내는 두 층이고 거리가 다르다**(2026-08-09): 40m `announceSteps`(전문)가 *무엇을* 할지, 10m `imminent`(짧은 명령형 + `ahead` 톤 + 햅틱)가 *지금이다*를 알린다. 문구 선택은 `walkStepAction`(웹 ↔ Kit `WalkAction.swift` 미러, 서버 재작성 문장에 부분 문자열 판정). ⚠ **회전 표지를 건널목보다 먼저 본다** — "횡단보도"는 지명의 일부로 등장하므로("천호역 횡단보도에서 왼쪽으로 돌아…") 순서를 뒤집으면 좌회전 지점에서 "횡단보도를 건너세요"가 나간다. "좌측"·"우측"은 회전이 아니라 어느 쪽 횡단보도인지라 **마커가 아니다**. ⚠ **래치는 스텝 단위다** — 유닛 끝으로 뛰면 묶음의 첫 스텝만 분류돼 묶음 **안**의 회전이 통째로 침묵한다(실측 2건). ⚠ **`imminentUpTo < announcedUpTo`가 발화 조건이고 그래서 전문 낭독보다 앞이다.** ⚠ **이미 지난 경계엔 발화 금지**(하한 없으면 uncertain 뒤 창이 경계를 넘겨 착지한 fix에서 모퉁이를 돈 뒤에 명령이 나간다). ⚠ **행동 없는 경계는 발화만 건너뛰고 래치는 전진.** ⚠ **톤은 임박 층이 있는 프로파일에서만 40m에서 뗀다** — car는 임박 층이 없어 40m가 유일한 소리다(무조건 떼면 자동차 세션 우선 톤이 0이 된다). ⚠ **walk 전용**(`imminentAheadM`, car는 null). ⚠ **햅틱은 백그라운드 미지원**이라 어떤 신호도 진동에만 싣지 않는다. ⚠ **마지막 결정 지점을 최종 접근이 선점하는 한계는 의도적 수용이다** — 미루게 하면 이탈 판정이 마지막 50m까지 연장돼 A6 헛경고율이 2배가 된다(실측). 설계는 spec `2026-08-09-walk-imminent-cue-design.md`.
- **이탈 판정은 축이 둘이고 확정은 OR, 복귀는 활성 축 전체 해제다**(2026-08-09). 수직거리 축에 **방위 축**(`guide-course-axis.ts` ↔ `GuideCourseAxis.swift`)을 더했다 — 경로가 자기 자신과 가까워지는 기하에서 수직거리가 단조롭지 않아 갈림 뒤 82초를 안 가는 길로 안내한 결함이 원인이다. ⚠ **`courseAccuracy`는 통과권이 아니라 불확실성이다** — 어긋남이 그 구간 안에 들어가면 `unknown`이고, 2-state 다수결로 되돌리면 지속 편향 잡음이 오류를 반복 관측으로 승격시킨다. ⚠ **`unknown`은 해제가 아니다**(근거 없이 복귀를 선언하지 않는다). ⚠ **표결·확정은 최종 접근 진입(6a)보다 앞이다** — 뒤로 옮기면 종점 부근에서 단방향 래치가 걸려 확인된 이탈이 영구 소실된다(6a에서 다시 보는 조건은 죽은 코드다, 순서가 곧 불변식). ⚠ **`GuideTuning.courseAxisEnabled`로 walk만 켠다** — 상수를 전부 보행 궤적으로 쟀고 "모퉁이 헛경고를 ±10m 접선 표본이 막는다"는 논거가 차량 속도에서 성립하지 않는다. ⚠ **상수는 전부 잠정값이고 A6은 아직 열려 있다**(`docs/BACKLOG.md`) — 실보행 로그가 정본이며, `AppConfig.realtimeGuidanceEnabled`의 `#if`를 지우기 전에 그 판정을 먼저 확인한다(축에 자기 게이트가 없다). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §이탈 판정 방위 축.**
- **iOS에서 버튼 활성화의 결과를 알리는 통지는 `.high`다**(헌장 §6 정본, 이 repo의 실사고 자리는 `BeaconModel.performReroute`). 그 핸들러가 **자기를 누른 버튼을 사라지게 하면** 포커스가 다른 컨트롤로 옮겨가고 VoiceOver가 그 라벨을 낭독하는데, 기본 우선순위 통지는 거기에 잠식돼 무발화된다. ⚠ **한 함수 안에서 실패만 `.high`이고 성공이 기본값이면 그 비대칭 자체가 결함 신호다** — 실패는 상태가 남아 사용자가 재시도로 확인하지만, 성공은 그 통지가 유일한 증거라 놓치면 "버튼이 동작하지 않는다"가 된다(재조회 실사고의 정확한 기제).
- **현위치 수동 지정: 유효 위치를 소비하는 화면과 표시줄을 함께 옮긴다**(2026-08-09). 사용자가 GPS 대신 자기 위치를 지정하면 그 좌표가 "내 주변"·검색 거리·**채팅 앵커**·길찾기 출발지를 정한다(우선순위 **장소 앵커 > 수동 위치 > GPS**, 실시간 안내만 실좌표). ⚠ **상태 표시줄은 "이 화면의 조회 기준"이라는 약속이다** — 화면에 표시줄을 두면 그 화면의 **모든 데이터 경로**가 같은 기준을 쓰는지 전수 확인해야 한다. 시각 사용자는 결과를 보고 어긋남을 알아채지만 SR 사용자에겐 그 문구가 유일한 정보원이다(실사고: 채팅 탭에 표시줄을 달았는데 `ChatModel`·`useChat`은 GPS를 계속 썼다. 같은 마일스톤이 장소 채팅 시트에서 표시줄을 끈 근거가 정확히 이 오해 방지였는데 탭에서는 그 오해가 실재했다). ⚠ **라벨은 `origin` 유무가 아니라 마지막 판정 결과까지 본다**(`isManualLocationVerified`, 웹↔Kit 미러) — `origin`은 있는데 지금 판정 불가(권한 철회·실내 측위 실패)면 검증 가능형 라벨이 나와 **더 나쁜 상태가 더 안심시키는 역전**이 된다. 판정 결과는 **영속하지 않는다**(며칠 전 판정이 새 세션 라벨을 정하면 안 된다). ⚠ **i18n 금지 표현 게이트는 네임스페이스 내부만 보면 못 잡는다** — `manualLocation` 안만 검사하던 게이트가 `whereAmI.ready`="현재 위치"를 통과시켰다. 금지 표현 축은 **전 네임스페이스 스캔**이어야 한다.
- **값을 특정 경로에서 배제할 때 1선은 구조, 2선은 소스 가드, 브랜드 타입은 3선이다**(2026-08-09 실측으로 순서 정정). 실시간 안내가 수동 좌표를 못 보게 만든 실제 방어선은 **진입점이 좌표를 아예 주입받지 않는 구조**였다(`useRouteGuide(dest, kind, accessible)`에 좌표 인자 없음, `BeaconModel.toggle()`도 origin 없음). ⚠ **브랜드 타입은 함수 바꿔치기를 못 잡는다** — `awaitRealFix`를 `awaitEffectiveLocation`으로 바꿔도 반환형에 `lat`/`lng`가 있어 `fix.lat`이 그대로 컴파일된다. 그 회귀를 잡는 것은 소스 가드다("타입이 정본, 스캔은 보조"는 틀렸다).
- **스크린리더 통지에 뻔한 꼬리 문장을 넣지 않는다**(2026-08-02 전수 정리, 35건 잔여). 판정선은 **"뒷문장이 새 정보를 주는가"**다. 제거: "잠시 후 다시 시도해 주세요"(실패했으면 재시도는 자명)·"목록에서 선택해 주세요"·"다른 검색어로 시도해 보세요"·"실제 경로는 길찾기 앱을 이용하세요"(잉여인 데다 **타 앱 사용 권유로 읽힌다**). 유지: 원인·조건·한계를 알리는 문장("위치 권한을 확인해 주세요"·"다른 앱이 사용 중인지"·출처 주석의 커버리지 한계·"기존 정보를 유지합니다" 3-state 신호). ⚠ **잉여가 항상 뒤에 오는 건 아니다**(`offline.body`는 heading이 이미 상태를 말해 첫 문장이 잉여였다). 패턴 정규식으로 훑지 말고 **여러 문장인 문자열 전부**를 놓고 판정할 것(정규식 스캔이 "이용하세요"를 놓친 실사고).
- **"내 주변" 장소 목록 4종(소아 진료·둘러보기·아이 놀 곳·무장애)은 "더 보기" 단계 공개**: provider `SERVER_CAP=50`, 클라 10건 초기 표시 + 회당 +10, 라벨은 수치 없는 `actions.showMore`. V2 3종 라우트는 **기본 응답 상한 유지 + 옵트인 `limit`(1~50, 범위 밖 400) + 절단 전 `total`** — limit 미지정 소비자(CLI/MCP)의 출력 팽창을 막고 "더 보기"를 구현한 웹·iOS만 `limit=50`을 명시 요청한다(웹 `NEARBY_LIMIT_MAX` ↔ Kit `fetchLimit` 미러). 포커스 계약: 누르면 첫 새 항목으로 이동하고 **별도 live region·통지 금지**(웹은 `useLayoutEffect` 페인트 전 재포커스, iOS는 `scrollTo` 선행 가시화+`AccessibilityFocusState`). **정본은 `NightClinicsNearby.tsx`·`ClinicNearbyView.swift`.** 교통 목록·보행 인프라·랜드마크는 절단 너머가 행동을 바꾸지 않아 의도적 비적용.
- **검색→상세 흐름**: 단일 검색창, 카테고리 칩 필터, 장소 선택 시 **History API 뷰 전환**(카카오는 ID 단건조회 없어 메모리 `Place`로 상세). `?q=` URL 동기화 + request-id ref로 stale 응답 폐기.
- **검색창 3섹션 결정론 병렬**: 장소(`/api/places`)+주소(`/api/address/search`)는 **매 검색 병렬**, 웹 검색은 **둘 다 0건일 때만 폴백**. 섹션 순서는 건수 내림차순(`orderResultSections`), 통지는 단일 polite 합산(`combinedLiveMessage`), 포커스는 전부 settled 후 1회. 비용 방어는 IP 레이트리밋(60초 30회)+쿼리 1h 캐시(실패는 throw로 캐시 회피). ⚠ **부활 금지 3종**: Gemini 자연어 라우터(deterministic 위에 LLM을 얹어 멀쩡한 쿼리를 악화 — [[gildongmu-search-router-removed-llm-antipattern]]), 명소 별도 섹션(정확도순 전환으로 랜드마크가 자연 부상해 중복이 됐다), 장소 결과의 버킷 섹션 그룹핑(고정 서열이 정확도 1위를 최하단 '기타'에 매몰시킨 실측 6사례). 결과는 항상 **정확도순 플랫 리스트**이고 버킷(`category.ts` ↔ Kit `SearchFilters.swift`)은 **칩 필터 축으로만** 쓴다 — **분류는 순위를 결정하지 않으며 'other'는 실패가 아니라 솔직한 잔여 라벨**이다. ⚠ 버킷 정규식은 부분 문자열 오탐 이력('문화'→사진관, '미술'→공예공방)이 있으니 수정 시 실측 카테고리로 검증. 카카오·네이버 중복은 `mergePlaces`가 흡수.
- **딥링크로 네이티브 앱 위임**: 실주행 내비는 `nmap://`(`deeplink.ts`)·`kakaomap://`(`deeplink-kakao.ts`). 자체 구현은 "출발 전 미리 듣기" **텍스트 브리핑만**(자동차·대중교통), 실주행은 위임 유지. **브리핑 진입점은 길찾기 뷰(웹 `DirectionsView`·iOS `DirectionsTab` 3수단 비교)와 채팅 렌더 카드로 일원화**(2026-07-30) — 장소 상세의 단일 수단 브리핑 진입점은 중복이라 제거했고 재도입 금지. 대중교통 대안은 요약 라벨 disclosure(웹 `aria-expanded`·iOS `DisclosureGroup`)로 펼침, 펼침 본문은 `includeSummary=false`로 구간만(라벨이 요약 전문이라 인접 중복 금지, 실기기 VO 합격 2026-07-30). 경로 렌더 카드는 웹 전용, iOS 채팅은 산문이 정본(렌더 3종: places·addresses·webResults, 그 외 타입은 `.unsupported`로 강등).
- **데이터 언어 분리**(`src/lib/data-locale.ts`): 외부 API는 ko/en만 제공 → 비한국어(en/es/fr/it/ja)는 영문 데이터 공유. **외부 fetch·영문 분기에 `useLocale()` 원시값 직접 금지, `dataLocale`/`prefersEnglish` 경유**(예외: STT Deepgram은 es/fr/it/ja 직접 인식). i18n 키 일관성은 `i18n-messages.test.ts`가 머지 게이트. 언어 선택 UI는 disclosure 메뉴(국기 이모지 금지, 각 언어 자국어 텍스트+`lang` 속성).

### 채팅 (Gemini function-calling)
- `src/lib/chat`·`src/lib/gemini`는 **React 비의존**(dodo 이식성). 진입은 두 갈래: **장소 상세의 "이 장소에 관해 물어보기" 오버레이**(`ChatOverlay` 모달, `canShowChat`=`hasGeminiKey()`, 장소마다 새 대화) + **홈 옴니박스의 [AI에게 질문] 범용 진입**(2026-07-30, `SearchBar`의 `onAsk` prop → `place` 없는 `ChatOverlay`, 검색 `?q=`와 분리된 경로라 URL 미기록). ⚠ 과거 메인 페이지 검색⇄채팅 모드 토글은 폐기(`ModeToggle`·`mode-state.ts` 전부 제거).
- **에이전트 루프**(`agent-loop.ts` `runAgentLoop`, maxIterations=6): functionCall→`Promise.allSettled` 병렬→관찰 반복, renders·sources 누적. `/api/chat`은 **NDJSON 스트리밍**(`maxDuration=120`). 도구 throw가 루프 안 죽임, 빈 text는 1회 폴백, 카드는 done에서 1회 마운트(중복 낭독 차단).
- **장소·주소 카드 탭=상세 진입**(`place-open-request` 브릿지, 상세 열림 중엔 같은 히스토리 엔트리 교체): `requestOpenPlace`를 `PlaceSearch`가 구독해 상세를 연다. 다른 카드로 갈아탈 땐 새 `pushState` 대신 `openSeq` 증가로 상세 뷰를 재마운트(뒤로가기 1회로 채팅까지 복귀). 주소 카드는 탭 시 `/api/geocode`로 좌표를 확보한 뒤 여는데, 왕복 중 오버레이가 닫히면(`aliveRef`) 도착 응답을 폐기한다(헌장 §6 ⑨ 이탈 게이트 동형).
- **장소 앵커 불변식**: `placeContext` 있으면 주변 도구는 `anchorOf(ctx)`=장소좌표 기준, 단 **길찾기 출발지는 실제 `userLocation`**(장소로 안 덮음). 장소 앵커 시 기기위치 nearby 카드는 render 생략(산문이 정본). `placeContext` 없으면 동작 byte-identical.
- **⚠ 장소 특징 날조 금지**: 도구가 준 필드만 — Gemini가 카페 분위기·평판을 사전지식으로 날조하면 시각장애 사용자가 검증 불가([[agentic-llm-fabricates-unstated-fields]], systemInstruction에 명시). 도구는 provider 직접 import 호출(`ToolResult{data,render?,source?}`), self-fetch 카드+출처(`SourceList`) 노출, `data`는 LLM에만(PII 누수 차단).
- **마크다운 답변**(`react-markdown`+`remark-gfm`): 헤딩은 강조 단락으로 다운그레이드(아웃라인 오염 방지). ⚠ **loose list `remarkTightLists`로 tight 강제** — `<li><p>` 중첩이 iOS VoiceOver 이중 낭독([[markdown-loose-list-voiceover-double-read]]). 완료 통지는 효과음(`playReceive`)+포커스 이동(진행만 live region).
- **채팅 도구는 20개이고 목록 정본은 코드다**(`src/lib/chat/tools`). 각 도구는 키 게이트를 통과할 때만 declaration에 오른다. ⚠ **카드 없이 산문이 정본인 도구 4종**(문화행사·날씨·혼잡도·보행 인프라)은 렌더 카드를 만들지 않는다. 공기질·날씨 declaration은 긍정 트리거("직접 질문·야외 활동 적합성일 때만")로 과잉 조회를 억제하되, **공기질 호출 시 `get_weather` 동반**을 공기질 쪽에 명시한다 — 날씨 쪽 트리거 문구만으로는 동반이 성립하지 않았다(실측). `get_walk_infrastructure`는 무키라 게이트가 없고 서비스 계층만 호출한다. `get_bus_route`는 V1 제외.
- **iOS 채팅 AI 동의 게이트(App Review 5.1.2(i), 2026-07-21)**: 미동의 시 채팅 탭·장소 sheet가 `ChatConsentView`로 대체되고 `ChatModel.send`도 `AIChatConsent.granted` 가드로 전송을 구조 차단(이중 방어) — 채팅에 새 전송 경로를 추가하면 이 가드를 우회하지 않는지 확인. 철회는 설정 "AI 채팅" 토글. `/api/chat`엔 IP 레이트리밋(60초 10회, `checkChatRateLimit`).
- **개인정보 3자 일치 불변식**: 수집·전송 항목을 바꾸면(새 데이터 유형·새 제3자) 웹 `/{locale}/privacy` 카피 + iOS `PrivacyInfo.xcprivacy` + ASC 영양 라벨(`docs/appstore/1.0-submission-draft.md` §7)을 **동시 갱신** — 불일치는 심사 거절·앱 제거 사유. iOS 받아쓰기는 온디바이스라 오디오는 세 곳 모두 미신고가 정본.

### 통합 카탈로그 (provider · route · 핵심 함정)
세부 구현·검증은 각 spec(`docs/superpowers/specs`) 참조. 새 통합 추가 시 위 횡단 함정·게이트 패턴을 적용.

| 도메인 | provider / route | 핵심 함정·정본 |
|---|---|---|
| 장소 검색 | kakao-local(+naver-local ko 병합) / `/api/places` | **정확도순+좌표 블렌딩**(`buildKakaoSearchUrl` — `x`/`y`만, `sort` 미지정, 2026-07-20 전환). ko는 両키 보유 시 `searchPlacesMergedKo` 병합(카카오 15 primary + 네이버 5 보강 뒤에 이어붙임, 좌표 4자리 dedupe, **재정렬 금지** — 네이버 전용 근처 가게가 하단에 오는 트레이드오프 수용). 거리 표기는 `searchPlaces` 진입점 `annotateDistances` 주석. 카카오 미등록 가게 보강(여의도 "백년찌개집 1971" 실측 2026-07-18). 폴백 kakao>naver>mock. ⚠ 과거 명소 전용 라우트(`/api/places/attractions`)·kakao-attractions provider는 폐지 — 카카오 관광명소 판별이 필요하면 `category_name.startsWith("여행 > 관광,명소")`(AT4 group code 아님, 부속 명소는 빈 문자열) |
| en 장소 | `searchPlacesMergedEn` | 카카오+TourAPI 병렬 병합, 중복=좌표 4자리. 영문주소 juso→NCP 폴백 |
| 주소·우편번호 | juso `searchJusoAddresses` / `/api/address/search` | 좌표는 카카오 `/api/geocode` 재사용. `engAddr`는 국가명 미포함 |
| 역지오코딩(현위치 주소) | kakao-address `coordToAddress`+ncp-geocode `reverseRoadAddress` / `/api/geocode/reverse` | "현재 위치" 라벨 병기용 경량 라우트. **도로명 보장 3단 체인**: 카카오 road → (null이면) NCP 최근접 도로명 → 지번(정직 최후 폴백). ⚠ 카카오 coord2address는 도로명 건물 미매핑 좌표(공터·블록 내부, GPS 빈발)에서 road_address null(실측 2026-07-22) — 지번 우선 회귀 금지 |
| 코레일 역시설 | korail-facilities / `/api/station/facilities` | 406역 전체 받아 `normalizeStationName` 클라 매칭, `stn_cd` 조인 |
| 서울 지하철역 시설 | seoul-metro-facilities (9 op)+voice-guides seed+seoul-elevator / `/api/station/metro-facilities` | 도시철도 보완, `stnNm` 포함필터→정확매칭 제외, `totalCount>300` throw. **보강 그룹 2종**(2026-07-22): 음성유도기 정적 seed(OA-22526 CSV cp949, `build-voice-guides.py`, 1~8호선 211역)+엘리베이터 위치 폴백(OA-21212 `tbTraficElvtr`, **wksn 엘베 부재 시만** — 9호선·우이신설 커버, 최근접 seed 좌표 기준 방위·거리 ko 합성). 보강 실패는 `supplementFailed`로 표기(groups 전멸 시에도 보존 — 실패 은폐 금지) |
| 역 첫차·막차 (전국) | tago-subway (SubwayInfo 15098554) / `/api/station/timetable` | ⚠ depTime HHMMSS·**00시대 심야열차가 배열 앞**(첫차·막차는 03:00 경계 +24h 서비스데이 보정, 요일 타입도 KST-3h 기준)·당역종착(`endSubwayStationId==자기`) 제외·keyword는 포함검색이라 정확매칭 코드 책임·item 1건은 객체. 노선명 축약("수인분당")은 `선` 접미 규칙(매핑 테이블 금지). 공휴일 보정은 특일정보(15012690) 게이트형(미신청·실패 시 요일 폴백+기준 라벨 명시). 레이트리밋 60초 10회 |
| 도시철도역 메타 | subway-stations (정적 seed) / `/api/station/meta` | XLSX→JSON 연1회 갱신(`scripts/build-subway-stations.py`), 서버 전용 import |
| 서울 지하철 실시간 | seoul-subway-arrival / `…/subway-arrival[/nearby]` | `arvlMsg2` 정본, 역명 기반(seed `findStationsNear`로 근접역), 부분실패 보존. ⚠ **`INFO-200`은 "운행 시간 밖"과 "실시간 미제공 역"이 공유하는 코드다** — 미커버로만 읽고 역을 숨기면 심야에 근접역이 전부 사라져 "주변에 지하철역이 없습니다"로 낭독된다. **역은 어떤 상태에서도 목록에서 빼지 않고 4-state**(`ok`/`unavailable`/`closed`+`firstTime`/`unknown`)로 가른다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §서울 지하철 실시간** — 이 코드를 수정하기 전에 읽는다.
| 시내버스 | tago-bus + seoul-bus → `src/lib/bus.ts` 병합 | 지방=TAGO·서울=TOPIS, `mergeBusStops` allSettled, envelope 다름(위 참조). ⚠ **TAGO 근접 조회는 ~700m 고정 반경이라 0건 대부분이 미커버가 아니라 정상적인 반경 밖**이다. 미커버 판정 정본은 `isUncoveredBusRegion`(라우트·채팅 공용, provider 직접 호출 금지)이고 **이 마커만 upstream 뒤에 온다**. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §시내버스** — 이 코드를 수정하기 전에 읽는다.
| 따릉이 | seoul-bike / `/api/bike/nearby` | 전체 페이지루프+서버 Haversine, row 수<1000이 종료조건 |
| 실시간 혼잡도 | seoul-congestion + `congestion-area.ts`(순수 판정) → `congestion.ts` / `/api/congestion/nearby` | 서울 `citydata_ppltn`, seed 116영역. ⚠ **중심-반경 원 금지** — 판정은 최근접 구성 지점 ≤300m, 중첩 시 중심 최근접 1개. 봉투가 3형째라 공용 파서 스코프 밖. 캐시는 좌표가 아니라 **영역 코드** 단위 5분이고 `area:null`은 오류가 아니다(서울의 91%). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §실시간 혼잡도** — 이 코드를 수정하기 전에 읽는다.
| 문화행사 | seoul-culture-events → `culture-events.ts` / `/api/events/nearby` | 서울 `culturalEventInfo`(OA-15486). ⚠ **`DATE` 파라미터 금지** — "그날 열리는 행사"가 아니라 DATE **문자열 부분일치**라 7월 시작·9월 종료 행사가 8월 조회에서 탈락한다. 진행 판정은 `STRTDATE`/`END_DATE`로 코드가. ⚠ **안전한 페이지 절단선 없음**(시작일 내림차순이라 진행 중 행사가 183~18,587행에 흩어짐, 상위 2,000행이면 91%만) → 전수 20페이지 수집을 **일자 키 `unstable_cache`**(6h)로 감싼다. 캐시 대상은 좌표 무관 "오늘 진행 중" 슬림 투영 — 거리·반경(3km)·정렬·캡은 캐시 **바깥** service가. 정상 코드는 `INFO-000`+**`INFO-200`(범위 밖 페이지=끝 신호, throw 금지)**, 봉투 정책은 한 함수에만 |
| 소아 야간진료 | night-clinic NMC / `/api/clinic/nearby` | 좌표 보유는 `getBabyListInfoInqire`(15001674은 좌표 없음), 진료 3-state(KST). 정본은 **달빛 지정 명부(20km)+일반 소아청소년과 보완 소스(`QD=D002`·3km) 병합**(`src/lib/clinics.ts`, 2026-07-26 — 명부 단독이던 시절의 미지정 소아과 부재 회귀와 동명이원 함정은 spec `2026-07-26-clinic-coverage-expansion-design.md`). 진입점 `findNightClinicsNow`(라우트·채팅 공용)가 **진료중 우선 정렬**(`prioritizeOpen`: open>unknown>closed, 안정 정렬로 거리순 보존) 후 서버 캡 50 — ⚠ 거리순으로만 자르면 문 연 곳이 닫힌 곳에 밀려 절단된다. 표시 절단은 클라이언트 "더 보기" 몫(아래 UI 패턴), 절단 전 수는 `total`로 노출(침묵 금지). 공휴일은 `fetchIsHoliday`(특일정보) 재사용해 dutyTime8 판정, 실패 시 요일 폴백+`basis` 라벨 명시 |
| 공기질·날씨 | air-quality + weather → `LocalConditions` | 단일 region, 두 fetch 독립(allSettled), 좌표계 TM/격자(위 참조) |
| 아이 놀 곳 | kids-places / `/api/places/kids` | 카카오 키워드→`category_name` 화이트리스트(키워드 매칭≠키즈), 실내/외 3-state |
| 둘러보기 | surroundings / `/api/places/around` | 카카오 카테고리(10종)+8방위(`bearing.ts`), ⚠ heading 없어 정면-상대 방향 금지 |
| 보행 인프라 | audio-signals(정적 seed)+overpass → `walk-infra.ts` / `/api/walk/nearby` | 음향신호기 정본은 서울 열린데이터 **OA-15543**(EPSG:5186 — 5181·2097과 다름, `scripts/build-audio-signals.mjs` golden 가드). ⚠ Overpass는 200+`remark`=부분응답 throw·User-Agent 필수, 질의는 타일 anchor 좌표(정밀 좌표 외부 전송 금지)+400m 고정, 거리·방위는 서비스가 실좌표 재계산. 상태는 discriminated union(ok/unsupported/error — null 중복 의미 금지), count류는 ok 안에만. 라우트·채팅 모두 `getWalkInfrastructure()`만 호출(provider 직접 금지) |
| 현재 위치 정위 | where-am-i / `/api/where-am-i` | 4조각 allSettled 조립, 산문은 결정론 템플릿(LLM 아님), `stripRegionPrefix` 중복제거 |
| 무장애 여행 정보 | tour-barrier-free / `/api/places/barrier-free[/detail/match]` | 한국관광공사 KorWithService2(B551011). 편의시설 화이트리스트 라벨링(⚠ 필드 철자는 실호출 확정), 장소상세 매칭 좌표50m∩이름(코드 거리 가드 병행). **게이트·인증 모두 `DATA_GO_KR_API_KEY`로 일치**(split-brain 금지). ⚠ 활용신청 별도(API별 독립 승인) |
| 자동차 경로 | **tmap-car(기본)+kakao-navi(폴백)** → `car-route.ts`(ko) / `ncp-directions`(en) / `/api/route/car` | **ko 기본 Tmap**(2026-07-30 위원장 판정 — Tmap `description`은 도로명 포함 완성 문장, 카카오 `guidance`는 도로명 없는 조각). guide별 수치 0은 **미제공 의미론**이라 소비자는 >0일 때만 병기한다. 게이트 `hasCarRouteKey`(=tmap∥kakao). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §자동차 경로** — 이 코드를 수정하기 전에 읽는다.
| 도보 경로 | **kakao-walk(기본)+tmap-pedestrian(폴백)** → `walk-route.ts` / `/api/route/walk` | ⚠ **경로는 목적지까지 가지 않는다** — provider는 가장 가까운 보행로 지점에서 끝내고 그 종점→목적지 오프셋이 실측 16~89m다. 그 구간이 곧 "마지막 몇 미터"이고 `finalApproach` 필드가 담는다(라우트 핸들러가 **요청 원좌표로** 계산 — provider 캐시는 `roundCoord(…,4)`로 목적지를 뭉친다). **낭독 문장은 서버 `rewriteWalkGuidance`(`src/lib/walk-guidance.ts`)가 만든다 — 소비자 재조합 금지**(2026-08-07 위원장 판정으로 종전 "provider 원문 정본"을 뒤집음). 라우트·채팅은 `getWalkRoute`만 호출(provider 직접 금지). 게이트 `hasWalkRouteKey()`(=kakao∥tmap, hasTmapKey 단독 금지). 계단 회피 `accessible=true` → `stepFree` union. **V1 ko 전용.** ⚠ 재작성 정규식·음향신호기 병합 게이트·파이프라인 순서(재작성 → 주석)·계단 회피 통지 계약은 어기면 조용한 실패다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §도보 경로** — 이 코드를 수정하기 전에 읽는다.
| 대중교통 | odsay + odsay-select + bus-service-hours / `/api/route/transit` | **파이프라인 순서가 계약이다: 정규화(전체) → 강등(전체) → 선정(5) → 축 라벨.** 순서를 바꾸면 운행 중인 유일한 경로가 목록 밖에 묻히거나 사라진 기준의 라벨이 붙는다. ⚠ **error 봉투가 2형**(객체·배열)이고 무효 키도 HTTP 200이라 `odsay-envelope.ts`를 거친다. ⚠ **ODsay는 출발 시각을 반영하지 않아** 운행시간을 조인해 강등한다. ⚠ iOS `routeKey` 필수 디코딩 — **웹 배포가 앱보다 먼저**. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §대중교통** — 이 코드를 수정하기 전에 읽는다.
| 지하철 빠른하차 | subway-quick-exit(정적 seed) → `quick-exit.ts` / 별도 라우트 없음(`TransitLeg.quickExit`) | 서울교통공사 1~8호선 하차역·방향별 계단·엘리베이터 최근접 칸·문. ⚠ **거리는 열차 선형 위치**(`(칸−1)×4+문`)로 재고 **엘베×계단 쌍**을 최적화한다. 방향은 직전역 배제 **+ 방면 1개 확정**일 때만 채택(분기역·급행·표기 불일치는 null). `includeStops`와 무관하게 항상 계산한다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §지하철 빠른하차** — 이 코드를 수정하기 전에 읽는다.
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
| `GEMINI_API_KEY` | `hasGeminiKey` | 채팅 FC 엔진(`GEMINI_MODEL=gemini-3.6-flash`, 2026-07-31 교체, 실측 근거 PROGRESS). **길동무 전용 GCP 프로젝트 `gildongmu-prod`**(2026-07-31 신설, 결제 연결·`generativelanguage.googleapis.com`만 허용하는 API 제한 키). ⚠ **dodo와 공유하지 않는다** — 종전 공유 프로젝트는 Converters의 TTS·이미지와 dodo가 섞여 사용량·비용 귀속이 불가능했고, dodo도 같은 모델을 써서 model 라벨 분리조차 성립하지 않았다. 키 교체 시 로컬·Vercel prod·리포트 상수 3곳 동조 |
| `PERPLEXITY_API_KEY` | `hasPerplexityKey` | 검색창 웹섹션 + 채팅 `search_web`. 유료($5/1,000req). dodo 공유 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | `hasNaverLocalKeys` | 네이버 지역검색(ko 장소 병합 보강). 2026-07-18 발급(수동 — Claude in Chrome이 naver 도메인 차단). 일 25,000회, 결과 최대 5건. ⚠ 2027-06-30 NAVER API Hub(NCP 키) 이관 데드라인(PROGRESS) |
| `TMAP_APP_KEY` | `hasTmapKey`(도보 노출 게이트는 `hasWalkRouteKey`, 자동차 노출 게이트는 `hasCarRouteKey`) | SK open API 앱 `gildongmu`(2026-07-21 발급, T아이디). **보행자 폴백 + 자동차 기본**(2026-07-29 도보 카카오 기본 전환·2026-07-30 자동차 ko 기본 Tmap 전환)으로 확장, POI도 동일 키 커버. 일 1,000건 무료를 도보 폴백·자동차 기본이 공유, IPS "Any IP allowed" 유지(IP 제한 금지 — Vercel 가변 egress) |

상세 키 발급 경로·실호출 검증 이력은 `PROGRESS.md`, API 생태계 조사는 `docs/research/RESEARCH-2026-06-*.md`.

⚠ **prod 채팅/STT가 502면 코드보다 키 등록 유효성을 먼저 의심**([[vercel-env-add-noninteractive-bug]]·[[deepgram-prod-key-401]]). 검증은 `env pull` 길이가 아니라 실호출로([[vercel-prod-env-pull-redacts-encrypted]]).

## 배포

- **대외 정본 도메인**: https://gildongmu.dodoplanet.space (2026-07-27 확정, DNS는 Cloudflare 와일드카드 CNAME — 상세는 PROGRESS). Vercel 프로젝트 URL https://gildongmu.vercel.app 도 유효(팀 `hunyong-kims-projects`). GitHub `Engccer/gildongmu` 연결 — **push하면 자동 배포**. ⚠ ODsay Referer는 URI 키 묶임이라 `gildongmu.vercel.app` 유지(교체하려면 ODsay 콘솔에 새 도메인 URI 등록 선행).
- **env 변경 후 반드시 재배포**(키는 배포 시점 함수 주입). 수동 배포 `vercel deploy --prod --yes`.
- 비대화형 등록 `printf '%s' "$VALUE" | vercel env add <KEY> production`(`vercel@latest` 사용 — 구버전 빈값 버그 [[vercel-env-add-noninteractive-bug]]). Preview는 `git_branch_required` 결함이라 REST API/대시보드.
- ⚠ **배포 직후 React #418(hydration) transient**는 스테일 SW 캐시 탓, 코드 결함 아님([[pwa-stale-sw-deploy-hydration-418]]) — dev 클린·캐시제거 먼저 확인. PWA는 수제 서비스워커(`public/sw.js`, Serwist가 Next 16 Turbopack 미지원이라 폴백), document network-first·`/api/` 비캐시.

### iOS 실험 기능은 빌드 구성이 가른다 (2026-08-04 신설)

검증 전 기능을 릴리스에서 빼는 방법은 **플래그 값을 손으로 고치는 것이 아니라 빌드 구성을 고르는 것**이다. 구성은 셋: `Debug`(개발) · `Release`(App Store, 실험 제외) · `Experimental`(실기기 실험판, 실험 포함).

- **`Experimental`이 한꺼번에 정하는 것**: `EXPERIMENTAL` 컴파일 조건 · 번들 ID `space.dodoplanet.gildongmu.dev` · 표시 이름 `…실험` · 아이콘 `AppIconExperimental` · 위치 권한 문구(거리 추적 절 포함). 번들 ID가 달라 **공식판과 한 기기에 공존**한다(설정·동의는 앱별로 분리).
- **실기기 배포**: `CONFIGURATION=Experimental ./ios/deploy-device.sh`. 환경변수 미지정이면 `Debug`(기존 동작). ⚠ `deploy-device.sh`는 **세 repo 공통본**이라 구성 이름을 스크립트에 박지 않는다.
- **코드 게이트**: `AppConfig.realtimeGuidanceEnabled`가 `#if EXPERIMENTAL`로 갈린다. 실험 기능을 새로 넣을 때도 같은 자리에 플래그를 두고, **기능이 검증되면 `#if`를 지운다(플래그 졸업)** — 안 지우면 플래그가 쌓인다.
- ⚠ **`INFOPLIST_KEY_*` 빌드 설정만으로는 구성별 분기가 안 된다.** `InfoPlist.xcstrings`의 로컬라이제이션이 그 값을 **이긴다**(실측). 그래서 표시 이름·권한 문구는 빌드 페이즈 `ios/scripts/experimental-infoplist.sh`가 컴파일된 `*.lproj/InfoPlist.strings`를 후처리한다. 그 스크립트는 대상 파일이 0개면 실패한다(경로 상수가 바뀌어도 공식판 값이 그대로 나가는 것을 막는다). **구성별로 달라야 하는 Info.plist 값은 종류로 경로를 가른다**(2026-08-06 정정 — 종전 "스크립트에도 넣는다" 지침은 로컬라이즈 문자열에만 참): 로컬라이즈 문자열(표시 이름·권한 문구)은 그 스크립트, **비로컬라이즈 키(`UIBackgroundModes` 등)는 `Support/Info-Experimental.plist`**(Experimental의 `INFOPLIST_FILE` 분기, `Support/Info.plist`와 수동 동기화). 비로컬라이즈 키는 스크립트 후처리로 못 넣는다 — `ProcessInfoPlistFile`이 스크립트 **뒤에** 매 빌드 실행돼 덮어쓰고, `INFOPLIST_KEY_UIBackgroundModes` 같은 설정은 존재하지 않아 조용히 무시된다(둘 다 산출물 실측).
- ⚠ **아이콘 표식은 시각 구분이라 그것만으로 부족하다.** 스크린 리더 사용자에겐 **표시 이름이 유일한 구분 수단**이므로 이름 접미사를 반드시 유지한다.
- ⚠ **번들 ID가 다르면 UserDefaults도 새로 시작한다.** 그래서 실험판 첫 실행은 언어 미선택 상태이고, 기기 시스템 언어가 영어면 `dataLocale`이 `en`이 되어 **ko 전용 게이트(수단별 실시간 안내·도보 경로)가 통째로 막힌다** — 검증하려고 깐 기능이 안 보인다(2026-08-04 실측). `AppLanguage.current`가 `#if EXPERIMENTAL`에서 **미선택 폴백만 ko로 고정**해 막았다(사용자 선택은 여전히 1순위). AI 동의·받아쓰기 설정도 같은 이유로 실험판에서 다시 물어본다(정상).
- ⚠ **pbxproj 객체 ID는 파일 전체에서 유일해야 한다.** 기존 ID를 재사용하면 그 객체를 덮어써 프로젝트가 열리지 않는다(`B30001`을 재사용해 `Project object`를 가린 실사고). **`plutil -lint`는 이것을 못 잡는다**(plist 문법은 유효하다) — 편집 후 검증은 `xcodebuild -list`로.

### CLI/MCP 릴리스 (`packages/cli`=npm `gildongmu`, `packages/mcp`=npm `gildongmu-mcp`)

- 발행은 `cli-v*` 태그 push → `.github/workflows/cli-publish.yml`이 두 패키지를 npm Trusted Publishing(OIDC)으로 자동 발행. 토큰·환경변수 불필요.
- 릴리스 절차: **버전 4곳 + CHANGELOG 2곳 동조 갱신**(두 `packages/*/package.json` + 두 `src/index.ts` 선언 — CLI는 citty `meta.version`, MCP는 `McpServer` version — + 두 `packages/*/CHANGELOG.md`에 그 버전 항목) → 커밋 → `git tag cli-v<버전> && git push origin main --tags`. ⚠ index.ts 버전은 하드코딩이라 package.json만 올리면 **발행본이 옛 버전을 보고한다**(0.6.0 tarball이 `--version`·MCP `serverInfo.version` 모두 0.5.0을 출력한 실사고 2026-07-31). `version-drift.test.ts`가 두 패키지에서 셋 다 강제한다(버전 일치·CHANGELOG 항목 존재·`files` 포함).
- ⚠ **CHANGELOG는 `files`에 적어야 tarball에 들어간다.** npm이 무조건 포함하는 것은 `package.json`·README·LICENSE뿐이고 CHANGELOG는 그 목록에 없다(2026-08-08 `npm pack --dry-run` 실측). npm 페이지에서 사용자가 보는 유일한 변경 이력이라 빠지면 곧 정보 부재다.
- ⚠ `--provenance` 금지(private repo, 404로 위장된 422, dodo Round 119 실측). 카탈로그(`endpoint-catalog-shared.ts`) 수정 시 cli·mcp 両미러 동일 유지(drift 테스트가 byte 해시로 강제).
- **카탈로그에 항목을 더하면 `FORMATTERS`(cli `lib/formatters.ts`)에도 등록한다.** 빠뜨리면 `runEndpoint`가 조용히 `JSON.stringify` 폴백으로 떨어져 **text 모드에서만** 통짜 JSON이 나온다 — 파이프로 돌린 실호출 검증은 비-TTY라 JSON 모드가 정상이므로 이것을 못 잡는다(2026-08-01 실사고). `formatter-coverage.test.ts`가 강제하고, 폴백이 맞는 항목은 그 파일의 예외 목록에 근거와 함께 적는다.

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)

node scripts/usage-report.mjs   # API 과금·쿼터·키 만료 상태 (로컬 전용, 13프로브 무과금)
```

**"API 비용·쿼터·키가 살아 있나"는 `usage-report.mjs`가 정본이다** — Vercel 대시보드나 각 벤더 콘솔을 손으로 훑지 말 것. 돈·가용성·시한·걱정불필요 4섹션을 평문으로 내고, 200에 오류를 담는 벤더 4종(ODsay·서울지하철·따릉이·juso)까지 judge로 가른다(설계 근거는 spec `2026-07-31-usage-cost-report-design.md`). ⚠ 이 스크립트가 답하지 **못하는** 것은 **호출량**이다(Vercel Hobby는 런타임 로그 보존 1시간·Observability 조회 12시간이 상한). 호출 건수·라우트 분포가 필요하면 Vercel Observability의 External APIs·Functions를 본다.

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반. Vitest 전역은 node-env지만 **컴포넌트 테스트는 파일 상단 `// @vitest-environment jsdom` 프라그마 + @testing-library/react 레인이 관례**(`PlaceDetail.test.tsx`·nearby 계약 스위트가 선례). 순수 로직은 node-env fixture 단위테스트, 외부 API 통합은 **실호출이 머지 게이트**.
- **외부 API 통합은 실호출(실데이터)을 머지 게이트로 박는다** — fixture green ≠ 실계약 검증(데이터 커버리지 현실은 정적 리뷰가 못 잡음).
- 커밋 이메일 `engccer@gmail.com`. 주석·커밋·문서 한국어, 변수/함수명 영어.
- a11y 변경 후 `a11y-auditor` 서브에이전트 점검.
- **신규 국내 서비스는 대장과 작업 큐가 다른 문서다**: `docs/SPEC.md` §3 "실험 백로그"는 **조사한 서비스의 대장**(존재하는가·쓸 만한가)이고, `docs/BACKLOG.md` E는 **착수 후보 큐**(다음에 뭘 할까)다. 발굴하면 SPEC에 등록하고, 착수를 결정하면 BACKLOG로 올린다. 둘은 중복이 아니라 파이프라인이다.
- **마일스톤을 닫을 때 문서를 분배한다**(위 §문서 체계): 서사 → `CHANGELOG.md`, 남은 판정 → `docs/BACKLOG.md`, 새 함정 → `CLAUDE.md`, 상태 한 줄 → `PROGRESS.md`. iOS 릴리스는 `docs/appstore/release-notes.md`에 What's New를 함께 남긴다(ASC에 입력한 문구 그대로가 정본).
- gildongmu는 리뷰 게이트 통과 후 묻지 말고 commit+push(자동배포 포함, [[gildongmu-auto-commit-push]]). `git add -A` 금지, 의도 파일만([[commit-stage-explicit-files]]).
