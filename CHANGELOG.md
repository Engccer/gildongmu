# CHANGELOG — 길동무 (gildongmu)

날짜별 변경 이력. **"언제 무엇이 바뀌었나"만** 담는다.

- 설계 근거·검증 상세는 각 항목의 `docs/superpowers/specs`·`plans` 링크가 정본이다.
- 항구 규칙·패턴·함정은 `CLAUDE.md`가 정본이다 — 여기에 다시 적지 않는다.
- 지금 무엇이 동작하고 무엇이 열려 있는지는 `PROGRESS.md`, 열린 백로그는 `docs/BACKLOG.md`.
- npm 패키지 릴리스 노트는 `packages/cli/CHANGELOG.md`·`packages/mcp/CHANGELOG.md`, App Store 릴리스 노트는 `docs/appstore/release-notes.md`.

---

## 2026-08-27

### BACKLOG W1 신설 — WebMCP 도구층 (최우선, 2026-09-04 외부 시한)

- 웹앱 기능을 브라우저 에이전트에게 도구로 선언하는 축(`document.modelContext.registerTool`)을 착수 항목으로 등재. 상세·게이트 순서는 `docs/BACKLOG.md` W1이 정본이다.
- 실측 기록(프로덕션 실호출 2026-08-27, 도구 출력 권장 상한 1.5K자 대비): `/api/route/transit` 3,706자(`recommended`만이면 551자, `alternatives` 4건이 3,475자) · `/api/nearby/overview` 1,641자 · `/api/station/subway-arrival/nearby` 703자 · `/api/walk/nearby` 496자. 경로 도구는 응답에 이미 있는 `routeKey`를 손잡이로 분할한다.
- 위험 2건 등재: ChatGPT 내장 브라우저 × VoiceOver 미검증(착수 게이트 0) · Tmap 단일 키를 dodo-planet과 공유하는데 `lang="en"`이 Tmap 단독이라 비한국어 도보 조회가 전량 소모.
- `.gitignore`: 착수 판정용 내부 조사 메모를 repo 밖(`~/gildongmu-private/research/`) 보관으로 분리. 실기기 계측 로그와 같은 취급이다.
- `docs/research/README.md` 목록에 누락돼 있던 `RESEARCH-2026-08-23-express-stop-data.md` 행 보충.

---

## 2026-08-26

### 실사용 피드백 2건 — 임박 큐 3단계 + 잊힌 도보 세션 안전망 (카카오톡 260826)

- spec `docs/superpowers/specs/2026-08-26-imminent-triple-cue-and-session-idle-design.md`.
- **임박 큐 3단계**: 결정 지점 20m 큐 뒤 15m·10m(투영 좌표 = 실위치 5m·0m + lag)에서 같은 톤·햅틱을 두 번 더 낸다. `IMMINENT_REPEAT_M`·`GuideTuning.imminentRepeatM`(car는 빈 배열로 종전 동일)·상태 `imminentStage`·이벤트 `stage`. 문장은 첫 단계만(소비자 `stage > 0` 침묵), 반복 단계는 `lastAnnouncedAt` 미갱신. 공유 fixture +4, 하네스 `stage` 축, 조합 불변식(강한 내림차순·마지막 ≥ lag).
- **잊힌 세션 안전망**: 도착 추정이 최종 접근 국면 밖 세션(GPS 두절·이탈·간략 강등·150m 밖 실내 진입)을 못 끝내던 공백. 국면 무관 `sessionIdleStep`(Kit `SessionIdle.swift` ↔ 웹 `session-idle.ts`, fixture 공유): usable fix 두절 10분 또는 앵커 25m 이동 없음 20분이면 도보 세션을 사용자 중지 모양으로 종료(`guide.endedIdle` 6로케일, 정지 톤 전경만, `.high` 통지). 배선은 `BeaconModel` 워치독. 자동차·대중교통 제외.
- doc-audit: `docs/INTEGRATIONS.md`의 삭제된 `SERVICE_RANK` 백틱 참조를 평문으로.

## 2026-08-25

### A20·A21 — 환승역 빠른하차 정본화 + 대중교통 정렬에서 `unknown` 제외 (김찬홍 선생님 리포트 착수)

- **A20** spec `docs/superpowers/specs/2026-08-25-subway-transfer-door-design.md`: 환승 leg는 ODsay `subPath.door`를 `quickExit.transfer`로 싣고("사당 하차, 빠른 환승 5-2 문"), 서교공 seed 엘리베이터·계단은 최종 하차 leg에만 남긴다. 역내 환승인데 `door`가 없으면 침묵, `"null"` 문자열은 긍정 정규식 매칭으로 차단. 웹·Kit·CLI 3벌 문장 + `route.transit.quickExitTransfer` 6로케일. 실호출 게이트 `scripts/verify-odsay-transfer-door.mjs`(사당 `5-2`·구로디지털단지 seed `7-4`/`8-3`·`"null"` 0건). E5 spec §6의 "환승 구간 별도 처리 불요" 철회.
- **A21** spec `docs/superpowers/specs/2026-08-25-transit-unknown-not-demoted-design.md`: 강등 정렬 키를 `outside` 유무 하나로(`SERVICE_RANK` 삭제, `isOutside` 술어를 강등·축 제외가 공유). TAGO가 노선째 0행인 4호선 경로가 `running` 버스 뒤로 밀려 선정 5개 절단에서 사라지던 결함. 표기 정책(outside만) 불변. `verify-korea-subway-timetable.mjs`에 노원역 관측(4호선 unknown·7호선 ok) 추가. ⚠ 심야 게이트 PASS는 판별력이 없어 주간 재관측이 BACKLOG A22에 남았다.

### 실사용 피드백 접수 — 지하철 환승 빠른하차 (김찬홍 선생님)

- 노원→구로디지털훈련센터 리포트를 실호출로 판정해 BACKLOG에 등록: **A20**(환승역 빠른하차가 환승 통로가 아닌 계단을 고름 — 사당 `1-1` vs 정답 `5-2`, ODsay `subPath.door` 미사용) · **A21**(4호선 TAGO 시간표 0행 → `unknown` 정렬 강등 × 5개 절단 = ODsay 1순위 경로 제외) · **E25**(ODsay 출구 번호·지하철 최단시간 경로 보강 후보). 코드 변경 없음, 착수는 별도 세션.

### 모델 A/B 하네스 날조 축 자동 판정 (병렬 세션 B `grounding`)

- **`src/__ab__/grounding.ts` 신설**: 도구 출력 대비 답변 엔티티 대조(GroundEval 방식, 결정론·LLM 호출 0) + 09 장소 앵커의 매장 속성 어휘 강등 + `pass^k` + 언어 불변 인자 검사. 도구 출력은 프로덕션 루프 무수정으로 다음 라운드 요청의 `functionResponse`에서 읽는다. 머지 게이트 `grounding.test.ts`: 2026-08-14 3.7-flash 날조 5건 + 08-25 스모크 2건 자동 검출, 3.6 정직 응답 8건 + 합성 정직 문장 4건 오탐 0. 어휘 강등은 **단정 어형만 + 부정 술어 문장 면제**(스모크·리뷰가 잡은 오탐 기제: "좌석 정보는 제공되지 않아"). 변이 주입: 어휘 0개면 엔티티 대조 단독으로 7건 중 4건(5호선·시각·주소), 어휘를 얹어 7/7. 케이스 정본은 `cases.ts`(하네스·게이트 테스트가 같은 객체를 import — 복사본 드리프트 차단).
- **케이스 스키마를 스킬 `llm-model-eval` 공통 계약으로**(`grounding`·`safety`·`langInvariantArgs`·`cluster`·`diagnostic`, gildongmu 확장 `grounding.forbidLexicon`). 결과 JSON은 `run{gitSha,measuredAt,interleaved}`·`checks` 계약, `report.ts`가 6항 리포트(뒤집힌 케이스가 집계 위)를 `.md`로 함께 낸다. `npm run eval:ab`(=`test:ab`)·`eval:ab:report`. 잔여 수동 judge 21건은 BACKLOG C5.

- **npm `gildongmu`·`gildongmu-mcp` 0.9.0 발행** — 0.8.0(08-02) 이후 쌓인 `nearby overview`·경유지 `via`·빠른하차·도보 구간 거리·시간표 `coverage`·거리 원값 표기·국경 폴리곤 판정. 노트 정본은 `packages/*/CHANGELOG.md`.
- **BACKLOG D26 종결**: `cli-publish.yml`에 `--provenance` 복원, 실발행에서 両패키지에 SLSA v1 증명 부착 확인(공개 repo + Trusted Publishing). CLAUDE.md의 금지 문구를 조건부로 정정.

## 2026-08-24

### App Store 1.12 빌드 20 제출

1.11 아카이브(`f312a39`) 이후 `ios/` 39커밋을 재판정해 What's New를 다시 썼다(정본 `docs/appstore/release-notes.md` §1.12). 빌드 19(`c56752c`)는 1.11 심사 중 409로 제출하지 못한 채 17커밋이 더 들어와 폐기하고, `37b99db`를 worktree 격리로 아카이브·업로드했다(산출물 검사 통과). en 노트는 E16 축3으로 열린 도보 상세 경로·실시간 도보 안내를 "새로운 기능"으로 묶었고, 심사 노트의 "Walking guidance is available in Korean only"를 전 언어 제공으로 고쳤다(`--review-notes`, ASC 실값 대조 차이 0). `asc-submit --apply`가 프로모션 텍스트 승계까지 처리해 별도 복사 단계가 필요 없었다. 1.12 `WAITING_FOR_REVIEW`(02:30 KST). BACKLOG G5 종결.

### K4 — 채팅 한눈에 보기 장소 카드 복원 + 계단식 캡 + follow-up 칩 (웹·iOS)

유라 님 리포트(센스 채팅방 2026-08-23): K3의 `get_nearby_overview`가 카드·장소 투영 없이 산문만 내서 "주변에 뭐 있어" 답변에서 iOS 장소 카드·"장소 N곳" 헤딩·산문 블록 버튼이 함께 사라졌다. spec `docs/superpowers/specs/2026-08-24-chat-overview-cards-followup-chips-design.md`.

- **카드 복원(A안)**: `composeOverview`가 `{ overview, places }`를 내고(불릿 순서 → 거리순, id dedupe, wire엔 미탑재) 채팅 라우터가 `{type:"places"}` 카드로 싣는다. iOS·웹 카드 기계는 무변경. 실호출 자택 좌표 13곳.
- **계단식 캡** `overviewNearestCap(count)`(<5: 2 · 5~9: 3 · ≥10: 4): 식당 45곳과 아이 놀 곳 3곳을 같은 2곳으로 부르던 비례성 결함. 웹·iOS 둘러보기·채팅이 한 조립을 쓰므로 셋이 함께 바뀌고 소비자 3벌은 무변경. 구간값은 실사용 판정 항목.
- **follow-up 칩**(dodo 이식, question만): `POST /api/chat/suggestions`(별도 리밋 60초 20회, `ThinkingLevel.LOW` — 3.6-flash는 `thinkingBudget: 0` 거부), 2개 자연 연속 + 1개 뜻밖, 앱 범위 제한. 웹 `FollowUpChips`+`useFollowUpSuggestions`(aria-disabled, 탭 시 보내기 버튼 선점 — 빈 상태 예시 버튼의 같은 이탈도 함께 수정), iOS `ChatSuggestionsService`+`ChatModel.followUps`+`SuggestionButtonList` 재사용. i18n `chat.followUpGroupLabel`·`ios.chat.followUps` 6로케일.

## 2026-08-23

### E16 축3·축2 — 비-ko 도보 상세 안내와 간략 단독 진입점 제거

비-ko 5개 로케일에서 **조회 자체가 없던** 도보 상세 안내를 열었다. ko 전용이던 이유는 게이트가 아니라 provider 계약(낭독 산문이 한국어)이라, Tmap 보행자 `turnType`·도로명·거리 구조화 필드에서 서버가 en 문장을 새로 만든다. 그 뒤 웹의 직선거리 단독 진입점 3종을 지우고 강등 사유 3-state를 넣었다. spec `docs/superpowers/specs/2026-08-23-non-ko-walk-guidance-design.md`(본문 축3 + 부록 축2), plan `docs/superpowers/plans/2026-08-23-non-ko-walk-guidance-plan.md`.

- **축3**: `pedestrian-action.ts` 한 표가 임박 큐 행동과 영어 문구를 함께 낸다(두 표로 나누면 좌우 불일치가 커버리지 테스트를 통과한 채 성립한다). 도로명 로마자는 juso `engAddr`(코퍼스 40개 중 39개, 실패 1건은 일반명사 "보행자도로" = 정답). 도보 스텝의 `action`은 이제 **서버가 전량 투영**하고 리듀서 walk 프로파일이 `actionSource: "step"`으로 바뀌었다(웹·Kit 한 줄씩, 공유 fixture에 action 15건 추가).
- **관측이 공식 표를 반증했다**: Tmap 공식 코드표는 경유지를 184~189로 적었지만 실호출 PP1 지점의 `turnType`은 **0**이다. 표만 보고 박았으면 경유지가 있는 모든 en 경로가 죽었다. 문장의 거리·도로명 귀속도 "LineString 합"이 아니라 **첫 구간**이다(합으로 읽으면 435스텝 중 48건이 어긋난다 — 이 어긋남을 설계 단계의 대조 가드가 잡았다).
- 부수 수정: `fetchPrimaryOrFallback`이 Tmap 폴백에 `includeLineGeometry`를 넘기지 않아 카카오 장애 시 상세 안내가 조용히 간략으로 강등되던 기존 결함을 고쳤다.
- **축2**: 장소 상세 `DistanceBeacon`·길찾기 `briefFallback`·상세⇄간략 전환 버튼과 전환 어휘 6키·웹 `speedSuggest` 발화 제거. `resolvePending`은 i18n 키이자 콜백인데 `toggleMode`가 유일한 설정자라 둘 다 죽었다. Kit `speedSuggest` 이벤트와 iOS가 쓰는 `beacon.briefGuideStart`·`beacon.straightLineNote`·`guide.detailUnavailable`·`guide.detailNoLocation`은 남겼다(소비자 기준으로 자른다).
- **강등 사유 3-state**: `fetchGuideRoute`가 `{ ok }` 태그로 `noLocation`·`retryable`·`unavailable`·`outOfCoverage`를 가른다. 400·404는 재시도 가능으로 접지 않고, 통지(사유)와 상시 표시(동작 서술)를 다른 문자열로 갈라 회전자 이중 낭독을 막았다. 변이 주입 4/4 검출.
- 설계 리뷰 2회(codex adversarial): 축3 12건 중 8건 수용, 축2 8건 중 6건 수용(기각 근거는 spec §7·부록).
- 실호출 게이트 `scripts/verify-non-ko-walk-guidance.mjs` 신설 — 30경로 405스텝에서 7축 전부 PASS(한글 0·오류 0·로마자 106·action 318).
### E19 커버리지 사각형 → 국경 폴리곤 승격 (웹·iOS Kit)

`isInKorea`가 사각형(31.43~44.35/122.37~132.0) 대신 국경 폴리곤으로 판정한다 — 사각형은 그 안의 프리필터로 남는다. 종전에는 후쿠오카·기타큐슈·대마도·시모노세키가 "한국 안"으로 통과했고 개성·해주는 파주와 위경도가 겹쳐 사각형 뺄셈으로 갈리지 않았다. 링은 E12가 walk seed용으로 받아 둔 OSM `admin_level=2` 경계(영해 경계 2,580점)라 **새 데이터가 필요 없었다**. spec `docs/superpowers/specs/2026-08-23-coverage-boundary-polygon-design.md`.

- **링은 한 벌**: seed(2.7MB)를 클라이언트가 import할 수 없어 `src/lib/data/korea-boundary.json`으로 분리했고, walk provider의 자체 폴리곤(`isInWalkSeedCoverage`·`SEED_BBOX`)은 삭제했다. Kit 리소스는 바이트 동일 사본(`korea-boundary-drift.test.ts`), 판정 표는 공유 fixture 15점을 웹·Kit·빌드 스크립트 G10이 함께 읽는다.
- **클라이언트도 같은 술어**(번들 gzip +15KB 실측 수용): 서버 왕복이 없는 `deeplink.ts`에서는 사각형이 최종 판정이 되고, 느슨한 클라 전용 술어를 남기면 다음 기능이 그것을 집는다.
- **프리필터 사각형은 상수가 아니라 링에서 유도한다**(리뷰 검출): 종전 상수 `KOREA_COVERAGE_BBOX`(≤동경 132.0)는 독도 영해 링(132.12)을 다 감싸지 못해 폴리곤 안인 독도 동쪽 해상을 잘라냈다 — 사각형이 상위집합이 아니면 프리필터가 거짓 "밖"을 낸다. 새 실패 방향(국내인데 폴리곤 밖)은 seed 노드 79,575점 전수를 `isInKorea`로 재판정하는 계약 테스트가 덮는다(링 데이터 열화 축, 링 소실 축은 golden이). 실호출(로컬 dev) 10건 전수 통과 — 후쿠오카·대마도·시모노세키 `outOfCoverage`, 파주·서귀포·울릉도 정상.
- 라우트별 "0건" 문장 갈림(같은 서울 전용 사실이 패널과 한눈에 보기에서 다른 문장, `route/car`가 웹 소비자마다 다른 문장)은 **조사만** 하고 `docs/BACKLOG.md` E19에 표로 남겼다.
### 급행 leg가 실시간 추적 대상에서 빠지던 노선명 매핑 공백 (A16 선행)

ODsay는 급행 운행 구간을 별도 lane으로 주고 이름 끝에 `(급행)`을 붙이는데(`수도권 9호선(급행)`), `subwayLineCore`가 그 접미를 안 벗겨 매핑표가 미스였고 `classifyTrackMode`가 `null`이었다 — **급행 경로를 고르면 실시간 안내가 통째로 열리지 않았다.** A16이 지목한 "하차역 매칭 실패"보다 한 단계 앞이다. 괄호 일반이 아니라 `(급행)` 한 토큰만 벗긴다(공항철도 `(직통)`은 실시간 도착 피드에 축이 없어, 매핑하면 정직한 "미커버"가 영원한 "미등장"이 된다). 웹 정본 + Kit 미러 + 양쪽 테스트, 표시명은 급행 표기 유지. 실호출 게이트 `scripts/verify-odsay-express-lane.mjs` 신설(⏳ 도입 당일 ODsay 쿼터 소진으로 첫 통과 실행 미완, `docs/BACKLOG.md` A16 L1).

### E14 / A16 L1 급행 정차역 데이터원 판정 — 위치 추적안 기각

조사 `docs/research/RESEARCH-2026-08-23-express-stop-data.md`(실호출 4후보), 판정서 `docs/superpowers/specs/2026-08-23-express-stop-data-verdict-design.md`. **"데이터원 부재"는 틀렸다**: 급행 정차역 집합은 ODsay `passStopList`가 이미 주고(급행 13역 vs 완행 29역, ODsay 직접 호출·프로덕션 라우트 両표면 확인), 잠금 열차 현재역은 서울 실시간 `realtimePosition`이 주며 그 `trainNo`는 도착 API `btrainNo`와 동일 식별자다(14/14 교차 대조). TAGO 시간표엔 급행 구분·열차번호가 없고, KRIC 「열차별 운행시각표(급행)」은 정본감이나 계정 승인 대기다. 그 위에 세운 **위치 기반 폴백 추적 설계는 독립 적대적 리뷰 2회가 BLOCKER 11건으로 기각**했다(지나침 판정이 죽은 분기·트리거 카운터가 그 시나리오에서 구조적으로 안 오름·폴백 발동 조건이 정상 상태와 구분 불가·래치 리셋 부재·`arrived` 도달 불가·L3 탈출구 소거·잔여 수 거짓 조합 등) — 코드는 넣지 않았다. E14 ① 전제와 A16 미확정 ①(9호선 열차번호 체계 상이 가설)을 함께 정정했다.

### 횡단보도 차로 수·도로 폭 낭독 (E8)

도보 안내의 단일 횡단보도 문장 끝에 전국횡단보도표준데이터(15028201) 값으로 `, N차로, 도로 폭 Mm`를 덧붙인다(서버 `getWalkRoute` 주석 단계, 웹·iOS·CLI 무변경). 있는 곳만 말하고 없는 곳은 침묵. spec `docs/superpowers/specs/2026-08-23-crosswalk-lanes-length-design.md`.

- 이용허락 "제한 없음"이라 정적 seed(54,186건, `NOTICE.md` 등재). 실측에서 교차로 횡단보도 여럿이 한 점에 겹쳐 등록된 것(3,425곳 값 불일치)을 발견해 최근접 대신 **3중 게이트**(중점 30m·연장≈구간 길이·후보 합의)로 fail-closed — 표본 22건 주석 8·침묵 14·오탐 0. 실호출 게이트 `scripts/verify-crosswalk-annotation.mjs` 7/7.
- 라벨은 "도로 폭": 재작성 문장이 이미 "횡단보도 길이 21m"(스텝 거리)를 달고 있어 맨몸 수치를 덧붙이면 길이가 둘로 들린다. 라벨 낭독 판정은 BACKLOG E8 잔여.
### A19 TAGO 시간표 (역·노선) 0행을 coverage 3-state로 — 노선 탈락 0 (웹·CLI·채팅·iOS)

업스트림이 인증 정상인데 스케줄 0행을 주는 (역·노선)(홍대입구 2호선·강남 신분당·서울역 공항)을 `lines[]`에서 빼던 것을 멈추고 `TimetableLine.coverage`(`ok`/`noTrains`/`unknown`/`unavailable`)로 가른다. 소비자 4곳이 노선명과 함께 "확인할 수 없습니다"·"불러오지 못했습니다"·"탑승할 수 있는 편성이 없습니다"를 따로 낭독하고(`timetable.coverage.*`, `timetable.empty` 삭제), `subway-nearby` 심야 "운행 종료" 단정은 `ok`·`noTrains` 노선만 참여하는 allowlist(fail-closed)로 바뀌었다. iOS는 `coverage` 옵셔널(웹 선배포). 실호출 게이트 `scripts/verify-korea-subway-timetable.mjs` 신설(15/15 PASS). spec `docs/superpowers/specs/2026-08-23-tago-timetable-coverage-design.md`, dodo 계약 역이식.

### B9 ① — 웹 길찾기 도보 추천·최단 2행 disclosure

웹 `DirectionsView`가 도보 조회에 `alternatives=1`을 붙여 추천·최단 쌍을 받고, `shortest`가 있을 때만 추천·최단 2행 disclosure(`aria-expanded`, 최단 기본 접힘, 추천은 종전 30분 문턱)로 낸다(iOS 도보 섹션·대중교통 대안 동형). `stepFreeNotice`는 両행 라벨에 쉼표 병기(단일 경로 장거리 disclosure에도 — 종전엔 접힌 본문 스텝 0에만 있었다), 펼침 본문은 요약·notice 스텝을 뺀다(`WalkRouteResult` `includeSummary`·`omitNoticeStep`, 경유지 인덱스 역보정). 안내 시작 버튼은 섹션 상단에 남아 추천 경로만(B9 ②까지). 실호출 게이트(prod) 통과. spec `docs/superpowers/specs/2026-08-23-web-walk-alternatives-disclosure-design.md`. **N4 "nmap 경유지 인자"는 취소**: 웹 nmap 길찾기 빌더는 2026-07-30에 참조 0으로 제거됐고 남은 iOS Kit 빌더의 호출처(장소 상세)는 경유지를 모른다(코디네이터 판정).
### E15-2 대중교통 실시간 안내 "주변 확인" — 앵커 배선 (iOS·Kit)

백로그 E15 다음 능력 ①(spec `docs/superpowers/specs/2026-08-23-transit-surroundings-anchor-design.md`, 설계 리뷰 생략 판정 기록). 도보 시트의 `SurroundingsSceneSection`(시그니처 불변)을 `TransitTrackingSheet` 본 Section 뒤 별도 Section으로 배선했다. 앵커는 Kit 순수 함수 `transitSurroundingsAnchor`가 정한다 — 조망의 `transitOverviewHere`가 `.station`으로 **확정**한 승차 중 현재역, 그 밖은 하차역, 하차역 좌표가 없으면 섹션 미노출(테스트 6건). 섹션 헤더가 기준 역을 말한다("내릴 곳 {역} 주변"/"현재역 {역} 주변", 6로케일) — 앵커가 둘 중 하나로 바뀌므로 어느 역인지가 곧 정보다. `GuideOverviewCapability`는 넓히지 않았다(프로토콜 없이 배선으로 충분, spec §3). 실험판 시뮬 AX 순서 확정(`이미 탑승했습니다` → 헤딩 → `주변 확인` → 장면 → `안내 종료`). ⏳ 실승차 판정 `docs/FIELD-TEST.md` §5-4 E15-2 행.

### 이식 원장 소비 — 계단 회피 좌표 정밀도·토글 라벨·xcstrings 린터 하한

`PORTS.md` → gildongmu 앞 6행을 전수 판정했다(절차 정본 `cross-port` 스킬).

- **계단 회피 조회는 원좌표로**: `kakao-walk`의 4자리 반올림이 캐시 키만이 아니라 upstream에 보내는 좌표 자체를 바꿔, 약 11m 격자 안에서 지하철 출입구 두 개가 합쳐졌다. `accessible`일 때만 반올림을 건너뛴다(비-accessible 계약 불변). 테스트 4건·변이 3건 검출.
- **토글 라벨 "계단 없는 경로" → "계단 회피 경로"**(6로케일, `about.feature2` 동조): 안내문에서 "계단"을 찾는 검사는 존재만 증명하고 부재는 증명하지 못하므로 종전 라벨이 지킬 수 없는 약속이었다. dodo의 "정상 응답에도 한계 문장" 계약은 **미채택**(위원장 판정 — 조회할 때마다 같은 40자를 듣는 비용이 라벨 수정으로 0이 된다).
- **xcstrings 린터 하한을 패턴별로**: 참조 건수를 출력만 하던 자리에 하한을 넣었고, 리뷰 지적으로 합계가 아니라 패턴마다 두었다(app 두 패턴 기여도 947 대 6이라 합계 하한은 소수 패턴의 전면 파손을 못 잡는다).
- **승격 2건**: TAGO 시간표의 (역·노선) 단위 커버리지 공백 → `docs/BACKLOG.md` A19(실호출로 확인), M3 도보 대안 웹 UI → B9. 채팅 포커스 계약은 이미 이식돼 있어(gildongmu@f1dae6a) 원장 행만 낡아 있었다.

### E15-1 대중교통 실시간 안내 "진행 상황 조망" — 능력 프로토콜 첫 발견 (iOS·Kit·웹 순수 계층)

백로그 E15의 첫 능력(spec `docs/superpowers/specs/2026-08-23-transit-progress-overview-design.md`, codex 설계 리뷰 §12 반영). 대중교통 시트의 "진행 상황"이 도보와 같은 조망 모달을 연다 — 헤더가 "{count}구간 중 {n}번째 구간. " + 상태 문장, 행은 도보·구간(완료/지금 이 구간/예정)·현재 구간 정차역("현재 위치"는 **신선한 추적 관측·지하철·유일 매칭일 때만**), 침묵 상태(notYetVisible·neverSeen·signalLost·upstreamFailed)면 설명 행 바로 뒤에 "탑승 변경" 탈출구(A16 L2의 침묵을 같은 화면에서 해소). "다른 경로 보기"는 **현재 위치 기준 재조회**(GPS → 현재역 앵커 → 실패, 승차 전엔 "{승차역} 기준으로 조회" 선언 버튼)로 후보를 펼쳐 보고 "이 경로로 전환"한다(커밋 가드는 시간이 아니라 근거 변화). 조망 안 행동·국면 전이 착지는 전부 **조망이 닫힌 뒤** 부모 `onDismiss`가 실행한다. 셸 `GuideOverviewSheet`(조망 전용으로 봉인된 `GuideOverviewCapability`)을 신설하고 도보 조망·대안 프리뷰 시트를 `BeaconTrackingSheet`에서 그 파일로 이동했다(어댑터 경유, 동작 변경 0). 판정 계층은 Kit `TransitProgressOverview` ↔ 웹 `transit-progress-overview.ts` 미러 + 공유 fixture 16건(변이 4건 검출). 웹 조망 UI는 후속(`docs/BACKLOG.md` E15). 실승차 판정 대본은 `docs/FIELD-TEST.md` §5-4.

### K1 안내 시트 접기·띠바 탭 바 위·탭 순서·받아쓰기 억제 (iOS)

위원장 실사용 피드백(2026-08-22 ①④, plan `docs/superpowers/plans/2026-08-23-feedback-260822-parallel-plan.md` §1 K1). 탭 순서 검색 - 길찾기 - 내 주변 - 채팅·기본 탭 검색은 **실험판에서만**(`AppConfig.experimentalTabOrderEnabled`로 `AppTab.order`를 가른다, 정식판은 종전 유지 — 위원장 추가 지시). 띠바를 탭 바 **바로 위**로 옮겼다 — iOS 26.1+ `tabViewBottomAccessory(isEnabled:)`, 26.0은 내용 비우기, 18~25는 각 탭 콘텐츠 `safeAreaInset` 폴백(종전 TabView 자체 inset이 탭 바를 시각·VO 모두에서 덮었다). "안내 최소화" 행 버튼을 두 시트의 제목 메뉴 헤더 행 우측 작은 아이콘으로 바꾸고(처음엔 toolbar였으나 빈 내비게이션 바가 한 행을 차지해 같은 날 헤더 행으로 이동) 라벨 "안내 시트 접기"·띠바 "안내 시트 펼치기"(6로케일). 같은 날 후속 판정으로 "안내 종료"를 목록 2번째 행에서 **목록 밖 최하단 고정 버튼**으로 내리고(상단 버튼 행이 늘어 VO로 되찾기 번거로움 — 네 손가락 아래쪽 탭이 지름길), 시트 진입·복귀 착지를 중지 버튼에서 제목 행으로 바꿨다(두 시트 동형). `SpeechService` 시작·모든 종료 경로에 `GuideSession.setDictationActive`를 연결해 검색·채팅 탭 받아쓰기 중에도 두 모델의 톤·통지가 억제된다(종료는 이전 값 ∧ 현재 값 — 시트 억제와 공존). 시뮬 18.6·26 양쪽에서 탭 바 가시·AX 순서 콘텐츠 → 띠바 → 탭 바 확인. spec `2026-08-22-guide-session-minimize-design.md` §2.2·2.3·2.6·9 개정, 실기기 관찰은 `docs/FIELD-TEST.md` N1③·K1④.
### K3 채팅 function-calling 도구 확장 — 신규 4 + 인자 확장 12 (20 → 24도구)

위원장 실사용 피드백(2026-08-22 ③) 판정대로 7종을 더했다(spec `docs/superpowers/specs/2026-08-23-chat-tools-expansion-design.md`). 신규 도구 `get_station_timetable`(역 첫차·막차, TAGO)·`get_barrier_free_detail`(무장애 편의시설 상세, `get_nearby_barrier_free`의 `contentId` 연쇄)·`get_where_am_i`(정위)·`get_nearby_overview`(한눈에 보기 6불릿). 인자 확장: `get_subway_arrivals`에 `stationName`(역명 조회, 이름 기반이라 커버리지 게이트 없음), 앵커 고정 8도구에 `place`(지명 > 장소 앵커 > 현재 위치, 해석된 장소를 `resolvedPlace`로 되돌림 — 카카오 키워드 1위가 지명과 어긋난 실측 "후쿠오카"→대구 동명 가게), 길찾기 3도구에 `via`(도보·자동차는 `waypoint.stepIndex`, 대중교통은 ODsay 미호출 `unsupported:"waypoint"`). 전부 산문 정본·신규 카드 없음이고, 지명·앵커 조회에선 기기 위치 self-fetch 카드를 내지 않는다. systemInstruction 불변. 버스 노선 경유 정류소는 제외(재론 금지). 도구별 실호출 게이트와 `npm run test:ab` 전후 비교는 spec §6·§7. 테스트 5파일 47건.

### K2 자동차 실시간 안내 완성 (웹·서버·Kit·iOS)

"실주행은 딥링크 위임" 방침을 폐기하고 자동차 안내를 도보 수준으로 완성했다(위원장 판정 2026-08-23, 피드백 2026-08-22 ②). 서버가 Tmap `turnType`을 공식 코드표 기준 `action`(left·right·back·keepLeft·keepRight)으로 투영하고, 리듀서는 car 프로파일에서 문장이 아니라 그 투영만 읽는다(없으면 침묵 — 182·183 "도착안내 방향"은 회전이 아니다). 임박 큐는 거리가 아니라 **시간 축** `max(15m, v×6초)`(운전자 9초, 표본 없으면 60m)로 나가고 전문 선행을 요구하지 않는다. 2026-08-22 실주행 로그(터널 5분 뒤 구속 창이 150m씩 기어가며 지난 교차로 3개 전문 연속 발화)의 기제를 `silentCatchUp` 세 항(점프 fix 무발화·표본 제외·기아 카운트 / `uncertainSince` 기준 복귀 공백 재획득 / 지난 유닛 래치 전진·묶음 안 끝난 스텝 제외)으로 막았다. 하단 2행·이탈 시 자동 제안을 car로 확장하고 주기 통지를 "{거리} 앞 우회전" 단문으로. iOS는 설정 "자동차 안내 듣는 사람"(동승자=VO 통지 / 운전자=`TtsPlayer` 스피커 발화, 짧은 명령·낮은 빈도), 정차 도착(40m·정지·정확도≤30) 뒤 종료 화면 "여기서 도보 안내 시작" 인계(`GuideSession.acceptCarWalkHandoff`, 진입점 6→7), 안내 중 "경유지 삭제"(N4 잔여), 로그 `session kind=` 표식. codex 설계 리뷰(BLOCKER 10·MAJOR 8)와 spec·품질 서브에이전트 리뷰(BLOCKER 2·MAJOR 11) 판정은 spec §10. 공유 fixture: route-guide car 12건·live-rows car 2건·car-action 55건·car-arrival 7건, Tmap 실호출 16스텝 action 대조. 봉인(`experimentalGuidanceEnabled`)은 유지 — B1 실주행 판정(실험판) 대본 `docs/FIELD-TEST.md` §6. spec `docs/superpowers/specs/2026-08-23-car-guidance-completion-design.md`.

## 2026-08-22

### B9 웹 "둘러보기" 이식 — 현재 위치 확인 + 둘러보기 패널 통합

iOS M4 화면을 웹 `NearbyHub`에 옮겼다(spec `docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md` §9 후속). 새 `AroundNearby.tsx` 패널 하나가 허브 맨 위에서 세 요청(`/api/nearby/overview`·`/api/surroundings/scene`·`/api/places/around`)을 한 커밋으로 받아 위치 문장(h3, 착지) → "한눈에 보기" 6불릿(`src/lib/overview-lines.ts`, Kit·CLI 동형) → 자동 펼침 "주변 상황" → "주변 가게와 시설"을 낸다. 장면·목록의 장소 행은 버튼으로 상세에 연결(`sceneItemToPlace` 신설). 채팅 `surroundings-nearby` 카드도 이 패널을 마운트한다. 죽은 코드 판정으로 웹 `WhereAmI`·`SurroundingsNearby`·`buildLocationNarrative`(웹·Kit)와 `whereAmI.narrative/category`·패널 상태 i18n 키를 삭제했고, `WalkInfraNearby`는 유지. iOS의 "이 위치에 관해 물어보기" 버튼은 **의도적으로 이식하지 않았다**(홈 옴니박스 [AI에게 질문]과 장소 상세의 앵커 채팅이 이미 있어 잉여 — 리뷰 W1 판정). 테스트: `overview-lines.test.ts`(실제 ko/en 템플릿으로 3-state 문장 상이)·`AroundNearby.test.tsx`(세 요청 한 커밋·조각 실패 잔존·수동 위치 헤딩·상세 진입). dev 서버 실호출로 길동 좌표 렌더·상세 진입 확인. 실기기 VO 관찰 3건은 `docs/BACKLOG.md` §2 관찰 항목.

### 한눈에 보기 — 식당·카페 분리(6불릿) + 불릿 문장형

위원장 실사용 피드백(2026-08-22 1.11 제출 뒤): "한눈에 보기"의 식당·카페 불릿을 둘로 나누고 각 불릿을 완성 문장으로("아이 놀 곳이 9곳 있습니다. 가장 가까운 곳은 ○○으로 남서쪽 3.2km입니다."). 서버 `nearby-overview.ts`가 카카오 FD6·CE7을 합치던 단계를 없애 `cafe` 불릿을 냈고(순서 transit·food·cafe·kids·events·barrierFree, 종별 캡 판정 유지), 6로케일 `whereAmI.overview.*` 템플릿을 문장형으로 바꿨다(`transitNoStationOnly`는 문장이 독립돼 제거). 라벨의 이/가·은/는과 장소명의 (으)로는 `KoreanParticle` 정본을 확장해 코드가 고른다(Kit ↔ 웹 ↔ CLI 미러, 드리프트 가드 5열 — 비한글 장소명은 쉼표 폴백). 가까운 곳 2곳 유지(위원장). 실호출(길동)로 식당·카페 각 15곳 이상 분리 확인. 리뷰 1건(CLI 타입 유니온 `cafe` 누락) 반영. 웹 소비자는 아직 없다(B9가 이식). spec `docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md` §4.

### App Store 1.12 빌드 19 업로드 (제출 대기)

1.11 아카이브(`f312a39`) 이후 iOS에 닿는 22커밋(K1 띠바·접기 아이콘 행·안내 종료 하단 고정, 받아쓰기 억제, 한눈에 보기 문장형, K3 채팅 도구)을 담아 아카이브·업로드했다(아카이브 커밋 `c56752c`, 12:37 KST, 산출물 검사 통과). ASC는 1.11이 `IN_REVIEW`인 동안 새 버전 생성을 **409로 거부**해 초안도 만들 수 없다 — 위원장 판정으로 1.11을 철회하지 않고 승인 뒤 제출한다. 노트 정본은 `docs/appstore/release-notes.md` §1.12. K2 자동차·E15-1 대중교통·탭 순서는 실험판 봉인이라 제외.

### App Store 1.11 심사 제출 (빌드 18)

1.10 아카이브(`0013c52`) 이후 iOS에 닿는 24커밋(M4·N1·N2·N4-iOS, BLE 정식 바이너리 제거)을 담아 제출했다(07:11 KST, `WAITING_FOR_REVIEW`). 아카이브 커밋 `f312a39`, `git worktree` 격리 빌드, 산출물 `Info.plist`·`otool -L`로 번들 ID·1.11.0(18)·`UIBackgroundModes`·**CoreBluetooth 미링크**(ITMS-90683 해소 실증)를 확인했다. N3 boarding과 N2 좌우 피커는 정식판 게이트 밖이라 노트에서 제외했고, 심사 노트는 새 권한·데이터가 없어 승계했다. 노트 정본은 `docs/appstore/release-notes.md` §1.11. 준비는 Opus 서브에이전트, push·제출은 컨트롤러.

### N1 안내 세션 앱 승격 + 안내 시트 최소화 + 탭 바 위 띠바 (iOS)

안내 중 다른 탭을 쓸 수 없던 것(위원장 실사용 피드백 2026-08-21 ②)을 고쳤다. `BeaconModel`·`TransitGuideModel`이 길찾기 탭 `@State`에서 앱 수명 `GuideSession`으로 올라가 탭 전환·탭 재생성·시트 닫힘이 세션을 끝내지 않는다. 시트는 루트 `.sheet(item:)` 하나로 띄우고, 내리는 제스처(스와이프·VO escape)는 중지가 아니라 **최소화**다 — 탭 바 바로 위 띠바(버튼 하나, "신명중학교까지 남은 거리 850m, 안내로 돌아가기", 대중교통은 탑승 대기·남은 정거장)가 모든 탭에서 복귀 경로다. 안내 중 새 안내 시작은 거부+통지(`GuideSessionCoordinator.claim` 정책 반전, 경로 조회는 허용 — 폼 도착지 변경의 자동 중지 삭제). 장소 상세 길찾기 섹션에 안내 중 "여기로 목적지 변경"(경유지 버튼은 자리만, N4-iOS가 채운다). 설계 리뷰 24건 반영(C 9 수용). spec `docs/superpowers/specs/2026-08-22-guide-session-minimize-design.md`.

### N4 경유지 — iOS (폼·안내 세션·도착 통지)

서버 계약(`via`·`waypoint{stepIndex,coord}`)을 iOS에 얹었다. 길찾기 폼에 "경유지 추가"(도착지와 경로 조회 사이, 확정 뒤 "경유지, C"+"경유지 삭제"), 도보·자동차 결과와 조망 목록에 "경유지 C 도착" 구획 행, 대중교통은 호출 없이 "경유지는 대중교통 경로에서 지원하지 않습니다"(`.unsupportedWaypoint`), 최근 경로 "A부터 B까지 C을 경유하는 경로 조회"(ko 조사는 호출부가 `KoreanParticle`로). 실시간 안내는 Kit `RouteGuide`의 새 이벤트 `waypointReached`(도착선 통과 감지/발화 분리, 임박 큐 뒤·최종 접근 앞, 미도착 경유지면 최종 접근 금지 — 웹 `route-guide.ts` 미러 + 공유 fixture 4건)를 받아 도착 종·통지 뒤 **멈추지 않고 계속**하며 `waypoint`를 비운다. 안내 시트 "경유지 추가"↔"C, 경유지 변경"(최소화와 종료 사이)·장소 상세 "여기를 경유지로 추가/변경"은 `setWaypoint` → 경로 재획득(`reacquireRoute`, 목적지 전환과 공유) → 폼 동기화. `RouteService` `via`·`StartRequest.waypoint`는 기본값 없는 필수 인자. 설계 리뷰 12건(codex) 중 9건 수용, 구현 리뷰에서 재시작 요청(`lastStartRequest`)이 목적지 전환·경유지 변경을 따라가지 않던 결함(목적지 쪽은 기존)을 `syncStartRequestWithSession`으로 함께 고쳤다. spec `docs/superpowers/specs/2026-08-22-waypoint-ios-design.md`, plan `docs/superpowers/plans/2026-08-22-waypoint-ios.md`.

### N3 대중교통 "탑승" 의미 재정의 — `boarding` 국면 신설 + 상태 문구 전수 + A19 (웹·Kit·iOS)

실사용 피드백(2026-08-21 #4): "탑승" 버튼이 곧 `waiting→riding`이라 정류소에 서서 차량을 고른 순간 "탑승 중"이 됐다. 상태 머신에 **`boarding` 국면**을 두어 버튼은 **차량 선택**(`vehicleSelected`)이 되고, 승차 정류소 폴링을 계속하다 선택 차량의 도착(서울버스 잔여 0 / 지하철 진입·도착, 동결 레코드 제외)을 관측하면 앱이 `riding`으로 올린다(`boarded(cause: observed)`, "도착. 탑승하세요."). 미등장은 탑승으로 추론하지 않고 `vehiclePassed`·`signalLost`로 사용자 선택("탑승했습니다"·"다른 차량 선택")을 연다. "탑승 변경 취소"는 `restoreBoarding`이 해제 전 국면으로 되돌린다. 문구 신설 14·개정 2·삭제 2(6로케일), 공유 fixture는 종전 24 시나리오를 `confirmBoarded` 삽입으로 보존하고 8개를 더했다. **A19**: 시트의 `Bool` 포커스 바인딩 6개를 옵셔널 단일 바인딩 `SheetControl`로 합치고 착지 헬퍼 하나(경합 해제·대상 존재 재검증·재가시화)로 통일했다. codex 설계 리뷰가 잡은 9건(미등장→riding 추론 폐기, 지하철 출발 코드 제외, 실패 이력 이월, 포커스 Task 경합 등)은 spec §9. 실승차 판정 항목은 `docs/FIELD-TEST.md` §5-2. spec [`2026-08-22-transit-boarding-phase-design.md`](docs/superpowers/specs/2026-08-22-transit-boarding-phase-design.md).

### N4 경유지 1개 — 서버·웹·CLI/MCP (iOS는 웨이브 3)

도보·자동차 경로가 경유지 1개(`via=위도,경도`)를 받는다(위원장 실사용 피드백 2026-08-21 ⑤). 실호출 게이트에서 4개 provider(카카오 도보 `via_x/via_y`·Tmap 보행자·자동차 `passList`·카카오 내비 `waypoints`) 전부 경유지를 수용해 기본·폴백 파이프라인은 불변이다. 응답엔 `waypoint{stepIndex,coord}`(경유지에서 시작하는 첫 단계·도착 판정 좌표)만 싣고 스텝 문장은 손대지 않는다 — 표지가 없으면 throw(카카오 도보는 이름이 틀린 파라미터를 200으로 무시한다). 대중교통은 ODsay에 경유지가 없어 upstream 없이 `unsupported:"waypoint"`(경로 없음과 다른 정직 상태). 웹 길찾기는 도착지와 조회 버튼 사이 "경유지 추가"(선택, 포커스 선점 이동·도착지 확정 뒤 포커스 불변), 결과 구획 "경유지 C 도착", `?dir=` 세 토막, 최근 경로 "A부터 B까지 C를 경유하는 경로 조회". 경유지 조회에서는 웹 안내 시작 버튼을 내지 않는다(안내 훅이 경유지를 모른다 — 버튼 부재가 정직). CLI `route walk|car|transit --via`, 텍스트 출력 `경유지 도착` 줄. spec [`2026-08-22-waypoint-server-web-cli-design.md`](docs/superpowers/specs/2026-08-22-waypoint-server-web-cli-design.md).

### N2 도보 안내 톤 5종 세분화 — 횡단보도·왼쪽·오른쪽·뒤로 돌기·그 외 (웹·iOS)

결정 지점 임박 큐(경계 20m 앞)가 행동과 무관하게 `ahead` 트릴 하나를 내던 것을 행동별 소리로 갈랐다(위원장 실사용 피드백 2026-08-21 ③). 횡단보도=음향신호기식 비프 4연음×2, 왼쪽·오른쪽=상승 2음 모티프, 뒤로 돌기(`WalkAction.back` 신설, 마커 "유턴"·"뒤로 돌아")=하강 글라이드 2회, 지하보도 등 그 외=기존 `ahead`. 소리 정본은 `scripts/build-guide-tones.py`(합성·결정론 재생성)이고 웹↔iOS 바이트 동일 가드에 편입했다. 좌우 구분은 **패닝/음높이 두 후보**를 함께 실었고(기본 음높이, 실험판 설정 피커로 전환) 위원장 실기기 선택이 남았다. 공유 fixture(`walk-action-cases`·`route-guide-scenarios`)가 행동별 톤을 못 박는다. spec [`2026-08-22-walk-tone-taxonomy-design.md`](docs/superpowers/specs/2026-08-22-walk-tone-taxonomy-design.md).

### iOS "내 주변" 탭 재편 — 둘러보기 통합 + "한눈에 보기" (M4)

"현재 위치 확인"과 "둘러보기"를 "둘러보기" 하나로 합쳐 허브 맨 위에 뒀다. 화면은 위에서 위치 문장(GPS·수동 위치 선언, VO 착지 1회) → "한눈에 보기"(대중교통·식당과 카페·아이 놀 곳·문화 행사·무장애 관광지 5불릿, 항목당 한 문장, 가장 가까운 곳 2개 명명) → "주변 상황"(150m 입구 기준 묶음이 버튼 없이 바로 펼쳐지고 각 장소가 상세로 열린다) → 물어보기 → 주변 가게 목록. 집계는 새 라우트 `/api/nearby/overview`(`assembleWhereAmI` 동형 allSettled, 불릿별 0건·정보 없음·실패·키 없음을 가르고 키 없는 불릿은 부재)이고 문장은 Kit·CLI의 결정론 템플릿(6로케일). **공통 반경 1km**는 서울 주거·상권·업무·전주·강릉·양평 6좌표 × 7단계 실호출로 정했다(500m는 아이 놀 곳·무장애가 서울에서도 상시 0, 1.5km는 도보 20분 초과). `/api/surroundings/scene` 항목에 장소 상세 재료(`id`·좌표·카테고리 원문·주소)를 실었고, 안내 시트의 버튼형 "주변 확인"도 같은 본문을 써 장소가 상세로 열린다. CLI/MCP `nearby-overview`(`gildongmu nearby overview`) 추가. 실호출 게이트 `scripts/verify-nearby-overview.mjs` 11/11. 보행 인프라 화면·BLE 진단 섹션은 유지(E20 배제와 별개). 웹은 후속 이식(백로그 B9). spec [`2026-08-22-nearby-tab-restructure-design.md`](docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md).

## 2026-08-20

### ITMS-90683(블루투스 권한 문구 누락) 업로드 경고 해소 — BLE 전송 층을 정식 바이너리에서 제거 (iOS)

1.8 빌드 14·15, 1.9 빌드 16, 1.10 빌드 17 업로드마다 App Store Connect가 `NSBluetoothAlwaysUsageDescription` 누락 경고(ITMS-90683)를 보냈다(경고라 심사는 전부 통과, 조치 없이는 다음 업로드에도 반복). 원인은 음향신호기 BLE 진단의 전송 층 `AudioSignalController`가 Kit(SPM)에 있어 `#if EXPERIMENTAL` 게이트가 닿지 않고 정식 바이너리에 CoreBluetooth가 링크된 것 — Apple 검사는 호출 여부가 아니라 심볼 참조만 본다. 권한 문구는 의도적으로 실험판 plist에만 있으므로(spec §5.2) 문구를 더하는 대신 파일을 앱 타깃 `ios/Gildongmu/Nearby/`로 옮겨 통째로 게이트했다. `check-release-artifact.mjs`에 정식 실행 파일의 `otool -L` CoreBluetooth 링크 검사를 추가했고, 개정 전 코드의 Release 빌드에서 실패·개정 후 통과를 변이로 확인했다. 다음 정식 업로드(1.11)부터 경고가 사라진다. spec [`2026-08-17-audio-signal-ble-probe-design.md`](docs/superpowers/specs/2026-08-17-audio-signal-ble-probe-design.md) §5.1·§5.3.

## 2026-08-19

### App Store 1.10 심사 제출 (빌드 17)

1.9 아카이브(`01447d4`) 이후 iOS 바이너리에 닿는 3커밋을 담아 제출했다(07:31 KST, `WAITING_FOR_REVIEW`). 아카이브 커밋 `0013c52`, `git worktree` 격리 빌드. 산출물 `Info.plist`로 번들 ID·1.10.0(17)·**`MinimumOSVersion 18.0`**·`UIBackgroundModes`(location·audio)·실험 전용 BLE 키 부재를 확인했다. 최소 지원 하향은 설치 가능 기기가 늘어나는 변경이라 ko·en 두 노트 모두에 적었고(도보 안내 2건은 ko 게이트라 ko만), 심사 노트는 `Microphone` 절에 OS별 엔진 2종과 서버 폴백 부재를 명시하고 `Motion & Fitness`의 `(new in this version)` 꼬리를 뗐다. 노트 정본 [`docs/appstore/release-notes.md`](docs/appstore/release-notes.md) §1.10.

⚠ **`1.0-submission-draft.md` §9(심사 노트 "정본")가 ASC 실값보다 낡아 있었다** — 1.8이 더한 `Motion & Fitness` 절이 문서에 없어, 그 값을 `--review-notes`로 넘겼다면 그 절이 지워졌을 것이다. 넘기기 전에 ASC 실값을 읽어 대조하는 규칙을 §9에 등재했다.

### iOS 최소 지원 버전 26 → 18 하향, 26 미만은 SFSpeechRecognizer 온디바이스 받아쓰기

사용자 피드백("요구 iOS 버전이 높아 설치하지 못했다")으로 `IPHONEOS_DEPLOYMENT_TARGET`·Kit 플랫폼을 18.0으로 내렸다. 코드 장벽은 받아쓰기 엔진 한 파일뿐이라 `SpeechService`를 `SpeechEngine` 계약 위로 올려 iOS 26+는 종전 SpeechAnalyzer(`AnalyzerSpeechEngine`), 그 아래는 `SFSpeechRecognizer` **온디바이스 강제**(`LegacySpeechEngine`)로 갈랐다 — 어느 엔진이든 오디오는 기기를 떠나지 않아 개인정보 3자 일치는 불변. 온디바이스 자산이 없는 언어·기기와 음성 인식 권한 거부는 새 문구(`errorOnDevice`·`deniedRecognition`)로 정직 실패. iOS 18 실기기 창구가 없어 26 미만 받아쓰기는 시뮬레이터 판정만으로 출시(위원장 결정). spec [`2026-08-19-ios-min-version-18-design.md`](docs/superpowers/specs/2026-08-19-ios-min-version-18-design.md).

### 추정 도착 자동 종료의 도착 종은 전경에서만 (iOS)

백그라운드에서 발동하는 추정 도착(실내 진입 3분·정지 5분 뒤 사후 정리)의 도착 종을 껐다 — 잠근 채 잊은 휴대전화가 한참 뒤 갑자기 울리는 당황을 없앤다(위원장 판정). 확정 도착의 종(실시간 신호)과 전경 발동은 그대로. 복귀 시 도착 화면과 상환 낭독이 종료 사실을 알린다. spec [`2026-08-13-presumed-arrival-auto-end-design.md`](docs/superpowers/specs/2026-08-13-presumed-arrival-auto-end-design.md) §5-2 개정 노트.

### 도보 안내 걸음·칼로리 요약을 모든 정상 종료로 확장 (iOS)

종전엔 확정·추정 도착에서만 요약이 나왔다(백그라운드 추정 도착은 도착 화면이 남아 복귀 시 보였고, 사용자 중지·스와이프 닫기·목적지 변경·권한 상실 종료는 시트가 즉시 닫혀 없었다). 이제 도보 세션의 도착이 아닌 종료도 같은 종료 화면(헤딩 "안내 종료", 첫 문장 = 중지 사유, 주변 확인 없음)을 남겨 요약을 보여 준다. 판정 근거는 세션 중 만보계 라이브 누적이라 종료 순간 동기로 갈리고(유효 거리 50m 미만·만보계 불가면 요약 없이 종전처럼 바로 닫힘, 도착에도 같은 임계값), 스와이프·VO escape는 시트가 내려간 뒤 `onDismiss`로 띄운다. OS 강제 종료(비정상)는 대상 밖. spec [`2026-08-17-walk-arrival-health-summary-design.md`](docs/superpowers/specs/2026-08-17-walk-arrival-health-summary-design.md) 개정 노트 2026-08-19.

## 2026-08-18

### iOS 1.9 심사 제출 (빌드 16)

1.8은 같은 날 `READY_FOR_SALE`. 1.8 아카이브 `1cad836` 이후 iOS 가시 변경은 아래 피드백 커밋 하나라 ko 노트 2줄·en 관용 문구. worktree 격리 아카이브 → 업로드 → `asc-submit --apply --submit`(산출물 검사 통과) → 19:55 KST `WAITING_FOR_REVIEW`. 노트 정본 [`docs/appstore/release-notes.md`](docs/appstore/release-notes.md).

### 도보 안내 실사용 피드백 3건 (위원장 카카오톡 메모 → 접수·처리)

로그(`guide-diag`, 17:00~17:25 KST 세션 553m)는 origin 수용·전문 3회·임박 2회·이탈 1회 복귀·도착·건강 요약 로드까지 정상이었고, 피드백은 전부 문구·UI 층. ① **출입구 승격 고지 문장 삭제**("출입구를 찾아 {name}까지 안내합니다", 웹 live 합산·iOS 정적 Section·6로케일 키) — 행동을 바꾸지 않는 문장이라 혼란만 준다는 판정. 승격 자체(좌표·안내 세션)는 그대로. ② **도착 화면 걸음·칼로리를 문장형으로** + **한국 음식 비유 한 문장**(Kit `WalkHealth.foodComparison`, 11단 사다리 비율 최근접, 상단 초과는 라면 n그릇, 하단 미달은 침묵) + **체중 미입력자에게만** 기준 65kg 고지와 "체중 입력하기" 버튼(설정 시트, 체중 필드에 VO 착지, 닫으면 같은 만보계 표본으로 재계산). "기준 체중 {kg}kg" 꼬리는 폐기. ③ **최소 iOS 버전 하향 요청**은 18.0 실험 빌드로 장벽이 `SpeechAnalyzer` 한 파일임을 실측하고 `docs/BACKLOG.md` E23으로 등재(엔진 폴백·개인정보 판정·iOS 18 런타임 회귀가 남아 마일스톤급).

## 2026-08-17

### iOS 1.8 심사 제출 (빌드 15)

20:10 KST `WAITING_FOR_REVIEW`. 1.7 아카이브 커밋(`45f1412`) 이후 107커밋 전수 판정 — 채팅 답변의 장소 상세 진입·말풍선 구획 헤딩·"내 주변" 전락 통지(D24)는 ko·en, 검색 리뷰순 정렬·걸음/칼로리 요약·안내 출발 좌표 정확도는 ko 게이트라 ko만. 대중교통 승차 추적 계열은 `experimentalGuidanceEnabled` 안이라 정식판에 진입점이 없어 전부 제외했다. **동작 및 피트니스 권한이 들어간 첫 버전**이지만 걸음(`CMPedometer`)·체중(`@AppStorage`) 모두 기기를 떠나지 않아 영양 라벨·`PrivacyInfo.xcprivacy`는 불변이고, 개인정보 처리방침에 `privacy.activity` 문단을 6로케일에 추가했으며 심사 노트에 `Motion & Fitness` 절을 넣었다(2,134자). 빌드 14는 버리고 15로 재업로드 — 노트 정정 뒤 `release-notes.json`이 앱 번들 리소스라 바이너리에 굳는다는 것을 업로드본 `.app`을 열어 확인했다. 노트·판정 정본은 [`docs/appstore/release-notes.md`](docs/appstore/release-notes.md).

### 네이버 리뷰순 정렬 (웹·iOS 검색 토글 + 채팅 인자)

위원장 실사용 요청 "장소 검색을 리뷰·별점 순으로". 전 provider 실호출 결과 별점 **값**을 주는 소스는 없고 네이버 지역검색의 리뷰 개수순(`sort=comment`)만 실재해, 그 하나를 정직하게 노출한다 — 값 없음·최대 5건·좌표 무시(지역명은 질의에)라는 제약 3종을 그대로 사용자에게 전달한다. 서버 `PlaceSearchParams.sort`(`review`면 네이버 단독, 병합·거리 재정렬 없음, 키 부재는 throw) + `/api/places?sort=`; 웹·iOS 검색 결과 위 토글 하나(라벨 전환 "네이버 리뷰순으로 보기"↔"정확도순으로 보기"가 상태 신호, 재조회 중 포커스 유지, ko + 네이버 키일 때만); 채팅 `search_places`에 `sort` 인자(네이버 키 게이트) + 프롬프트 한 줄 + 렌더에 `sort`를 실어 iOS 카드 묶음 헤딩 "네이버 리뷰순 N곳"(웹은 캡션). 실호출 게이트 4축(`scripts/verify-naver-review-sort.mjs`)·A/B 3케이스 6/6 통과. CLI/MCP·영어·둘러보기 행 표기(E22)는 범위 밖. spec `docs/superpowers/specs/2026-08-17-naver-review-sort-design.md`.

### 길찾기 수동 위치 고지 이동

결과 화면 상시 문장 폐기 → 안내 시작 버튼의 직접 응답으로 "현재 위치에서 안내를 시작합니다"(웹 live region·iOS `.high`). 출발지가 현재 위치일 때만, 정지 탭엔 발화 안 함. spec `docs/superpowers/specs/2026-08-09-manual-location-design.md` §4 갱신.

### 채팅 답변의 장소를 상세로 잇는다 (iOS)

위원장 실사용 요청: 채팅 탭 답변 아래 장소 카드와 산문 안 장소명이 장소 상세로 이어지지 않았다(웹 카드는 이미 `requestOpenPlace`로 진입). 두 층으로 잇는다 — ① 장소 카드 활성화 = 장소 상세 **시트**(닫기 버튼, 닫으면 연 카드로 VO 포커스 복원. 기존 로터 액션 유지) ② 산문 블록은 그대로 한 객체로 두고 장소 언급 수로 활성화만 가른다 — 1개(실호출 표본 27블록 중 26)면 블록 전체가 버튼(이름 링크색), 2개 이상이면 이름별 인라인 링크 + 로터 커스텀 액션 "○○ 상세 보기"(Kit `chatPlaceMentions` 결정론 매칭). 같은 날 위원장 실기기 판정으로 1차본(항상 로터 액션)에서 개정 — 시각 사용자도 산문에서 바로 열 수 있어야 해서. 웹 산문 연결과 장소 채팅 시트(앵커 모드)의 산문 연결은 보류(`docs/BACKLOG.md`). 같은 날 위원장 실사용으로 nearby류 답변(소아 진료·아이 놀 곳·둘러보기·무장애)도 같은 결손임이 드러나 닫았다: 서버가 self-fetch 렌더(타입만)에 공통 `Place` 투영을 `places`로 싣고(`src/lib/nearby-place.ts`, iOS `PlaceProjection.swift`의 웹 정본), iOS는 그 4종을 장소 카드로 디코딩해 카드·산문 언급 → 상세가 다른 장소 답변과 같아졌다(웹 컴포넌트는 그 필드를 쓰지 않아 무변경). 같은 날 위원장 실기기 판정 추가: 산문 → 카드 → 출처 경계가 VO 선형 읽기에서 들리지 않아 **카드 묶음·출처 앞에 구획 헤딩**("장소 14곳"·"주소 N건"·"웹 검색 결과 N건"·"출처", 있는 것만)을 둔다 — 질문 헤딩 아래 하위 구획이 되어 로터로 카드 시작점 점프도 된다.

### 오픈소스 공개 준비 — 라이선스 분리·이력 재작성·사람용 문서

위원장이 App Store 출시와 함께 공언한 오픈소스 공개. 같은 날 준비를 마치고 **public으로 전환했다**(`gh repo edit --visibility public`, 위원장 지시). GitHub 옛 커밋 캐시 삭제 요청은 하지 않기로 했고(위원장 결정), Windows 클론은 재클론했다.

- **데이터 라이선스를 코드에서 분리**: `NOTICE.md` 신설 — 코드는 MIT, 번들 seed 7종은 각 원출처(OSM ODbL 1.0 · 서울 열린데이터 공공누리 1유형 · 공공데이터포털 제한 없음)를 따른다고 파일별로 명시. 라이선스 유형은 각 데이터셋 페이지에서 실확인. 이름·아이콘·도메인·npm 패키지명은 MIT 대상 밖임을 명시.
- **실보행 GPS 로그를 저장소와 git 이력에서 제거**(`git filter-repo` + force push): `docs/superpowers/specs/logs/*.log.gz` 7개는 위원장의 실제 이동 경로라 공개 불가(위원장 결정). 원본은 저장소 밖 보관, `logs/README.md`는 색인으로 남김. 게이트 테스트 2개(`course-derivation-replay`·`presumed-arrival-replay`)가 읽던 부분만 익명화 fixture로 분리 — 도보 281 fix는 경도 평행이동(haversine·방위 불변이라 수치 동일), 최종 접근 세션은 t·event만. `.gitignore`가 재커밋을 막는다. 같은 재작성에서 **자택·지인 주택 주소도 전 이력 치환**(`--replace-text`·`--replace-message`): 자택 아파트 동 표기 → "자택", 주택 두 곳 → "주택 A/B", 실보행 fixture 파일명 `gildong-hyundai-gowoo.json` → `home-gowoo.json`. 대응표는 저장소 밖(`~/gildongmu-private/places.md`). 리뷰어(별도 컨텍스트)가 로그 파일 밖 문서의 상세 주소를 지적한 것이 계기 — gitleaks는 자연어 주소를 보지 않는다.
- **비밀값 스캔**: gitleaks 전 이력(1,515커밋) 스캔 — 실제 유출 0건(오탐 2건은 테스트 더미, `.gitleaks.toml` allowlist).
- **사람용 문서**: `docs/FORKING.md`(클론→내 서비스 사이 바꿔야 할 자리·지역 교체·그대로 가져갈 자산), `CONTRIBUTING.md`, `SECURITY.md`, `CITATION.cff`, README에 라이선스·시작하기 절. GitHub 저장소 설명·토픽 설정.

### 도착 종료 화면을 닫은 뒤 길찾기 탭에 도착 문장이 남던 것 (iOS)

위원장 실사용 발견: 도보 안내가 도착으로 끝난 뒤 목적지를 바꿔 다시 조회해도 첫 수단 섹션 위에 "목적지에 도착했습니다"류 문장이 남았다. 도착 분기가 `stop()` 뒤에 `statusText`를 다시 넣는데 `clearArrival()`이 그것을 비우지 않았고 새 조회는 beacon을 건드리지 않아 다음 세션까지 남던 것. `clearArrival()`에서 `statusText`·`liveTopText`를 함께 비운다. 트리거는 재조회가 아니라 "도착으로 끝난 세션의 종료 화면 닫기" 자체(중지로 끝낸 세션은 무관). 웹은 도착 즉시 종료라 해당 없음.

### 백로그 코드 잔일 묶음 — A17·B4·G4·D24·D25·D8 종결, D10 낡은 등재 정리

병목이 판정으로 넘어간 뒤 코드만으로 닫히던 소규모 항목 6건을 단독 정리했다(편승 정책이 "얹힐 작업"이 오지 않아 무기한 보류로 작동하던 것을 2026-08-16과 같은 판정으로 치웠다). 웹·iOS 모두, 실기기 판정 없이 닫히는 축만.

- **A17** 버스 승차 대기 "방면을 확인해 주세요" 상시 노출: `classifyBoardingCandidates`(웹) ↔ `classifyTransitBoardingCandidates`(Kit)의 `directionUncertain`을 "방향 축이 있는데 매칭 전멸"로 좁혔다 — 후보 전원 `direction`이 빈 문자열(버스)이면 축 부재라 uncertain이 아니다. 両미러 테스트 추가.
- **B4** 웹 대중교통 안내 시작 시 트리거 unmount로 커서가 body로 떨어지던 것: 세션 상태 텍스트(`statusRef`, `tabIndex=-1`)로 선점 착지(`TransitGuidePanel`), 계약 테스트 추가(변이 검출 확인).
- **G4** `guidance-gate-drift.test.ts`에 `manualOriginNoticeText` **소비 지점** 가드: 줄 수 창 대신 중괄호 구조를 거슬러 모든 바깥 블록 머리말·해당 문장에서 봉인 플래그 부재를 검사(`enclosingHeaders`, 주석·문자열 제거). 실파일 변이 주입으로 검출 확인.
- **D24** 통지 우선순위 판별선 잔여 적용: `NearbyLoadState`의 권한·정밀도·커버리지 전락 3종(목록이 오버레이로 교체)과 `ChatConversationView` 받아쓰기 전사 통지 2분기(보내기 버튼 선점 이동 직후)를 `.high`로. `announceRefreshFailed`는 의도적으로 기본값 유지. `CLAUDE.md` 규칙 문구를 "포커스가 움직이고 착지 라벨로 대체될 수 없을 때"로 정정.
- **D25** `NearbyOverlayCopy.description` 죽은 필드·`copyView` 분기 제거(소비자 0). `list/plain`의 위치·서버 실패 동일 화면은 기록만(회귀 아님).
- **D8** iOS `transitLegText` 도보 4분기의 키·인자 순서 판정을 Kit `TransitWalkLegText.resolve`로 이관(테스트 5건), 앱은 키→리터럴 항등 매핑 + `appLocalized(_:arguments:)` 배열 오버로드.
- **D10** 파일 로거 3벌 통합은 같은 날 E20 계측기가 `DiagFileLog`로 이미 끝냈으므로 백로그에서 내렸다(등재만 낡아 있던 사례).

### 도보 도착 화면에 걸음·칼로리 요약 한 줄 (iOS)

spec `docs/superpowers/specs/2026-08-17-walk-arrival-health-summary-design.md`, 플랜 `docs/superpowers/plans/2026-08-17-walk-arrival-health-summary.md`. 정식·실험판 모두, 웹 미러 없음(만보계·도착 화면이 없다). 실기기 판정(행 존재·VO 순서·조회 지연)은 `docs/FIELD-TEST.md` §3.

- 도착 종료 화면(확정·추정 도착 모두)의 도착 문장 아래에 "이번 구간 N걸음, 약 Mkcal"(체중 미입력이면 ", 기준 체중 65kg") 한 줄. 걸음은 `CMPedometer` 구간 사후 질의(`PedometerService`, 세션 시작 Date~도착), 칼로리는 Kit `WalkHealth.summary` 활동 칼로리(거리×체중×0.5kcal/kg/km, ACSM 보행식 순 대사분 — 시간 항이 소거돼 정지·속도 무관). 못 읽으면 행 부재(0걸음은 표시).
- `BeaconModel`: 세션 토큰+`arrivalDest` 이중 조건으로 비동기 결과 커밋, `start`/`clearArrival`에서 취소, 전경 복귀 시 `.failed`만 1회 재조회. 도착 낭독 문장 불변, 건강 값은 로그 미기록(지연만).
- 설정 "칼로리 추정용 체중(kg)"(`walkWeightKg`, 20~300 밖은 미입력), 정보 출처에 실측/추정 방법 한 행, `NSMotionUsageDescription` 6개 로케일(pbxproj 세 구성 + `InfoPlist.xcstrings`). `PrivacyInfo`·영양 라벨 불변(기기 밖 전송 없음).

### 음향신호기 BLE 진단 화면 구현 — 실험판에만 들어갔다

spec `docs/superpowers/specs/2026-08-17-audio-signal-ble-probe-design.md` §9 순서 그대로. 정식판 변경 없음(전부 `#if DEBUG || EXPERIMENTAL`), 웹 미러 없음. 위원장 실측·로그 회수·E20 게이트 판정은 열려 있다.

- Kit 순수 층 `AudioSignalProtocol.swift`(이름 파싱·명령 3종·ACK/NAK/규격 밖 응답, 계약 테스트 12건) + 전송 층 `AudioSignalController.swift`(스캔 `withServices: nil`, `0003cdd2` write · `0003cdd1` notify, 연결 15초 타임아웃, 옛 기기 늦은 콜백 정체성 가드, 서비스·특성 nil 발견으로 UUID+properties 관측).
- 앱 `AudioSignalProbeSection`(스캔 토글·연결 확인·명령 3·청취 기록 3, 고지 한 줄, 상태 줄 고정 슬롯) + `AudioSignalDiag`(파이프 구분 로그, `Documents/audio-signal-diag.log`). 진단 모델 수명은 `WalkInfraNearbyView`가 쥐고 화면 수준 `onDisappear`에서만 shutdown.
- 진단 파일 로그 싱크를 `DiagFileLog` 하나로 통합(GuideDiag·TransitGuideDiag·ChatFocusDiag의 사본 셋 제거, TransitGuideDiag의 비-throwing write도 throwing으로 통일).
- `Info-Experimental.plist`에만 `NSBluetoothAlwaysUsageDescription`, 양쪽 plist 주석. `check-release-artifact.mjs`에 실험 전용 키 누출 검사(Info.plist + 로케일별 InfoPlist.strings) — 1.7 아카이브 통과·키 주입 사본 실패로 확인.

### 도보 안내 경로 출발점에 정확도 판정을 되돌렸다 (A18)

2026-08-16 실보행에서 버스 하차 직후 명일로 횡단보도 안내가 빠진 원인 — 경로 origin이 실제 위치보다 115m 북쪽 — 을 고쳤다. iOS만(웹 실시간 안내는 origin 취득 경로가 다르다). 백로그 §1 A18 종결(코드), 판정은 §2 도보 표.

- **1선(근본)**: `BeaconModel`의 시작 조회 대기 분기가 `isUsableFix`(정확도 상한 없음) 대신 Kit 순수 함수 `routeOriginStep`을 지난다 — `shouldAcceptFix`(≤30m·≤10초) 통과 fix면 즉시 조회, 미달이면 `storeCeiling`(100m) 이내 최선값만 보관, 15초 대기 상한에 최선값으로 조회, 최선값조차 없을 때만 종전 간략 폴백. 단발 취득 `currentCoordinate()`의 최선값 정책과 같은 모양이고 재측위 의존은 되살리지 않았다. `RouteOriginTests` 9건 + 변이 3종(상한 제거·최선값 방향 반전·ceiling 무시) 전부 검출.
- **3선(계측)**: `routeOrigin lat lng acc age reason=accepted|best|none` 1줄 + 대기 중 버린 fix마다 `routeOriginWait acc age best`(상한 15초라 부피 유한). 종전엔 이 분기가 계측 전에 반환해 origin 정확도가 로그에 없었다.
- **2선은 로그까지만**: 상세 fix 로그에 `perp`·`edgeHits`를 병기했다. 첫 fix 창 끝 적중을 즉시 재조회로 잇는 것은 상수를 실보행 없이 못 정하고 리듀서를 만지면 웹 미러(`route-guide.ts`)까지 따라오므로 이번엔 넣지 않았다.
- ⚠ `isUsableFix` 자체는 건드리지 않았다 — 비콘 앵커·최종 접근의 느슨한 정확도는 의도다.
- 새 대가는 "정확한 fix를 기다리는 침묵"이고 `docs/FIELD-TEST.md` §2 첫 세 줄이 그것을 듣는 대본이다.

### 음향신호기 BLE 진단 화면 설계 — 계측기를 먼저 만들기로 했다

E20의 착수 게이트를 벤더 앱이 아니라 우리 계측기로 열기로 했다(위원장 결정). 벤더 앱은 자사 기기만 볼 가능성을 배제할 수 없어 0건이 결론이 못 되고, 그러면 두 번 걷게 된다. spec `docs/superpowers/specs/2026-08-17-audio-signal-ble-probe-design.md`, 구현은 다음 세션. **코드 변경 없음.**

- **자리는 "내 주변 보행 인프라" 화면의 음향신호기 섹션 아래**(위원장 제안 채택). 그 화면이 이미 seed 기준 `deviceCount`·`sites`를 낭독하고 있어 **대조("등록돼 있다" vs "지금 응답한다")의 왼쪽 절반이 거기에만 있다.** 게다가 E20은 이 화면의 존폐를 가르는 판정이라 도구가 대상 위에 선다.
- **재사용은 "진단 UI를 제품에 쓰기"가 아니라 계층 분리로 얻는다**: 프로토콜(순수)·전송(CoreBluetooth)은 Kit에 두어 제품이 그대로 승계하고, 진단 UI·로그는 버려진다. ⚠ 순수 층에 `import CoreBluetooth` 금지 — Kit은 macOS도 플랫폼이라 `swift test`가 거기서 돈다.
- **안전 사다리 3단**(스캔 → 연결 → 명령)이고 명령 안에서도 `0x03`(설치 위치 안내) → `0x01` → `0x02`(신호안내) 순이다. `0x03`이 첫째인 이유는 무해하면서 **"이 MAC이 어느 횡단보도인가"에 답하는 유일한 채널**이기 때문이다.
- ⚠ **권한 문구는 실험판 plist에만 넣는다.** 정식 `Info.plist`에 `NSBluetoothAlwaysUsageDescription`을 넣으면 쓰지도 않는 권한을 선언하게 된다. 두 plist는 "공통 항목은 양쪽에"가 계약이라 **의도적으로 한쪽에만 두는 첫 항목**이고, 그 이유를 양쪽 주석에 적는다.
- **역방향 가드 신설 예정**: `check-release-artifact.mjs`가 릴리스 산출물에 Bluetooth 키가 있으면 실패시킨다. 2026-08-15 백그라운드 모드 승격 누락의 거울상이고, 소스 검사로는 안 잡힌다(어느 `INFOPLIST_FILE`이 병합됐는지는 산출물에만 있다).
- spec §11에 **"실측이 뒤집을 수 있는 것" 4건을 미리 명명**했다(이름 형식 불일치·즉시 끊김·응답 부재·광고에 UUID가 실려 있는 경우). 그중 넷째는 좋은 소식이라 로그가 반드시 그 값을 남긴다.

---

## 2026-08-16

### 음향신호기 앱 조작 조사 — 경찰청 규격서에 공개 BLE 프로토콜이 있었다

위원장 요청(주변 음향신호기 탐색 + 앱에서 조작)의 성립 여부를 조사했다. 기록 `docs/research/RESEARCH-2026-08-16-audio-signal-ble-control.md`, 규격서 사본 `docs/research/refs/`, 작업 큐 `docs/BACKLOG.md` E20. **코드 변경 없음.**

- **서버형 공개 API는 없고, 그 자리를 규격이 대신한다**: 「시각장애인용 음향신호기 규격서」(경찰청, 2022.4.27) `Ⅶ. 부가장치`가 BLE 공용 프로토콜을 담는다 — 이름 `AHG001+<MAC>+`로 검색, 3바이트 명령(`0x31 0x00 0x01/02/03` = 위치안내·신호안내·설치 위치 음성안내), ACK/NAK 응답. 규격이 앱에 **검색·유도·신호버튼 3기능을 필수로 요구**하므로 요청이 곧 규격이 상정한 앱이다.
- **UUID를 검색한 것이 조사에서 가장 값어치 있었다**: 상용 시리얼 투과 모듈 USR-BLE100/WH-BLE102로 확인돼, 규격서가 침묵하는 자리를 부품 매뉴얼이 메웠다 — PIN 인증은 **기본 꺼짐**(켜져 있으면 연결 10초 뒤 끊김이 진단 신호), 앱은 **`0003cdd2`에 write하고 `0003cdd1`을 notify 구독**한다(규격서의 TX/RX는 모듈 기준 이름이라 반대로 읽기 쉽다).
- **막는 것은 코드가 아니라 보급률이다**: BLE는 규격상 선택 설치다. 서울 OA-15543 **원본 DBF 전수 집계**로 상한만 쟀다(최신 설치·교체 2021년 이후 46.2%, 2023년 이후 24.1%. 종류 컬럼은 전 행 단일값이라 기종 구분 불가). 착수 게이트는 위원장의 `AHG001` 스캔 실측 1건이고 길동 후보 좌표 14개를 뽑아 뒀다.
- **M4 요청 ②(보행 인프라 제거)에 철회 조건이 걸렸다** — 실측에서 응답 기기가 잡히면 제거가 아니라 조작 UI로 전환한다.
- ⚠ **웹은 원천 불가·iOS 네이티브 전용**(Safari에 Web Bluetooth 없음). 웹↔iOS 미러가 성립하지 않는 첫 사례다.
- 부수 수확: 규격서 원문 오타 1건 확정(신호안내 설명이 위치안내와 동일 문장, 3개 파서 교차 재현), `docs/research/refs/` 신설(재취득이 어려운 1차 사료 사본 — police.go.kr은 쿠키 왕복이 필요해 링크만으로는 다음 사람이 도달하지 못한다).

### 마을버스 실승차 — 서울버스 추적 첫 완주와 승차 문장 정리

위원장 실승차(마을버스 강동01, KST 21:34~21:44) 계측을 회수했다. 로그 원본은 `docs/superpowers/specs/logs/transit-guide-diag-2026-08-16.log`.

- **서울버스(TOPIS) 추적이 전 국면을 처음 완주했다**: 대기 폴 12회(20초 주기 준수) → 탑승 8초 뒤 잠금 → 사다리 3·1 → `arrived(certain)` → `legAdvanced(final)`. 8월 14일 9호선 급행의 무한 침묵(A16)은 재발하지 않았다 — 다만 그 세션은 지하철이라 L1을 다시 시험한 것은 아니다.
- **승차 중 도착 문장에서 잔여 정거장 중복 제거**: 상태줄이 "남은 정거장 3개"를 말한 뒤 TOPIS 원문의 "[3번째 전]"을 다시 읽고 있었다. `rewriteBusArrivalMessage`가 꼬리를 떼고 "…후"를 "… 남음"으로 맺는다. **국면 인자는 필수** — 대기 후보 목록은 `remainingStops`를 따로 싣지 않아 그 꼬리가 잔여 정보의 유일한 채널이고, 구분 없이 걸었다가 리뷰에서 잡혔다. 꼬리 패턴은 `remainingFromArrmsg`와 공유한다.
- **새 결함 [A17](docs/BACKLOG.md) 등재**: 버스는 upstream이 방향 필드를 주지 않아 `directionUncertain`이 구조적으로 항상 켜지고, 그 결과 "방면을 확인해 주세요"가 모든 버스 세션에 뜬다 — 확인할 방면 정보가 화면에 없는데도. 위원장 체감은 "거슬리지 않았다"라 편승 대기로 둔다.
- **미해결로 남은 것**: 사다리 잔여 2 결번과 "1분32초 후" 통지 16초 뒤 도착. riding 국면에 계측이 없어(`logWaitingPoll`은 대기 전용) 폴이 덜 돈 것인지 upstream 갱신 입도인지 가르지 못한다(A16 미확정 ①).

### OSM 보행 노드 정적 seed화 (E12) — 외부 서버 의존을 계층째 걷어냈다

`/api/walk/nearby`의 OSM 축(횡단보도·점자블록)이 Overpass 실시간 호출에서 **전국 79,574 노드 정적 seed**로 옮겨갔다. spec `docs/superpowers/specs/2026-08-16-osm-walk-nodes-seed-design.md`.

- **조회 1.4~3.9초(성공)·7.9~8.9초(실패) → 4~8ms**(dev 실호출). 프로덕션 로그로 확정됐던 429·504가 원인째 사라진다. 110m 격자라 걸어가면 정의상 신규 타일이 연속돼 캐시가 가장 안 듣는 사용자가 보행자였다.
- **추가가 아니라 제거였다**: `providers/overpass.ts`(169줄) 전체와 `walk-infra.ts`의 타일 캐시·쿨다운·예산·single-flight·타일 anchor, 라우트 두 곳의 캐시 주입이 함께 사라졌다(261줄 → 117줄). 그 코드는 전부 "외부 서버가 실패한다"는 사실 하나에 대응하려고 존재했다.
- **한국 밖은 `unsupported: outsideKorea`**(0건 아님). 웹·iOS·CLI 세 소비자가 각각 미제공 문구를 갖는다 — 종전에는 unsupported와 error를 합쳐 렌더해 "조회 실패"로 낭독됐을 자리다.
- 신규 `scripts/build-osm-walk-nodes.mjs`(연 1회 재생성) + 가드 G1~G8. 실측이 셋을 잡아 설계를 바꿨다: `out tags`는 좌표를 생략해 **0건이 조용히 통과**할 뻔했고(G1이 잡았다), `area`+`out body`는 상류 504라 위도 밴드로 쪼갰고, bbox만으로 받으면 **일본 노드 17,806개**가 섞였다.
- iOS 설정에 **"정보 출처" 화면** 신설(ODbL attribution 이행). iOS는 웹의 출처 각주 19곳 중 2곳만 노출하고 있어 그 결손도 함께 메운다.
- ⚠ **제공 지역 판정은 리뷰가 회귀를 잡아 사각형에서 국경 폴리곤으로 올라갔다.** 사각형이면 후쿠오카·대마도·개성이 "제공 지역 안"으로 통과해 거짓 0건을 냈다(종전 Overpass 경로는 그곳에서 실제 데이터를 냈으므로 회귀였다). `admin_level=2` 경계가 해안선이 아니라 영해 경계선이라 좌표점 2,580개로 끝났고, 링 넷(본토+제주·서해5도·울릉·독도)이 파주와 개성을 정확히 가른다. 가드 G9~G11이 이 판정을 지킨다.


### 판정 세션 — 열린 판정 7건을 닫고 그중 셋을 코드로 소화했다

백로그에서 **실보행·실승차가 필요 없는** 판정만 골라 위원장께 하나씩 물었다(§2는 대상이 아니다).

- **통지 우선순위(D13)**: "포커스가 움직이면 끊고, 안 움직이면 끊지 않는다"로 통일. `DirectionsTabView.clearRecentRoutes`가 고정 항목이 남는 분기에도 `.high`를 붙여 검색 시트와 갈려 있었는데, **그 함수 주석 자신이 "포커스 무이동"이라 적고 있었다** — 규칙은 이미 옳게 적혀 있고 코드만 안 따랐다. 같은 규칙이 D13 본체("개별 삭제는 포커스가 반드시 옮겨가는데 기본 우선순위")를 그대로 판정해 함께 닫았다(`SearchView`·`DirectionsEndpointSearchView`).
- **꼬리 문장(D7)**: `ios.common.retryLater`("잠시 후 다시 시도해 주세요")를 소비 6곳에서 걷어내고 키를 6개 로케일에서 삭제(1055→1054). 2026-08-02 정리에서 제거 대상으로 **이름까지 불린 문장**이 iOS 카탈로그에서만 살아남아 있었다.
- **조회 출처(D21)**: `useNearbyFetch`의 `done`이 `origin`(place/manual/gps)을 함께 싣는다. ⚠ **처음엔 좌표 대조로 되짚으려다 변이 주입에서 틀린 것이 드러났다** — 지정한 위치가 마침 GPS와 같은 지점이면 두 출처가 같은 값이라 구분되지 않는다. 백로그가 원래 제시한 처방(공유 계층이 출처를 **기록**한다)이 옳았다. 트리거 시점에 라벨을 얼리는 방법도 틀린다: force 재조회는 이동 판정으로 수동 위치를 해제한 뒤 GPS로 떨어질 수 있다.
- ⚠ **회귀 테스트의 첫 판은 통과했지만 무력했다**(A16과 같은 함정): 부정 단언은 아무 일도 안 일어나면 저절로 참이 된다. 변이 주입이 옛 코드를 그대로 통과시켜 그것을 드러냈고, "수동 지정이 이 컴포넌트에 도달했다"는 증거 단언을 같은 테스트에 세우고서야 검출력이 생겼다(변이 재주입으로 확인).
- **D11은 편승이 아니라 동결로 재분류**: 조건인 "A6 상수 확정"은 게으름이 아니라 **판정 중인 코드에 손대지 않는다**는 규율이다. 이탈 판정 리듀서는 지금 실보행 판정 대상이라, 고치면 판정의 근거가 흔들린다.
- **독립 리뷰가 D21 수정의 대칭형 구멍을 잡아 같은 자리에서 닫았다**: 조회 뒤 지정이 풀리면(이동 판정 drop·직접 해제) 헤딩이 다시 "현재 위치"로 떨어져, 이번엔 **수동 좌표로 만든 산문이 GPS로 낭독**된다. 라벨도 `done`에 실어 얼렸다. ⚠ **얼리는 것은 라벨과 출처뿐이다** — "검증 가능/불가"는 지금 축이라 살아 있어야 하고(며칠 전 판정이 새 세션 라벨을 정하면 안 된다), 두 시제를 한 함수(`useManualLabelFormatter`)에서 조립해 소유를 갈랐다. 이 계약도 변이 주입으로 확인했다.
- 같은 리뷰가 **전수성 결함 2건을 새로 열었다**(D24·D25): 같은 판별선에 걸리는데 아직 기본 우선순위인 자리(`NearbyLoadState` 3함수 · 채팅 전사 통지)와, D7이 마지막 호출부를 지우며 소비자 0이 된 `NearbyOverlayCopy.description`. **일관성을 주장하는 변경은 그 주장이 어디서 깨지는지도 함께 적어야 한다.**

**데이터 판정 — 실측이 결론을 뒤집었다.**

- **juso 내비게이션용DB(E18) ⏸ 보류**: 압축을 풀어 `match_rs_entrc.txt`를 전수로 셌다. 보행자 전용 출입구(`출입구유형 03`)는 **전국 4,667행 = 건물 2,091곳**뿐이다(경기 1,194·서울 583·그중 강동 37). "보행 전용 출입구를 아는 유일한 소스"는 여전히 참이지만 **유일함이 곧 쓸모는 아니었다** — 커버리지가 아니라 표본이고, 반대편에는 국외 반출 금지(GitHub·Vercel 둘 다 불가)라는 비용이 그대로 있다. 수치를 백로그에 박아 다시 재지 않게 했고, 되살릴 신호만 남겼다. ⚠ 실측은 저장소 밖 임시 폴더에서만 했다.
- **OSM seed(E12) 착수 전 판정 넷 종결**: ODbL(완료) + **attribution은 설정 "정보 출처" 항목에만**(위원장 — 수시로 들리는 곳이 아니라 찾아가면 언제든 읽히는 고정 자리. 시작 시 1회는 첫 실행이 이미 붐벼 기각) + **갱신 연 1회**(기존 seed 관례) + **Overpass 전국 질의 1회·단일 파일**(디폴트 판정). ⚠ "Overpass가 불안해서 seed로 옮긴다"와 모순이 아니다 — 그 불안은 사용자 조회 경로의 문제이고 빌드 스크립트의 1회 질의는 실패하면 사람이 다시 돌린다.
- **다음 착수는 E12**(위원장 지정).

### 백로그 증거 대조 — 낡은 것은 없었고, 처음부터 틀린 것이 있었다

기준선 4종을 돌리고(테스트 2,745건·`tsc` error 0·`lint` error 0·ASC 1.7 `READY_FOR_SALE`) §1~§9의 주장 40여 개를 코드·git·실호출로 대조했다. **판정을 뒤집는 낡음은 0건**이었다 — 같은 날 여섯 번 갱신된 문서라 그 축은 건강했다. 대신 다른 계열이 나왔다.

- **§6 C4의 "이 라우트만 IP 레이트리밋이 없다"에서 틀린 것은 "없다"가 아니라 "만"이었다.** 무방비는 그 라우트의 특징이 아니라 기본값이고(공기질·날씨·소아진료·코레일 시설·무장애·`/api/bus/route`가 전부 같다), 같은 쿼터를 쓰면서 리밋을 **가진** 쪽이 소수다. 배타성을 근거로 적어 두면 쿼터 초과 때 진단이 엉뚱한 곳으로 가므로 근거를 호출량으로 바꿨다. ⚠ **이 정정은 첫 판이 틀렸고 독립 리뷰가 잡았다** — 리뷰가 지적한 누락(`/api/transit/track`이 TAGO 버스로 같은 쿼터를 쓰면서 리밋이 있다)은 실재했으나 리뷰의 처방은 "이 라우트"를 `/api/station/timetable`로 오인해 그대로 받았으면 새 거짓이 됐다. **신호는 맞고 처방은 틀린** 전형이었다.
- **문서가 자기 안에서 어긋나 있었다**: "다음에 할 일"이 A16 L2를 착수 대상으로 지시하는데 §1은 같은 항목을 그날 종결로 적는다. 끝까지 읽지 않는 사람은 **이미 끝난 일에 착수한다.**
- **끊어진 참조 2종**: spec 하나가 존재하지 않는 "백로그 D6"을 가리켰고(행선지는 §9 카카오 캐시 항목), `M0~M5`가 CHANGELOG의 다른 두 계열과 글자를 공유해 "백로그 M4"의 역추적 후보가 셋이었다. 결번 선언에 D6을 넣고 재사용 사고 표에 네 번째 행을 더했다.
- **`docs/FIELD-TEST.md`로 가는 링크가 한쪽뿐이었다.** 대본은 §2를 가리키는데 §2는 대본을 몰랐다 — 판정하러 나가는 사람이 대본의 존재를 모른 채 spec 열둘을 뒤지게 된다.
- **`CLAUDE.md`·백로그가 같은 가드를 잘못 설명했다**: `guidance-gate-drift.test.ts`는 `beacon.toggle(`뿐 아니라 `restart(`도 세는데(6곳) 둘 다 `toggle`만 적었다. 아이러니하게 CLAUDE.md의 **바로 앞 문장이 "실패 뒤 재시작"을 놓치기 쉬운 진입점으로 지목**하고 있었다 — 가드는 이미 고쳐졌는데 그 사실을 설명이 못 따라간 것이다.
- 그 외 사실 정정: A16 L1 행의 대기 파라미터(L3가 `boardOverrideName ?? boardName`으로 바꿨다), D21 소비자 10→11, D7 "소비자 넷"은 심볼 수이고 고칠 자리는 6곳, D13 판정의 범위가 검색 시트 한정(`DirectionsTabView`는 `.high`가 정답), `toneLayerStep` 호출 자리는 `BeaconModel.routeTone`(walk·car 공유), M4 제거 경계에 웹 컴포넌트 누락, E16 축2의 i18n 키는 이름이 아니라 값만 바뀌었다는 표기, E18 문단이 §5와 §8에 축자 복제돼 있던 것 제거.

⚠ **반대 방향도 봤다**: 코드의 열린 표시가 백로그에 도착했는가. 앱 소스에 `TODO`/`FIXME` 0건이고, `잠정` 상수 13파일이 전부 백로그 항목(A6·A11·A16·E10·최종 접근)에 대응한다. 누락 없음.

### 문서 전수 정합 — 삭제된 플래그가 매 세션 로드되는 파일에서 지시하고 있었다

`CLAUDE.md`와 `docs/INTEGRATIONS.md`가 **"`AppConfig.realtimeGuidanceEnabled`의 `#if`를 지우기 전에 A6 판정을 먼저 확인하라"**고 지시하고 있었는데, 그 플래그는 2026-08-15 도보 졸업 때 삭제됐다. 방위 축은 자기 게이트가 없어 그때 **정식판으로 함께 나갔고**, 그것은 출하 spec의 의도된 결정이었다(축을 끄면 갈림길에서 80초 넘게 안 가는 길을 안내받는 원증상이 남고 그쪽이 헛경고보다 위험하다). 문제는 결정이 아니라 **문서가 그 결정을 따라가지 못한 것**이다 — 다음 사람이 없는 플래그를 찾다가 "이미 지워졌으니 판정이 끝난 모양"으로 읽는다. 세 곳(+`PROGRESS.md`)을 현행으로 고치면서 **"판정 전에 나갔다"와 "검증 보행은 실험판에서 해야 한다"**(`GuideDiag`가 `#if DEBUG || EXPERIMENTAL`이라 정식판엔 로그가 없다)를 함께 박았다.

- 같은 훑기에서 `CLAUDE.md`의 낡은 인용 2건: 채팅 도구 목록 정본 경로(`src/lib/chat/tools` → `declarations.ts`, 그 경로는 존재하지 않는다)와 봉인 대상 버튼 라벨(E16 축1이 "간략 안내 시작"을 지웠다). **경로는 기계적으로 검증했다** — 활성 문서 4종이 인용한 파일 경로를 전수 대조했고 나머지는 문맥상 축약형이었다.
- `PROGRESS.md`: 1.7 출시 반영(도보 안내 행이 "제출 대기"로 남아 있었다), 방위 축 행을 정식판으로, 직선거리 추적 행을 E16 축1 종결 상태로, prod env 16개 재실측(변동 없음) + **누락 점검의 술어를 `process\.env\.[A-Z_]+` 스캔으로 명시**(코드가 읽는 변수 전수와 대조해 등록 불필요분을 가렸다).
- `docs/BACKLOG.md` 식별자 재사용 표: "`PROGRESS.md`에 B2 두 뜻이 다 남아 있다"는 경고가 273KB 재편으로 이미 해소됐는데 경고만 남아 있었다.
- 워크스페이스 `PORTS.md`: 실시간 안내 이식 행(held)에 2호선 승차 후보 판정 계약을 동반 계약 ③으로 등록.

같은 훑기를 README·SPEC·npm 패키지 문서·App Store 문서로 병렬 확장해 아래가 나왔다. **문서를 고치다 코드 결함 둘을 잡았다** — 문서가 코드를 검증하는 방향으로도 쓰인다는 뜻이다.

- **npm MCP README의 Codex 설치 명령이 실제로 실패하는 구문이었다**: `codex mcp add gildongmu --command "npx -y gildongmu-mcp"`에는 존재하지 않는 옵션이 들어 있어 문서대로 치면 오류가 난다(`codex mcp add --help` 대조). `-- npx -y gildongmu-mcp`로 정정. `claude mcp add`는 현행 그대로 유효.
- **MCP 도구 설명의 혼잡도 지점 수가 5개 과장돼 있었다**(`121곳` → `116곳`, 카탈로그 2벌 미러). 서울시가 주는 핫스팟은 121개지만 **그중 5개는 구성 지점이 0개**라 어떤 구현도 매칭할 수 없다(spec §1-5 실측). 이 문자열이 특별한 이유는 **MCP 도구 설명이 LLM 컨텍스트에 그대로 들어가** 사용자에게 하는 말을 정한다는 것이다 — "121곳 안에 없습니다"라고 단정하게 만든다.
- **CLI CHANGELOG에 `cli-v0.8.0` 태그 이후 사용자 체감 변경 4건이 누락**돼 있었다(빠른하차 줄·도보 구간 거리·대안 축 라벨·거리 표기 원값). 버전은 올리지 않고 `[미출시]`로 적었다. 프로덕션 실호출로 출력을 확인해 썼다.
- **App Store 제출 절차 문서가 스크립트보다 세 가지 뒤처져 있었다**: 산출물 게이트(`check-release-artifact.mjs`가 ASC를 건드리기 전에 도는 것)가 **아예 없었고**, `--review-notes`·프로모션 텍스트 자동 승계(1.5부터)도 없었다. 제출 정본에 게이트가 없으면 손으로 우회할 여지가 생긴다. 1.4~1.6 상태 표기(`WAITING_FOR_REVIEW` → `READY_FOR_SALE`)와 "키 발급 대기"·"미검증은 쓰기 경로뿐" 같은 이미 해소된 현재형 주장도 정정.
- **기록물과 절차서를 갈라 다뤘다**: 심사 회신 기록·1.0 QA 체크리스트·과거 릴리스의 포함 판정은 **그때 사실이라 고치지 않고**, 전제가 뒤집힌 것만 머리에 한 줄을 얹었다(1.3 봉인 절의 플래그 이름, QA 49항목 완주 전제). 지금 이름으로 고쳐 쓰면 당시 판정 근거를 사후 위조하게 된다.
- 개인정보 3자 일치(웹 카피 ↔ `PrivacyInfo.xcprivacy` ↔ ASC 영양 라벨)는 **어긋난 곳 없음**을 확인했다.
- **⚠ `docs/SPEC.md` §4가 접근성 헌장이 금지한 패턴을 현행처럼 지시하고 있었다**: `<dl>` 구조와 `<nav aria-label>`을 설계 약속으로 적어 뒀는데 코드엔 둘 다 **0건**이고(헌장이 명시적으로 금지한다), 터치 타깃도 `min-h-12`로 적혀 있으나 관례는 `min-h-11` 88곳이다. **스펙을 읽고 구현하면 헌장 위반이 나오는 상태**였다는 점에서 단순 낡음보다 나쁘다. 헌장·CLAUDE.md를 정본으로 가리키고 설계 층 약속만 남겼다.
- **§0이 §5와 정면 충돌하고 있었다**: "검증된 것만 dodo-planet으로 졸업시킨다"(부트스트랩 전제)가 2026-08-03에 폐기된 뒤에도 §0에만 남아, 같은 문서가 단방향 졸업과 양방향 이식을 동시에 주장했다.
- **§3 "v0/v1 후보" 표는 6행 중 5행이 거짓이었다**(장소 검색 "TourAPI 키 대기", 자동차 현재가 카카오모빌리티인데 지금 ko 기본은 Tmap, 도보·대중교통 "딥링크만", NCP 2종 "검토"). 표를 지우고 현재 배치는 `CLAUDE.md` 통합 카탈로그를 가리키게 했다. 대장(§3 실험 백로그)에서는 **이미 운영 중인데 "미착수·키 대기"로 남아 있던 6건**을 정정하고, 대장에 아예 없던 운영 소스 6종(역 첫차·막차, 역 보강 2종, 날씨, 문화행사, 혼잡도, 보행 인프라)을 등록했다.
- **문서가 주장한 것을 실측으로 확정했다**: 무장애 여행 API는 실호출 1회로 `resultCode 0000` + 실데이터를 확인해 활용신청 승인·운영 중을 굳혔고(추정이 아니라 응답), **키 없는 환경 통과**는 `.env.local`을 치운 채 실제로 돌려 확인했다(테스트 2,740건 통과, `npm run build` 종료코드 0). §2가 종전에 적던 "mock 모드 E2E(CI에서 키 없이 통과)"는 **E2E 하네스도 웹 CI 워크플로도 없어**(`.github`엔 `cli-publish.yml` 하나뿐) 실제로 가능한 게이트 표현으로 바꿨다.
- **§2의 "영어 UI 완결성"은 측정 수단이 없어 게이트를 만들었다**(`i18n-messages.test.ts`에 비-ko 한글 잔존 검사). 기존 두 검사(키 집합·플레이스홀더 토큰)는 **ko 문장을 그대로 복사한 번역 누락을 정의상 통과**한다 — 키도 토큰도 맞기 때문이다. 변이 주입으로 확인했다: 기존 키의 값만 한국어로 바꾸면 종전 검사는 전부 통과하고 새 축만 걸린다. 실측 결과 잔존은 `nav.korean`("한국어") 하나뿐이고 이는 **언어 메뉴가 각 언어를 자국어로 보여 주는 설계**라 예외로 명시했다(예외를 늘릴 판정선도 함께 적었다 — "그 언어 사용자에게 한글이 보이는 것이 옳은가").

### B2 운행 중 게이트 종결 — 5축 통과, 순환선 결함 1건 검출·수정

같은 날 오후에 남은 두 축을 닫았다. spec `2026-08-04-transit-guidance-design.md` §8 항목5에 표본과 수치를 남겼고, 코드 변경은 커밋 `3ce4dd6`이다.

- **vehId 조인 재현**: 130번 승차 강동성심병원(순번 42) → 하차 길동역1번출구(45)를 30초 간격 24회 폴링. 같은 `vehId`가 두 오퍼레이션에 나타났고(교집합 3대), **양쪽에 동시에 잡힌 37회 전부 잔여 정거장 차이가 정확히 3**으로 순번 간격과 일치했다. ID 일치만으론 번호 재사용을 못 배제하는데 **독립 물리량이 함께 맞아** 그 가능성이 닫혔다. 차량이 승차 정류소를 통과하는 순간(승차 목록에서 사라지며 하차 목록에서 3 → 2로 이어짐)도 잡혔다.
- **2호선 방향 대응 확정**: `내선 = wayCode 2`, `외선 = wayCode 1`. 순환선 반대편 4개 역의 ODsay leg 8건 + 한 바퀴 13개 역 도착 표본 52건의 직전 역이 어긋남 없이 일치했다. **한 역만으로는 확정되지 않는다** — 그 역에서 마침 그랬을 경우와 구분이 안 된다. 이로써 종전의 판정 유보를 풀었고 2호선에서도 진행 방향 열차만 남는다.
- **⚠ 그 과정에서 결함이 나왔다**: 52표본의 종착역이 **전부 "성수"** 였다. 열차별 종착이 아니라 노선 상수라, 경유 목록에서 성수가 하차역보다 앞선 구간(을지로입구→잠실)은 **모든 열차가 활성화 차단**됐다. 성수보다 앞선 열차가 성수 **다음** 역 도착 목록에 오르는 것이 그 열차가 성수에서 끝나지 않음을 증명한다. 종착 검사가 기대는 전제("경유 순서 = 잔여 경로")가 **순환선엔 없다** — 2호선 계열을 그 검사에서 제외했다.
- **독립 리뷰가 면제 범위를 물어 지선까지 실측했다**(성수·신정 8개 역): **지선도 내선/외선을 쓴다.** "내선이면 순환선"이 아니라서 판별자 이름을 `isLine2Direction`으로 고쳤다. 지선까지 면제돼도 안전한 근거는 둘이다 — 방향 대응이 본선과 같고(ODsay 지선 leg 4건 ↔ 도착 표기 일치), 지선의 종착은 `"성수지선"` 같은 **역명 아닌 라벨**이거나 그 지선의 **종점**이라 하차역보다 앞설 수 없다. 리뷰는 코드로는 답할 수 없다고 했고 실제로 그랬다 — **실호출만이 답할 수 있는 질문**이었다.
- 실승차 판정에 두 축이 새로 열렸다(§2 B2 ⑩⑪): 방향 필터가 맞는 쪽만 남기는가, 2호선 구간에서 "탑승"이 눌리는가. **대응이 뒤집혀 있으면 화면에 남는 열차가 전부 반대 방향**이고 그 사실을 알 수단이 목록뿐이라, 실승차가 마지막 게이트다.

### 판정 대본 신설 — BACKLOG §2를 실행 가능하게 만든다

`docs/FIELD-TEST.md`. §2는 판정 항목을 **기능별**(A6·A12·M0…)로 적는데 실행은 **시간순**이라, 걸으러 나갈 때마다 spec 열둘을 뒤져 "오늘 뭘 들어야 하나"를 재구성해야 했다. 대본은 그 축 변환이고, **자연 발생 vs 의도적 재현**을 가른 것이 핵심이다(도착 종소리는 그냥 걸으면 나고 이탈 경고는 일부러 다른 길로 들어서야 난다 — 같은 목록에 두면 실행 비용이 열 배 다른 항목이 섞인다).

- **낭독 문장의 정본은 spec이 아니라 문자열 자원이다.** 초판이 spec에서 인용해 **폐기된 문형과 낡은 라벨**을 실었고 독립 검증이 BLOCKER 3건을 잡았다: 최종 접근 진입의 슬롯형("성내로 끝입니다…", 2026-08-09 폐기) · 램프인 방향 역전(원값으로 시작해 **짧아진다**, "짧게 시작"은 램프인이 막으려는 결함이다) · 수단별 시작 버튼 라벨(spec은 공통이라 했으나 코드는 수단마다 다르다). 반면 **상수는 거의 전부 일치**했다. 그래서 대본에 "수치는 spec, 문장은 i18n"을 규칙으로 박았다.
- 그 검증이 **spec 낡은 자리 2곳**을 부수적으로 잡아 각 spec에 표기했다: 목적지 메뉴의 확인 통지 문구, 그리고 대안 프리뷰가 근거로 삼은 `AppConfig.realtimeGuidanceEnabled`가 **지금 존재하지 않는다는 것**(도보 졸업 때 삭제). 후자 탓에 정식판 기능이 실험판으로 분류돼 있었다.

### 판정 세션의 전제 정정 — 1.7 도달과 "빌드 열은 실재를 적는다"

- **1.7이 심사를 통과해 스토어에 있다**(`READY_FOR_SALE`, PROGRESS는 `IN_REVIEW`로 낡아 있었다). 도보 실시간 안내가 처음 정식판에 도달한 버전이라 §2 도보 항목 대부분이 오늘부터 판정 가능하다.
- **A11 승격은 정식판에 없다.** 백로그가 "정식판"이라 적었고 성격상 맞는 판정이지만 구현이 1.7 아카이브 **다음 날** 들어왔다. **적합성과 가용성은 다른 질문**이라, "빌드" 열은 그 코드가 지금 어느 바이너리에 있는지를 적는다는 규칙을 §2 머리에 남겼다.
- **E5(빠른하차)는 봉인 밖이라 정식판으로도 판정된다** — 안내 세션이 아니라 길찾기 결과 행에 붙어 `experimentalGuidanceEnabled`를 보지 않는다. "대중교통 판정은 전량 실험판"이라는 전제가 틀렸다.

### B2 "아침 게이트" — 이름이 이월의 원인이었다

항목명을 **운행 중 게이트**로 바꿨다. 정본 spec §8 항목5는 그 넷을 "실호출 게이트(머지 전)"로 분류할 뿐 **시각 조건이 없다**. "첫차 05:30 이후"는 *운행 중이어야 한다*는 하한인데 이름이 그것을 *아침에만 할 수 있는 일*로 굳혔고, 아침 일이라 매번 미뤄졌다. 백로그가 "이월 반복 자체가 신호"라고 적어 둔 것이 맞았으나 신호가 가리킨 것은 난이도가 아니라 라벨이었다.

- **낮 12시 실호출로 3축 관측**: 부역명 회귀는 spec §6.3 표본 5종 전부 통과(부역명 유·무 동일 정규화 / 환승 왕십리 4노선 / 동명이역 양평 양쪽 / 광역철도 청량리 4노선) · 열차 목록의 방향·종착·급행 분기 · 2호선 양쪽 API 실값. **사람이 탈 필요도 없다.**
- 남은 vehId 조인·2호선 방향 축은 **같은 날 오후에 닫혔다**(위 "B2 운행 중 게이트 종결"). 방향 축은 결함이 아니라 미확정이었다 — `directionMatchesWayCode`가 내선·외선에 `null`을 돌려 오필터를 피하고 있었으므로, 판정 목적은 "틀렸나"가 아니라 "그 유보를 풀 근거를 얻는가"였다.

### E16 축1 — "간략 안내"라는 이름을 지웠다

12개 키 × 6개 로케일의 값을 바꿔 사용자 노출 문장에서 모드 이름을 없앴다. spec `docs/superpowers/specs/2026-08-16-brief-guidance-name-removal-design.md`, 계획 `docs/superpowers/plans/2026-08-16-brief-guidance-name-removal.md`.

- **백로그가 적은 8건이 실제로는 12건이었다.** 누락된 `guide.detailStart`("상세 안내 시작. …")는 **"간략"이라는 글자가 없어** 문자열 검색에서 새어 나갔다 — 지울 대상이 낱말이 아니라 대비 구조(간략↔상세)였다. 대체 형태는 발명하지 않았다: `guide.carStart`가 이미 "**자동차** 안내 시작"으로 모드가 아니라 **수단**으로 가르고 있어 도보를 거기에 맞췄다.
- **정식판 iOS가 듣는 2건은 "무엇을 주는지" 말한다**(위원장 선택): "경로 정보를 가져오지 못했습니다. 목적지까지 직선거리로 안내합니다." ⚠ **복구를 약속하지 않는다** — `BeaconModel.fallbackToBrief` 이후 `awaitingRoute`가 내려가고 재조회 트리거가 목적지 변경·세션 재시작뿐이라, "잠시 후 다시 됩니다"는 iOS에서 거짓이 된다.
- **i18n 키는 불변.** `guidance-gate-drift.test.ts`가 `"beacon.briefGuideStart"` 문자열을 창 검사 앵커로 쓰고 xcstrings가 그 키로 생성되며, 축2가 곧 지울 것들이라 개명은 낭비다.
- **재유입 가드 신설**(`guidance-mode-name.test.ts`): `messages/`와 `ios/i18n/ios-extra/`를 디렉터리째 훑는다(import 목록은 새 로케일 추가를 잊으면 그 파일만 조용히 비검사로 남는다). 낱말이 아니라 **구(句)** 단위 검사 — `상세`·`detail` 단독은 장소 상세 등 정당한 용례가 있다. **변이 주입 6/6 검출, 교차 오탐 0**.
- ⚠ **부재 단언은 문자열 교체의 사각이다**: 기존 `not.toContain("상세 안내 시작")`은 값을 바꾸는 순간 조용히 참이 되어 검사 대상을 잃는다. 옛 문자열 단언 3건을 새 값으로 함께 옮겼다.
- **독립 리뷰가 잡은 것 1건**(`b524346`): 가드가 로케일 **파일**은 `readdir`로 훑으면서 그 파일이 담긴 **디렉터리**는 손으로 적어 `ios/i18n/kit-extra` 6개 파일이 스캔 밖이었다. 지금 그 디렉터리에 걸릴 문자열이 없어 실질 갭은 아니었으나 **목록을 손으로 적는 방식 자체가 이 가드의 존재 이유와 어긋난다**. 검사 파일 12→18개. ⚠ 넓힌 범위는 그 범위에서 다시 쟀다(kit-extra 변이 1건 검출).
- **남은 것**: 웹에는 여전히 "직선거리 안내"·"경로 안내" 두 이름이 노출된다. 그 노출을 없애는 것은 축2이고 축2는 축3(비-ko 상세)을 기다린다. iOS 정식판은 전환 버튼이 없어 축1만으로 모드 이름 노출 0에 도달했다.

### A16 L2·L3 — 관측되지 않는 잠금의 탈출구

9호선 급행 실승차에서 35분간 아무 변화가 없던 결함의 두 층을 닫았다. spec `docs/superpowers/specs/2026-08-16-transit-guide-never-seen-escape-design.md`, 계획 `docs/superpowers/plans/2026-08-16-transit-guide-never-seen-escape.md`.

- **L2 미관측 시간 상한(웹·Kit 미러)**: 잠금 이후 한 번도 관측되지 않은 채 10분(잠정)을 넘기면 `neverSeen` 신호와 통지를 1회 낸다. 종전에는 미등장 조기 반환이 `missCount` 증가를 건너뛰어 **`signalLost` 임계에 도달할 산술적 경로가 없었다** — 무한 침묵은 버그가 아니라 설계된 대로의 동작이었다. 판정을 폴 횟수가 아니라 시계로 둔 근거는 계측 로그다(35분에 폴 11회, 주기 60초면 35회여야 한다 — 화면 잠금 중 타이머 정지가 유력하고 횟수 기반이면 화면을 끌수록 시한이 늦게 온다).
- **L3 탑승 변경이 지금 있는 역을 묻는다(웹·iOS)**: 조회 기준이 국면으로 고정돼(대기=승차역) 탑승 변경이 처음 탔던 역 목록으로 돌아갔다. 이제 경유역에서 현재 역을 고르면 그 역이 기준이 된다. **위치가 아니라 목록**인 것은 위원장 판정이다(지하철 안 GPS 부재). 신규 데이터원 0건(`viaStops` 재사용), Kit·공유 fixture 무변경 — 상태 머신은 조회 대상 역을 모르기 때문이다.
- **승차 중 상태 어휘 분리**: 타고 있는 동안 화면의 유일한 신호가 "차량 접근 대기"였는데 이는 대기 국면 어휘라 "아직 못 탔다"로 뒤집혀 읽힌다.
- **구현 중 함께 잡은 것**: 판정 바로 위의 기존 대입이 확정된 신호를 매 폴마다 `notYetVisible`로 되돌려 1회성 가드를 무력화했다(fixture가 반복 발화로 검출).
- **변이 주입으로 검증 층을 실측**: 5종 중 3종 검출(fixture 2 · **타입 검사 1** — `ridingSince` 제거는 TS18047이라 vitest는 통과시킨다). 검출되지 않은 둘은 지우지 않되 그 사실을 주석에 남겼다. ⚠ 웹 계약 테스트의 첫 판은 **통과했지만 무력했다**(승차역과 같은 역을 골라 소거 여부가 URL을 바꾸지 않았다) — 소거가 실제로 중요한 환승 경로로 다시 짰다.

**독립 리뷰 2건이 잡은 것 셋 + spec 구멍 6건**(같은 날 반영, `487820e`·`d9217f0`·`1b035d0`). 셋 다 자기 검토로는 잡히지 않는 유형이었다:

- **문맥 문장이 조회 대상과 어긋났다**(두 리뷰어가 독립적으로 같은 결론): 재선택한 역으로 조회하면서 상시 표시·진행 상황 발화는 원래 승차역을 말했다. **목록 항목에 역명이 없어** SR 사용자에게는 그 문장이 화면의 유일한 역 정보원이라, A16이 고치려던 혼란을 새 UI가 재생산할 뻔했다. 고치며 한 겹 더 나왔다 — `waitContextWalk`의 선행 도보는 **원래 승차역까지의 구간**이라 역명만 갈아 끼우면 "3분 걸어 왕십리역에서"라는 새 거짓이 된다(문구째 떨궜다).
- **픽커 플래그가 국면을 넘어 살아남았다**: `boardOverride`는 "소거를 호출부마다 흩뿌리지 않는다"는 이유로 중앙화하고 주석까지 적어 놓고 **같은 수명을 갖는 짝을 그 switch에 넣지 않았다**. 소거를 국면 축으로 둔 이유는 재현 경로의 시작점이 *폴이 일으키는* arrived 전이라 입력 종류 열거로는 잡히지 않기 때문이다. 회귀 테스트는 근사 잠금으로 국면을 왕복시켰다(폴 주기 15초를 안 기다리는 유일한 경로).
- **override 적용 범위가 함수 밖 성질에 기댔다**: `waitContextText`가 다음 구간 안내에도 쓰이는데 leg를 가리지 않아, 무해함의 근거가 "그 시점엔 nil"이라는 **board 소거의 성질**이었다. `isCurrentLeg` 필수 인자(기본값 없음)로 함수 안에서 자립시켰다 — §3.1의 `phase == riding`을 자립적 표현으로 남긴 판단과 대칭이 맞는다.
- **spec 구멍 6건**: 픽커 수명 미규정 · §3.4 두 항목이 서로 배타 · 코드 블록이 구현보다 약함 · 지하철 전용 제한 미기재 · 5번째 키 누락 · 불변식 개수 오타. ⚠ **초판 spec의 결손이 두 플랫폼에 똑같이 복제됐다는 사실이 그것이 구현 실수가 아니라는 증거**였다.
- **리뷰 기록의 정정도 남겼다**: spec 리뷰를 무응답으로 판단해 직접 검증하고 "전부 충족"이라 적었는데, 뒤늦게 도착한 리뷰가 6건을 더 찾았다. 검증 범위가 좁아서가 아니라 **자기 산출물을 보는 관점으로는 안 보이는 종류**였고, 그 판정 기록을 지우지 않고 한계와 함께 spec §5.1에 남겼다.

### 작은 고침 묶음 — A7·A13·A11·G4②와 편승 잔일 6건

판정 세션에서 처방이 확정된 항목을 한 세션에서 닫았다. 계획 `docs/superpowers/plans/2026-08-16-small-fixes-bundle.md`.

- **A7 길찾기 출발지가 낡는다(웹)**: `Coord`에 취득 시각(`at`)을 심고 `LocateOptions.maxAgeSeconds`를 신설해, 조회 출발지는 3분 넘은 캐시만 정밀 재취득한다. iOS는 `LocationFixPolicy.freshTTL`(60초)로 이 축이 이미 있어 무변이다.
- **A13 안내 재시작이 시작 인자를 잃는다(iOS)**: `BeaconModel`이 `StartRequest` 한 벌을 들고 `restart()`가 그것을 그대로 쓴다. `toggle(kind:)` 기본값을 제거했고, 드리프트 가드의 판정 축을 "`toggle` 호출 수"에서 "세션 시작 호출 수"로 넓혀 `restart()`가 시야에서 사라지지 않게 했다(spec `2026-08-15-walk-guidance-ship-design.md` §3.2 표 동조).
- **A11 넓은 부지 목적지의 출입구 승격**: `/api/places/entrance` + 순수 판정 `src/lib/entrance.ts` 신설. 카카오 `교통,수송 > 입출구` 카테고리 + 이름 잔여 토큰 2중 판정으로 부속시설·타 시설 출입구를 거르고 출발지 최근접을 고른다. 이득 게이트(부지 부근 출발 200m·승격 폭 300m)가 승격이 개선일 때만 승격시킨다. 실호출 게이트에서 신명중학교 종점 오프셋이 58.83m → 4.51m로 줄어 도착 반경(15m) 안에 들었다. 설계는 착수 전 적대적 리뷰를 거쳤고 채택·기각 판정표를 spec §8에 남겼다. spec `docs/superpowers/specs/2026-08-16-destination-entrance-promotion-design.md`
- **G4② 업데이트 이력이 미출시 버전을 보여준다**: 설치된 빌드의 `CFBundleShortVersionString`보다 높은 항목을 숨긴다(Kit `compareVersionStrings` 수치 비교 — `1.7` vs `1.7.0`·`1.10` vs `1.9`). 미리 등재하는 관례는 유지.
- **독립 리뷰 2건 반영**: iOS 출입구 조회에 웹과 같은 2초 예산(없으면 upstream 지연이 길찾기 조회 전체를 최대 60초 멈춘다) · 릴리스 노트 전량 폴백 제거(그 분기가 열리는 유일한 조건이 곧 이 필터가 막으려던 누출이었다) · D5 예외 상수 철회(seed에 `34070 계룡시`가 따로 있어 no-op이었다 — 아무것도 바꾸지 않으면서 검증됐다는 인상만 남기는 코드) · `Coord.at` 부재 시 판정을 `undecidable`로(초안은 "지금"으로 도장을 찍어 나이 상한을 무조건 통과시켰다) · D19 가드 테스트 3건.
- **편승 잔일 6건 + D5**: D5(2자리 도시코드가 만든 도달 불가 키 9개 제거) · D18 ①검색 결과 거리 ②웹 "이 지역 상황" 좌표원을 유효 위치로 ③주소 해석 4-state를 부재·실패로 가름 ④Swift `isValid`의 시각 유한성 · D19(판정 측위가 표시 상태를 흔들지 않는 `silent` 옵션) · D20(문구 게이트 사각 2곳: 간접 키 계층·표시줄 자신) · D22(iOS 표시줄이 "권한 있음 + fix 부재"를 실패로 승격) · D23(Swift 소스 가드 3축) · D12(재획득 뒤 상태 텍스트 래치).

## 2026-08-15

### 제출 파이프라인 수정 2건 (1.7 제출 중 발견)

산출물 검사의 버전 대조가 **제출 경로에서 항상 실패**했다 — ASC `versionString`(`1.7`)과 산출물 `CFBundleShortVersionString`(`1.7.0`)은 같은 버전인데 `asc-submit`이 ASC 표기를 그대로 넘겨 문자열 완전 일치 비교가 어긋났다. 게이트를 도입한 마일스톤이 실제 제출로 밟아보지 않아 드러나지 않았다. 세그먼트 비교로 바꾸고 반대 방향(다른 버전은 막는가)까지 테스트로 고정했다(`src/lib/__tests__/release-artifact-version-match.test.ts`). 그리고 `asc-submit`에 `--review-notes`를 더해 심사 노트 갱신을 API 경로로 흡수했다 — 종전엔 그 항목만 ASC 콘솔을 손으로 여는 경로로 남아 있었다(값이 같으면 무변경, appStoreReviewDetail이 없으면 연락처를 지어내지 않고 멈춘다).

### 도보 실시간 안내 정식 출시 (iOS)

수단 축으로 봉인을 분할해 도보만 내보낸다. `AppConfig.realtimeGuidanceEnabled` → `experimentalGuidanceEnabled`로 대체하고 도보 경로(`walkGuideStartable`·`manualOriginNoticeText`)는 플래그를 보지 않는다 — 자동차·대중교통·간략 단독 진입점은 봉인 유지(간략 단독 버튼은 `isTracking ∨ experimental` 조건으로 정식판 실패 상태 화면에서도 차단). 정식 `Info.plist`에 `UIBackgroundModes`(location·audio) 승격, 위치 권한 문구 ko에 거리 안내 절 추가(비한국어는 ko 게이트 안 기능이라 현행 유지), 안내 시트의 화면 켜기 힌트 삭제(백그라운드 승격으로 거짓 문장화 — 진짜 무음은 `soundDegraded`가 런타임 판정으로 알린다). `experimental-infoplist.sh`는 표시 이름 전용으로 축소하고 파일-존재 카운트를 접미사 적용 결과 검증으로 교체. 가드는 소스 드리프트 6종 + 제출 전 산출물 검사. spec `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md`, 계획 `docs/superpowers/plans/2026-08-15-walk-guidance-ship.md`

### 도보 출시 독립 리뷰 처리

리뷰 2건(결함 0건·SHIP / MAJOR 2 + MINOR 6). 반영: 산출물 검사가 ko 권한 문구를 마커뿐 아니라 카탈로그 전문과도 대조(마커만 남기고 문구가 갈린 변이가 종전엔 통과했다), `beacon.toggle` 계수 스캔을 iOS 전체로 확대, 제출 대상 버전·빌드 대조 신설(낡은 아카이브가 통과하던 구멍). **기각 1건**: 공지 문안이 disclosure 펼침 단계를 담지 않는다는 MAJOR 지적은 위원장 판정으로 기각했다(의도적 단순화 — 1회성 공지의 몫은 절차 완전 기술이 아니다). 근거·재개 조건은 `docs/BACKLOG.md` A14. 신규 등재 A15(공지 시트 표시 경합, 추측)·G4.

### 길찾기 탭 도보 안내 공지 모달 (iOS)

길찾기 탭 첫 진입에 1회성 시트(미확인 ∧ 한국어). 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라 **"확인을 누르면 다시 뜨지 않는다"** — 드래그·VoiceOver 탈출은 막지 않고(1급 사용자의 표준 탈출 수단) 저장을 확인 버튼에만 걸어 읽지 않고 닫으면 다음 진입에 다시 뜬다. 제목·소제목 2개는 별도 `Text` + `.isHeader`, 본문은 문단마다 별도 `Text`. 문안은 위원장 확정본(spec §5.4)이고 미판정 항목(A11·A6·A12·최종 접근 상수)은 항목별 열거가 아니라 포괄 문장으로 덮는다.

### Gemini 3.7-flash 교체 기각 + 모델 A/B 실호출 하네스

`gemini-3.7-flash`(2026-08-13 출시) 검증 결과 **3.6-flash 유지**. 비용·지연·필수 도구 선택은 동률인데 장소 앵커 채팅의 날조 축에서 5/5 회귀(도구가 주지 않은 매장 분위기를 `search_web` 우회로 서술). 판정 근거·재평가 트리거는 `docs/BACKLOG.md` C5, 근거 주석은 `src/lib/gemini/client.ts`. 하네스 `src/__ab__` + `npm run test:ab`는 프로덕션 채팅 경로를 그대로 태우고 프로덕션 코드엔 계측 훅을 두지 않는다(클라이언트 프록시 계측). 동형성을 가드 테스트가 아니라 단일 정의로 보장하려고 systemInstruction을 `src/lib/chat/system-instruction.ts`로 분리했다(라우트·하네스 공용, 동작 무변경).

### Gemini 비용 보고 단가를 날짜 분기로

`usage-report.mjs`가 출력 단가를 $7.50 고정으로 써 프로모 기간(~2026-12-31, 실단가 $3.75) 내내 비용을 2배로 과다 보고했다. 단가가 실제로 날짜의 함수라 상수 대신 경계 분기로 바꾸고(2027-01-01 복귀) 경계 양쪽을 테스트로 고정했다.

## 2026-08-14

### 안내 효과음이 끝난 뒤 발화 (웹·iOS)

톤(잔여 0.6초 이상)이 재생 중이면 그 소리가 끝난 뒤에 SR 통지를 게시한다 — 임박 큐·도착 종이 문장 앞머리를 덮던 실보행 결함 해소. 판정은 `speechDeferStep`(Kit·웹 미러), 지연은 단일 슬롯 latest-wins(iOS `DeferredAnnouncer`·웹 재발화 타이머 공유), 변이 주입 10종으로 검출력 실증. spec `docs/superpowers/specs/2026-08-14-guide-speech-after-tone-design.md`

### 안내 중 대안 경로 프리뷰·전환 중립화 (iOS)

안내 시트의 상시 전환 버튼 제거(경로 변경 압박 해소), 진행 상황 조망에 "대안 경로 보기" → 현위치 기준 프리뷰(요약·잔여 비교·스텝) → "이 경로 안내로 전환"(신선 즉시 채택·낡음 재조회 폴백). E10ⓑ 라벨은 "현재 위치부터 다시 안내 시작"으로 교체. spec `docs/superpowers/specs/2026-08-14-guide-alternative-preview-design.md`

## 2026-08-13

### 도착 추정 자동 종료 — 잊힌 안내 세션 정리 (walk 전용)

귀가 실사고(최종 접근 진입 직후 실내 진입 → 도착 판정 부재 → 세션이 수동 종료까지 수 시간 생존) 대응. 최종 접근 국면 + 마지막 확인 거리 ≤150m에서 usable fix 두절 180초(워치독 경로) 또는 앵커 기준 무진행 300초(fix 경로)이면 도착 종 + `.high` 중립 낭독 후 자동 종료, 도착 시트는 확정/추정 문구 분기. 판정은 순수 함수 웹·Kit 미러(`presumedArrivalStep`·`advanceProgressAnchor`, 공유 fixture) + `GuideTuning.presumedArrivalEnabled`(car=false). 설계 적대적 리뷰가 저속 연속 보행 오판(직전 fix 비교 → 앵커 재정의)·거리 캡 부재·자동차 공통 적용 위험을 구현 전 차단. 리플레이 게이트(8-13 실사고 로그)·변이 2종 검출 확인. spec `docs/superpowers/specs/2026-08-13-presumed-arrival-auto-end-design.md`. 상수 4종은 실보행 판정 전 잠정값(BACKLOG E13). 리마인더·대중교통·자동차 축은 범위 제외(E13).

### Overpass 실패 처리 3건 — 대응 범위·타임아웃·예산

`/api/walk/nearby`의 OSM 축이 실패할 때의 동작을 실측 근거로 바꿨다. ①**실패 쿨다운 신설**(60초, 성공 캐시 1시간과 별개): `overpassScope`가 `tile`(부분 응답·malformed)이면 그 타일만, **비200과 scope 없는 실패(클라이언트 타임아웃·네트워크)는 전역**. ②**클라이언트 abort 12초 → 6초**, Overpass `[timeout:N]`은 그 예산에서 유도(`OVERPASS_CLIENT_TIMEOUT_MS`)해 두 값이 갈리지 않게 했다. ③**분당 예산 30 → 10**. 실호출 게이트: 성공 1.35~1.62초 12~13건, 실패 직후 다른 새 타일이 5ms·2ms 즉시 실패(종전엔 각각 6~12초 대기), `audioSignals=ok` 유지로 부분 실패 보존 불변식 무손상. 변이 2종(429를 타일별로·쿨다운 무만료) 검출 확인. 함정은 `CLAUDE.md` 보행 인프라 행이 정본.

**리뷰 반영**: 게이트를 지속 캐시 **앞**에 둔 초안이 무관한 타일의 실패로 이미 캐시된 타일까지 60초간 "조회 실패"로 만들었다(리뷰 검출 → 재현 테스트로 확인 → 게이트를 캐시 미스 확정 후로 이동). 함께 반영: 서버 timeout 유도식 하한 1초, 만료 타일 항목 lazy 정리, 게이트 throw를 실패로 기록하지 않는 순서 불변식(변이 검출 확인). 기각 1건: 비200 전부를 `upstream`으로 분류하는 것이 이론상 4xx까지 전역화하지만 실측 사례가 429·504뿐이라 분기를 추가하지 않았다. 실호출 재검증: 신규 타일 4ms 즉시 실패 + 캐시된 타일은 쿨다운 중에도 ok 11건.

### 성능 3제안 실측 — 2건 기각, 1건 이미 구현

"API 백엔드를 Go로 묶을 실익" 조사에서 파생한 세 후속 제안을 실측했다. **seed 지연 로딩 기각**: seed 5종 `JSON.parse` 합계 2.41ms, 가장 무거운 라우트 모듈 로드 34ms, 로컬 웜 요청 0.54ms로 우리 코드 몫이 프로덕션 콜드 스타트 968ms의 4% 미만이다(Turbopack이 seed를 `JSON.parse('...')` 문자열로 내보내 이미 최속 경로). **Bun 런타임 기각**: 모듈 로드 33.8→5.8ms이지만 웜 요청은 0.54→0.75ms로 느려지고, 절감 28ms는 콜드 스타트의 2.9%다. **Overpass 캐시는 이미 구현돼 있었다**(110m 격자 타일·1시간, 실패 미캐시) — 그래서 문제를 다시 규명해 위 항목이 나왔다. 대안 엔드포인트도 실측 기각(kumi 중위 15.0초·private.coffee 5중 4 타임아웃). 남은 판정 2건은 `docs/BACKLOG.md` E12(OSM seed화)·F-b(웜 핑).

## 2026-08-12

### App Store 1.6 제출 (빌드 12)
1.5 출시 이후 iOS 정식 빌드에 **도달하는** 변경 3종을 담았다: 최근 목록 고정(4목록) · 도보 경로 대안 2행(추천·최단) · 길찾기 결과 섹션 동적 순서. 1.5 아카이브(`aa4b823`) 이후 63커밋 중 실시간 안내 계열 20여 개는 `realtimeGuidanceEnabled` 게이트 안이라 Release에서 도달 불가, 서버 전용(A9 근접역 동명이역·횡단 꼬리 거리 이름 부여·`/api/route/walk` variant 계약)은 웹 배포로 이미 1.5 사용자에게 반영, A8(조회 요약 수치)은 웹 전용이라 제외했다. **도보 대안은 ko 노트에만** 적었다 — iOS 도보 섹션이 `AppLanguage.current == "ko"` 전용이라 조회 자체를 생략하므로 en에 적으면 없는 화면을 찾게 된다. M3의 실보행 판정 잔여분은 전부 실험 구성 안이고 Release에 도달하는 면은 정보 제공 축이라 1.5의 M1과 같은 근거로 판정 전 출시를 받아들였다. 노트는 `docs/appstore/release-notes.md` §1.6.

### 길찾기 결과 섹션 동적 순서 (E11)
결과 섹션 순서를 조회 결과로 결정 — 성공 수단 앞·비성공(경로 없음·실패) 뒤, 도보 성공이 30분 이하(`shouldCollapseWalk` 경계 재사용)면 최상단. 순서는 settled 시점 1회 스냅샷(웹 `QueryResults.orderedModes`, Kit `DirectionsResults.orderedModes` 저장 프로퍼티 + `replacingWalk` 보존 교체)이라 계단 회피 재조회에도 불변. 순수 함수 웹↔Kit 미러(`directions-order.ts` ↔ `DirectionsOrder`)를 공유 fixture로 동조. 첫 성공 포커스·합산 집계도 새 순서 기준. spec `2026-08-12-directions-dynamic-order-design.md` · plan `2026-08-12-directions-dynamic-order.md`.

### 도보 경로 대안 제시·안내 중 전환·이탈 시 제안 (M3+E10ⓑ)
서버 `/api/route/walk`에 옵트인 2종 additive 추가 — `variant=shortest`(Tmap `searchOption=10` 단독, 폴백 없음)·`alternatives=1`(추천+최단 병렬, **기본 실패는 502 유지·최단 실패만 `shortest:null` 흡수**), 금지 조합 2건 400. Tmap normalize가 `includeLineGeometry`로 LineString을 스텝 `pathCoords`에 귀속(최단 실시간 안내의 성립 조건). iOS 조회 화면 도보 섹션은 추천·최단 2행 disclosure(Release·Experimental 공통, 안내 시작 버튼은 경로 귀속으로 행 안 이동), 안내 세션은 `sessionVariant`를 보유하고 시트 "다른 경로로 전환"이 반대 variant로 현위치 재조회(기존 재조회 커밋 경로 재사용). 이탈 확정 회차당 1회 자동 조회 후 **제안**(E10ⓑ 수락제 — 자동 전환 금지 유지): Kit `RerouteProposalGate`(신선도 30m/120초·세션 상한 5회, 잠정값) + `BeaconModel` 상태 머신(latest-wins 토큰·만료 능동 전이·기존 버튼 라벨 전환이 지속 신호). 실호출 게이트가 결함 1건 검출·수정(Tmap 종점 도착 마커가 기하 모드 경로 전체를 거부 → finalApproach 소실). 등굣길 실호출: 추천 956m·최단 689m 이면도로 재현, 시뮬 실측으로 전환(최단→추천) 동작 확인. spec `2026-08-12-walk-route-alternatives-design.md` · plan `2026-08-12-walk-route-alternatives.md`.

### 최근 목록 고정(pin) — 4목록 공통, 웹+iOS
최근 목록 4종(검색어·출발지·도착지 장소·경로)의 각 항목에 고정/고정 해제 액션 추가(iOS는 swipeActions로 VO 로터 자동 노출, 웹은 항목별 버튼 — 両쪽 다 고정이 삭제보다 앞). 고정 항목은 상단 유지(고정 시점 순 자리 안정), cap 20·"모두 지우기" 면제, 라벨 접미사 "고정됨" 단일 텍스트. 토글 직후엔 재정렬하지 않고(포커스 유실 방지) 다음 로드부터 정렬. 검색어 저장은 `{text,pinned}` v2 키로 승계. a11y 감사 MAJOR 2건 반영(웹 통지 동일 문자열 bail out 침묵 → 항목명 포함 통지, iOS `ForEach id: \.self` 행 파괴 → Identifiable 안정 키). 로터 액션 순서·토글 후 커서 잔류는 실기기 검증 대기(spec §7). spec `2026-08-12-recent-pinning-design.md` · plan `2026-08-12-recent-pinning.md`.

### 안내 시트 목적지 메뉴 — 장소 상세 보기·끊김 없는 목적지 전환
안내 시트(도보·자동차·대중교통) 제목을 네이티브 Menu로 교체(헤딩 trait 유지 시도, 실기기 판정 대기). "장소 상세 보기"는 최소 Place 합성(`guideDestinationPlace`, Kit)으로 시트 위 시트, 길찾기 진입 버튼은 문맥상 숨김. "목적지 바꾸기"는 기존 도착지 검색 시트(최근 목록 포함) 재사용 — 도보·자동차는 `BeaconModel.changeDestination`(세션 유지 경로 재획득, `awaitingRoute` 보류로 전환 중 옛 경로 발화 0, 즉시 `.high` 확인 통지), 대중교통은 2단 확정(`prepareDestinationChange` 사이드 채널 후보 → 선택 시 `changeRoute` 세션 연속 교체, stale 120초 재조회 가드, 취소 시 전체 무효). 폼은 출발지 `.current`+도착지 갱신 후 무통지 재조회, 기존 "도착지 변경 = 안내 중지" 가드는 값 결합 1회 소비 플래그로 안내 주도 변경만 통과. 어제(8/11) 실보행에서 목적지 전환에 중지·재검색·재시작이 필요했던 부담의 해소. 적대적 설계 리뷰 13건 중 12건 수용·1건 기각. spec `2026-08-12-guide-destination-menu-design.md` · plan `2026-08-12-guide-destination-menu.md`.

### 실보행 피드백 3종 반영 (오아시스마켓 왕복, 위원장 판정)
①**walk 주기 통지 단문화**: 직진 구간 반복 통지가 다음 스텝 전문(한 문장에 행동 3개)을 싣던 것을 "{target}까지 {distance} 직진하세요" 단문으로 교체(`walkPeriodicLine` ↔ `GuideText.periodicWalk`, target은 현재 스텝 서버 `live` 조각 재사용). 조망은 40m 선행 전문 1회가 담당하고, car는 임박 층이 없어 종전 틀 유지. BACKLOG A5-2 부분 종결(A5-1·A5-3 잔존). ②**투영 지연 보정 15→10m**: `PROJECTION_LAG_M` 하향(15는 실지연보다 커 표시·임박이 실위치보다 앞서갔다), 유도식으로 임박 큐 25→20m 연동. 공유 fixture는 같은 유효 진행거리를 만드는 입력으로 이동해 국면 워크스루 보존. ③**closer 데드밴드 10→6m**: 위원장 "6m 간격" 직접 지정(감쇠 하한 5m 유지). spec `2026-08-11-guide-live-two-rows-design.md` 개정 노트 참조.

### A10 — 최종 접근 진입 거부 데드락 수정 (투영 점프 판정을 리듀서로 이관)
하교 실보행(17:26)에서 확정된 세션 영구 정지 수정. 종전에는 리듀서가 `phase=finalApproach`를 커밋한 뒤 오케스트레이터가 점프 fix의 진입 이벤트를 사후 거부해, 거부된 세션이 0a 가드 국면에 갇혔다(잔여 4m 동결·도착 무통지). 판정을 리듀서 6b **진입 확정 앞**으로 옮겨 이벤트와 phase 전이를 원자화했다 — 리듀서 안에서는 직전 d(`state.d`)·직전 시각(`state.lastFixAt`)이 이미 상태라 별도 기준값 부수효과가 사라진다(백로그가 ②안의 장애물로 지목했던 것). 오케스트레이터 両쪽(`BeaconModel`·`useRouteGuide`)의 `lastRemaining` 기계는 제거하고 추세 톤 게이트는 `GuideOutput.projectionJumped`를 소비한다. 하교 로그의 d 동역학(407.6→458.3→501.2/2s)을 공유 fixture 시나리오로 박아 웹·Kit 양쪽에서 변이 주입(게이트 제거·계수 파손) 검출을 확인했다. spec `2026-08-08-final-approach-guidance-design.md` §3.2 개정.

### A9 — 근접 지하철역 노선 집계의 전국 동명이역 혼입 수정
서울 용산역 앞 prod 응답 `lines`에 대구 용산역의 "대구 도시철도 2호선"이 섞이던 결함(이름만으로 seed 집계). `summarizeStationNear`/`findStationMetaNear`(앵커 = 매칭 seed 레코드 좌표, 복합체 반경 600m — 빌드 가드의 환승 쌍 경계와 동일: 정당 최대 435m·오염 시작 600m)를 신설해 `subway-nearby` 두 지점을 교체했다. 서울 안 동명 분리역(2호선 신촌 vs 경의중앙선 신촌, 701m)도 함께 분리된다. 이름 기반 소비자(채팅 router·`/api/station/meta`)는 좌표 문맥이 없어 종전 `findStationMeta` 유지.

### A8 — 계단 회피 토글 후 조회 요약 수치 갱신
`toggleStepFree`가 `outcomes.walk`만 갈아끼우고 `phase.successCount`를 두어 "N개 수단 준비됨" 낭독이 실제 성공 수와 어긋나던 결함(2026-08-09 최종 리뷰 검출, 낭독 수치라 시각 반증 불가). 토글 재조회 후 성공 수를 재계산해 phase를 함께 갱신한다(변이 검출 확인).

### D10(tsc 절반) — `tsc --noEmit` 기준선 0 회복
선재 테스트 파일 5 error(geolocation mock 튜플 접근 2·`rewriteWalkBriefing` 인자 누락 2·remark fixture 캐스트 1) 해소. 0이 아닌 기준선은 새 에러를 자기 노이즈에 숨긴다는 등록 사유 그대로의 정리.

### 횡단 안내 꼬리 거리에 이름 부여 ("21m" → "횡단보도 길이 21m")
위원장 실사용 지적("다른 거리와 헷갈린다") 반영. `rewriteWalkGuidance`의 횡단 규칙이 내던 벌거벗은 꼬리 거리는 무엇의 거리인지 말하지 않아 구간 잔여·다음 안내까지 거리로 들렸다. 꼬리를 `{횡단보도|지하보도} 길이 {거리}`로 바꿔 라벨을 `kind`에서 가져오므로 지하보도 문장도 같은 형태가 된다. 값 조립은 그대로 `formatDistance` 하나만 통과한다. 문장에 "횡단보도"가 두 번 나오는 중복은 혼동 제거의 대가로 수용했다. 공유 fixture 갱신으로 Kit 동조.

### 상세 안내 closer 톤 간격 단축 (데드밴드 15m → 10m)
위원장 실사용 지적("가까워지고 있다는 사운드 간격이 조금 멀다")을 그날 회수한 실보행 로그로 실측해 반영했다. 실질 간격을 정하는 것은 closer 최소 간격(도보 2초)이 아니라 데드밴드였고, 리플레이 결과 중위 17.5초·15~25초 구간이 절반이었다. 상세 모드에만 별도 상수를 두고(`detailDeadBand` ↔ `DETAIL_DEAD_BAND_M`) 간략 비콘의 15m는 유지했다 — 간략은 직선거리라 GPS 지터가 그대로 실리지만 상세의 잔여 거리는 구속 창 투영·단조 전진·phase 게이트를 거쳐 역행이 구조적으로 없다(로그 5세션 6,047 스텝 역행 0건). 10m에서 중위 11.5초. 자동차는 주행 속도에서 closer 간격 10초가 병목이라 영향이 없고, 정체·신호 대기에서만 도보와 같은 기제로 잦아진다(최대 1.5배, 해롭지 않아 수단을 가르지 않음). 웹↔Kit 드리프트 가드 추가(변이 3종 검출 확인), 재현 스크립트 `docs/superpowers/specs/logs/closer-interval-replay.py` — 리뷰 지적으로 재기준 즉시 1회 톤과 3초 정숙 구간을 반영해 최대 침묵 수치를 교정했다(38초, 미반영 시 86초로 부풀려졌다). 실보행 판정 대상(BACKLOG F-a).

### 경로 목록 모달 닫기 버튼 라벨 축약
실시간 안내 중 낭독 길이를 줄이려 "경로 목록 닫기" → "닫기". 관례 키 `actions.close`로 통합하고 전용 키 `ios.guide.routeListClose`는 6로케일에서 폐기했다.

### 도착지 부근 상황 재구성 M1 — 실사용 판정 통과
위원장 실사용 확인("큰 문제 없었다")으로 유일한 판정 축인 "목적지를 찾는 단서가 됐는가"가 만족됐다. 위원장이 스크린 리더 실사용자이므로 실기기 VO 축 중 사용자가 지나는 면(묶음 제목 점프·한 줄 비분절·WhereAmI 경로)도 같은 판정에 포함된다. 1.5(빌드 11)로 이미 출하됐고, 제출 시점에 "판정 전이지만 정보 제공 축이라 받아들인다"고 적은 판단이 사후 확인됐다. 잔여 두 면(추적 시트 임베드 착지는 실험 경로, 재조회 실패 시 목록 유지는 실패 주입 필요)은 일상 실사용이 닿지 않아 BACKLOG §H M1에 남는다.

### App Store 1.5 제출 (빌드 11)
1.4 출시 이후 iOS 정식 빌드에 **도달하는** 변경 3종을 담았다: 도착지 부근 상황 재구성(내 주변 → 현재 위치 확인 → 주변 확인) · 길찾기 최근 경로 · 설정 업데이트 이력. 같은 창의 실시간 안내 커밋 20여 개는 `realtimeGuidanceEnabled` 게이트 안이라 Release에서 도달 불가고, 서버 전용 변경은 웹 배포로 이미 반영되어 제외했다. 노트는 `docs/appstore/release-notes.md` §1.5.
`asc-submit.mjs` 두 가지 개선: **프로모션 텍스트 자동 승계**(비어 있을 때만 직전 버전 값 PATCH — 1.1~1.4가 네 번 연속 수동 복사였다, BACKLOG D9 종결)와 **제출 3호출의 재사용화**(생성·항목 추가·제출이 각각 기존 것을 재사용 — 이번에 마지막 `submitted:true` PATCH만 ASC 500으로 죽었고, 그대로 재실행하면 미제출 submission이 하나 더 생기는 구조였다). 아카이브는 병렬 세션과 소스가 섞이지 않도록 `git worktree`로 커밋을 격리해 빌드했다.

### 안내 시트 컨트롤 재편 — 전환 버튼 폐지·주변 확인 상향·도착 종료 화면
위원장 실사용 판정 3건 반영(iOS). ①상세⇄간략 전환 버튼 폐지(무용 판정) — `toggleMode`·간략→상세 해소 기계(`resolveDetailIfPending`)까지 제거, `speedSuggest` 이벤트는 Kit 공유라 소비만 no-op. ②주변 확인을 말미 별도 섹션에서 전환 버튼 자리(진행 상황 다음)로 이동 — 말미 배치는 안내 정보 행을 읽다 보면 다음 스와이프가 자꾸 버튼에 닿았다. ③도착 종료 화면 신설 — 도착 즉시 시트가 닫혀 경로 조회 결과로 떨어지던 전이를 대체(`arrivalDest` 유지, 대중교통 핸드오프 제안 §14.2 동형): 도착 헤딩+도착 문장(포커스 착지)+주변 확인(목적지 앵커)+닫기. 웹 DistanceBeacon 미러는 BACKLOG B5.

### 실시간 도보 안내 하단 2행 재설계 — 현재 행동 실시간 갱신 + 다음 안내 예고 (H M0)
실보행 라운드2 최상위 피드백 반영. 윗줄 = 현재 행동(직진 미터 카운트다운 → 10m부터 "{n}m 후 {행동}" → "잠시 후" / 횡단·상태 대체·최종 접근 문형), 아랫줄 = "다음 안내," 종류별 예고 — 종전 currentText/statusText 자리를 walk 상세에서 대체(car·간략은 불변). 표시 좌표계 `effectiveD = d + min(15, 기준점 이후 진행)` 통일 + `IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M` 유도식 재정의(값 25 불변, 기존 음성 fixture 웹·Kit 전체 무수정 통과가 증명 게이트). 리듀서형 `guideLiveRows` 웹 ↔ Kit 미러 + 공유 fixture(실경로 8스텝 근사, ko 최종 문자열 대조). 서버 `rewriteWalkGuidance`가 `live{target,anchor}` 조각을 `includeGeometry=1` 응답에 노출 — 실호출 게이트가 까지 절 없는 문형의 anchor 유실을 검출·수정(6/6 스텝 조각 확인). spec `2026-08-11-guide-live-two-rows-design.md`, 실보행 판정 축 5건은 BACKLOG §H M0.

## 2026-08-10

### 실보행 라운드2 판정 종결 — 피드백 반영분 전부 만족
위원장 저녁 왕복 실보행(자택↔주택 A, 両다리 완주)으로 라운드1 반영분 전원 만족 판정. 종결 5건: ①도보 임박 큐·도착 종 판정 ①~⑥(25m 임박 큐·분류 커버리지·도착 종 가청·무톤 전환·진동·정숙 구간 — spec `2026-08-09-walk-imminent-cue-design.md` §4) ②진행 상황 조망·하단 2행 판정 ①~⑤ 및 라운드2 ⓐⓑⓒ(조망 모달·2행 분리·"다음 안내," 라벨·횡단보도 행동 문장 — spec `2026-08-10-guide-progress-overview-design.md` §7) ③이탈 재조회 수정 확인(재조회 `.high` 통지·현위치 시작·재이탈 없음) ④현위치 수동 지정 실기기 판정 ⑪건 ⑤최근 경로+업데이트 이력 실기기 확인. 종결분에서 승계 2건: 대중교통 탑승 버튼 `.high` 판정 → 실승차 재판정 ⑨, endpoint 검색 시트 통지 승격 → BACKLOG D13. 계측 로그 `docs/superpowers/specs/logs/guide-diag-2026-08-10.log.gz`(같은 세션에서 유도 방위 축이 첫 결정 표 verdict=on 240행 — A6 §7 3단계 판정은 별도 진행).

### 자동차 안내문 재작성 — "오른쪽 방향 후" 계열 「후」 결합 파손 해소
실주행 리포트(길동→주택 B, "오른쪽 방향 후"가 어색)로 발견. Tmap 실호출 전국 12경로 212문장 전수 조사로 상태·위치 명사+「후」 결합 파손이 53%(112문장)임을 확정하고, 도보 `rewriteWalkGuidance` 동형의 서버 재작성(`src/lib/car-guidance.ts`, `getCarRoute` 진입점 적용)을 신설 — "오른쪽 길로 들어선 뒤"·"터널을 지나"(지점명 중복 흡수 포함)·"입구로 들어선 뒤/출구로 나온 뒤". 회전 계열·출발·도착·미지 어휘·카카오 폴백은 원문 통과(fail-safe). turnType 117/118은 코퍼스 실측(도로 유지 48%/69%)으로 회전이 아니라 갈래 선택임을 확정 — "우회전" 치환 금지를 계약에 박았다(`docs/INTEGRATIONS.md` §자동차 경로).

### 역 seed 인접역 좌표 혼입 수정 (4호선 이촌역 = 신용산 좌표)
CLI 실사용 리포트(Windows, `nearby subway`)로 발견 — 신용산역 앞에서 실거리 1km의 이촌역이 8m 최근접 1순위로 잡혔다. 원인은 표준데이터 XLSX 원본이 4호선 이촌(국립중앙박물관) 레코드에 한 정거장 옆 신용산역 좌표(907m 오차)를 담은 것. `COORD_FIXES` 보정(카카오 실좌표) + 환승 쌍 거리 가드 신설(동명이고 한쪽 이상 환승인 쌍이 600m~30km면 빌드 중단 — 인접역 혼입은 노선 연속성 축의 사각, 변이 주입으로 검출 확인, 오탐 0). seed 변경은 이촌 1건.

### 길찾기 최근 경로 + iOS 설정 업데이트 이력
길찾기 조회 완료(settled) 시 출발·도착 쌍을 기기 로컬에 기록해(최대 20, 쌍 dedupe, 현재 위치는 nil/null 투영) 결과 없는 화면에 최근 경로 섹션으로 노출한다(웹·iOS). 활성화=두 필드 확정+즉시 조회+조회 버튼 포커스 선점, 삭제는 기존 최근 검색 계약을 그대로 따른다(iOS 스와이프=로터, 웹 삭제 버튼). 저장은 웹 `src/lib/recent-searches.ts` ↔ iOS `RecentSearchStore`(`RecentRoute`) 미러.
iOS 설정에 업데이트 이력 화면을 추가했다 — `docs/appstore/release-notes.md`(정본) → `scripts/build-release-notes.mjs` → 번들 `release-notes.json`(1.1~1.4) → `ReleaseNotesView`(버전 heading 로터 점프, ko 외 5개 언어는 en 폴백). 드리프트 가드는 `src/lib/__tests__/release-notes-bundle.test.ts`.
a11y 감사 반영으로 최근 경로 삭제·전체 지우기 통지를 `.high` 우선순위로 올렸다(자기 소멸 버튼이 기본 우선순위 통지를 잠식하는 패턴 재발 방지).
spec `docs/superpowers/specs/2026-08-10-recent-routes-and-release-notes-design.md`.

### 실시간 안내 실보행 라운드1 반영 (같은 날 아침 실보행 4건)
①"현재 안내" 행을 발화 이벤트 연동에서 **현재 구간 상태 유도**로 전환(웹·iOS) — 발화는 경계 40m 선행+1회 래치라 짧은 구간의 15초 재통독이 선행분을 덮은 뒤 영구 고착됐다(마지막 구간 내내 횡단보도 안내 잔류 실사고). ②상태 행의 주기 예고에 "다음 안내," 라벨(iOS 표시 전용, 음성 불변). ③횡단보도·지하보도 재작성을 행동 동사 우선으로("메가 MGC커피 앞에서 횡단보도를 건너세요, 21m" — 서버라 웹·iOS·CLI 동시 반영). ④임박 큐 10m→**25m**(GPS·투영 지연 ~15m가 10m를 잡아먹어 회전을 지난 뒤 발화, 차도 진입 위험 실사고 — 위원장 25m 지정). 공유 시나리오 fixture 재계산 포함. spec `2026-08-10-guide-progress-overview-design.md` §8.

### 실시간 안내 진행 상황 조망 + 하단 2행 분리 (실보행 판정 대기)
실보행 피드백(2026-08-09) 반영 3건, 웹·iOS 미러. ①진행 상황 버튼을 조망형으로 재설계 — 서수 위치("안내 12개 중 5번째 구간")+잔여(+근거 있을 때만 시간)+현재 스텝 전문+다음 스텝. 종전 응답은 주기 통지와 뒷부분이 동일해 고유 정보가 0이었다. iOS는 버튼이 전 구간 조망 모달을 연다(현재 구간 표식, 조망 문장은 모달 헤더가 전달. 초판 인라인 펼침은 위원장 1차 확인 "탐색 개체 과다"로 당일 모달 전환. 웹은 목록이 이미 화면에 있어 의도적 비적용). ②하단 상태를 역할 고정 2행으로 분리 — "현재 안내" 행(`currentGuidanceText`/`currentText`, 실행 안내 시점에만 갱신)+상태 행(기존 슬롯). iOS는 구간을 넘는 순간 상태 행을 비워 중복·낡은 예고 잔류를 제거(전경 복귀 재생은 현재 안내 폴백, 위원장 승인 후 당일 강화). ③묶음 통독 개수 제거("다음 안내. A. B"). spec `docs/superpowers/specs/2026-08-10-guide-progress-overview-design.md`.

### 도착지 부근 상황 재구성 M1 — iOS 이식 (실보행·실기기 VO 판정 대기)
계산이 전부 서버 라우트에 있어 Swift 계산 미러 없이 소비 계층만 이식했다: Kit에 서버 JSON 1:1 Codable 모델+엔드포인트(`NearbyService.surroundingsScene`, fixture는 prod 실캡처 entrance·compass 2종), 앱에 임베드 섹션(`SurroundingsSceneSection` — `NearbyLoadCore` `.fixed` 앵커 + 묶음별 `RevealWindow`, 통지는 Announcement 없이 포커스·라벨 채널만), 진입점 2곳(WhereAmI 정위 좌표·추적 시트 목적지 좌표, `BeaconModel.dest` 읽기 노출). 시뮬레이터 prod 실호출로 트리거→묶음 헤딩→더 보기→닫기 전 경로 검증.
편승 수정: 임박 큐의 동적 i18n 키 조립을 린터 계약대로 리터럴 switch로 교체(키 누락 무증상 결함 차단). plan `docs/superpowers/plans/2026-08-10-surroundings-scene-ios-port.md`.

### 도착지 부근 상황 재구성 M1 — 웹 + 계산 코어 (실보행 판정 대기)
"여기가 맞나"를 확인하는 요청형 기능. 도로명주소 홀짝(시행령 제7조④)과 juso 건물 목록 최소제곱 축 복원으로 **입구를 마주 본 기준의 왼쪽·오른쪽·맞은편·건물 너머** 묶음을 조립한다(추가 데이터 소스 0). 축을 못 세우면 절대 방위로 물러난다(3-state). 진입점은 "내 주변 → 현재 위치 확인" 결과 아래와 안내 시트 두 곳, 앵커는 각각 정위에 쓴 좌표(수동 위치 자동 반영)·목적지 좌표.
카카오 카테고리 18종 전부를 받도록 provider를 인자화했고(둘러보기 기본 10종 불변), 임베드 UI는 live region 없이 포커스·라벨 채널로 통지한다(DistanceBeacon 단일 live 계약이 강제).
검증: 변이 주입(부호 반전 7/14 파손), 실호출 게이트 6/6(신명중 골목 축·강동구청 맞은편·자택 아파트 좌우·망원시장 compass 폴백·수원시청·해외). spec `docs/superpowers/specs/2026-08-09-arrival-surroundings-design.md`, plan `docs/superpowers/plans/2026-08-09-arrival-surroundings.md`.

## 2026-08-09

### 도보 결정 지점 10m 임박 큐 + 도착 종소리 절단 수정 (판정 대기)
위원장 도보 안내 실사용 피드백. 결정 지점 안내가 두 층이 됐다: 40m 전문 낭독(`announceSteps`, **무톤**으로 전환)이 *무엇을* 할지, 새 10m 임박 큐(`imminent`)가 *지금이다*를 알린다. `ahead` 톤이 40m에서 10m로 옮겨 왔고 실측 파형에 동기한 햅틱과 짧은 명령형 문장("잠시 후 왼쪽으로 도세요"·"잠시 후 횡단보도를 건너세요")이 함께 나간다. 문구 선택은 신설 `walkStepAction`(웹 ↔ Kit 미러)이 서버 재작성 문장에서 회전·횡단보도·지하보도를 읽어 맡고, 분류가 없으면 큐 자체가 나가지 않는다(미분류의 정답은 오안내가 아니라 침묵). walk 전용이다.
발화 조건은 `imminentUpTo < announcedUpTo`이고 그래서 이 블록이 전문 낭독보다 앞이다 — 전문 없이 명령만 내보내지 않으면서, 30m 횡단보도 유닛에서 전문에 밀려 모퉁이를 지나 울리던 문제도 함께 막는다.
**도착 종소리**는 `playTone(.nearby)` 다음 줄의 세션 원복이 2.2초짜리 재생을 백그라운드에서 잘라 왔다(정지 톤 1.3초도 같은 경로). 순서 규칙으로는 못 막는 결함이라 `endSession()`이 재생 잔여 시간만큼 원복을 미룬다. 전경에서는 증상이 없어 손에 들고 하는 시험이 통과시켜 온 계열이다.
검증: 공유 fixture 4종 + `toneNull` 단언 축 신설, `walk-action-cases.json` 신설. spec `docs/superpowers/specs/2026-08-09-walk-imminent-cue-design.md`.

### 현위치를 사용자가 직접 지정한다 (웹·iOS 1.4)
GPS가 실내에서 못 잡거나 다른 곳을 잡을 때 스스로 고칠 수단이 없었다. 채팅·검색·내 주변 첫 줄에서 위치를 눌러 장소를 검색해 고르면 그 자리를 현재 위치로 쓴다. 지정 위치는 "내 주변" 전 도메인·검색 거리·**채팅 앵커**·길찾기 출발지에 반영되고, 우선순위는 **장소 앵커 > 수동 위치 > GPS**다.
자리를 옮기면 자동으로 해제하고 통지한다. 판정 기준점은 장소 좌표가 아니라 **지정 시점의 실측 fix**(`origin`)다 — 장소 검색 결과는 건물 중심이나 대표 출입구라 같은 자리에서도 100m 넘게 떨어져 오해제가 난다. 이동 판정은 양쪽 오차 원을 차감한 `separation`으로 재고, 판정 왕복 중 재지정은 `revision` CAS가 가른다. 트리거는 셋(앱·탭 시작 · 포그라운드 복귀 · `force` 조회)이고 전부 `force:true`다 — 캐시를 읽으면 이동을 영영 놓친다.
**실시간 안내는 실좌표만 쓴다.** 봉인의 실제 1선은 구조다(안내 진입점이 좌표를 인자로 받지 않는다). 브리핑과 안내의 출발지가 다를 수 있다는 사실은 시작 전에 알린다 — 웹은 단일 live region에 합치고 iOS는 정적 텍스트다(조회 후 포커스 이동 계약이 반대라 수단이 갈린다).
라벨은 `origin` 유무가 아니라 **마지막 판정 결과까지** 본다(`isManualLocationVerified`, 웹↔Kit 미러). 그러지 않으면 권한 철회·실내 측위 실패에서 검증 가능형 라벨이 나와 더 나쁜 상태가 더 안심시키는 역전이 된다.
검증: 변이 주입 30종(19 + 최종 수정 11) 전부 red 실측. spec `docs/superpowers/specs/2026-08-09-manual-location-design.md`, plan `docs/superpowers/plans/2026-08-09-manual-location.md`.

### 지하철 빠른 하차 문 번호 표기 (비한국어 4로케일)
`"door {door}"`가 명사구로만 읽혀 "거기서 내려라"인지 "그게 5번 문이다"인지 갈리지 않았다. 한국어는 조사가 위치를 표시하지만 영어·스페인어·프랑스어·이탈리아어는 전치사가 필요하다. `"at door {door}"` 계열로 고쳤다.


### 이탈 판정에 방위 축을 더했다 (A6, 판정 대기)
갈림에서 사용자가 반대로 갔는데 82초 동안 안 가는 길의 스텝을 계속 낭독하던 문제. 원인은 판정 축이 수직거리 하나뿐인 것이었고, 재현해 보니 진단이 한 겹 더 있었다 — 그 경로는 ㄷ자로 돌아오는 기하라 이탈 궤적이 **경로의 다른 구간**에 가까워지면서 수직거리가 13m → 4m → 48m로 단조롭지 않았다. 임계를 낮추는 방식으로는 못 고친다(목표 시각의 수직거리가 12m로 GPS 오차와 구분되지 않는다).
진행 방위를 경로 접선과 비교하는 축을 수직거리와 **독립**으로 두고 확정을 OR로 했다. `courseAccuracy`를 통과권이 아니라 불확실성으로 써 `mismatch`/`match`/`unknown` 3-state로 표결하며, 창의 분포로 확정·해제한다. 2-state 다수결은 잡음이 독립일 때만 성립하고 지속 편향에서는 오류를 반복 관측으로 승격시킨다. 축마다 latch를 따로 들어 복귀는 활성 축이 모두 해제될 때만 성립한다.
⚠ **이 변경은 A6을 닫지 않는다.** 상수는 전부 잠정값이고 실보행 로그가 정본이다(spec §6·§7). 보수적 출발점으로 임계를 60에 두었다 — 잡음 모델 실측에서 45는 검출을 54→27초로 줄이지만 가혹 조건 헛경고가 23%였고 60은 54→46초에 4.0%였다. 시각장애 사용자에게 거짓 이탈 경고는 지연보다 해롭다는 판단이다. 축은 보행 전용이고(`GuideTuning.courseAxisEnabled`) 웹은 방위 불확실성 필드가 없어 꺼져 있다. spec `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`, plan `docs/superpowers/plans/2026-08-09-off-route-course-axis.md`, 계약 `docs/INTEGRATIONS.md` §이탈 판정 방위 축.

### 도보 안내 fix 진단 로그 (실험 빌드 전용)
방위 축 파라미터를 정할 근거를 만든다. 매 fix의 원시 센서값(위치·정확도·course·courseAccuracy·속도·모션·age)과 판정 결과(국면·진행거리·수직거리·그 fix의 표·창의 표 분포·축 latch·판정)를 남긴다. 게이트를 통과시킨 결과만 남기면 게이트가 무엇을 걸렀는지 알 수 없고, 그 판단이 옳았는지가 파라미터 확정의 핵심 질문이다. 릴리스 빌드에서는 no-op이다.

## 2026-08-08

### 이탈 후 재조회가 실제로 현재 위치를 쓴다
위원장 실보행(자택 → 고우헤어)에서 발견. 이탈해서 "경로 다시 조회"를 눌러도 새 위치 기준 안내가 오지 않았다. 원인이 셋이었다. 웹은 `fetchGuideRoute`가 공유 위치 스토어를 force 없이 읽어 세션 최초 좌표로 같은 경로를 다시 받아 왔고(스토어에 TTL이 없어 한 번 `ready`가 되면 갱신되지 않는다), iOS는 재조회 **성공** 통지만 기본 우선순위라 버튼이 사라지며 커서가 중지 버튼으로 옮겨가는 낭독에 잠식됐으며(같은 함수의 실패 경로는 `.high`였다), 두 플랫폼 모두 성공 통지가 첫 안내 문장 하나뿐이라 그것이 새 경로인지 원래 경로의 다음 스텝인지 구분되지 않았다. 화면 출발지 필드는 길찾기 입력값이라 세션이 갱신하지 않으므로 낭독이 유일한 채널이다.
`force`는 기본값 없는 필수 인자로 뒀고(생략이 조용한 결함이 되는 자리다), 재조회 통지는 시작 통지와 같은 구조로 "현재 위치에서" 다시 찾았음과 새 경로의 규모를 함께 준다. 시작 조회를 정밀 재취득으로 바꾸면서 GPS 락 대기 창이 넓어져, 그동안 간략 안내가 상세 시작 요약보다 먼저 나가는 이중 발화가 생길 수 있었다 — iOS에만 있던 `awaitingRoute` 억제를 웹에 이식해 막았다(독립 리뷰 검출). 회귀 가드는 `src/hooks/__tests__/useRouteGuide.reroute.test.tsx`이고 세 축 모두 변이 주입으로 검출을 확인했다.

### 마지막 몇 미터 — 경로 종점 이후 오프셋 구간 안내
도보 경로는 목적지가 아니라 가장 가까운 보행로 지점에서 끝난다(실측 오프셋 16~89m). 종전 인계는 "경로 잔여 50m"였고 그 판단은 "경로 종점 = 목적지"를 전제했으므로, 오프셋 89m 목적지에서는 실제 목적지까지 139m 지점에서 경로 추종이 꺼지고 그 뒤로 아무 말도 하지 않았다. 이제 경로를 종점까지 따라간 뒤 남은 오프셋 구간을 직선으로 다루고, 종점에서 목적지의 배치(방향·거리·기준 도로명)를 1회 서술한 다음 15초 주기로 짧게 통지하며 도착까지 간다. 시간 상한은 두지 않는다.
오프셋의 거리·방향은 경로 수신 시점에 폴리라인에서 결정론적으로 계산되므로 GPS·나침반이 필요 없다. 실시간 상대 방향은 `course` 3-state 게이트를 통과할 때만 말한다.
정본: [spec](docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-08-final-approach-guidance.md) · [조사](docs/research/RESEARCH-2026-08-08-last-few-meters.md).

### 지하철 빠른하차 출입문 병치
하차역·방향별로 계단·엘리베이터에 가장 가까운 칸·문을 승차 전에 안내한다. 서울교통공사 빠른하차 데이터 2,358행을 정적 seed로 굳혀 런타임 upstream 호출이 없다. 1~8호선 범위이고 분기역·급행·방면 미확정은 침묵한다.
정본: [spec](docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md) · [plan](docs/superpowers/plans/2026-08-08-subway-quick-exit.md). 백로그 E5 종결.

### 계단 회피가 실시간 안내까지 전달
브리핑에서 계단 회피를 켜고 안내를 시작하면 안내가 따라가는 경로는 계단 회피가 꺼진 기본 경로였다. 안내 세션이 현재 위치 기준으로 재조회하면서 `accessible`을 빠뜨렸고, 화면과 귀가 다른 경로를 가리키는데 어느 쪽도 오류를 내지 않아 실패가 조용했다.
정본: [spec](docs/superpowers/specs/2026-08-08-walk-guidance-stepfree-design.md) · [plan](docs/superpowers/plans/2026-08-08-walk-guidance-stepfree.md). 백로그 A4·D1 종결.

### 백그라운드 사운드·톤 커버리지
잠금·백그라운드에서 톤도 음성도 들리지 않던 것을 톤은 남기고 음성만 억제하는 구조로 바꿨다. 안내 톤 판정을 배타적 계층(신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축)으로 재편하고, 정지 판정을 도플러 3-state로, fix 부재 감시를 타이머 워치독으로 세웠다. 소리 9종.
정본: [spec](docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md) · [plan](docs/superpowers/plans/2026-08-08-background-tone-coverage.md).

## 2026-08-07

### 길찾기 화면 재편
ODsay 정규화를 "정규화(전체) → 강등(전체) → 선정(5) → 축 라벨" 파이프라인으로 교체했다. 종전에는 선정이 강등보다 앞이라 운행 중인 유일한 무환승 경로가 목록 밖에 묻혔다. 대안 축은 최단·최소환승 둘이고 운행 시간 밖 경로는 축 후보에서 뺀다. 도보 구간에 거리·행선지를 실었다.
정본: [spec](docs/superpowers/specs/2026-08-07-directions-view-restructure-design.md) · [plan](docs/superpowers/plans/2026-08-07-directions-view-restructure.md).

### 안내 문장 어순 재배치
자동차 실주행 피드백에서 출발. 한 자리에 완결 서술문과 목적지 명사가 번갈아 들어와 낭독이 어긋났다("…300미터 이동까지 약 129미터"). 틀을 값 타입별로 둘로 갈랐다: 서술문은 `{거리} 앞 {안내}`, 목적지는 `{목적지}까지 {거리}`.

### 대중교통·도보 문구 다듬기
같은 계열 결함이 대중교통·도보에도 있는지 전수 점검했고 없음을 확인했다. 실사용 지적 3건을 반영: 승·하차에 조사 추가(`{역}에서 승차`), 수단별로 갈리던 단위를 `{count} 정거장`으로 통일, 버스 번호에 `{route}번 버스` 표기. 도보 안내문은 provider 원문 재조합 금지 계약을 뒤집고 서버가 다시 쓰도록 바꿨다(거리 침묵 39%·괄호 도로명·"왼쪽길로" 3건이 근거).

## 2026-08-06

### 실시간 안내 실사용 피드백 라운드1 (M0~M5)
위원장 실승차 피드백 13건에서 출발한 마일스톤. M0 즉효 4건, M1 추적 정보 품질, M2 대기 국면 탈출구·계측, M3 경유역 목록·도보 핸드오프, M4 속도 가드·백그라운드 위치 승격, M5 대안 경로에서 안내 시작. 경로 대안 데이터원 채택은 보류(백로그 E6).
정본: [plan](docs/superpowers/plans/2026-08-06-realtime-guidance-feedback-r1.md).

### TAGO 지하철 API 업스트림 복구
`resultCode 01 "서비스키는 필수입니다"`가 포털 개편 작업 오류로 확인되어 조치됐다(2026-08-04 오류신고 회신). 코드 변경 0으로 소비자 3곳(역 시간표·대중교통 경로 지하철 구간·지하철 4-state)이 전부 정상 복귀했다.

## 2026-08-04

### 실시간 길 안내 봉인 후 1.3 출시
수단별 경로 안내가 실주행·실승차 판정 대기이고 거리 추적은 그 마일스톤의 중간 계단이라 단독 출시가 성립하지 않아 두 층을 함께 봉인해 내렸다. 봉인은 revert가 아니라 플래그다.

### 실험 기능은 빌드 구성이 가른다
플래그를 손으로 고치던 방식을 폐기하고 `Experimental` 빌드 구성을 신설했다. 실험판은 번들 ID `.dev`·표시 이름 "…실험"·전용 아이콘으로 공식판과 한 기기에 공존한다. 릴리스마다 코드를 고칠 일이 없어졌다.

### data.go.kr 평문 http hang 수정
프로덕션 대중교통 길찾기가 71초 걸려 앱 타임아웃으로 실패했다. `apis.data.go.kr`에 평문 http로 붙으면 TCP 연결까지는 되고 응답이 오지 않는다(같은 요청이 https로는 0.07초). 세 파일 https 전환 + 10초 타임아웃. 실측 71초 → 0.89초.

### B2: 대중교통 실시간 길 안내
수단별 진입점의 마지막 수단. 신호 정본은 GPS가 아니라 도착 API의 차량·열차 식별자다. 차량 도착과 사용자 하차를 구분해, 도착은 자동 통지하되 다음 구간 전환은 사용자 확인으로 둔다.
정본: [spec](docs/superpowers/specs/2026-08-04-transit-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-04-transit-guidance.md).

## 2026-08-03

### B1: 수단별 안내 진입점 재편 + 자동차 안내
길찾기 뷰 수단 섹션마다 "도보/자동차 안내 시작"을 두고, 리듀서를 수단별 프로파일로 갈랐다(차량은 임박·예고·이탈 임계가 도보와 다르다).
정본: [spec](docs/superpowers/specs/2026-08-03-mode-entrypoints-car-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-mode-entrypoints-car-guidance.md) · [조사](docs/research/RESEARCH-2026-08-03-mode-specific-guidance.md).

### 실시간 길 안내(E4)
"거리 추적"이 "실시간 길 안내"로 확장됐다. 간략(직선거리)·상세(경로 추종형, 도보·ko 전용) 2모드를 한 시트에서 제공한다. 사운드 8종을 위원장 청취로 선정해 교체했다.
정본: [spec](docs/superpowers/specs/2026-08-03-realtime-route-guidance-design.md) · [plan](docs/superpowers/plans/2026-08-03-realtime-route-guidance.md).

### 실사용 피드백 묶음 A
"현재 안내 반복" 버튼 제거 확정, "가까워지는 중" 통지를 잔여 거리 적응형 사다리로 완화(멀어지는 중은 경고라 50m 고정 유지 — 비대칭이 정책이다), 상세 모드에 경로 기준 잔여 거리·예상 시간 상시 표시.

### GEO 대응
소개·FAQ 페이지 + JSON-LD + llms.txt 프로덕션 검증.

## 2026-08-02

### 위치 정확도 A3
단발 위치 취득이 게이트(30m·10초)+타임아웃+세대 토큰으로 바뀌고, 정밀 위치 꺼짐이 별개 상태가 됐다. "정확한 위치 허용" 버튼이 그 자리에서 시스템 팝업을 띄운다.
정본: [spec](docs/superpowers/specs/2026-08-02-location-accuracy-design.md).

### 거리 표기 정본 통일
"1km 200m" 나눠쓰기를 하루 만에 폐기하고 소수 km 원값(`1.1km`·`6.285km`)으로 되돌렸다. 3벌 정본(웹·Swift·CLI)에 가드가 없어 지역 사본 4곳이 갈려 있었고, 그중 CLI·iOS 도보 요약은 850m를 `0.8km`로 내고 있었다. 드리프트 가드 3종 신설.

### 거리 추적 실보행 통과
위원장 실보행에서 목적지 거리 추적이 정상 작동해 백로그 F-b가 닫혔고 B1이 확정됐다. 추적 시트를 "시작 = 표시, 중지 = 닫힘"으로 1:1 묶어 "닫혔는데 추적은 살아 있는" 상태를 없앴다.
정본: [spec](docs/superpowers/specs/2026-08-02-beacon-feedback-design.md).

### TAGO 미커버 지역 버스 안내
강릉에서 터미널·역 바로 앞에서도 0건이라 "주변에 정류소가 없습니다"가 낭독되던 거짓말을 고쳤다. 조회 반경이 약 700m 고정이라 0건 대부분은 미커버가 아니라 정상적인 반경 밖이고, 판정을 0건일 때만 발동시키자 인접 지역 반례가 전부 사라졌다.
정본: [spec](docs/superpowers/specs/2026-08-02-bus-uncovered-region-design.md). 백로그 A2 종결.

### 지역별 미제공 표기 + 지하철 최근접 역
따릉이·문화행사처럼 서울에만 있는 도메인을 조회 없이 즉답한다. 판정선은 그 도메인의 조회 반경에서 유도해 상수 복제를 없앴다. 지하철은 거리가 전국에 연속 분포해 어떤 임계값도 자의적이라 판정 대신 최근접 역을 싣는다.

부수로 seed 좌표 혼입을 잡았다: 경의중앙선 양원역 레코드에 동명이역인 영동선 양원역(경북 봉화)의 좌표가 들어 있었다.

### 내 주변 지하철 4-state
심야에 근접역이 전부 사라져 "주변에 지하철역이 없습니다"가 낭독되던 것을 고쳤다. 실시간 API의 `INFO-200`이 "운행 시간 밖"과 "실시간 미제공 역"에 함께 쓰이는데 후자로만 읽어 역을 숨겼다. 역은 어떤 상태에서도 목록에서 빼지 않고 4-state로 가른다.

### 스크린리더 통지 문장 전수 정리
"잠시 후 다시 시도해 주세요"류 자명한 꼬리 문장을 걷어냈다(여러 문장 문자열 41 → 35건). 판정선은 "뒷문장이 새 정보를 주는가"다. `route.briefing.disclaimer`의 "실제 경로는 길찾기 앱을 이용하세요"는 잉여인 데다 타 앱 사용 권유로 읽혀 특히 제거 대상이었다.

### 포커스 착지 2건
길찾기 탭 시트 확정 후 커서가 최상단으로 이탈하던 것과, "이 장소 주변" 4종이 로드 완료 후에도 커서가 네비게이션 바에 남던 것. 공유 계층 `NearbyFocusLander`로 시퀀스를 한 곳에 뒀다.

## 2026-08-01

### 실시간 인구 혼잡도
서울 `citydata_ppltn` 116개 영역. 종전 보류 사유("영역 경계 미공개")가 사실이 아니었음이 드러났다 — 전체 `citydata`의 지하철역·버스정류장 좌표가 그 영역을 정의한다. 판정은 중심-반경 원이 아니라 최근접 구성 지점 300m다.
정본: [spec](docs/superpowers/specs/2026-08-01-realtime-congestion-design.md) · [plan](docs/superpowers/plans/2026-08-01-realtime-congestion.md).

### 근처 문화행사
서울 `culturalEventInfo`. 10번째 "내 주변" 도메인. 안전한 페이지 절단선이 없어(진행 중 행사가 183~18,587행에 흩어짐) 전수 수집을 일자 키 캐시로 감쌌다.
정본: [spec](docs/superpowers/specs/2026-08-01-nearby-culture-events-design.md) · [plan](docs/superpowers/plans/2026-08-01-nearby-culture-events.md).

### data.go.kr envelope 파서 공용화
중복이 6벌이 아니라 25지점이었다. 9벌이 같은 모양을 다르게 읽어 원시값을 감싼 유령 항목(전 필드 `undefined`)과 조용한 전멸을 만들고 있었다. 설계 경계는 "모양은 공용, 봉투 정책은 provider".
정본: [spec](docs/superpowers/specs/2026-08-01-datagokr-envelope-design.md) · [plan](docs/superpowers/plans/2026-08-01-datagokr-envelope.md).

### 좌표 파라미터·서울 열린데이터 위장 제거
오류로 보이지 않는 오류 둘을 걷어냈다. 좌표 누락이 `Number("")===0`으로 (0,0)이 되어 `200 {"outOfCoverage":true}`로 나가던 것(라우트 14곳)과, 무효 키가 `/json/` 경로에서도 200 + XML을 주어 `Unexpected token '<'`로 원인을 지우던 것. 정적 가드 2개로 재발 차단. 백로그 D2·D3 종결.

### 지하철 구간 운행 시간 판정
ODsay가 출발 시각을 반영하지 않아 심야에 첫차 04:00 노선을 추천하던 결함의 지하철 축. 버스 축은 2026-08-01 별건으로 처리했다.
정본: [spec](docs/superpowers/specs/2026-08-01-subway-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-subway-service-hours.md).

### ODsay 심야 결함 수정 (버스 축)
노선 운행시간을 조인해 leg에 `serviceStatus`를 싣고 안정 정렬로 강등한다. 분기는 도시 코드가 아니라 TOPIS 보유 여부로 가른다(TOPIS가 수도권 광역 노선도 갖는다).
정본: [spec](docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md) · [plan](docs/superpowers/plans/2026-08-01-odsay-service-hours.md).

### iOS 목적지 거리 추적 이식
판정을 Kit 순수 함수로 내리고 `BeaconModel`을 얇은 껍데기로 뒀다(앱 타깃에 테스트 번들이 0건이라 앱에 두면 검증이 구조적으로 불가능하다). 웹 원본의 잠복 결함도 함께 잡았다: 도착음이 매 fix 반복되던 것.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-distance-beacon-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-distance-beacon.md).

### iOS 장소 상세 "이 장소 주변"
버스 도착·따릉이·날씨/공기질(2026-08-02에 지하철 추가로 4행). 데이터 계층은 이미 있었고 없던 것은 "현재 위치 대신 장소 좌표로 앵커하는 길" 하나뿐이었다.
정본: [spec](docs/superpowers/specs/2026-08-01-ios-place-nearby-design.md) · [plan](docs/superpowers/plans/2026-08-01-ios-place-nearby.md).

### Google Maps provider 후보 평가 (도입 없음)
Gemini SDK Maps grounding은 길동무 인증 모드에서 400으로 사용 불가. Routes API는 한국 도보·자동차가 200 + 빈 배열(도쿄 대조군은 정상이라 지역 제약 확정)이라 후보 탈락. TRANSIT은 시간대 반영·근거리 응답이 우위이나 도보 안내 문장이 없어 낭독 정본 계약에 미달. Places는 ko 열위·en 우위. 이 평가가 위 ODsay 심야 결함을 부수로 드러냈다.

## 2026-07-31

### 1.1 출시
1.0 승인 후 쌓인 110커밋. en 스토어 로컬라이제이션이 이 제출과 함께 공개됐다.

### Gemini 전용 GCP 프로젝트 분리
`GEMINI_API_KEY`가 Converters·dodo-planet과 공유하는 프로젝트에 묶여 사용량 귀속이 불가능했다. model 라벨 분리도 성립하지 않았다(dodo도 같은 모델을 쓴다). `gildongmu-prod` 신설.

### 과금·쿼터 상태 리포트
`node scripts/usage-report.mjs`가 돈·가용성·시한·걱정불필요 4섹션을 평문으로 낸다. 200에 오류를 담는 벤더 4종은 judge로 가른다.
정본: [spec](docs/superpowers/specs/2026-07-31-usage-cost-report-design.md) · [plan](docs/superpowers/plans/2026-07-31-usage-cost-report.md).

### iOS Nearby 상태 골격 추출
11개 모델이 각자 갖고 있던 `load()` 상태 머신을 Kit `NearbyLoadCore`로 수렴시켰다. 취소 결함도 함께 닫혔다.
정본: [spec](docs/superpowers/specs/2026-07-31-ios-nearby-skeleton-design.md) · [plan](docs/superpowers/plans/2026-07-31-ios-nearby-skeleton.md).

### `@google/genai` 2.15.0 업그레이드
breaking change가 Interactions API에만 있어 해당 없음을 확인하고 진행. 프로젝트 분리와 별도 커밋으로 나눴다(한 번에 하면 장애 시 키 문제와 SDK 문제를 가를 수 없다).

## 2026-07-30

### 1.0 App Store 승인·출시
2.1(a) 반려 1회 대응 후 승인. 반려 사유는 홀드 받아쓰기를 비-VoiceOver 심사자가 짧게 탭했을 때 무반응으로 보인 것이고, 기본값을 탭 토글로 바꿔 대응했다.

### 옴니박스 중심 웹 IA 재편
홈을 "길찾기"·"내 주변" 칩 2개로 축소하고 nearby 10종을 허브 뷰로 옮겼다. 딥링크 압축·채팅 진입 수렴.
정본: [spec](docs/superpowers/specs/2026-07-30-omnibox-web-ia-redesign-design.md) · [plan](docs/superpowers/plans/2026-07-30-omnibox-web-ia-redesign.md).

### 웹 nearby 중복 추출
9종이 복붙하던 상태 머신·렌더 골격을 `useNearbyFetch`+`NearbyPanelShell`로 수렴시키고 잠복 결함(닫힌 패널의 늦은 응답)을 닫았다.
정본: [spec](docs/superpowers/specs/2026-07-30-nearby-dedup-design.md) · [plan](docs/superpowers/plans/2026-07-30-nearby-dedup.md).

### 자동차 경로 ko 기본 Tmap 전환
도보와 반대 구도로, Tmap `description`이 도로명 포함 완성 문장인 반면 카카오 `guidance`는 도로명 없는 조각이다. 폴백은 Tmap throw 시에만 카카오모빌리티.
정본: [plan](docs/superpowers/plans/2026-07-30-car-route-tmap-primary.md).

### 장소 상세 브리핑 진입점 일원화
길찾기 뷰와 채팅 렌더 카드로 진입점을 모으고 장소 상세의 단일 수단 브리핑을 제거했다(중복).

### 레거시·중복 감사 수정 묶음
웹 UI·iOS·lib·라우트/i18n 전반.
정본: [plan](docs/superpowers/plans/2026-07-30-legacy-audit-fix-batch.md).

## 2026-07-29

### 도보 경로 카카오 기본 전환
동좌표 문체 대조 실측 근거로 방향을 역전했다(위원장 판정: "이견의 여지가 없을 정도로 카카오 우월"). 카카오는 의미 단위 병합·역사 내 이동·계단/지하보도 명시, Tmap은 미세 분절·상대방향 중심. 계단 회피 모드(`route_mode=ACCESSIBLE`)도 이때 들어왔다.
정본: [spec](docs/superpowers/specs/2026-07-29-kakao-walk-primary-design.md) · [plan](docs/superpowers/plans/2026-07-29-kakao-walk-primary.md).

### 서비스 지역 커버리지 계약 + 받아쓰기 재설계
App Review 반려 대응. 좌표 의존 라우트가 한국 밖이면 오류가 아니라 200 `{"outOfCoverage":true}`로 응답한다(3-state에 더한 4번째 정직 상태). 받아쓰기 기본값을 탭 토글로 바꾸고 홀드는 설정 선택지로 남겼다.
정본: [spec](docs/superpowers/specs/2026-07-29-coverage-contract-dictation-design.md) · [plan](docs/superpowers/plans/2026-07-29-coverage-contract-dictation.md).

### 웹→iOS 기능 갭 이식 1차
계단 회피 토글 + 보행 인프라 화면.

## 2026-07-28

### 1.0 App Store 심사 제출
스크린샷 ko 7컷, VoiceOver QA 스모크 4항목 위원장 실기기 합격으로 게이트 대체.

### 일본어(ja) 로케일
6번째 언어. iOS 설정 언어 메뉴 피커 포함.

### 나머지
"더 보기" 단계 공개를 V2 3종 라우트로 확장([plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v2-three-domains.md), [웹](docs/superpowers/plans/2026-07-28-nearby-show-more-v2-web.md)), 도보 경로 횡단보도 단계에 음향신호기 주석([spec](docs/superpowers/specs/2026-07-28-walk-route-audio-signal-annotation-design.md)), 듣기 속도 설정 이식.

## 2026-07-27

### Phase 0 출시 전 방어
STT 라우트 레이트리밋+크기 상한, 채팅 웹검색 1시간 캐시, 좌표 반올림으로 캐시 키 실효화, 리전 icn1 고정, 정본 도메인 `gildongmu.dodoplanet.space` 확정.
정본: [plan](docs/superpowers/plans/2026-07-27-phase0-launch-defense.md).

### "내 주변" 장소 목록 "더 보기"
소아 진료부터 시작해 4종에 단계 공개를 도입했다. 교통 목록·보행 인프라·랜드마크는 절단 너머가 행동을 바꾸지 않아 의도적 비적용.
정본: [plan](docs/superpowers/plans/2026-07-27-nearby-show-more-v1-clinics.md).

## 2026-07-26

### 소아 진료 커버리지 확장
위원장 실사용 제보(일요일 진료 중인 강동 소아과가 "내 주변"에 없음)에서 출발. 달빛 지정 명부 단독이던 것을 일반 소아청소년과 보완 소스와 병합했다. 명부 커버리지가 6.5%였다(강동 20km에서 123곳 중 115곳 누락).
정본: [spec](docs/superpowers/specs/2026-07-26-clinic-coverage-expansion-design.md).

### 내 주변 → 장소 상세 UI 이식 (iOS)
내 주변 4종 항목을 검색 탭과 같은 상세로 통일해 로터 액션 6종을 획득했다.
정본: [spec](docs/superpowers/specs/2026-07-26-nearby-place-detail-port-design.md) · [plan](docs/superpowers/plans/2026-07-26-nearby-place-detail-port.md).

### 최근 검색 기록
검색 탭 + 길찾기 출발/도착지, 웹·iOS.
정본: [spec](docs/superpowers/specs/2026-07-26-recent-searches-design.md) · [plan](docs/superpowers/plans/2026-07-26-recent-searches.md).

## 2026-07-22

### 도보 길찾기(Tmap) + 길찾기 뷰·iOS 4탭
3수단 비교 화면 신설. 위원장 실기기 QA 통과("의도했던 기능이 잘 구현").
정본: [spec](docs/superpowers/specs/2026-07-21-walk-route-directions-tab-design.md) · [plan](docs/superpowers/plans/2026-07-21-walk-route-directions-tab.md).

### 역 상세 보강
첫차·막차 시간표 + 시설 패널 보강 그룹(음성유도기 seed·엘리베이터 폴백) + 역명 매칭 수정. 카카오 역 place_name이 "강동역 5호선" 형태라 정규화 없이는 역 섹션 전체가 죽어 있었다.
정본: [spec](docs/superpowers/specs/2026-07-22-station-detail-enrichment-design.md) · [plan](docs/superpowers/plans/2026-07-22-station-detail-enrichment.md).

### 보행 인프라 ("내 주변" 7번째)
음향신호기(서울 열린데이터 OA-15543 정적 seed) + 횡단보도·점자블록(Overpass).
정본: [spec](docs/superpowers/specs/2026-07-22-walk-infrastructure-design.md) · [plan](docs/superpowers/plans/2026-07-22-walk-infrastructure-plan.md).

## 2026-07-21

### App Store 출시 필수 요건 완비
채팅 AI 동의 게이트(5.1.2(i)), `PrivacyInfo.xcprivacy`, 웹 개인정보처리방침 5개 언어, `/api/chat` 레이트리밋.
정본: [spec](docs/superpowers/specs/2026-07-21-appstore-release-gates-design.md) · [plan](docs/superpowers/plans/2026-07-21-appstore-release-gates.md).

### 장소 결과 플랫 리스트 + 칩
버킷 섹션 그룹핑을 폐지했다. 고정 섹션 서열이 정확도 1위를 최하단 '기타'에 매몰시킨 실측 6사례가 근거다. 분류는 순위를 결정하지 않는다.

## 2026-07-20

### 정확도순 검색 전환
거리순을 폐지하고 정확도순+좌표 블렌딩으로 바꿨다. 랜드마크가 자연히 부상하면서 명소 전용 라우트가 중복이 되어 함께 폐지했다.
정본: [spec](docs/superpowers/specs/2026-07-20-accuracy-first-search-design.md) · [plan](docs/superpowers/plans/2026-07-20-accuracy-first-search.md).

### iOS 받아쓰기 WhatsApp식 홀드
누른 동안 녹음·떼면 확정. 위로 밀면 잠금(일시정지+확정), 왼쪽으로 밀면 취소. 실기기 3차에 합격했고, 그 과정에서 SwiftUI 제스처 조합을 UIKit 인식기 계층으로 교체했다(List 스크롤 팬 경합·VO pass-through 드래그 유실).

### iOS 채팅 멀티 턴 먹통 수정
몇 턴 대화 후 앱 전면 무응답. 먹통 생존 상태에서 CPU 리포트를 회수·심볼화해 `LazyVStack`의 lazy 크기 추정 진동 루프로 확정하고 eager `VStack`으로 교체했다.

## 2026-07-19

### iOS 다국어(5개 언어) + 설정 언어 픽커
웹 `messages/{locale}.json` 정본에서 결정론 스크립트로 String Catalog를 생성한다. Bundle이 언어 협상을 프로세스 시작 시 1회만 캐싱해 앱 내 즉시 전환이 안 되던 것을 언어별 `.lproj` 직접 조회로 해결했다.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-i18n-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-i18n.md).

### iOS 제목 메뉴 + 테마
새로고침·설정 메뉴, 테마 3택.
정본: [spec](docs/superpowers/specs/2026-07-19-ios-title-menu-refresh-theme-design.md) · [plan](docs/superpowers/plans/2026-07-19-ios-title-menu-refresh-theme.md).

## 2026-07-18

### iOS 채팅 탭
3탭 전환(채팅·검색·내 주변). 실기기 VoiceOver에서 산문이 통짜 객체 하나로 낭독되던 것을 블록 분할로 고쳤다.
정본: [spec](docs/superpowers/specs/2026-07-18-ios-chat-tab-design.md) · [plan](docs/superpowers/plans/2026-07-18-ios-chat-tab.md).

### iOS 단축어(App Intents) + 유휴 복귀 초기화
"길동무 음성 검색"·"내 주변" Siri 진입.
정본: [App Intents spec](docs/superpowers/specs/2026-07-18-ios-app-intents-shortcuts-design.md) · [유휴 리셋 spec](docs/superpowers/specs/2026-07-18-idle-reset-title-refresh-design.md).

### TestFlight 외부 테스터 배포 개시
App Store Connect 앱 신규 등록(App ID 6792234349).

## 2026-07-16

### CLI(`gildongmu`) + MCP(`gildongmu-mcp`) npm 첫 발행
REST 카탈로그를 중계하는 씬 클라이언트. 버전별 이력은 [CLI CHANGELOG](packages/cli/CHANGELOG.md)·[MCP CHANGELOG](packages/mcp/CHANGELOG.md).
정본: [spec](docs/superpowers/specs/2026-07-15-cli-mcp-design.md) · [plan](docs/superpowers/plans/2026-07-15-cli-mcp.md).

## 2026-07-06 ~ 2026-07-10

### iOS 네이티브 재작성 (M0~M6b)
SwiftUI 앱 신설. M0 검색, M1 장소 상세, M2 내 주변·위치, M3 역 상세·날씨/공기질, M4 경로 브리핑, M5 장소 채팅, M6 음성 받아쓰기, M6b 웹 동등성 누락분 7건.
정본: [spec](docs/superpowers/specs/2026-07-06-ios-native-rewrite-design.md) · plans `2026-07-06~10-ios-native-rewrite-m*.md`.

## 2026-07-04

### ODsay 대중교통 프로덕션 해소
apiKey가 발급 시점 플랫폼에 묶여 Server 앱 키로는 referer 식별이 안 됐다. URI 전용 앱을 새로 만들고 서버 fetch에 `Referer`를 명시해 해결했다.

### dodo-planet 전량 이식 완결
Phase A~E 이식 대상 자산 전부 dodo 합류.
정본: [spec](docs/superpowers/specs/2026-07-03-dodo-full-port-design.md).

### `DistanceBeacon` 패치
훅 계층 버그 2개로 죽어 있었다. `useScreenWakeLock`이 매 렌더 새 객체를 반환해 정리 effect가 매 렌더 돌면서 `watchPosition`이 등록 직후 해제되고 있었다(시작 톤 후 fix 0회, 영원한 침묵).

## 2026-06-27 ~ 2026-06-30

- **무장애 여행 정보**(한국관광공사 KorWithService2) — [spec](docs/superpowers/specs/2026-06-30-barrier-free-travel-design.md)
- **현재 위치 정위 카드**(where-am-i) — [spec](docs/superpowers/specs/2026-06-28-where-am-i-location-card-design.md)
- **자연어 검색 라우터 폐기**: Gemini 라우터를 통째로 제거하고 장소·주소·웹 항상 병렬 3섹션으로 회귀했다. deterministic 검색 위에 LLM 재해석을 얹으니 "위스키바→바→미용실"로 멀쩡한 쿼리가 악화됐다. [plan](docs/superpowers/plans/2026-06-27-remove-search-router-parallel-web-section.md)

## 2026-06-20 ~ 2026-06-24

- **채팅 에이전틱 전환**(Gemini function calling) — [spec](docs/superpowers/specs/2026-06-20-chat-agentic-workflow-design.md) · [chat interface](docs/superpowers/specs/2026-06-20-chat-interface-design.md)
- **장소별 채팅**(장소 앵커 불변식) — [spec](docs/superpowers/specs/2026-06-21-place-scoped-chat-design.md)
- **Perplexity 웹 검색** — [spec](docs/superpowers/specs/2026-06-21-perplexity-web-search-design.md)
- **내 주변 둘러보기**(카카오 카테고리+8방위) — [spec](docs/superpowers/specs/2026-06-20-surroundings-awareness-design.md)
- **이 지역 날씨**(기상청 격자 변환) — [spec](docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md)
- **목적지 거리 추적 (웹)** — [spec](docs/superpowers/specs/2026-06-20-distance-beacon-design.md)

## 2026-06-14 ~ 2026-06-19

초기 구축. 각 기능의 현재 상태는 `PROGRESS.md` 운영 표를 본다.

- **v2**: 검색→상세 흐름, 역 교통약자 편의시설(코레일), 언어 분리 UI — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2-upgrade-design.md)
- **v2.1**: 음성 받아쓰기(Deepgram), PWA 수제 서비스워커 — [spec](docs/superpowers/specs/2026-06-14-gildongmu-v2.1-voice-pwa-design.md)
- **시내버스**: TAGO 지방 + 서울 TOPIS 병합 — [TAGO spec](docs/superpowers/specs/2026-06-14-gildongmu-tago-bus-design.md) · [서울버스 spec](docs/superpowers/specs/2026-06-15-seoul-bus-api-design.md)
- **따릉이** — [spec](docs/superpowers/specs/2026-06-16-seoul-bike-design.md)
- **서울 지하철**: 교통약자 시설 9종 + 실시간 도착 + 전국 도시철도역 메타 seed
- **소아 야간·휴일 진료** — [spec](docs/superpowers/specs/2026-06-17-nearby-night-clinic-design.md)
- **공기질**(에어코리아 TM중부원점 변환) — [spec](docs/superpowers/specs/2026-06-17-air-quality-design.md)
- **아이 놀 곳** — [spec](docs/superpowers/specs/2026-06-18-kids-places-design.md)
- **대중교통 길찾기**(ODsay) — [spec](docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md)
- **주소·우편번호 검색**(juso) — [spec](docs/superpowers/specs/2026-06-19-juso-official-address-design.md)
- **검색창 3섹션 병렬** — [spec](docs/superpowers/specs/2026-06-19-unified-place-address-search-design.md)

## 2026-06-12

최초 커밋. Next.js 16 + next-intl 기반 프로젝트 신설.
