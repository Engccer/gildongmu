# INTEGRATIONS — 통합 상세 계약

`CLAUDE.md` 통합 카탈로그에서 **요지만으로는 지킬 수 없는 계약**을 옮겨 둔 곳이다. 카탈로그 행이 여기를 가리키면 **그 코드를 수정하기 전에 해당 절을 읽는다**.

- 여기 있는 것은 전부 실측으로 확정된 계약이고, 어기면 대개 **조용한 실패**(거짓 안내·3-state 붕괴·낭독 오류)가 된다.
- 설계 근거·검증 서사는 각 절이 가리키는 `docs/superpowers/specs`가 정본이다. 여기엔 "지킬 것"만 둔다.
- 횡단 함정(좌표 파라미터·envelope 파서·거리 표기·영문 응답)과 실시간 안내 세션도 **요지는 `CLAUDE.md`, 상세는 여기**다(2026-09-02 문서 축소 — `CLAUDE.md` 항목이 `→ INTEGRATIONS`로 끝나면 같은 제목의 절이 여기 있다). 통합과 무관한 내부 계약(UI·포커스·i18n·채팅·WebMCP·iOS 빌드)은 `docs/PATTERNS.md`.

---

## 도보 경로 (`walk-route.ts` · `/api/route/walk`)

### 도보 경로 (CLAUDE.md 이관)

⚠ **경로는 목적지까지 가지 않는다** — provider는 가장 가까운 보행로 지점에서 끝내고 그 종점→목적지 오프셋이 실측 16~89m다. 그 구간이 곧 "마지막 몇 미터"이고 `finalApproach` 필드가 담는다(라우트 핸들러가 **요청 원좌표로** 계산 — provider 캐시는 `roundCoord(…,4)`로 목적지를 뭉친다). **낭독 문장은 서버 `rewriteWalkGuidance`(`src/lib/walk-guidance.ts`)가 만든다 — 소비자 재조합 금지**(2026-08-07 위원장 판정으로 종전 "provider 원문 정본"을 뒤집음). 라우트·채팅은 `getWalkRoute`만 호출(provider 직접 금지). 게이트 `hasWalkRouteKeyFor(lang)`(ko=kakao∥tmap, en=tmap 단독 — E16 축3. 채팅 declaration·router는 ko 산문 정본이라 `hasWalkRouteKey()`; ko 경로에 `hasTmapKey` 단독 금지). ⚠ **`accessible` 요청은 좌표를 반올림하지 않는다**(2026-08-23): `roundCoord(…,4)`는 캐시 키만이 아니라 upstream에 보내는 좌표 자체를 바꾸고, 4자리 셀(약 11m) 안에 지하철 출입구 두 개가 들어가 계단 유무가 갈린다 — 캐시 히트율을 이유로 되돌리지 말 것(카카오 도보는 무과금이라 그 비용이 사실상 0이다). 토글 라벨은 "계단 없는 경로"가 아니라 **"계단 회피 경로"**다(위원장 판정 2026-08-23): 안내문의 "계단" 문자열 검사는 계단의 *존재*만 증명하고 *부재*는 증명하지 못하므로("육교를 건너"로만 쓰면 안 걸린다) 전자는 지킬 수 없는 약속이다. 그래서 그 검사는 **강등 전용**이고, 정상 적용(`applied`)에는 한계 문장을 싣지 않는다(dodo는 싣는다 — 의도된 비대칭). 계단 회피 `accessible=true` → `stepFree` union. ⚠ **비-ko는 Tmap 단독이고 문장은 서버가 en으로 만든다**(E16 축3, spec `2026-08-23-non-ko-walk-guidance-design.md` — 종전 "V1 ko 전용"을 대체. 소비자는 웹·iOS·CLI/MCP 전부다 — 2026-09-01 E26으로 `gil route walk --lang en`·MCP `route_walk`의 `lang`이 닫혔다): `turnType → {action, phrase}` **표 하나**(`pedestrian-action.ts`)가 임박 큐 행동과 영어 문구를 함께 낸다 — 두 표로 나누면 "문장은 좌회전인데 톤은 우회전"이 각 표의 커버리지 테스트를 둘 다 통과한 채 성립한다. **문장의 거리·도로명은 Point 뒤 첫 LineString**이지 합이 아니다(합으로 읽으면 435스텝 중 48건이 어긋난다. `pathCoords`는 종전대로 전부 귀속 — 기하는 실경로를 따라야 한다). 응답의 한국어 원문은 en 문장의 **출처가 아니라 증인**이다 — 표지·거리 대조 가드(`pedestrian-guard.ts`, 표지 우선순위는 회전 → 시설 → 건널목)가 미관측 코드와 귀속 가정 파손을 즉시 실패로 바꾼다(코퍼스 435스텝 오탐 0, en 전용 옵트인이라 ko 폴백은 종전 동작). 미지 `turnType`은 **throw**다: 행동절을 빼면 *회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다. 로마자 도로명은 juso `engAddr`(지역 제약 없음 — 로마자는 한글의 함수라 동명 도로도 같은 표기. 조회 실패는 throw라 "도로명 없음"으로 캐시되지 않는다). ⚠ **도보 스텝의 `action`은 이제 서버가 전량 투영**하고(`attachStepActions`: Tmap=turnType 표, 카카오=주석까지 끝난 최종 문장) 리듀서 walk 프로파일은 `actionSource: "step"`만 본다(웹; Kit은 `step.action` 직접, 2026-09-02) — 클라이언트 문자열 폴백을 두면 구조화의 "의도된 행동 없음"(육교·계단·엘리베이터)과 미투영을 구별하지 못한다. `includeGeometry` 응답에만 실어 브리핑 응답은 byte-identical. ⚠ **`lang`은 `getWalkRoute`·`walkRouteUrl`·Kit `RouteService.walk` 셋 다 기본값 없는 필수 인자**다(Kit은 `DataLocale` enum — 앱 정본 `AppLanguage.dataLocaleValue`, 문자열 `dataLocale`은 그 투영. 2026-09-02). ⚠ **비-ko에 계단 회피 컨트롤을 노출하지 않는다**(웹·iOS 둘 다) — Tmap에 검증된 회피 축이 없어 항상 `unavailable`인데, 켤 수 있게 두면 SR 사용자는 그 사이 적용됐다고 믿는다. ⚠ 재작성 정규식·음향신호기 병합 게이트·파이프라인 순서(재작성 → 주석)·계단 회피 통지 계약은 어기면 조용한 실패다. **경로 축(M3)**: `variant=shortest`는 Tmap `searchOption=10` **단독·폴백 없음**(카카오에 동등 축 없음, 키 부재·실패는 throw — null 위장 금지), `alternatives=1`은 추천+최단 병렬로 **기본 실패 502 유지·최단 실패만 `shortest:null` 흡수**(부분 성공 비대칭), `variant+alternatives`·`alternatives+includeGeometry`는 400(스키마 정본 `route-schema.ts`). ⚠ Tmap 기하 모드는 **기하 없는 후행 도착 마커를 떨군다** — 남기면 `buildGuideRoute` 유령 스텝 가드가 경로 전체를 거부해 상세 안내가 조용히 간략 강등된다(실호출 게이트 검출 2026-08-12). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §도보 경로** — 이 코드를 수정하기 전에 읽는다.


기본 카카오(`dapi.kakao.com/v2/routing/walk`, 기존 `KAKAO_REST_API_KEY`) + Tmap 폴백. 위원장 판정 2026-07-29로 카카오가 기본이 됐다(의미 단위 스텝·역사 내 이동·계단/지하보도 명시로 브리핑 우월). spec `2026-07-29-kakao-walk-primary-design.md`·`2026-08-08-walk-guidance-stepfree-design.md`.

### 봉투·폴백
- envelope는 top-level `route` **단수** + `status`. 경로 불가는 `TOO_FAR_AWAY`·`ROUTE_RESULT_NOT_FOUND`만 null이고 **미관측 status·스키마 위반은 throw**(fail-closed).
- **폴백은 카카오 throw 시에만 Tmap**이다. null은 폴백 없이 null이 정본. 폴백 시 좌표 포함 `console.warn`(Vercel 로그로 폴백률 관측).
- 게이트는 `hasWalkRouteKeyFor(lang)`(ko=kakao∥tmap, en=tmap 단독 — E16 축3 2026-08-23). 라우트·page가 이것을, 채팅 declaration + router 이중 방어는 ko 산문 정본이라 `hasWalkRouteKey()`를 쓴다 — **ko 경로에 `hasTmapKey` 단독 게이트 금지**(카카오 키만 있는 배포에서 도보가 죽는다).
- 거리·시간은 provider에서 `Math.round`(iOS 엄격 Int 디코딩 방어).
- **언어가 provider 선택을 정한다**(E16 축3, 2026-08-23): `lang="ko"`는 카카오 기본 + Tmap 폴백, `lang="en"`은 **Tmap 단독·폴백 없음**. en에서 카카오로 내려가면 "가용성 폴백"이 아니라 한국어 문장이 나오기 때문이다. en 파이프라인은 `rewriteWalkBriefing`(ko 재작성)을 타지 않고 `buildEnBriefing`(구조화 필드 → 영어 문장)을 탄다. 계단 회피는 카카오 전용 축이라 en은 항상 `unavailable`이고, 그래서 웹·iOS 모두 비-ko에 그 컨트롤을 노출하지 않는다.
- **Tmap 응답 귀속 규칙**: 한 Point 뒤에 LineString이 둘 이상 붙을 수 있고, 문장이 말하는 거리·도로명은 **첫 구간**의 것이다(30경로 435스텝 실측 — 합으로 읽으면 48건이 어긋난다). `pathCoords`는 종전대로 전부 귀속한다. 이 가정은 `pedestrian-guard.ts`의 거리 대조가 런타임에 증명한다(en 전용 옵트인, `guard` 플래그).

### 낭독 문장 재작성 (`rewriteWalkGuidance`)
**서버가 만든 문장이 정본이고 소비자는 재조합하지 않는다.** 2026-08-07 위원장 판정으로 종전 "provider 원문이 정본" 계약을 뒤집었다(판정 기준은 가독성·일관성. 원문이 거리를 39% 침묵했고, 괄호 도로명은 SR 구두점 설정에서 사라지며, "왼쪽길로"가 명사처럼 읽혔다).

- 결과 틀: **`{어디서} {어느 쪽으로 돌아} {어디까지} {길}을 따라 {거리} 이동`**. 교량도 같은 틀("교량을 따라 260m 이동" — "이동, 교량 진입"은 올라선 뒤 걷는 순서가 뒤집혀 들린다).
- 횡단보도·지하보도만 `{거리} 이동, {시설} {N}개 이용`. **개수는 2 이상일 때만** — "1개"는 개수 정보가 아닌 데다 아래 병합 게이트를 잘못 열어 단일 횡단보도의 신호기 주석을 지운다.
- ⚠ **미매칭 문장은 원문 그대로 통과**(fail-safe: 새 문형이 와도 그 문장만 종전 낭독).
- ⚠ 단 **마지막 "…이동" 폴백은 미매칭 문장 전부를 대상으로 삼으므로 "이미 거리를 말하는가" 가드가 필수**다(`HAS_DISTANCE` — 표준 m·km보다 넓게 한글 단위까지 본다). 없으면 "100미터 이동"이 "100미터 100m 이동"이 된다. 폴백을 "역사 내 이동"으로 **좁히지 말 것** — 어미가 다른 실제 문장들("엘레베이터를 이용하여 강동역으로 이동")이 같은 폴백으로 거리를 얻는다.
- ⚠ **도로명 조사는 받침으로 계산**한다(실측 58종 중 받침 있음 9·없음 49라 어느 쪽으로 고정해도 다른 쪽이 전부 틀린다). 한글이 아니면 삽입을 포기하고 괄호째 보존.
- ⚠ **재작성 정규식은 `이동(…)$` 앵커가 핵심**이다. 괄호를 훑는 방식이면 "삼성역 2호선 7번출구(임시폐쇄)"가 "임시폐쇄를 따라"로 나간다(실측 유일 예외이자, 괄호 2개 문장에서 마지막 것만 도로명인 근거).
- ⚠ **이름 있는 캡처 그룹 금지**(tsconfig target ES2017).
- **단계 번호는 세 소비자 모두 원본 인덱스 기준**(웹 `<ol>`·CLI `"1. "`·iOS `WalkRouteRows`).

### 음향신호기 주석
라우트·채팅은 `getWalkRoute`만 호출한다(provider 직접 금지). description "횡단보도" 포함 + **병합 스텝 아님** + 후보점(카카오 `pathCoords` 폴리라인 전체 or Tmap `coord` 1점) 중 40m 내 seed 존재 시 ", 음향신호기 있음"을 흡수한다(분포 32.5m 이하 vs 91m 이상 완전 분리 실측, 병합 스텝은 특정 불가라 침묵 — positive-only).

- ⚠ 병합 판정은 **원문형 "N개의"와 재작성본 "횡단보도 N개" 둘 다** 막아야 한다. 재작성이 "2개의"를 "2개"로 바꾸므로 원문형만 보면 이 게이트가 조용히 열려 신호기 없는 횡단보도에 "있음"이 붙는다.
- ⚠ **파이프라인 순서가 계약이다: 재작성 → 주석.** 뒤집으면 주석이 먼저 붙어 재작성 정규식의 `$` 앵커가 깨진다. 그 순서는 `getWalkRoute`를 통과하는 테스트로만 검출된다 — 두 단계를 테스트가 직접 조합하면 순서를 테스트가 정해 버려 변이가 안 잡혔다.
- step `coord`·`pathCoords`는 응답 전 제거한다.

### 횡단보도 차로 수·도로 폭 주석 (`annotateCrosswalkInfo`, E8)
전국횡단보도표준데이터(15028201) 정적 seed(`src/lib/data/crosswalks.json`, `scripts/build-crosswalk-seed.mjs`, 이용허락 제한 없음)로 **단일 횡단보도 스텝**에 `, {N}차로, 도로 폭 {M}m`를 덧붙인다. **있는 곳만 말하고 없는 곳은 침묵**(위원장 2026-08-16 — 수식이라 3-state 대상이 아니다). spec `2026-08-23-crosswalk-lanes-length-design.md`.

- **판정은 `matchCrosswalk`(`providers/crosswalks.ts`) 3중 게이트 전부 통과일 때만**: ①스텝 폴리라인 양 끝 중점에서 30m 안 ②seed 연장과 구간 길이 차 ≤ max(5m, 0.4·구간) ③남은 후보의 차로 수 동일·연장 차 ≤ 2m(최근접 채택). 근거: 이 데이터는 **교차로의 횡단보도 여럿이 한 점에 겹쳐 등록**돼 있어(좌표 4,833곳 중복, 3,425곳 값 불일치) 최근접 1건은 어느 횡단보도인지 모르고, 틀린 차로 수는 침묵보다 나쁘다. 길이 축이 겹친 후보를 가른다(실측 22건: 주석 8·침묵 14, 오탐 0). 상수를 풀면 교차로 옆 횡단보도의 값이 붙는다.
- ⚠ **Tmap 경로는 provider 게이트로 침묵**(`annotateCrosswalkInfo(…, provider)`, 기본값 없음): 비기하는 `coord` 1점이라 구간 길이가 없고, 기하 요청은 Point 스텝에 다음 결정 지점까지 LineString이 붙어 2점이 되지만 그 길이는 횡단 길이가 아니라 길이 축이 우연히 열린다. 병합 스텝(`MERGED_CROSSWALK`)도 침묵.
- ⚠ **"도로 폭"이라는 이름은 벌거벗은 수치 금지 판정의 적용이다** — 재작성 문장이 이미 "횡단보도 길이 21m"(보도 간 스텝 거리)를 달고 있어 맨몸 "15m"를 덧붙이면 한 문장에 길이가 둘로 들린다. 연장은 차도 폭이라 다른 값이다.
- **파이프라인: 재작성 → 음향신호기(`keepGeometry=true`) → 차로 수(기하 제거·통일 담당) → 행동·횡단 투영(`attachStepActions` — `action`+`crossing`, E16 축3·A26. 둘 다 `includeGeometry` 응답에만 실린다).** 음향신호기 단계에 기하 제거를 되돌리면 차로 수 단계가 전량 침묵한다. 순서를 뒤집으면 재작성 `$` 앵커가 깨진다(변이 주입으로 검출 확인).
- 커버리지는 63개 시군구·서울은 동작구뿐이라 서울 대부분에서 구조적으로 침묵한다. 실호출 게이트 `scripts/verify-crosswalk-annotation.mjs`(동작구 "붙는다" + 길동 "침묵").
- seed 갱신은 반기 데이터라 연 1~2회 수동. 빌드 가드는 전부 throw(총건수·한국 상자·파싱률·시도 수·연장 1~60m).

### 계단 회피 모드
`accessible=true`(그 외 값 400) → `route_mode=ACCESSIBLE`. 응답 `stepFree`는 `"applied"|"no_stepfree_route"|"unavailable"`(요청 시 필수·미요청 시 부재 = 스키마 byte-호환). applied는 계단 guidance 존재 시 선언 금지(fail-closed), 무계단 부재 시 기본 모드 재호출.

- 미적용이면 서버가 안전 문장을 결정론 전달하는데 **채널이 소비자 종류로 갈린다**: 산문 소비자(브리핑·채팅·CLI)에겐 `steps[0]` 삽입, `includeGeometry=1` 구조화 소비자에겐 **유사 스텝 없이 `stepFreeNotice` 필드로만**.
- ⚠ 기하 응답에 기하 없는 스텝을 넣으면 `buildGuideRoute`(웹 `route-geometry.ts` · Kit `RouteGeometry.swift`)가 **경로 전체를 거부**해, 계단 회피가 가장 필요한 순간에 상세 안내가 조용히 간략으로 강등된다. UI 별도 문구·live region 금지.
- **실시간 안내 조회에도 계단 회피가 실린다**: 값은 봉인하지 않고 **조회 시점에 읽는다**(웹 `useState` 초기값은 *마운트* 수명이지 *세션* 수명이 아니라, 세션 종료 후 토글을 바꿔도 같은 마운트에서 옛 값이 남는다). 통지는 **열화 상태로의 전이**에서 1회이며 시작·재조회 발화와 **한 문자열로 결합**한다(두 번 내보내면 배칭이 앞을 삼키거나 뒤가 앞을 끊는다).
- ⚠ **통지의 신호는 상태 분류가 아니라 `stepFreeNotice`의 존재다.** 알려진 셋으로 분류되는지로 가르면 서버가 넷째 상태를 추가하는 순간 문장이 와 있는데도 iOS만 침묵한다(웹은 낭독 = 플랫폼 불일치). 중복 통지는 **원시 문자열**로 막고, 열화인데 문장이 비어 오면 기준을 갱신하지 않는다.
- ⚠ **iOS는 발화 성공 시점에만 소비한다**: 백그라운드 게이트에 걸린 통지는 `pendingStepFreeNotice`로 남겨 전경 복귀 때 갚는다. 세션에 1회뿐인 안전 경고라 다음 fix가 대신 말해 주지 않고, `missedAnnouncement` 복귀 재생은 그 사이 도착한 fix가 `statusText`를 덮어써 통째로 유실된다.
- ⚠ **안전 관련 인자에 기본값을 두지 말 것**(`RouteService.walk`·`walkRouteUrl`·`DistanceBeacon` prop·`BeaconModel.toggle` 전부 required). 백로그 A4가 정확히 그 기제에서 나왔고, 기본값을 없애자 컴파일러·타입 검사가 누락 7곳을 즉시 잡았다.

### 캐시·쿼터
IP 레이트리밋 60초 10회 + fetch 단위 `revalidate 3600`(GET이라 Authorization 헤더 무관 캐시 유효·200만 캐시라 장애 미고착. Tmap POST revalidate는 실효). ⚠ **실시간 안내(기하 포함) 요청은 `noStore`로 캐시를 우회한다**(`kakao-walk.ts`) — 세션 전용 실시간 데이터를 revalidate에 태우면 "세션 한정 메모리 보유, 저장 아님" 약관 판단과 모순(spec 2026-08-03 §7.2). 되돌리지 말 것. ⚠ **카카오 앱 유료 전환 미신청 유지** — 초과=오류=폴백이라 비용 상한이 구조적으로 0원이다(신청은 하드 스톱).

길찾기 뷰(`DirectionsView`)는 `?dir=` 동기화에서 현재 위치를 `cur` 토큰으로만 쓰고 좌표를 직렬화하지 않는다(2026-08-22 N4부터 `via` 토큰이 함께 실린다 — `serializeDir(from, to, via)`). **경유지(`via`)는 응답 `waypoint{stepIndex,coord}` 하나로만 드러나고 스텝 문장은 불변이며, provider가 경유지 표지를 못 찾으면 throw한다**(카카오 도보는 파라미터 이름이 틀려도 200 정상 응답이라 URL 단언 `route-waypoint.test.ts`가 유일한 가드). 계약 전문은 `CLAUDE.md` §횡단 함정 경유지 항목과 spec `2026-08-22-waypoint-server-web-cli-design.md`. 계단 회피 경로 토글은 `walkAccessible=1` 토큰·`aria-pressed`이고 busy 상태를 조회와 공유한다.

---

## 대중교통 (`odsay` + `odsay-select` + `bus-service-hours` / `/api/route/transit`)

### 승차 후보의 활성화 차단 술어는 `unreachable` 하나이고 급행 판정은 ID가 정본이다 (CLAUDE.md 이관)

**승차 후보의 활성화 차단 술어는 `unreachable` 하나이고 급행 판정은 ID가 정본이다**(A16 L1, 2026-09-02, spec `2026-09-02-transit-trend-tone-and-express-gate-design.md` §4): `classifyBoardingCandidates` ↔ `classifyTransitBoardingCandidates`의 `unreachable`(종착 앞 / 급행 통과)이 null이 아니면 버튼을 만들지 않고, 선택 진입점(iOS `board(item:)`·웹 `boardCandidate`)도 `unreachableReason`으로 다시 거른다 — 버튼 유무에만 기대면 다른 호출 경로가 통과 급행을 잠근다. 급행 판정 `expressVerdict`는 `expressStopIds` ∧ `alightStop.stationId`가 있으면 ID로 끝내고(정규화 없음), 이름 폴백은 자격 둘(하차역이 `viaStops`와 조인·집합이 `viaStops`와 이름 공유)을 지나야 `skips`다 — ⚠ **차단은 근거가 조인된 이름·ID에서만 나온다**(별칭 하나가 곧 거짓 "서지 않습니다"가 되므로 자격 미달·집합 부재·빈 집합은 전부 `unknown` = 종전 `expressCheck`). ⚠ 근사 잠금("이미 탑승했습니다")은 하차역 도착 목록에 통과 급행이 나타날 수 없어 후보 판정이 없는 대신, 급행 집합이 있는 노선에서 `needsExpressPrompt`로 "급행인가요?"를 한 번 묻고 `declaredExpressVerdict`(같은 `expressVerdict` 재사용)가 `skips`면 잠그지 않는다(2026-09-02 위원장 판정, spec §6). 급행 선언 잠금은 하차역 목록의 급행 항목**만** 잡는다 — 완행 폴백을 두면 더 가까운 완행 잔여로 카운트다운이 나가고 급행이 잡힐 때 "기준 차량 교체"가 거짓으로 난다. 출구 번호(E25)는 **확정 도착 통지와 하차역 행에만** 붙이고 추정 도착엔 붙이지 않는다(서버가 역 밖 하차에만 싣고 소비자 `validExitNo`는 이중 방어).

### 승차 국면 지하철 상태줄은 `arvlMsg2` 원문을 "{stop}까지" 틀에 넣지 않는다 (CLAUDE.md 이관)

**승차 국면 지하철 상태줄은 `arvlMsg2` 원문을 "{stop}까지" 틀에 넣지 않는다**(A27, 2026-08-31 실승차 피드백 "충정로까지 전역 도착"): 지하철 `arvlMsg2`는 조회역(=하차역) 기준 **열차 위치 서술**이라 버스 완성 문장용 `messageFrame`에 넣으면 뜻이 뒤집힌다. `subwayRidingMessage(arrivalCode)`(웹 `transit-guide.ts` ↔ Kit, 공유 fixture)가 3·4·5 → "다음 역 {stop}." · 0 진입 · 1 도착 · 2 출발 · 99 생략(잔여 수가 말한다) · 미지 → 원문 그대로를 고르고, 상태 `lastArrivalCode`·이벤트 `arrivalCode`가 그 축이다(공유 descriptor `frameLine`의 코드 인자에 기본값 없음). ⚠ 버스 승차 국면(`messageFrame`)·대기 국면 후보(`approachFrame`/`approachFrameLine`)·내 주변 역 도착 목록은 완성 문장 정본 그대로 — riding 상태줄만이다.

### 대중교통 (CLAUDE.md 이관)

**파이프라인 순서가 계약이다: 정규화(전체) → 강등(전체) → 선정(5) → 축 라벨.** 순서를 바꾸면 운행 중인 유일한 경로가 목록 밖에 묻히거나 사라진 기준의 라벨이 붙는다. ⚠ **error 봉투가 2형**(객체·배열)이고 무효 키도 HTTP 200이라 `odsay-envelope.ts`를 거친다. ⚠ **ODsay는 출발 시각을 반영하지 않아** 운행시간을 조인해 강등한다. **강등 정렬 키는 `outside` 유무 하나다 — `unknown`은 정렬에 참여하지 않는다**(A21, 2026-08-25): 선정 5개 절단과 결합하면 강등이 곧 제외라, TAGO가 노선째 0행인 4호선 경로가 하루 종일 사라졌다. 술어는 `odsay-select.ts`의 `isOutside` 하나(강등·축 제외 공유). ⚠ iOS `routeKey` 필수 디코딩 — **웹 배포가 앱보다 먼저**. ⚠ **급행 구간은 노선명이 다르다**(`"수도권 9호선(급행)"`) — `subwayLineCore`가 `(급행)` **한 토큰만** 벗겨 매핑표에 닿고, 안 벗기거나 넓게 벗기는 두 실패가 **같은 문장으로** 도달한다(§노선명 표기와 실시간 매핑). **실시간 안내 상태 머신(`transit-guide.ts` ↔ Kit `TransitGuide.swift`)의 "탑승"은 차량 선택이고 riding 승격은 앱이 한다**(2026-08-22 N3): `waiting → boarding → riding`에서 `boarding`은 승차 정류소를 계속 조회하며 선택 차량의 도착 관측 또는 사용자 선언으로만 riding이 된다 — 미등장을 탑승으로 추론하지 않고, 소비자의 승차 정류소 갈래 조건은 `waiting || boarding`이다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §대중교통** — 이 코드를 수정하기 전에 읽는다.


spec `2026-08-07-directions-view-restructure-design.md`·`2026-08-01-odsay-service-hours-design.md`.

### 파이프라인 순서가 계약이다
**정규화(전체) → 강등(전체) → 선정(5) → 축 라벨.**

- 선정을 강등보다 앞에 두면 **선정 밖의 유일한 운행 중 경로를 영영 못 본다**(종전 `slice(0,3)`이 길동→서울역 무환승 370번을 7번째에 묻었다).
- 라벨을 선정보다 앞에 두면 강등이 1순위를 바꿨을 때 승격된 경로가 **사라진 기준으로 계산된 라벨**을 달고 올라온다. ⚠ 이 변이는 시간표 스텁이 빈 `Map`이면 강등이 no-op이라 검출되지 않는다 — 합성 테스트에 **강등이 실제로 순위를 뒤집는 케이스**가 있어야 한다.
- 축은 최단·최소환승 2개이고 `outside` 경로는 **축 후보에서 제외**한다(접힌 disclosure 접근명에 운행 상태가 없어 권유 라벨이 못 타는 차에 붙는다). 절단 전 후보 수는 `totalCandidates`로 응답에만(UI 미표기).
- 세션 추적·포커스 복귀는 배열 인덱스가 아니라 `routeKey`. ⚠ **iOS `routeKey`는 필수 디코딩이라 웹 배포가 앱보다 먼저 나가야 한다.**

### 봉투
⚠ **error 봉투가 2형이다**(`odsay-envelope.ts`가 흡수): 경로 없음(-98)은 객체 `{code,msg}`, 인증 실패(500)는 **배열** `[{code,message}]`이고 **무효 키도 HTTP 200**이다. `data.error.code`를 직접 읽으면 배열에서 `undefined`가 되어 코드 판정이 무력화된다. `result.path`가 배열이 아니면 **throw**(0건과 조회 실패를 뭉개지 않는다). 환승도보 `{distance:0}` leg는 제외.

**URI(도메인) 식별**: 서버 fetch가 `Referer: https://gildongmu.vercel.app/`를 명시한다(IP 무관 — Vercel 가변 IP 해소). ⚠ ODsay 키는 발급 시점 플랫폼에 묶여 Server 키에 URI를 추가해도 referer 식별이 안 되므로 URI 전용 앱 키여야 한다.

### 노선명 표기와 실시간 매핑 (`subwayLineCore` → `subwayIdForOdsayLine`)

ODsay 지하철 `lane[].name`은 **급행 운행 구간에서 별도 표기**를 쓴다: 완행 `"수도권 9호선"`, 급행 `"수도권 9호선(급행)"`(실호출 2026-08-23). 그 이름은 두 곳으로 간다 — 화면 표시와, 서울 실시간 API의 `subwayId`를 찾는 매핑표(`ODSAY_SUBWAY_LINES`)다. `subwayLineCore`가 후자를 위해 `"수도권"` 접두와 구분자를 벗기는데, **여기에 `(급행)` 한 토큰 제거가 함께 있다.**

양쪽으로 틀릴 수 있고 **두 실패가 사용자에게 같은 문장으로 도달한다**:

- **안 벗기면**: 매핑 미스 → `subwayIdForOdsayLine`이 `null` → `classifyTrackMode`가 `null` → **급행 경로만 실시간 안내가 통째로 열리지 않는다**(2026-08-23까지의 실제 동작이자 A16 L1의 지배적 경로였다). 화면은 "추적할 수 없습니다"라고만 말해 정직한 미커버와 구분되지 않는다.
- **넓게 벗기면**(`\(.*\)`): 공항철도 `"(직통)"`처럼 **실시간 도착 피드에 축이 아예 없는 등급**까지 매핑된다. 그러면 정직한 "미커버"가 **영원한 "미등장"**으로 바뀌는데, 그 침묵이 정확히 A16이 고치려는 증상이다.

그래서 벗기는 것은 **실호출로 확인한 토큰 하나**여야 하고 앵커(`$`)로 **끝에 붙은 것만** 집는다. 웹 정본 ↔ Kit `TransitGuide.swift` 미러이고 양쪽 테스트가 ①`(급행)` 매핑 ②`(직통)` 비매핑 ③앵커 계약(`"수도권 (급행)9호선"` → null)을 못 박는다. **표시명은 급행 표기를 그대로 둔다** — 정규화는 매핑 축에만 건다.

⚠ 이 계약이 조용히 무력화되는 유일한 경로는 **ODsay가 표기를 바꾸는 것**이라 실호출 게이트 `scripts/verify-odsay-express-lane.mjs`가 상설 관측한다(그 게이트는 **업스트림 표기만** 본다 — "우리 정규화가 그 표기에 닿는가"는 웹·Kit 단위 테스트가 같은 문자열을 함수에 넣어 지킨다).

⚠ **같은 도메인에 `(급행)` 정책이 다른 정규화가 둘 있고, 그 비대칭은 의도다.** `quick-exit.ts`의 `normalizeLine`은 접두만 벗기고 `(급행)`을 **남긴다** — 그래서 `STATIONS["역|9호선(급행)"]` 키가 미스나고, 그것이 **빠른하차가 급행에 아무 안내도 내지 않는 유일한 기제**다(칸·문 스냅숏은 완행 정차 순서 기준이라 급행에 붙이면 거짓이 된다, §지하철 빠른하차). 두 정규화를 "중복"이라 보고 통합하면 **급행 승객에게 완행 기준 칸·문 안내가 조용히 붙는다.** 어느 쪽도 상대를 대체하지 않는다.

⚠ **급행 leg의 `passStopList`는 이미 급행 정차역만 담는다**(급행 13역 vs 완행 29역, `stationID`도 완행 일련번호를 건너뛴다). 경유역 목록·조망은 그대로 쓰면 되고, 별도 급행 정차역 데이터가 필요한 것은 **계획 leg와 다른 등급을 잠갔을 때**뿐이다(`docs/BACKLOG.md` A16 L1).

### 급행 정차역 집합 `expressStops` · 출구 번호 `exit` (A16 L1 데이터층 · E25, 2026-09-02)

spec `2026-09-02-express-stops-data-design.md`. 둘 다 `includeStops=1` 응답의 지하철 leg에만 additive다(CLI/MCP 미지정 응답 byte-identical).

- **`expressStops`는 소비자가 결정적 차단의 근거로 쓰므로 원칙이 "거짓 집합보다 부재"다.** 노선 표 `EXPRESS_LINES`(`src/lib/express-stops.ts`, 현재 9호선 하나)의 노선만 대상이고, 표에 오르려면 ①ODsay가 `(급행)` lane으로 모델 ②정차 패턴이 노선당 하나·양방향 동일 ③전 구간을 한 급행 subPath로 주는 OD — 셋 다 실호출로 증명해 spec §0에 적는다. 1호선은 ODsay가 급행 lane 자체를 주지 않는다(용산→동인천 완행뿐).
- **집합은 ODsay 전 구간 정·역방향 2콜을 수락 판정 7조건에 태운 것만**이다(`extractExpressStops`): 전 구간 커버 급행 leg 존재·양 끝 일치·길이≥3·`stationID` 존재/유일/강단조·정규화 후 이름 유일·같은 방향 후보 간 일치·**역방향이 정확한 역순**·같은 구간 완행 leg가 있으면 그 진부분집합. 하나라도 어긋나면 부재. ⚠ ODsay 데이터가 양방향 일관되게 틀린 경우는 단일 소스 안에서 못 잡는다 — 그 축은 실호출 게이트 `scripts/verify-odsay-express-stops.mjs`의 **16역 골든 전수 대조**가 맡고(머지 전 + A22 주간 재관측), 골든을 런타임 코드에 두지 않는 것은 위원장 판정(런타임 캐시, seed 커밋 금지)이다. 골든이 어긋나면 다이어 개정인지 ODsay 오류인지 사람이 가른다.
- **캐시 함수는 검증된 비어 있지 않은 집합만 반환하고 그 외는 throw**(`odsay-express-stops.ts`, 7일 `unstable_cache`, 키에 계약 버전 `v1`). `unstable_cache`는 예외를 굳히지 않으므로 부재가 7일 굳는 경로가 없다. 재시도 억제는 **캐시 바깥**: 노선별 단일 실행(in-flight 공유) + 실패 종류별 쿨다운(판정 부재·봉투 오류 6h / 429 1h / HTTP·타임아웃 10m). 각 probe 8초 타임아웃. ⚠ 쿨다운을 캐시 안으로 옮기거나 부재를 정상 반환으로 바꾸면 리뷰 #5 결함이 되살아난다. 노선을 끄는 스위치는 표에서 항목을 빼는 것이다.
- **`expressStopIds`는 `expressStops`와 항상 함께, 같은 길이·순서**(ODsay `stationID` 원문 = `stops[].stationId` 표기)다. 소비자는 ID가 있으면 정규화 없이 ID로 판정한다(하차역 별칭이 거짓 차단이 되지 않게). 서버는 둘 중 하나라도 비거나 길이가 다르면 둘 다 싣지 않는다.
- **`expressLineKey`는 끝에 붙은 `(급행)` 한 토큰만 벗긴다**(`subwayLineCore`와 같은 앵커 원칙, `수도권` 접두는 남긴다 — 표 키가 완행 원문). 완행 leg에도 붙는 이유는 소비자 시나리오가 "완행 leg × 급행 잠금 후보"이기 때문이다.
- **`exit`는 필드 존재가 아니라 경로 문맥으로 허용한다**: `board`는 역 밖 진입 승차(첫 탑승·버스 뒤·0m 아닌 도보 뒤, `boardKindAt`)에만, `alight`는 역 밖 하차(`alightKindAt === "final"`)에만. ODsay가 환승 leg에 값을 채우기 시작해도 환승역에서 역 밖 출구를 안내하지 않는다. 값은 `^[1-9]\d*(?:-[1-9]\d*)?$`만(0 계열·`"null"` 부재), 출구 좌표가 역에서 1km 밖이면 부재(좌표 없으면 검사 안 함).
- **빠른환승 문 `"0-0"`은 부재다**(실호출 2026-09-02, 개화→김포공항 완행 leg의 같은 승강장 급행 환승). `transferDoor`는 칸·문 모두 1 이상만 문으로 본다 — 종전 `^\d+-\d+$`는 "0-0 문"을 낭독시켰다.

### 영문 응답 (`lang=en` → ODsay `lang=1`, E27 2026-08-31)

`getTransitRoute({ lang: "en" })`만 URL에 `lang=1`을 붙인다(ko는 파라미터 없음 — 종전 URL·캐시 키 그대로). `lang=1` 응답은 이름 필드마다 `*Kor` 한글 병기가 붙고(실호출 636개 결측 0) 원래 필드가 영문이다.

- **한글은 `*Kor`에서만 얻고 그것이 하나라도 빠지면 영문 응답을 통째로 버린다**(`assertKorComplete` → ko 재조회, `console.warn` 결측 경로). 영문이 한국어 필드(`lineName`·`fromName`·`toName`·`stops[].name`·`departName`·`arriveName`)에 들어가는 경로는 없다 — 그 필드가 운행시간·빠른하차·실시간 매핑·역명 조인의 키다. 버스 번호 `busNoKor`는 숫자만인 것이 정상이라 존재만 본다.
- 영문은 additive `*En`: 지하철 `lineNameEn`은 **표**(`subway-line-names.ts`)가 `nameKor`로 만든다 — ODsay 영문 `name`은 쓰지 않는다(급행 표지 소실 `Line 9`, `Suin·Bundang Line` 가운뎃점, `Busan 1 Line` 비공식). 표 미스는 부재. 정류소·역명은 `normalizeTransitNameEn`(`ㆍ`·`. `→쉼표, `Stn.`→`Station`, 약어·이니셜·숫자 뒤 보존) + 한글 포함 값은 부재.
- 도보 leg의 `toNameEn`은 뒤 탑승 `fromNameEn`에서 유도(한국어 `toName`과 같은 자리).
- 실호출 게이트 `scripts/verify-odsay-lang.mjs`: 경로 3종(급행 필수 표본 포함) × en·ko, 한국어 필드 전수 일치(언어 무관 서명으로 짝), 정규화 잔존물 0, ko 응답 `*En` 0, 실시간 도착 영문 생성률.

### 출발 시각 미반영 보정
⚠ **ODsay는 출발 시각을 반영하지 않는다**(심야에 첫차 04:00 노선 추천, 실측 6개 대안 전량). `getTransitRoute`가 노선 운행시간을 조인해 leg에 `serviceStatus`(running·unknown·outside)와 첫차·막차를 싣고 **안정 정렬로 강등**한다(`prioritizeOpen` 동형, 같은 상태 안에서 ODsay 추천순 보존). **정렬 키는 `outside` 유무 하나**(A21, 2026-08-25) — `unknown`은 정렬에 참여하지 않는다. 종전 3단 서열(running·unknown·outside 순, 삭제된 SERVICE_RANK 상수)은 선정 5개 절단과 결합해 "강등 = 제외"가 됐다(TAGO 4호선 0행). 술어는 `odsay-select.ts` `isOutside`를 강등·축 제외가 공유한다.

- 조인 키는 ODsay `lane[0].busLocalBlID`. **분기는 도시 코드가 아니라 TOPIS 보유 여부**다(TOPIS가 수도권 광역 노선도 가진다 — 하남 30-3 실측), 미보유만 TAGO 번호 검색 후 `endsWith` 대조(지역별 접두사 상이: 부산 `BSB`+숫자, 대구는 접두사 포함 동일 값).
- 판정은 순수 함수 `src/lib/service-hours.ts`(시각 주입이라 심야 재현 불요). **조회 실패는 throw 금지**(unknown으로 두고 경로 응답 유지). 낭독은 `outside`만 표기(정상·정보없음 침묵).
- ⚠ 첫차·막차는 **차고지 출발 기준**이라 막차 직후 중간 정류장 승차 가능 구간이 outside로 나올 수 있다(강등일 뿐 제외 아님).
- 지하철은 (역명·노선·`wayCode`)로 TAGO 시간표를 조인한다(`subway-service-hours.ts`, spec `2026-08-01-subway-service-hours-design.md`). 조인 실패·0행은 `unknown`이고 정렬·표기 어디서도 결함으로 읽히지 않는다.

### 도보 leg
`distanceMeters` + `toName`(뒤 첫 탑승 구간의 `fromName`, **환승 통로 필터 뒤** 배열에서 유도 — 필터 전이면 첫 도보가 환승역을 가리킨다)을 싣는다. 마지막 도보는 `toName` 부재가 정상이다(소비자가 "목적지까지"로 채운다).

### 승차 후보 판정

방향 필터·종착 검사는 `classifyBoardingCandidates`(웹) ↔ `classifyTransitBoardingCandidates`(Kit)에 있고(2026-09-02부터 차단 술어는 `unreachable` 하나 — 종착 앞 / 급행 통과 — 이고 급행 축은 `expressVerdict`가 `expressStopIds` ID 우선으로 판정한다. 계약 전문은 CLAUDE.md "승차 후보의 활성화 차단 술어" 항목), 두 판정이 쓰는 필드(`direction`·`destinationName`)는 **서울 지하철 실시간 도착 API**가 주고, **버스 upstream은 `direction`을 주지 않는다**(`transit-track.ts`가 빈 문자열로 채운다). 그래서 `directionUncertain`은 "방향 축이 있는데(후보 중 `direction`이 비어 있지 않은 것이 하나라도 있음) 매칭이 전멸했다"일 때만 참이다(A17, 2026-08-17) — 전원 빈 문자열이면 축 부재라 uncertain이 아니다. 어기면 모든 버스 세션에 "방면을 확인해 주세요"가 상시 붙는데 버스 목록엔 확인할 방면 정보가 없다. **2호선은 그 두 필드가 모두 다르게 동작하므로 이 계층을 수정하기 전에 아래 §서울 지하철 실시간의 "순환선(2호선)" 절을 읽는다.**

### 안내 상태 머신에 신호를 추가할 때 (A16에서 배운 것)

`transit-guide.ts`(웹 정본) ↔ `TransitGuide.swift`(Kit 미러)에 새 `TransitSignal`을 더하거나 국면 UI를 붙일 때 아래가 조용히 어긋난다.

- ⚠ **그 상태를 덮는 기존 대입을 먼저 찾는다.** 미등장 블록의 `signal = "notYetVisible"` 대입은 보호 목록(`upstreamFailed`·`signalLost`)에 없는 신호를 **매 폴마다 되돌린다**. 새 신호를 목록에 넣지 않으면 1회성 가드가 무력해져 반복 발화한다(실측). 신호를 추가하는 작업의 절반은 **덮는 자리를 찾는 일**이다.
- ⚠ **조회 대상 역은 상태 머신이 모른다.** 머신은 폴 *결과*만 받고 어느 역을 조회할지는 소비자(`trackTargetUrl` · `fetchPoll`)가 정한다. 그래서 "무엇을 조회할까"에 속하는 기능(A16 L3 역 재선택)은 **Kit·공유 fixture를 건드리지 않고** 앱·훅 계층에서 끝난다. 반대로 판정에 속하는 것은 반드시 양쪽 미러 + fixture를 지난다.
- ⚠ **국면이 조회 대상을 정한다**(`waiting`·`boarding` → 승차 정류소, 그 뒤 → 하차 정류소). 그래서 국면을 되돌리는 액션(`changeBoarding`)은 조회 대상도 함께 되돌린다 — 이것이 A16 L3 결함의 기제였다. 국면 전이를 추가할 때 "이 전이가 조회 대상을 어디로 옮기는가"를 함께 답할 것. **`boarding`(N3, 2026-08-22)은 차량을 고른 뒤에도 승차 정류소를 계속 조회하는 국면**이라, 소비자의 "승차 정류소 갈래" 조건은 `waiting || boarding`이어야 한다(iOS `fetchPoll`·`tagoCacheKey`·`resolveTagoIfNeeded`, 웹 `trackTargetUrl`·tago 캐시 키 — 한 곳만 `waiting`으로 남으면 boarding이 하차 정류소를 조회해 도착 관측이 영영 안 온다). riding 승격은 **도착 관측(`remainingStops 0`·지하철 arvlCd 0/1, 동결 제외) 또는 사용자 선언(`confirmBoarded`·`restoreBoarding`)** 두 길뿐 — 미등장은 `vehiclePassed`·`signalLost`까지만이고 탑승으로 추론하지 않는다(설계 리뷰 C2). "탑승 변경 취소"는 `board(previousLock)`이 아니라 `restoreBoarding`이다 — 전자는 식별자 잠금을 boarding으로 보내 이미 탄 사용자를 승차 정류소 폴링으로 되돌린다.
- **소거는 dispatch 한 곳에서, 단 축은 상태마다 다르다.** 사용자가 고른 기준 역(`boardOverride`)처럼 수명이 짧은 값은 호출부마다 지우지 말고 디스패치에서 판정한다 — `board` 디스패치만 네 곳이라 하나만 빠져도 다음 대기 국면이 조용히 틀린 역을 조회한다. ⚠ **그런데 그 자리에 두 축이 나란히 산다**: `boardOverride`는 **riding 진입과 `advance`**로(N3 개정 — 종전 `board` 시점 소거는 boarding이 재선택 역을 조회해야 해서 옮겼다. 국면 기반이라 폴이 일으키는 승격도 잡는다), 픽커 플래그(`reboardPickerActive`)는 **국면**으로(`phase != riding` = "그 UI가 성립하지 않게 될 때") 지운다. 픽커를 입력 종류로 지우면 **폴이 일으키는 arrived 전이를 놓쳐**, 화면에서만 사라지고 플래그가 남아 다음 구간 탑승에서 되살아난다(iOS는 VO 포커스까지 강탈).
- ⚠ **riding 상태줄의 지하철 문장은 `arrivalCode`가 고른다**(A27): 리듀서는 `lastArrivalCode`(state)와 `arrivalCode`(`trackingStarted`·`countdown`·`messageChanged`·`backOnTrack`)를 싣고, 공유 descriptor `frameLine`(`src/lib/transit-guide-text.ts` ↔ Kit `TransitGuideText.swift`)이 `subwayRidingMessage`로 종류를 고른다(99는 빈 문장 → 잔여 수 문장으로 폴백). ⚠ **판정은 descriptor에 있고 플랫폼은 키 조회만 한다**(E27 잔여 ① 재배선) — 소비자 쪽에 판정을 다시 쓰면 프로덕션 호출자가 0이 되어 공유 fixture만 초록으로 남는다. 이벤트에 `message`만 싣고 코드를 빠뜨리면 상태줄이 다시 "{stop}까지 {원문}"으로 돌아간다.
- ⚠ **국면 전용 UI를 새로 붙이면 그 플래그의 수명을 함께 정한다.** A16에서 override는 중앙화하고 주석까지 근거를 적어 놓고 **같은 수명을 갖는 짝을 그 switch에 넣지 않았다**(독립 리뷰가 잡았다). 규율을 세운 사람이 그 규율의 두 번째 대상을 못 보는 것이 이 계열의 전형이라, "이 상태는 언제 성립하지 않게 되는가"를 선언 시점에 한 줄로 적어 둔다.

---

## 지하철 빠른하차 (`subway-quick-exit` seed → `quick-exit.ts`)

### 지하철 빠른하차 (CLAUDE.md 이관)

서울교통공사 1~8호선 하차역·방향별 계단·엘리베이터 최근접 칸·문. ⚠ **거리는 열차 선형 위치**(`(칸−1)×4+문`)로 재고 **엘베×계단 쌍**을 최적화한다. 방향은 직전역 배제 **+ 방면 1개 확정**일 때만 채택(분기역·급행·표기 불일치는 null). `includeStops`와 무관하게 항상 계산한다. ⚠ **환승 leg는 seed가 아니라 ODsay `subPath.door`가 정본이다**(A20, 2026-08-25 — seed 원본은 계단이 환승 통로인지 출구인지 구분하지 않아 쌍 최적화가 사당에서 환승 통로 `5-2` 대신 엘베 옆 계단 `1-1`을 골랐다): `quickExit.transfer` 단독, seed 엘베·계단은 **최종 하차 leg에만**. 역내 환승(0m 도보 뒤 지하철)인데 `door`가 없으면 침묵. `door`는 하차 leg에서 문자열 `"null"`로 오므로 긍정 정규식(`^[1-9]\d*-[1-9]\d*$` — 칸·문 모두 1 이상, 같은 승강장 완행→급행의 `"0-0"`은 부재)만 통과시킨다 — 부정 판정(`!== "null"`)은 다음 변종에 뚫린다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §지하철 빠른하차** — 이 코드를 수정하기 전에 읽는다.


서울교통공사 1~8호선 하차역·방향별로 계단·엘리베이터에 가장 가까운 칸·문(15143840). seed 빌드 `scripts/build-subway-quick-exit.mjs`(가드 11종), spec `2026-08-08-subway-quick-exit-design.md`. 별도 라우트 없이 `TransitLeg.quickExit`로 실린다.

- ⚠ **거리는 열차 선형 위치**(`(칸−1)×4+문`)로 잰다. (칸 차이, 문 차이) 사전순은 물리 거리가 아니다 — `1-4`와 `2-1`은 옆 문인데 같은 칸 양끝보다 멀다고 판정된다.
- **엘베×계단 쌍을 최적화한다**(각자 최저면 칸 차이 0~1이 55%인데 쌍이면 91%). 두 시설을 병기하는 이유가 *도착해서* 고르게 하려는 것이라 둘이 멀면 병기가 무의미하다.
- **방향은 직전역으로 배제**하고 정확히 하나 남을 때만, 그 방향의 방면이 **하나로 확정**될 때만 채택한다. ⚠ 배제로 살아남은 것과 확인된 것은 다르다 — 방면 없는 방향(응암 6호선 상행)은 배제될 수 없어 조용히 선택된다. 분기역(강동 5호선 하행)·급행·표기 불일치는 전부 null.
- ⚠ ODsay는 `"수도권 5호선"`, 이 데이터는 `"5호선"`이고 **급행은 `"수도권 9호선(급행)"` 형태로 노선명에 실린다**. 접두만 벗기고 노선 화이트리스트는 두지 않는다(커버 정본은 seed 키 하나).
- 직전역은 `passStopList` 끝에서 두 번째이고 **마지막이 하차역인지 확인하고** 쓴다(부분·역순 목록이면 반대편 승강장 안내가 된다).
- `includeStops`와 무관하게 **항상 계산한다**(그 플래그는 방출만 통제 — 옵트인으로 두면 CLI·MCP·iOS가 조용히 침묵한다).
- 문장은 소비자가 만든다(provider가 문장을 주지 않는다): 웹 `quick-exit-text.ts` ↔ Kit `QuickExitText.swift` ↔ CLI `transitQuickExitLine` 3벌 미러, 동조는 `format-drift.test.ts`가 웹 정본 실행 대조로 강제. **3분기 × 2형태로 키를 나눈다**(변수만 비우면 로케일별 절 순서가 깨지고, `"3-2,3-3 사이"`를 문 번호 자리에 넣으면 문장이 깨진다).
- 노출은 경로 브리핑 + 안내 세션 **대기 국면**(포커스 착지점 뒤·열차 목록 앞), 통지는 만들지 않는다.
- **환승 leg는 seed가 아니라 ODsay `subPath.door`가 정본이다**(A20, spec `2026-08-25-subway-transfer-door-design.md`): `quickExit.transfer` 단독("사당 하차, 빠른 환승 5-2 문"), seed 엘베·계단은 최종 하차 leg에만. 하차 종류 판정(`alightKindAt`)은 환승 통로 필터 **전** 원본 subPath 인덱스에서 — 0m 도보가 역내 환승의 단서다. 역내 환승인데 `door`가 없으면 필드 부재(거짓보다 침묵). `door`의 부재 표기는 문자열 `"null"`이라 긍정 정규식 매칭만 통과시킨다. 소비자 3벌은 `transfer`를 먼저 보고 있으면 그 문장만 낸다(배타).

---

## 시내버스 (`tago-bus` + `seoul-bus` → `src/lib/bus.ts`)

### 시내버스 (CLAUDE.md 이관)

지방=TAGO·서울=TOPIS, `mergeBusStops` allSettled, envelope 다름(위 참조). ⚠ **TAGO 근접 조회는 ~700m 고정 반경이라 0건 대부분이 미커버가 아니라 정상적인 반경 밖**이다. 미커버 판정 정본은 `isUncoveredBusRegion`(라우트·채팅 공용, provider 직접 호출 금지)이고 **이 마커만 upstream 뒤에 온다**. ⚠ **도착 완성 문장(`arrmsg1`)을 다듬는 것은 승차 국면뿐이다**(`rewriteBusArrivalMessage`, 2026-08-16): 승차 상태줄만 잔여 수를 따로 말해 원문 꼬리 `[N번째 전]`과 중복되고, **대기 후보 목록·정류소 도착 목록은 `remainingStops`를 별도로 싣지 않아 그 꼬리가 잔여 정보의 유일한 채널**이다(웹 `TransitGuidePanel`·iOS `TransitTrackingSheet` 모두 `item.message`만 조립). 같은 원문이 국면에 따라 뜻도 다르다 — 대기 중 "2분55초후"는 *버스가 오기까지*, 승차 중에는 *내릴 곳까지*라 어미가 갈린다. 그래서 `slotToItem`의 국면 인자에 **기본값이 없다**. 꼬리 정규식은 `ARRMSG_REMAINING_TAIL` 하나를 읽는 쪽(`remainingFromArrmsg`)과 지우는 쪽이 공유한다 — 한쪽만 무는 변형이 생기면 잔여 수와 문장이 동시에 사라진다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §시내버스** — 이 코드를 수정하기 전에 읽는다.


지방=TAGO·서울=TOPIS, `mergeBusStops`가 `allSettled`로 병합한다(envelope는 서로 다르다 — `CLAUDE.md` 횡단 함정 참조). spec `2026-08-02-bus-uncovered-region-design.md`.

- ⚠ **TAGO `getCrdntPrxmtSttnList`는 ~700m 고정 반경**이다(반경 파라미터 없음. 해남 서림승강장 기준 600m 2건 → 800m 0건 실측). 그래서 **0건은 대개 "이 지역 미커버"가 아니라 정상적인 반경 밖**이고, 둘을 뭉개면 전국 시골이 미제공으로 낙인찍힌다.
- 미커버 판정 정본은 `isUncoveredBusRegion`(`src/lib/bus.ts`, 라우트·채팅 공용 — **provider 직접 호출 금지**). seed는 `getCtyCodeList` 138개(`scripts/build-tago-cities.mjs` → `tago-cities.json`).
- ⚠ **이 마커만 upstream 뒤에 온다**(다른 도메인은 파싱→마커→키 게이트→upstream). 좌표만으로 사전 판정하면 담양·화순처럼 인접 광역시 버스가 넘어오는 지역에 거짓 미제공이 나간다. **0건일 때만** 발동시키면 그 지역은 분기에 들어오지 않아 반례가 스스로 사라진다.
- 매칭 키는 **시도+시군**(강원/경남 고성군 동명 실사고, 시도는 citycode 앞 2자리)이고 **모르는 시도는 fail-open**이다. 행정구역 개편이 표를 낡게 만든다 — 광주광역시는 전라남도와 통합돼 카카오·juso가 `전남광주통합특별시`로 주는데 TAGO는 여전히 `광주광역시`다.
- ⚠ seed 빌드는 **`totalCount:0`을 그대로 믿지 않는다**. upstream이 장애를 HTTP 200 + 0으로 내서 천안·함평·산청이 한 빌드에서 가짜 0으로 잡혔다(재확인 + golden 가드).

### 도착 완성 문장(`arrmsg1`)의 국면별 재작성 (`rewriteBusArrivalMessage`, 2026-08-16)

- 낭독 정본은 `arrmsg1`·`arrmsg2` 완성 문장이고(`CLAUDE.md` 횡단 함정), **다듬는 것은 승차 국면뿐**이다. 승차 상태줄은 잔여 수를 따로 말해 원문 꼬리 `[N번째 전]`과 중복되므로 꼬리를 떼고 어미를 "남음"으로 바꾼다. **대기 후보 목록·정류소 도착 목록은 `remainingStops`를 별도로 싣지 않아 그 꼬리가 잔여 정보의 유일한 채널**이다(웹 `TransitGuidePanel`·iOS `TransitTrackingSheet` 모두 `item.message`만 조립) — 거기서 떼면 어느 버스를 탈지 고를 정보가 사라진다.
- 같은 원문이 국면에 따라 뜻이 다르다: 대기 중 "2분55초후"는 *버스가 오기까지*, 승차 중에는 *내릴 곳까지*. 그래서 `slotToItem`의 국면 인자에 **기본값이 없다**([[no-default-for-safety-parameters]]).
- 꼬리 정규식은 `ARRMSG_REMAINING_TAIL` 하나를 읽는 쪽(`remainingFromArrmsg`)과 지우는 쪽이 공유한다 — 한쪽만 무는 변형이 생기면 잔여 수와 문장이 동시에 사라진다.

---

## 서울 지하철 실시간 (`seoul-subway-arrival`)

### 서울 지하철 실시간 (CLAUDE.md 이관)

`arvlMsg2` 정본, 역명 기반(seed `findStationsNear`로 근접역), 부분실패 보존. ⚠ **`INFO-200`은 "운행 시간 밖"과 "실시간 미제공 역"이 공유하는 코드다** — 미커버로만 읽고 역을 숨기면 심야에 근접역이 전부 사라져 "주변에 지하철역이 없습니다"로 낭독된다. **역은 어떤 상태에서도 목록에서 빼지 않고 4-state**(`ok`/`unavailable`/`closed`+`firstTime`/`unknown`)로 가른다. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §서울 지하철 실시간** — 이 코드를 수정하기 전에 읽는다.


`arvlMsg2`가 낭독 정본, 역명 기반 조회(seed `findStationsNear`로 근접역), 부분 실패는 보존한다.

⚠ **`INFO-200`은 "운행 시간 밖"과 "실시간 미제공 역"이 공유하는 코드다.** 미커버로만 읽고 역을 숨기면 심야에 근접역이 전부 사라져 화면이 "주변에 지하철역이 없습니다"로 낭독한다 — 근접역은 정적 seed라 시각과 무관하게 참인데 그 참을 부재로 뒤집는 거짓말이다(위원장 지적 2026-08-02).

**역은 어떤 상태에서도 목록에서 빼지 않고 4-state로 가른다**: `ok` / `unavailable`(조회 실패) / `closed`(그 역 시간표로 운행 밖 확정, `firstTime` 동반) / `unknown`(판정 불가 — 미제공 역이거나 시간표 결측).

- 판정은 `judgeStationService`(순수)가 `fetchStationTimetable`+`judgeServiceStatus`로 하고 **실시간이 빈 역에만** 조인한다(평시 0콜, 시간표는 revalidate 86400).
- **`closed` 단정은 시간표 `lines[].coverage`가 `ok`·`noTrains`인 노선만 참여하는 allowlist다**(A19, 2026-08-23): `unknown`(업스트림 0행)·`unavailable`·미지 값이 하나라도 섞이면 판정 불가(`closed:false`). 대가 — 0행 노선이 있는 역(홍대입구·강남·서울역)은 심야 "운행 종료, 첫차 X"가 나가지 않는다. 거짓 확정보다 침묵이 덜 해로워 택한 교환이지 회귀가 아니다.
- ⚠ **시각 근사(01~05시)로 가르지 말 것** — 같은 04:47에 천호 `closed`·강동 `ok`(첫차 대기 열차)가 공존한 실측이 있다.

### 영문 투영 (`lang=en`, `withArrivalsEn` → `subway-arrival-en.ts`, E27)

라우트가 `lang=en`일 때만 각 도착에 `lineEn`·`directionEn`·`trainLineNmEn`·`messageEn`·`currentLocationEn`을 additive로 더한다(한국어 필드 불변). **거짓 문장보다 부재**가 원칙이다:

- `messageEn`은 `arvlCd`×`arvlMsg2` **정확 행렬**(0↔`{S} 진입`, 1↔`{S} 도착`, 2↔`{S} 출발`, 3·4·5↔`전역 출발/진입/도착`, 99↔`N분( M초) 후`·`[K]번째 전역`)에서만 나온다. 코드와 문장 모양이 어긋나면 부재 + 모양만 계측(`console.warn`, 역명 제외). 분 ≥ 1·초 0~59·잔여역 ≥ 1 밖도 부재. `barvlDt`는 쓰지 않는다.
- 괄호 현재역(`5분 후 (종각)`)은 문장에 넣지 않고 `currentLocationEn`의 원천이다(arvlMsg3 우선, 둘이 다르면 부재).
- 역명 → seed 영문: 도착 노선과 **같은 노선 후보 우선**(영문 표 동치 → 코어 접두), 남은 후보의 영문이 대소문자 무시로 둘 이상이면 부재. ⚠ 서울역은 seed에 `Seoul Station`(1·4호선)·`Seoul`(인천국제공항선)·`Seoul station`(경의중앙선) 3표기라 노선 문맥 없이는 부재다 — 공항철도 열차의 `서울 출발`이 이 함정에서 검출됐다(게이트 1차 33/35).
- `trainLineNm` `{종착}행 - {방면}방면( (급행))` → `To {Dest} via {Via}`(급행 꼬리는 `express` 필드가 따로). 방면의 괄호 노선 힌트(`신촌(경의중앙선)`)는 seed 매칭 힌트로 쓴다.

### 순환선(2호선)은 방향·종착 두 필드가 모두 다르게 동작한다

승차 후보 판정(`classifyBoardingCandidates` ↔ `classifyTransitBoardingCandidates`)이 쓰는 두 필드가 2호선에서만 갈라진다. 실호출 확정 2026-08-16.

- **방향 표기가 `내선`/`외선`이다**(상행·하행 아님). 대응은 **내선 = wayCode 2, 외선 = wayCode 1**. 근거는 순환선 반대편 4개 역의 ODsay leg 8건 + 한 바퀴 13개 역 도착 표본 52건의 직전 역(`currentLocation`)이 같은 순환 순서를 어긋남 없이 따른 것이다. ⚠ **한 역 표본으로 확정하지 말 것** — 그 역에서 마침 그랬을 경우와 구분되지 않는다.
- ⚠ **종착역은 상수다.** 13개 역 52표본이 **전부 "성수"**였다(양방향 모두). 열차별 종착이 아니므로 **종착 검사에 태우면 안 된다** — 경유 목록에서 성수가 하차역보다 앞선 구간(을지로입구→잠실은 성수 9 < 잠실 14)에서 **모든 열차가 활성화 차단**된다. 성수보다 앞에 있는 열차가 성수 **다음** 역의 도착 목록에 오르는 것이 그 열차가 성수에서 끝나지 않음을 증명한다.
- **근본 이유는 전제다**: 종착 검사는 "경유 목록의 순서가 곧 열차의 잔여 경로"라는 **선형 노선의 전제**에 기대는데 닫힌 고리엔 그 전제가 없다(진행 방향 어느 역이든 앞에 있다). 그래서 판별자는 역 이름도 노선 번호도 아닌 **방향 표기 자체**(`isLine2Direction`)다.
- ⚠ **지선(성수·신정)도 내선/외선을 쓴다** — "내선이면 순환선"이 아니다(8개 역 실측). 그래서 그 판별자는 지선까지 함께 걸러내는데, 두 가지가 확인돼 안전하다: ①**방향 대응이 본선과 같다**(ODsay 지선 leg 4건이 도착 표기와 일치 — 이쪽이 안전 축이다. 뒤집혀 있으면 반대 방향 열차만 남는다) ②**종착 검사가 지선에서 잡아낼 것이 없다**(종착 값이 `"성수지선"`·`"신도림지선"`이라는 **역명 아닌 라벨**이거나 `"신설동"`·`"까치산"`이라는 **그 지선의 종점**이라, 어느 쪽도 하차역보다 앞설 수 없다). 지선은 선형이므로 언젠가 중간 회차 열차가 생기면 이 면제가 위험해진다 — 그때는 판별자를 노선 축으로 좁혀야 한다.

---

## 실시간 혼잡도 (`seoul-congestion` + `congestion-area.ts` → `congestion.ts`)

서울 `citydata_ppltn`. spec `2026-08-01-realtime-congestion-design.md`.

- 영역 경계가 미공개라 종전엔 착수 불가로 판정했는데, 전체 `citydata`의 `SUB_STTS`·`BUS_STN_STTS`가 **구성 지하철역·버스정류장 좌표(WGS84)**를 준다. seed는 `scripts/build-congestion-areas.mjs`(116영역·1,969지점, 가드 4종).
- ⚠ **중심-반경 원 금지.** 영역 크기가 0~1,872m로 제각각(중앙 475m)이라 잠실 원이 주택가를 삼킨다. 판정은 **최근접 구성 지점 ≤300m**, 중첩 시 중심 최근접 1개(잠실역 1번 출구는 3영역 동률 7m → 중심 78m인 "잠실역"). 임계값 근거: 매칭 대상 ≤120m vs 비대상 ≥676m 완전 분리, 서울 격자 8.9%.
- **봉투 3형**: 정상은 `RESULT` 없는 `SeoulRtd.citydata_ppltn` 배열, 오류는 점 포함 **평면 키** `"RESULT.CODE"` → 공용 파서 스코프 밖.
- 캐시는 좌표가 아니라 **영역 코드** 단위 5분. `area:null`은 오류가 아니고(서울의 91%) 이때 upstream을 호출하지 않는다.
- 등급어는 provider가 원문 통과, 번역은 표시 계층(`congestion-level.ts`). API가 한국어만 주므로 **완성 문장은 ko 로케일에서만** 노출한다. 인구수는 라우트에서 제거(해석 불가 수치).

---

## 자동차 경로 (`tmap-car` 기본 + `kakao-navi` 폴백 → `car-route.ts`)

### 자동차 경로 (CLAUDE.md 이관)

**ko 기본 Tmap**(2026-07-30 위원장 판정 — Tmap `description`은 도로명 포함 완성 문장, 카카오 `guidance`는 도로명 없는 조각). **낭독 문장은 `getCarRoute` 진입점의 `rewriteCarGuidance`가 다듬는다**(2026-08-10, 도보 동형 — "오른쪽 방향 후"류 「후」 결합 파손을 동사구로. ⚠ turnType 117/118은 회전이 아니라 갈래 선택이라 "우회전"으로 바꾸면 의미가 틀린다). guide별 수치 0은 **미제공 의미론**이라 소비자는 >0일 때만 병기한다. 게이트 `hasCarRouteKey`(=tmap∥kakao). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §자동차 경로** — 이 코드를 수정하기 전에 읽는다.


ko 기본 Tmap(2026-07-30 위원장 판정). 도보와 반대 구도로, Tmap `description`이 도로명 포함 완성 문장인 반면 카카오 `guidance`는 도로명 없는 조각이다. en은 `ncp-directions`이되 **ko 폴백 사유 셋**(NCP 키 부재·경유지·**기하 요청**)이 있고 전부 응답 `guidanceLang: "ko"`로 드러난다(A26 2026-08-31) — 기하 요청을 NCP로 보내면 `provider`·기하가 없어 실시간 안내가 조용히 간략 강등된다.

- **낭독 문장은 서버 `rewriteCarGuidance`(`src/lib/car-guidance.ts`)가 다듬는다**(2026-08-10 위원장 판정, 도보 `rewriteWalkGuidance` 동형). Tmap 문형은 `{지점}에서 {방면}으로 {행동} 후 {도로}를 따라 {거리} 이동` 하나뿐이고(전국 12경로 212문장 전수), `{행동}` 자리의 상태·위치 명사(오른쪽 방향·터널·고가도로옆 등 53% = 112/212)가 「후」와 결합이 깨져 동사구로 푼다("오른쪽 길로 들어선 뒤"·"터널을 지나"). 적용 지점은 `getCarRoute` 진입점 한 곳(웹·iOS·CLI·채팅·실시간 안내 동조), 미매칭·회전 계열·카카오 폴백 문장은 원문 통과(fail-safe). 코퍼스 fixture는 `src/lib/__tests__/fixtures/tmap-car-corpus.json`.
  - ⚠ **"오른쪽/왼쪽 방향"(turnType 117/118)을 회전 어휘로 바꾸지 말 것**: 코퍼스 실측으로 48%/69%가 같은 도로로 이어진다(올림픽대로→올림픽대로) — 교차로 회전이 아니라 자동차전용도로의 갈래 선택 지시라, "우회전"으로 바꾸면 문장은 자연스러워지고 의미가 틀린다.
  - 자동차에도 임박 층이 있지만(2026-08-23 K2) **문장을 보지 않는다** — 행동은 Tmap `turnType`을 서버가 `action`(`carActionFromTurnType`, 공식 코드표)으로 투영한 별도 필드이고 리듀서는 car 프로파일(웹 `actionSource: "step"`; Kit은 2026-09-02부터 `step.action` 직접)에서 그것만 읽는다. 그래서 재작성이 깨뜨릴 하위 판정은 여전히 없다. ⚠ `action`이 없으면 침묵이다 — 문장 분류로 폴백하지 말 것("오른쪽 방향"이 회전으로 분류된다). 182·183은 "도착안내 왼쪽/오른쪽"(목적지 위치)이지 비보호 회전이 아니다.
- guide별 `distanceMeters`/`durationSeconds`는 0이 **미제공 의미론**이다. 소비자(웹·iOS·CLI)는 >0일 때만 수치를 병기한다(0m 중복 낭독 차단).
- 폴백은 Tmap throw 시에만 카카오모빌리티(관측된 "경로 없음"류 graceful 코드가 없어 현재는 전량 throw).
- 게이트 `hasCarRouteKey`(=tmap∥kakao, 라우트·채팅 declaration 공용). 캐시 `no-store`(실시간 교통, 両 provider 동일) + IP 레이트리밋 60초 10회(Tmap 일 1,000건 쿼터를 도보 폴백과 공유하므로 walk 동형 비용 방어).
- NCP `duration`은 **밀리초**다(`CLAUDE.md` 단위 함정 참조).

---

## 실시간 길 안내 (톤·정지 판정·오디오 세션)

### 안내 경로 origin은 "신선한가"가 아니라 "정확한가"로 고른다 (CLAUDE.md 이관)

**안내 경로 origin은 "신선한가"가 아니라 "정확한가"로 고른다**(2026-08-17 A18). 세션이 시작되는 순간은 차량 하차·실내 탈출 직후라 대개 그 세션에서 GPS가 가장 나쁜 순간이고, 그래서 **첫 fix와 가장 나쁜 fix가 구조적으로 같은 fix**다. 그 좌표가 origin이 되면 경로가 통째로 다른 곳에서 출발하고(실보행 115m → 건너야 할 횡단보도가 경로에 없었다), 오류·빈 결과가 아니라 멀쩡한 200 응답이라 낭독만 듣는 사용자에겐 반증 채널이 없다. `BeaconModel`의 시작 조회 대기 분기는 Kit `routeOriginStep`(수용 ≤30m·≤10초면 즉시, 미달은 100m 이내 최선값 보관, 15초 상한에 최선값, 없으면 간략 폴백)만 지난다. ⚠ **`isUsableFix`를 조이지 말 것** — 비콘 앵커·최종 접근은 느슨한 정확도가 의도다(500m 전 정밀 좌표보다 40m 오차의 지금 좌표). ⚠ **재측위(`currentCoordinate()`) 의존을 되살리지 말 것** — 의존을 끊은 것과 판정을 버린 것은 다른 일이며, 정책은 스트림 위에서 구현한다. origin fix는 `routeOrigin` 로그 1줄로 반드시 남긴다(계측 전 early-return이 원인 값을 지운 것이 이번 판정의 병목이었다).

### 소리와 음성은 같은 청각 채널이다 — 톤 뒤 발화 계약 (CLAUDE.md 이관)

**소리와 음성은 같은 청각 채널이다 — 톤 뒤 발화 계약**(2026-08-14): 안내 효과음(잔여 0.6초 이상)이 재생 중이면 SR 통지는 그 소리가 끝난 뒤 게시된다. 판정은 `speechDeferStep`(Kit `GuideSpeechGate.swift` ↔ 웹 `guide-speech-gate.ts` 미러 — **톤 이름 목록 금지**, 축은 남은 재생 시간), 지연은 발화 창구 한 곳의 단일 슬롯 latest-wins(iOS `DeferredAnnouncer`·웹 재발화 타이머 공유 — **타이머·슬롯을 늘리면 서로의 문장을 덮는다**). ⚠ 새 통지 경로는 반드시 기존 창구(`announce`)를 지나야 지연이 걸린다 — iOS에서 `AccessibilityNotification` 직접 게시·웹 live region 직접 대입 금지. 사용자 활성화의 직접 응답만 `announceNow`(즉시·슬롯 무효화). 상세는 spec `2026-08-14-guide-speech-after-tone-design.md`.

### 대중교통 승차 추세 톤은 이벤트 소유가 신뢰 불가보다 앞이고, 앵커는 "마지막으로 전달된 잔여"다 (CLAUDE.md 이관)

**대중교통 승차 추세 톤은 이벤트 소유가 신뢰 불가보다 앞이고, 앵커는 "마지막으로 전달된 잔여"다**(E15 ②, 2026-09-02, spec `2026-09-02-transit-trend-tone-and-express-gate-design.md`): Kit `transitToneStep`(↔ 웹 `transit-guide-tone.ts`, 공유 fixture는 **리듀서 입력 단위**)은 도보 `toneLayerStep`과 배타 계층·앵커 비교만 공유한다 — 축은 정수 정거장 수(데드밴드 1), 정지 축 없음, 신규 소리 0. ⚠ 도보 순서(신뢰 불가 우선)로 되돌리지 말 것: 대중교통의 신호 전이는 항상 이벤트(weak 톤)와 함께 와 한 폴에 경고음 둘이 나고 새 재생이 앞 소리를 선점한다. ⚠ 이벤트가 있는 폴은 앵커를 그 잔여로 옮긴다 — 안 옮기면 사다리 발화 직후 같은 값에 closer가 난다. `neverSeen`·`notYetVisible`은 unreliable이 아니다(급행 오선택으로 실제 타고 있는 사용자에게 여정 내내 경고). 확정 도착만 억제, 추정 도착은 경고 유지. `TransitGuideModel`의 톤은 `playTone`(억제 가드 한 곳), 통지는 `DeferredAnnouncer`(톤 뒤 발화 — 도보와 같은 계약, 직접 응답만 `announceNow`)를 지난다.

### 소리를 낸 직후 세션을 끝내면 그 소리가 잘린다 — 순서가 아니라 대기가 답이다 (CLAUDE.md 이관)

**소리를 낸 직후 세션을 끝내면 그 소리가 잘린다 — 순서가 아니라 대기가 답이다**(2026-08-09 실사용 발견). `playTone` 뒤에 `endSession()`을 두는 순서 규칙은 톤의 *시작*만 `.playback` 아래에 두고, 한 줄 뒤의 카테고리 변경은 재생 **도중**에 떨어진다. 백그라운드에서 `.ambient`는 정의상 무음인 데다 오디오 백그라운드 모드의 근거도 함께 사라져, 2.2초짜리 도착 종이 거의 들리지 않은 채 끊긴다(정지 톤 1.3초도 같은 경로였다). 지금은 `BeaconTonePlayer.endSession()`이 재생 잔여 시간만큼 원복을 미룬다. ⚠ **`beginSession()`은 미뤄 둔 원복을 반드시 취소하고**(안 하면 새 세션 한복판에 `.ambient`가 떨어져 그 세션이 통째로 잠금 무음), **`shutdown()`은 취소한 뒤 즉시 원복을 마친다**(안 하면 화면을 떠난 뒤에도 공유 세션이 `.playback`에 남아 무음 스위치를 무시). ⚠ **전경에서는 증상이 없다** — 손에 들고 하는 시험은 이 계열을 통과시킨다.

### 결정 지점 안내는 두 층이고 거리가 다르다 (CLAUDE.md 이관)

**결정 지점 안내는 두 층이고 거리가 다르다**(2026-08-09): 40m `announceSteps`(전문)가 *무엇을* 할지, `imminent`(짧은 명령형 + 행동별 톤 + 햅틱, 유도식 10 + `PROJECTION_LAG_M` = 현재 20m — 초기 10m는 투영 지연에 잡아먹혀 회전을 지난 뒤 발화한 위험 실사고로 상향했고, lag 자체는 실보행 재판정 2026-08-12로 15→10)가 *지금이다*를 알린다. **walk 직진 구간의 주기 통지는 단문이다**(같은 재판정 — "{target}까지 {distance} 직진하세요", `walkPeriodicLine` ↔ `GuideText.periodicWalk`): 여러 행동을 한 문장에 싣는 조망은 40m 전문 1회의 몫이고 반복 채널에 실으면 과잉이다(car는 K2부터 `carPeriodic` "{거리} 앞 {명령}" 단문). 문구 선택 분류기 `walkStepAction`(웹 `walk-action.ts`, 재작성 문장에 부분 문자열 판정)은 **서버 `attachStepActions`에서 돌고** 리듀서는 그 결과(`step.action`)만 읽는다(E16 축3) — Kit에는 분류기가 없다(2026-09-02 삭제, `GuideActionSource`·`stepActionFor`·`buildDisplayUnits(source:)`도 함께). 클라이언트에 문장 폴백을 되살리지 말 것. ⚠ **회전 표지를 건널목보다 먼저 본다** — "횡단보도"는 지명의 일부로 등장하므로("천호역 횡단보도에서 왼쪽으로 돌아…") 순서를 뒤집으면 좌회전 지점에서 "횡단보도를 건너세요"가 나간다. "좌측"·"우측"은 회전이 아니라 어느 쪽 횡단보도인지라 **마커가 아니다**. ⚠ **래치는 스텝 단위다** — 유닛 끝으로 뛰면 묶음의 첫 스텝만 분류돼 묶음 **안**의 회전이 통째로 침묵한다(실측 2건). ⚠ **`imminentUpTo < announcedUpTo`가 발화 조건이고 그래서 전문 낭독보다 앞이다.** ⚠ **이미 지난 경계엔 발화 금지**(하한 없으면 uncertain 뒤 창이 경계를 넘겨 착지한 fix에서 모퉁이를 돈 뒤에 명령이 나간다). ⚠ **행동 없는 경계는 발화만 건너뛰고 래치는 전진.** ⚠ **40m 톤은 임박 층이 없는 프로파일(`imminentAheadM === null`)에만 남는 폴백이다** — walk·car 둘 다 임박 층이 있어(2026-08-23 K2부터 car도) 40m에선 톤을 떼지 않는다. 임계 축만 다르다(walk 거리 20m, car는 아래 시간 축). ⚠ **햅틱은 백그라운드 미지원**이라 어떤 신호도 진동에만 싣지 않는다. ⚠ **마지막 결정 지점을 최종 접근이 선점하는 한계는 의도적 수용이다** — 미루게 하면 이탈 판정이 마지막 50m까지 연장돼 A6 헛경고율이 2배가 된다(실측). 설계는 spec `2026-08-09-walk-imminent-cue-design.md`. **임박 큐는 한 결정 지점에 세 번이고 문장은 첫 번만이다**(2026-08-26 위원장 피드백, spec `2026-08-26-imminent-triple-cue-and-session-idle-design.md`): 단계는 `[imminentAheadMeters, ...imminentRepeatM]`(walk 20·15·10m — 5m·0m 요청도 같은 `+lag` 유도식이라 0m 단계가 지난 경계 폐기 하한과 충돌하지 않는다), 상태 `imminentStage`, 이벤트 `stage`. fix당 이벤트 1개라 건너뛴 단계는 소급하지 않고, 반복 단계는 `lastAnnouncedAt`을 갱신하지 않는다(재통독 리듬이 밀린다). car는 `imminentRepeatM: []`. ⚠ 소비자가 `stage > 0`에 문장을 내면 4초 안에 셋이 겹친다. **임박 큐의 소리는 행동별 5종이다**(2026-08-22 N2): `imminentTone(action)`(웹 `walk-action.ts` ↔ Kit `WalkAction.swift`)이 횡단보도·왼쪽·오른쪽·뒤로 돌기(`WalkAction.back`)·그 외(`ahead`)를 가르고, 6a 방출부는 이 함수만 지난다(`"ahead"` 상수로 되돌리면 route-guide fixture 4건이 실패한다). 소리 파일은 손으로 만들지 않는다 — `scripts/build-guide-tones.py`가 정본이고 햅틱 타이밍도 그 상수에서 나온다. ⚠ `BeaconTone.left/.right`는 케이스가 행동이고 파일은 `LeftRightToneScheme`이 고른다(실기기 선택 대기, `docs/BACKLOG.md` N2).

### 자동차 임박 큐는 문장이 아니라 서버 `turnType` 투영(`action`)으로 행동을 고르고, 없으면 침묵이다 (CLAUDE.md 이관)

**자동차 임박 큐는 문장이 아니라 서버 `turnType` 투영(`action`)으로 행동을 고르고, 없으면 침묵이다**(2026-08-23 K2, spec `2026-08-23-car-guidance-completion-design.md`): 자동차 문장의 "오른쪽 방향"(117)은 회전이 아니라 갈래라 도보 분류기(`walkStepAction`)로 되돌아가면 거짓 회전 명령이 된다 — `GuideTuning.actionSource`가 car·walk 둘 다 `step`이고(walk는 2026-08-23 E16 축3로 전환) 웹은 `stepActionFor`만 지난다(Kit은 그 축 자체를 지워 `step.action`을 직접 읽는다, 2026-09-02) — 문장 분류로 폴백하지 말 것. 코드 표 정본은 Tmap 공식 표(`car-action.ts` ↔ `CarAction.swift`, fixture `car-action-cases.json`): 16~19는 "N시 방향 좌/우회전"(회전), 130 토끼굴, 131~142 시계 방위, **182·183은 "도착안내 방향"이라 null**. 임계는 `max(바닥 15m, v×6초)`(운전자 9초)이고 **속도 표본이 2개 미만이면 60m** — 바닥만 남기면 터널 복귀 직후가 침묵한다. ⚠ **공백 뒤 따라잡기는 `silentCatchUp` 세 항이 한 묶음이다**(점프 fix 무발화·표본 제외 / uncertain 복귀 공백 >10초 재획득 / 지난 유닛 래치 전진): 2026-08-22 실주행에서 터널 5분 뒤 구속 창이 fix마다 150m씩 기어가며 **지난 교차로 3개의 "우회전"을 1초 간격으로** 읽었고, 그 기어가는 fix의 표본(150m/s)이 창을 부풀려 재획득도 안 걸렸다 — 한 항만 되돌리면 나머지가 무력화된다. 도보는 종전 동작(동결). 운전자 모드(`CarListener.driver`)는 리듀서가 아니라 `BeaconModel`이 이벤트를 거르고 `TtsPlayer.speakGuidance`(세션 카테고리 비소유)로 발화하며, `driverChannel`·`arrivalSessionKind`는 **`stop()` 앞에서 기록/유지**한다(stop()이 `sessionKind`를 walk로 되돌려 도착 문장이 VO 채널로 새고 인계 버튼이 안 보인다). 자동차 도착은 `carArrivalStep`(40m·도플러 정지·정확도≤30)뿐이고 15m 무조건 분기가 없다(옆 차로 통과 종료). 상세는 `docs/INTEGRATIONS.md` §자동차 임박·따라잡기.


판정은 전부 순수 함수이고 웹 ↔ Kit 미러다(공유 fixture가 동조를 강제한다). spec `2026-08-08-background-tone-coverage-design.md`.

### 톤 계층 (`toneLayerStep`)
Kit `GuideToneLayer.swift` ↔ `src/lib/guide-tone-layer.ts`, fixture `tone-layer-scenarios.json`이 톤 열 일치를 강제한다.

**신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축** 순으로 **배타** 판정한다. 상위가 톤을 내면 `trendStep`을 호출하지 않으므로 앵커·타이머가 불변이고, 그래서 "억제된 후보의 latch가 커밋되어 다음 fix에서 사라지는" 문제가 성립하지 않는다(중재기·2단계 커밋 계약이 불필요한 이유).

- **간략·상세가 같은 함수를 쓰고 차이는 입력 조립에만 둔다.** 모드별 계층 로직을 새로 만들면 부채가 형태만 바꿔 돌아온다.
- 소리 13종이고(2026-08-22 N2가 횡단보도·왼쪽·오른쪽·뒤로 돌기 4종을 더했다 — 임박 큐 5종은 `imminentTone(action)`이 가른다) **`tick`은 정지**다(종전 하트비트 폐기 — 간략에서는 정체, 상세에서는 생존 신호라는 두 뜻이었다).
- ⚠ 최소 재확인 간격 도입은 **폐기한 하트비트의 재등장**이라 기각됐다. `maxNormalSilenceSeconds` 21초가 계약값이다.
- **데드밴드는 축마다 다르고, 기각된 축소는 간략 쪽 이야기다.** 간략은 직선거리라 GPS 지터가 그대로 실려 `max(15, accuracy)`를 유지한다(축소하면 지터가 톤이 된다 — 이 기각은 유효하다). 상세는 구속 창 투영 + `max(state.d, proj.d)` 단조 전진을 거치고 `phase` 게이트·`projectionJumped`가 이탈·튐 fix를 앞서 버리므로 **뒤로 튀는 일이 구조적으로 없고**(실보행 5세션 6,047 스텝 역행 0건), 데드밴드에 남은 역할은 지터 방어가 아니라 빈도 노브다. 그래서 상세만 가른다(`detailDeadBand` ↔ `DETAIL_DEAD_BAND_M`, 감쇠 하한 5m): 15m(closer 간격 중위 17.5초, 위원장 체감과 충돌) → 10m(11.5초, 2026-08-11 로그 리플레이) → **6m(위원장 실보행 판정 2026-08-12 — 10m 간격도 성기게 느껴져 "6m 간격" 직접 지정)**. 자동차는 주행 속도(5.4km/h 이상)에서 `closerIntervalSeconds` 10초가 병목이라 영향이 없고, 그 아래 정체·신호 대기에서만 도보와 같은 기제로 잦아진다 — 정체 중 진행 신호가 잦은 것은 해롭지 않아 수단을 가르지 않는다. ⚠ 리플레이 수치는 **근사**다(스크립트 docstring의 재현 범위 참조) — 데드밴드 간 비교에는 쓰되 절대 초 수를 계약값으로 승격하지 말 것. ⚠ 감쇠 하한(5m)보다 커야 감쇠가 산다(deadband-drift 테스트가 강제).
- 복귀 시 앵커 재기준화는 `needsRebase`가 **추세 축에 도달하는 첫 fix**에서 소비한다(복귀 fix에 상위 톤이 나면 그 fix는 추세 축에 닿지 못해 기회를 잃는다).
- 축 전환(handoff·모드 전환)은 `rebaseBeaconState`로 **앵커와 `lastSpokenDistance`를 함께** 재설정한다. 앵커만 바꾸면 옛 축 값이 남아 전환 직후 거짓 closer 음성이 나간다.

### 자동차 임박·따라잡기 (`GuideTuning.car`·`carDriver`, 2026-08-23 K2)
spec `2026-08-23-car-guidance-completion-design.md` §3. 임박 임계는 `max(imminentAheadM, v×imminentAheadS)`(walk 20m·0초, car 15m·6초=5+fix 지연 1, 운전자 9초). 속도 표본이 2개 미만이면 `imminentUnknownSpeedM`(car 60) — 바닥만 남기면 터널 복귀 직후 30m 앞 교차로가 침묵한다. 표본 정확도 상한은 프로파일 값(walk 20·car 50). car는 전문 선행을 요구하지 않는다(`imminentNeedsAnnounce: false` — 명령이 자기 완결, 먼저 나가면 전문 래치도 올린다).

`silentCatchUp`(car)은 2026-08-22 실주행의 "터널 뒤 지난 교차로 3개 전문 연속 발화"를 막는 세 가지다: ①점프 fix(`jumped`)는 표본 제외 + 6a 이후 무발화(창이 기어가는 중이라 d가 실위치가 아니다 — 표본에 넣으면 창이 부풀어 재획득이 안 걸린다) ②uncertain 복귀 fix의 공백 >10초는 복귀 대신 재획득 ③유닛 끝이 d 앞이면 전문 없이 래치 3종 전진(`!isOff`), 묶음 안 끝난 스텝은 전문에서 제외. 도보는 전부 종전 동작(실보행 판정이 종전 전제). iOS는 car 재획득 뒤 "지금 구간" 전문을 함께 읽는다(`restateAt`이 현재 유닛을 낭독 완료로 두기 때문).

K2-a(2026-08-31, spec `2026-08-31-car-session-end-design.md`)가 같은 `GuideTuning`에 세션 종료 갈림 셋을 더했다: `entersFinalApproachWithoutGeometry`(car true — 기하 없이 종점 150m에서 최종 접근 진입, 종전엔 간략 인계로 빠져 `carArrivalStep`이 도달 불가) · `presumedArrival`(`PresumedArrivalThresholds`, car 두절 120·무이동 300·캡 150) · `sessionIdleStationaryAxis`(car false — 무이동은 정체와 구분 불가). 계약 전문은 CLAUDE.md §횡단 함정 "잊힌 도보 세션은 국면 무관 안전망이 끝낸다" 항목.

### 정지 판정 (`motionStep`)
도플러 3-state: `stopped`/`moving`/`speedUnknown`. 도플러가 경로·목적지 양쪽에 독립이라 두 모드가 공유할 수 있는 유일한 축이다(직선거리 미분은 "목적지 접근 속도"라 옆으로 지나쳐 걸으면 정지로 보인다).

- 임계 0.4·0.6·2.0초는 **위원장 판정**(비장애 보행 90% 기준)이라 재계산 금지.
- `speedUnknown`에서는 tick을 내지 않는다(속도를 모르는데 정지 톤은 거짓이다).
- ⚠ 웹 `GeolocationCoordinates.speed`는 무효일 때 **`null`**이고 `speedAccuracy`가 없다. `speed < 0` 분기를 그대로 옮기면 `null`이 0이 되어 거짓 정지 tick이 난다.
- ⚠ 기존 `speedGuardActive` 표본 기계는 다른 목적(속도 빠름 오판 가드)이라 건드리지 않는다.

### fix 부재 워치독
웹·iOS 각 8초, 주기 2초. 톤을 fix 처리 경로에만 걸면 권한 철회·서비스 중단에서 판정 자체가 실행되지 않아 **마지막 정상 톤 이후 영구 침묵**이 되고, 백그라운드에서는 톤이 유일한 채널이라 그 침묵이 곧 무고장 판정이 된다. 음성 통지(15초·원인 구분)는 별도 축으로 유지한다 — **톤은 추가 채널이지 대체가 아니다.**

### 오디오 세션 (`guideAudioStep`)
안내 세션 중 카테고리는 `.playback`(정식·실험 모두 — 1.7 도보 졸업으로 구성 게이트 없음). 판정은 Kit 순수 함수가 하고 **`didPromote`일 때만 원복한다** — 세션은 프로세스 전역 자원이고 소비자가 셋(안내 톤·TTS·받아쓰기)이라 무조건 원복하면 다른 소비자를 깬다.

- suppression 해제·인터럽션 종료·route 변경이 **한 재조정 경로**로 모여 "받아쓰기 중 시작한 세션이 영구히 `.ambient`로 남는" 구멍을 닫는다.
- 백그라운드에서는 **톤은 남기고 음성만 막는다**(`scenePhase` 게이트. `.inactive`는 화면을 보고 있는 중이라 허용). ⚠ 예외 하나: **추정 도착 자동 종료의 도착 종은 전경에서만**(`BeaconModel` `if isForeground { playTone(.nearby) }`, 위원장 판정 2026-08-19) — 실시간 신호가 아니라 잠근 채 잊은 기기에서 한참 뒤 울리는 사후 정리라서다. 확정 도착 톤은 백그라운드에서도 울린다. 상태 텍스트는 계속 갱신하고 복귀 발화는 누적이 아니라 현재 상태 하나다.
- `UIBackgroundModes: location`·`audio`는 **두 plist 모두**(`Support/Info.plist`·`Support/Info-Experimental.plist`)에 둔다 — 1.7 도보 졸업 때 승격했다. 실험 전용 키는 `NSBluetoothAlwaysUsageDescription` 하나뿐이다(`check-release-artifact.mjs`가 누출을 막는다).

## 이탈 판정 방위 축 (`course-derivation.ts`·`guide-course-axis.ts` ↔ `CourseDerivation.swift`·`GuideCourseAxis.swift`)

### 이탈 판정은 축이 둘이고 확정은 OR, 복귀는 활성 축 전체 해제다 (CLAUDE.md 이관)

**이탈 판정은 축이 둘이고 확정은 OR, 복귀는 활성 축 전체 해제다**(2026-08-09, 관측 재설계 2026-08-10). 수직거리 축에 **방위 축**(`guide-course-axis.ts` ↔ `GuideCourseAxis.swift`)을 더했다 — 경로가 자기 자신과 가까워지는 기하에서 수직거리가 단조롭지 않아 갈림 뒤 82초를 안 가는 길로 안내한 결함이 원인이다. **방위 관측은 기기 course가 아니라 위치 이력 유도다**(`course-derivation.ts` ↔ `CourseDerivation.swift` — 기기 course는 보행 속도에서 방위를 제공하지 않는다, 실사용 로그 courseAcc 중위 83°). ⚠ **유도기 버퍼·전진 게이트는 그 한 곳뿐이다** — 리듀서나 플랫폼에서 재구현 금지(`guideStep`은 방위 인자를 받지 않고, 그 시그니처가 1선 방어다). ⚠ **사슬 U는 통과권이 아니라 불확실성이다** — 어긋남이 그 구간 안에 들어가면 `unknown`이고, 2-state 다수결로 되돌리면 지속 편향 잡음이 오류를 반복 관측으로 승격시킨다. ⚠ **관측이 없으면 표도 없다**(정지 중 창은 시간으로 낡아 unknown 복귀 — 근거가 사라지면 판정도 사라진다). ⚠ **`unknown`은 해제가 아니다**(근거 없이 복귀를 선언하지 않는다). ⚠ **표결·확정은 최종 접근 진입(spec §6b, 신설 당시 §6a)보다 앞이다** — 뒤로 옮기면 종점 부근에서 단방향 래치가 걸려 확인된 이탈이 영구 소실된다(6b에서 다시 보는 조건은 죽은 코드다, 순서가 곧 불변식). ⚠ **`GuideTuning.courseAxisEnabled`로 walk만 켠다** — 상수를 전부 보행 궤적으로 쟀고 "모퉁이 헛경고를 ±10m 접선 표본이 막는다"는 논거가 차량 속도에서 성립하지 않는다(웹은 유도라 입력 갭이 없고 축이 켜진다 — 단 웹 실보행은 미검증, spec §7 3단계). ⚠ **상수는 전부 잠정값이고 A6은 아직 열려 있다**(`docs/BACKLOG.md`) — 실보행 로그가 정본이다(리플레이 게이트 `course-derivation-replay.test.ts`). ⚠ **이 축은 자기 게이트가 없어 도보 졸업과 함께 정식판으로 나갔다**(1.7, 2026-08-15 — 의도된 결정이다: 축을 끄면 갈림길에서 80초 넘게 안 가는 길을 안내받는 원증상이 남고 그쪽이 헛경고보다 위험하다). 그러므로 **판정이 끝나서 나간 것이 아니라 판정 전에 나갔다** — 상수를 만질 때 "정식판에 있으니 확정된 값"으로 읽지 말 것. 검증 보행은 **실험판에서** 해야 한다(`GuideDiag`가 `#if DEBUG || EXPERIMENTAL`이라 정식판엔 계측 로그가 없다). **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §이탈 판정 방위 축.**


수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을 진행 방위로 잡는다. 두 축은 독립 병렬이고 **확정은 OR, 복귀는 평가 가능한 활성 축 전체 해제**다. 설계 정본은 `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`(재설계 2026-08-10 개정).

### 관측 유도기 (`deriveCourse`)

방위 관측은 기기 `course`가 아니라 **fix 이력의 chord**에서 만든다(재설계 2026-08-10). 기기 course는 GPS 도플러 기반이라 보행 속도에서 방위를 제공하지 않는다(실사용 로그: 도보 281 fix에서 courseAcc 중위 83°, 축 통과 0건). 유도 방위의 조건은 속도가 아니라 누적 변위다.

- **기저선**: chord ≥ 10m·age ≤ 30s인 가장 가까운 과거 fix. 없으면 관측 없음.
- **사슬 자기일관성 U**: `atan((중간 fix들의 chord 수직 편차 최대 + 1.5m) / chord)`, 하한 8°. ⚠ **U가 기기 `courseAccuracy`의 대체물이자 회전 보호다** — 모퉁이에서 사슬이 굽어 U가 커지고 표가 자동으로 `unknown`이 된다. 위치 잡음도 같은 경로로 스스로 `unknown`이 된다.
- **전진 게이트 2m**: 직전 방출 지점에서 2m 이상 전진해야 새 표를 낸다. ⚠ 없으면 정지 중 같은 chord가 반복 관측된다 — "같은 오차의 반복 집계"가 정지 상태에서 재발한다.
- ⚠ **보고 acc 게이트(12m)는 폐기했다.** 실사용 로그에서 보고 acc는 14.2m 동결(249/281 — iOS 필터 캐시)이라 판정 근거로 무의미했고, 유지하면 축이 다시 사실상 꺼진다. 위치 오차는 절대값이 아니라 상관이 문제였다(인접 fix 상대 잡음 중위 0.42m — 변위에서 공통 성분이 소거).
- **유도는 공유 순수 계층 한 곳에서만 한다.** 리듀서 상태(`GuideState.courseDerivation`)가 fix 이력 버퍼를 소유하고 `guideStep`은 방위 인자를 받지 않는다 — 플랫폼이 관측을 만들 수 없는 구조가 1선 방어다(플랫폼별 유도 drift 차단). ⚠ 버퍼·전진 게이트를 리듀서나 플랫폼에서 재구현하지 말 것.
- **버퍼는 경로 교체와 무관하다**(궤적은 경로의 함수가 아니다). `restateAt`(재획득·복귀)이 자동 승계하고, **재조회·brief↔detail 전환은 소비자가 `guideStateAt`/`initialGuideState`의 `courseDerivation` 승계 인자로 잇는다**(웹 `useRouteGuide` 3곳·iOS `BeaconModel` 2곳 — 빠뜨리면 갈림 직후 재조회에서 축이 ~10m 냉시동, 2026-08-10 리뷰 검출). age 30s로 자체 소멸하며, 새 세션(안내 시작)에서만 초기화한다. 창 무효화(§2.8)가 비우는 것은 표결 창이지 버퍼가 아니다.

### 표결 (`courseVote`)

유도 관측이 있을 때만 3-state 표를 만든다. 기준은 **"경로의 어느 부분과도 나란하지 않은가"** — 진행거리 `d`의 앞뒤 10m를 5m 간격으로 훑어 **각도차의 최솟값**을 쓴다.

⚠ **단일 지점 접선과 비교하면 모퉁이에서 헛경고가 쏟아진다.** 사람은 2~3초에 급히 꺾는데 접선은 15m 폭으로 완만하다. 도는 중에도 꺾기 전이나 꺾은 뒤 방향과는 나란하므로, 최솟값을 쓰면 그 구간이 자연히 `match`가 된다.

⚠ **U는 통과권이 아니라 오차범위다.** 각도차 50°에 U 40°면 실제 차이는 10°일 수 있다.

- `best - U > 임계` → `mismatch`
- `best + U < 임계` → `match`
- 그 사이 → `unknown`

임계는 **45°(잠정)**. 종전 60°는 기기 course의 두꺼운 꼬리(p90 51°)에 맞춘 값이었고, 유도 방위(p90 30.8°)에서는 45°가 오표 0.4% 그대로 45° 갈림까지 검출한다. 확정은 검증 보행(§7 3단계).

무효 입력(`[0,360)` 밖·NaN·음수 U·유효 접선 0개)은 전부 `unknown`이고, 어떤 경우에도 `match`로 접지 않는다.

### 창과 판정 (`recordVote` · `courseAxisVerdict`)

시간 창(20초)에 표를 쌓고 분포로 판정한다. 확정 0.7 / 해제 0.3 히스테리시스이고 그 사이는 `unknown`이다.

⚠ **관측이 없으면 표를 내지 않는다(창에 안 쌓임).** 정지·저속·fix 공백은 유도기 한 계층이 흡수하고, 창은 매 fix 시간 기준으로 낡는다 — 정지가 길어지면 표가 말라 verdict가 `unknown`으로 돌아간다(도플러 3-state와 동형: 근거가 사라지면 판정도 사라진다. 움직이지 않는 사람은 잘못된 길을 걷고 있는 것이 아니다).

⚠ **`unknown`은 `on`이 아니다.** 판정 근거가 없는데 정합으로 접으면 실제 방향을 모르는 상태에서 "돌아왔습니다"를 발화한다(3-state 불변식).

⚠ **같은 시각의 중복 fix는 하나로 합친다**(표결 창·유도기 버퍼 양쪽 — 배치 도착 방어).

최소 증거량은 셋이 함께 걸린다: 판정 가능한 표 **개수** 하한(8), 창에서 판정 가능해야 하는 **비율**(0.8), 그 표들이 덮어야 할 **시간 span**(16s). ⚠ 비율 게이트가 없으면 얇은 근거 위에서 확신하고, 개수로만 표현하면 cadence에 묶인다(전용 fixture "성긴 표" 케이스가 개수 하한을 독립적으로 잠근다 — span 게이트에 가려 미검출이던 변이를 2026-08-10 보강). ⚠ 전진 게이트(2m)가 표 밀도를 이동 거리에 묶으므로 **지속 이동 ~1m/s 미만에서는 창이 최소 증거량에 못 미쳐 확정이 성립하지 않는다** — 이는 결함이 아니라 정의역이다(정지 상태의 "갈림"은 물리적으로 이탈이 아니다).

### 리듀서 배선 (`guideStep`)

- **축별 latch** `offRouteAxes: { distance, course }`. 단일 "원인" 문자열로 접지 않는다.
- **이탈 중 표결 기준은 `entryProjection`이 고른 지점**이다. 후보가 모호하면 관측이 있어도 `unknown` 표(복귀 확정 불가), 관측이 없으면 표 없음.
- **국면 전이는 창을 비우고 latch·유도기 버퍼는 보존한다**(`uncertain`·`reacquiring`·`finalApproach`). ⚠ **`offRoute`에서는 창을 비우지 않는다** — 비우면 복귀 판정 표본이 영영 최소치에 못 미친다.
- **`reacquiring` 성공도 같은 복귀 계약을 거친다**(fix 공백 10초 우회 차단).
- **표결·확정은 최종 접근 진입(6b)보다 앞이다.** 뒤로 옮기면 종점 부근에서 확인된 이탈이 영구 소실된다 — 순서가 곧 불변식.
- **`guideStep`은 방위 인자를 받지 않는다**(위 유도기 절). 종전 `INACTIVE_COURSE`·"웹은 데이터 부재로 축이 꺼진다" 계약은 재설계로 소멸 — **웹에서도 축이 켜진다**(유도는 lat/lng/t만 필요). ⚠ 단 웹 활성은 코드 대칭이지 품질 검증이 아니다(§3.0은 iOS 로그) — 웹 실보행 검증은 spec §7 3단계 관측 항목.

### 검증

- **실사용 로그 리플레이 게이트**: `src/lib/__tests__/course-derivation-replay.test.ts` — 도보 281 fix를 유도기에 재생해 §3.0 수치(가용률·오표·U 분포·합성 이탈 확정 시각)를 회귀 기준으로 잠근다. 로그 원본 `docs/superpowers/specs/logs/guide-diag-2026-08-09.log.gz`(읽기 전용).
- 산술 동조: 공유 fixture `course-axis-scenarios.json`의 `derivation`·`votes`·`verdicts`·`reducer` 4층(웹 ↔ Kit).

### 범위와 잠정성

⚠ **보행 전용이다.** `GuideTuning.courseAxisEnabled`가 walk에서만 켜져 있고 게이트는 `guideStep` 진입점 한 곳뿐이다. 차량 속도에서는 ±10m 표본 대역을 1.3초에 통과해 헛경고 논거가 성립하지 않고, 차량 헛경고율은 측정된 적이 없다.

⚠ **상수는 전부 잠정값이다.** 확정은 검증 보행(spec §7 3단계 — 탐색 로그와 분리된 새 보행)이 하고, A6은 그 판정이 날 때까지 열려 있다. ⚠ **이 축은 자기 게이트가 없어 도보 졸업과 함께 정식판으로 나갔다**(1.7, 2026-08-15). 얹혀 있던 `AppConfig.realtimeGuidanceEnabled`는 그때 삭제됐다. 출하는 의도된 결정이었으나(축을 끄면 갈림길 원증상이 남고 그쪽이 헛경고보다 위험하다) **판정이 끝나서 나간 것이 아니다** — 상수를 "정식판에 있으니 확정된 값"으로 읽지 말 것. 검증 보행은 **실험판에서** 해야 한다(`GuideDiag`가 `#if DEBUG || EXPERIMENTAL`이라 정식판엔 계측 로그가 없다).

⚠ **진짜 평행 도로는 이 축으로도 못 잡는다.** 30m 안에서 실제로 나란한 두 도로는 방위도 같아 수학적으로 구분 불가다. 유도 방위로 바뀌어도 같다.


---

## 횡단 함정 상세

`CLAUDE.md`가 요지만 남기고 여기로 옮긴 상세 계약이다(2026-09-02 문서 축소). 각 절 제목은 `CLAUDE.md`의 해당 항목 제목과 같다.

### 좌표 쿼리 파라미터는 `src/lib/coord-param.ts`를 쓴다

**좌표 쿼리 파라미터는 `src/lib/coord-param.ts`를 쓴다**(`latParam`/`lngParam`, 범위가 다르면 `coordParam(min,max,label)`, 2026-08-01 백포트): `searchParams.get("lat") ?? ""`를 `z.coerce.number()`에 직접 태우면 `Number("")===0`이라 **파라미터 누락이 (0,0)이 되고 그 좌표는 한국 밖이라 400이어야 할 요청이 `200 {"outOfCoverage":true}`로 위장**한다. 200에 그럴듯한 안내 문장이라 CLI 소비자는 자기가 해외에 있다고 읽는다. 커버리지 판정이 폴리곤인 라우트(`walk/nearby`)에선 같은 함정이 `unsupported: outsideKorea` **200으로 위장**하고, 커버리지 마커가 없는 좌표 라우트에선 **널 아일랜드 실조회**가 된다. 좌표가 선택인 라우트는 `latParam().optional().catch(undefined)`(400이 아니라 "좌표 없음"이 정답). 가드는 `src/app/api/__tests__/coord-param-usage.test.ts`. ⚠ **클라이언트에도 같은 함정이 따로 있다**: CLI `resolve-location.ts`가 `Number("")`를 유한값으로 통과시키면 (0,0)이 서버엔 정상 좌표로 도착해 서버 가드로 못 막는다.

### 서비스 커버리지 마커(2026-07-29 심사 반려 대응)

**서비스 커버리지 마커(2026-07-29 심사 반려 대응)**: 좌표 의존 라우트는 zod 전지구 범위 검증 후 `isInKorea`(`src/lib/coverage.ts` 정본, iOS Kit `Coverage.swift` 미러) 판정. ⚠ **판정은 국경 폴리곤이고 그 안의 프리필터 사각형은 링에서 유도한다**(2026-08-23 E19): 사각형만으로는 후쿠오카·기타큐슈·대마도·시모노세키가 "한국 안"으로 통과하고 개성·해주는 파주와 위경도가 겹쳐 어떤 사각형 뺄셈으로도 갈리지 않는다. 링(`src/lib/data/korea-boundary.json`, OSM `admin_level=2` 영해 경계 2,580점)은 **한 벌**이고 Kit 리소스는 바이트 동일 사본이다(`korea-boundary-drift.test.ts`가 강제, 판정 표는 공유 fixture `korea-boundary-cases.json` 한 벌을 웹·Kit·빌드 스크립트가 함께 읽는다). ⚠ **클라이언트도 같은 술어를 쓴다**(번들 gzip +15KB 수용) — 느슨한 클라 전용 술어를 남기면 서버 왕복이 없는 소비자(`deeplink.ts`)에서 그것이 최종 판정이 된다. ⚠ **프리필터 사각형은 상수가 아니라 링에서 유도한다** — 상수 `KOREA_COVERAGE_BBOX`(≤132.0)는 독도 영해 링(132.12)을 다 감싸지 못해 폴리곤 안인 좌표를 잘라냈다(리뷰 검출). 유도하면 상위집합 전제가 구조적으로 참이다. ⚠ 사각형에 없던 새 실패 방향(국내인데 폴리곤 밖 = 거짓 "제공 지역 밖")은 **seed 노드 79,575점 전수를 `isInKorea`로 재판정**하는 계약 테스트가 덮는다 — 이 단언이 잡는 것은 링 **데이터 열화**이지 알고리즘 결함이 아니다(빌드 스크립트 `insideRings`는 같은 코드의 사본이라 공유 결함은 못 잡는다). 링 하나가 통째로 사라지는 축은 반대로 golden이 잡는다. ⚠ 이 술어의 뜻은 **"한국 안인가"**이지 upstream이 답하는 범위가 아니다 — 그 축은 아래 `unavailableHere`와 0건이 따로 든다. 한국 밖이면 **키 게이트보다 앞서** 200 `{"outOfCoverage":true}` 반환(오류 아님 — 3-state에 더한 4번째 정직 상태, upstream 미호출로 쿼터 보호). 신규 좌표 라우트는 파싱→마커→키 게이트→upstream 순서를 따르고, 소비자는 기존 감지 계층 재사용: 웹 `isOutOfCoverageBody`+선분기, iOS `APIError.outOfCoverage`+선분기, CLI/MCP `isOutOfCoverage`, 채팅 `coverageGate`(**앵커 좌표 기준** — 장소 앵커가 한국이면 해외 사용자도 정상, 길찾기만 userLocation). 안내 문구는 "위치 기반 기능만 제한" 톤(`common.outOfCoverage`·`ios.common.outOfCoverage`), 이름 기반 기능(검색·역 정보·목적지 길찾기·장소 앵커 채팅)은 전 세계 유효.

### 국내 지역별 미제공은 커버리지와 다른 층이다

**국내 지역별 미제공은 커버리지와 다른 층이다**(2026-08-02): 한국 **안**이지만 그 도메인 데이터가 그 지역에 없으면 200 `{"unavailableHere":"seoulOnly"}`(마커 자리·순서는 위와 동일, upstream 미호출). 소비자: 웹 `unavailableHereReason`→`useNearbyFetch`의 `unavailableHere` 상태→`tCommon("unavailableHere")`, iOS `APIError.unavailableHere`→`NearbyLoadPhase.unavailableHere`, CLI/MCP `unavailableHereReason`, 채팅 `SEOUL_ONLY`. **판정선은 임의로 고르지 말고 그 도메인의 조회 반경을 그대로 쓴다** — `metersOutsideSeoul`(coverage.ts)에 따릉이는 1km(`MAX_DISTANCE_METERS`), 문화행사는 3km(`RADIUS_METERS`)를 넘긴다. 반경 밖엔 대상이 존재할 수 없으므로 판정이 정의상 틀리지 않고, 상수를 복제하지 않아 drift도 없다. ⚠ **행정경계로 자르지 말 것**: 반경이 서울 경계를 넘어 하남 미사·과천에서 실제로 서울 행사가 잡힌다(실측 각 1건). ⚠ **연속량인 도메인에 이 판정을 쓰지 말 것**: 최근접 지하철역 거리는 전국에 간격 없이 분포해(울산 3.5·세종 10.0·창원 17.3·원주 26.6km, 6~26km에 국토 격자 15.7%) 어떤 임계값도 자의적이다 — 지하철은 판정 대신 0건일 때 **최근접 역을 그대로 실어**(`nearest`) 거리로 사용자가 판단하게 한다(1.5km면 걸어가고 90km면 도시철도가 없는 지역이다).

### 역 seed는 타 역 좌표 혼입을 의심한다

**역 seed는 타 역 좌표 혼입을 의심한다**(실사고 2건): 표준데이터 XLSX가 ①경의중앙선 양원역(서울 중랑구) 레코드에 **동명이역인 영동선 양원역(경북 봉화)의 좌표**(198km 밖, 2026-08-02), ②4호선 이촌역 레코드에 **한 정거장 옆 신용산역의 좌표**(907m 밖, 2026-08-10 — 신용산역 앞에서 실거리 1km의 이촌역이 8m 최근접 1순위로 잡힌 CLI 실사용 리포트)를 담고 있었다. 두 건 모두 주소 컬럼은 올바른데 좌표만 다른 역 것이라, 증상이 "그 역이 안 나온다"·"엉뚱한 역이 가깝다고 나온다"뿐이라 최근접 노출 전까지 드러나지 않는다. `scripts/build-subway-stations.py`가 `COORD_FIXES`로 보정하고 가드 2축이 새 혼입에 **빌드를 중단**한다: **노선 내 연속성**(같은 노선 최근접 역까지 30km 초과 — 원거리 혼입용. 주소 컬럼 판정은 형식 차이로 커버리지가 뚫려 기각: 대구 94역은 시도 접두가 없어 매칭 0%, 경기 268건은 광역시가 아니라 대상 밖) + **환승 쌍 거리**(동명이고 한쪽 이상 환승인 레코드 쌍이 600m~30km — 인접역 혼입은 잘못된 좌표조차 같은 노선 위라 연속성 축이 정의상 못 잡는 사각. "両환승"이 아닌 이유는 원본 플래그가 비대칭인 실환승 쌍 17건. 정당 환승 복합 최대 435m, 両비환승 동명 신촌 701m·타 도시 동명 교대 315km는 대상 밖). 임계값 근거는 전 seed 실측+변이 주입(両축 오탐 0), 주소 형식과 무관하게 1,098건 전부 검사.

### data.go.kr envelope는 공용 파서를 쓴다

**data.go.kr envelope는 공용 파서를 쓴다**(`src/lib/providers/datagokr-envelope.ts`, 2026-08-01 공용화): `readItems`·`readResultCode`·`readResultMsg`·`readTotalCount`+`fetchDataGoKrJson`. **자체 추출 함수 신설 금지** — 종전 9벌이 같은 모양을 다르게 읽어 원시값 `item`을 감싼 유령 항목(전 필드 `undefined` = SR에 "이름 없는 항목")과 `items` 직접 배열의 조용한 전멸을 만들었다. 경계는 **모양은 공용, 정책은 provider**: 허용 resultCode(`"00"`/`"0"`/`"0000"`/`"03"`)·throw vs null·totalCount 가드는 서비스 계약이라 각 provider에 남기고 공용 fetch는 resultCode를 보지 않는다(합치면 `okCodes` 분기 주머니가 된다). `fetchDataGoKrJson`은 `res.json()`을 쓰지 않는 이유가 있다 — 키 만료·미신청이면 `_type=json`이어도 **HTTP 200 + XML 본문**이 와서 `Unexpected token '<'`라는 원인 없는 SyntaxError가 된다(`OpenAPI_ServiceResponse` 게이트웨이 에러도 함께 감지). ⚠ **`items.item` 단건 모양은 기관코드마다 다르다**(실측 2026-08-01 `numOfRows=1`): B551011(TourAPI)·B551457(코레일)은 1건에도 **배열 유지**, B552657(NMC 응급의료)·1613000(TAGO)은 **단일 객체**. 새 API는 호출해 봐야 알고, 틀리면 런타임 TypeError나 조용한 누락이라 두 모양을 다 받는 공용 파서가 그 질문 자체를 없앤다. ⚠ **JSON 파라미터 이름도 기관마다 다르다**: 빠른하차(B553766)는 `_type=json`을 **무시하고 XML을 준다** — `dataType=json`이어야 한다(`type`·`resultType`도 XML). 이때 `resultCode 00`에 실데이터가 실려 오므로 키 문제로 오진하기 쉽다. 새 기관코드는 첫 호출에서 파라미터 이름부터 확인할 것(실측 2026-08-08). ⚠ **`apis.data.go.kr`은 반드시 https로 부른다**: 평문 http는 **TCP 연결까지 되고 응답이 오지 않는다**(read ETIMEDOUT, 같은 요청이 https로는 0.07초). 프로덕션 대중교통 길찾기가 71초 걸려 앱 타임아웃으로 실패한 실사고가 있었고(2026-08-04), 원인은 한 provider만 https로 고치고 같은 호스트를 쓰는 셋을 빠뜨린 것이었다. hang이라 `revalidate` 캐시가 영영 안 채워져 두 번째 호출도 71초로 일관된다는 점이 진단 단서였다. 가드는 `datagokr-https-usage.test.ts`. ⚠ TOPIS(`ws.bus.go.kr`)는 http에서 정상이고 https 지원 근거가 없어 건드리지 않는다.

### 서울 열린데이터(`openapi.seoul.go.kr`) 본문은 `readSeoulOpenJson`으로 읽는다

**서울 열린데이터(`openapi.seoul.go.kr`) 본문은 `readSeoulOpenJson`으로 읽는다**(`src/lib/providers/seoul-open-json.ts`, 2026-08-01 공용화. 소비자 4종: 따릉이·문화행사·혼잡도·엘리베이터): 인증키가 무효하면 `/json/` 경로여도 **HTTP 200 + XML 본문**이 와서 `res.json()`이 `Unexpected token '<'`로 죽는다. 키를 넷이 공유하므로 **키가 죽으면 동시에 같은 방식으로 오진**되고, 원인이 키라는 사실이 SyntaxError에 가려진다(`fetchDataGoKrJson` 동형 함정). 경계는 datagokr과 같다: **모양은 공용, 봉투 정책(정상 코드 판정)은 provider**. 가드는 `src/lib/providers/__tests__/seoul-open-json-usage.test.ts`. ⚠ 실시간 지하철은 `swopenapi.seoul.go.kr`로 **호스트도 키도 다르므로 이 계약 밖**이다.

### 경유지(`via`)는 응답 `waypoint{stepIndex,coord}` 하나로만 드러나고 스텝 문장은 불변이다

**경유지(`via`)는 응답 `waypoint{stepIndex,coord}` 하나로만 드러나고 스텝 문장은 불변이다**(2026-08-22 N4, spec `2026-08-22-waypoint-server-web-cli-design.md`): provider 4종이 경유지 표지(카카오 도보 `legs` 2개·Tmap `PP1`/`B1` Point·카카오 내비 `type 1000` guide)를 찾아 투영하고 **못 찾으면 throw**한다 — 카카오 도보는 파라미터 이름이 틀려도 200 정상 응답이 와서(`waypoints`·`passlist` 전부 무시) "경유 안 한 경로"가 "경유한 경로"로 낭독될 수 있고, URL 문자열 단언(`route-waypoint.test.ts`)이 그 이름의 유일한 가드다. `stepIndex`는 **산문 소비자용 스텝 0 삽입(`withStepFree`)이 있으면 +1 보정**되고 기하 응답엔 보정이 없다. 대중교통은 ODsay에 경유지가 없어 `{result:null, unsupported:"waypoint"}`(null만 주면 "경로 없음"으로 낭독돼 거짓). 구획 문장("경유지 C 도착")은 서버가 만들지 않는다 — 서버는 라벨을 모르고, 웹 `StepList`(ol 둘 + 평문 한 줄, `start`로 번호 연속)·CLI `경유지 도착` 줄·iOS 통지가 `stepIndex` 자리에 그린다. ⚠ 웹 실시간 안내(`useRouteGuide`)는 경유지를 모르므로 경유지 조회에선 안내 시작 버튼 2종(도보·자동차)을 내지 않는다. **iOS 실시간 안내의 경유지는 세 층이 갈린다**(2026-08-22 N4-iOS, spec `2026-08-22-waypoint-ios-design.md`): ①**요청** — `RouteService.walk/walkAlternatives/car`의 `via`와 `BeaconModel.StartRequest.waypoint`는 **기본값 없는 필수 인자**다. 경유지가 있는 세션의 fetch(시작·재조회·제안·프리뷰·ETA) 중 하나라도 `via`를 빠뜨리면 "경유 안 한 경로"가 "경유한 경로"로 낭독되는데, 그 누락은 서버 throw가 아니라 *인자 생략*으로 일어나고 기본값이 있으면 조용히 컴파일된다. `fetchDetailData`는 경유지를 **인자로** 받고 커밋 가드가 스냅샷 일치를 본다(가변 `self.waypoint`를 읽지 않는다). ②**판정** — Kit `RouteGuide`의 `waypointReached`는 감지(W1, `!isOff && !jumped`)와 발화를 분리한다: 같은 fix의 임박 큐가 이기고 도착은 `waypointPending`으로 남아 다음 fix에서 새 임박보다 **먼저** 나간다(W2), 6b 최종 접근은 **미도착 경유지가 있으면 진입하지 않는다**(진입선 안 경유지는 6b가 먼저 래치돼 도착이 영구 소실된다). 두 래치는 `restateAt`이 승계한다. 웹 `route-guide.ts` 미러·공유 fixture 4건. ③**상태** — 도착하면 `waypoint = nil`(이후 fetch는 출발→도착), 제안·프리뷰·왕복 중 재조회 폐기, `lastStartRequest`에서도 지운다(재시작이 지난 경유지를 되살리지 않게). 조망 행의 라벨은 경로에 결박된 `routeWaypointLabel`이 따로 든다. ⚠ **간략 폴백은 경유지를 조용히 버리지 않는다** — 기하 없는 직선 안내는 경유지를 모르므로 소거 + `ios.guide.waypointDropped` `.high` 통지. 폼의 `via`는 세션 상태가 아니라 사용자 질의라 도착으로 지우지 않는다.

### 거리 표기는 `formatDistance`만 지난다

**거리 표기는 `formatDistance`만 지난다**(웹 `src/lib/format.ts` ↔ Kit `Format.swift` ↔ CLI `formatters.ts` `dist()` 3벌 미러): 1,000m 미만은 `"{m}m"`, 이상은 **소수 km 원값**(`"1.1km"`·`"6.285km"`, 후행 0 없이. 위원장 실사용 판정 2026-08-02로 종전 `"1km 200m"` 나눠쓰기를 대체. ⚠ Swift `String(Double)`은 정수에 `"1.0"`을 남기므로 1,000 배수는 정수 분기). **낭독 정정은 m만**: VO가 소수 포함 km는 정확히 kilometers로 발화하지만 숫자+`m`은 minutes로 오독한다(실기기 확정). iOS 낭독 채널(`distanceText`·통지)은 Kit `spokenDistanceUnits`로 m만 로케일 단어로 풀고(`(\d)m(?![A-Za-z])`, `\b`는 한글 직결에서 불성립), 시각 표기는 불변. ⚠ **어디서도 소수 km를 직접 조립하지 말 것**: 가드가 없던 동안 지역 사본 4곳이 갈렸고 그중 CLI·iOS 도보 요약은 1km 미만 분기를 건너뛰어 **850m를 "0.8km"로** 냈다(표기 불일치보다 나쁜 실제 결함). 3벌 동조와 사본 금지는 `src/lib/__tests__/format-drift.test.ts`(웹↔Swift 표 대조 + 전 소스 스캔)와 `packages/cli/src/__tests__/format-drift.test.ts`(웹↔CLI 실행 대조)가 강제한다. i18n 문구는 단위 없이 `{distance}` 하나만 받는다(로케일별 공백 관례 불필요). **예외는 오차 반경**(비콘 `nearby`의 `±{meters}m`)이다. 거리가 아닌 축이라 태우지 않는다.

### 역명 매칭은 확장 정규화가 정본

**역명 매칭은 확장 정규화가 정본**(`station-match.ts`, 2026-07-22): 카카오 역 place_name은 "강동역 5호선" 형태라 괄호 부가명·후행 노선 토큰(`…선`/`…철도`/`GTX-…`)을 벗겨야 seed·wksn·korail·arrival과 매칭된다(미적용 시 역 섹션 전체 死 — 실측 회귀). 노선 토큰은 버리지 않고 `parseStationQuery`의 `lineHint`로 보존(동명이역 양평 5호선 vs 경의중앙선 분리, 숫자 코어는 완전 일치만). 신규 역 데이터 소스는 `normalizeStationName`+`lineHintMatches`를 재사용하고 자체 정규화 금지.

### 음성 전사를 검색어로 쓰기 전 `normalizeVoiceQuery` 필수

**음성 전사를 검색어로 쓰기 전 `normalizeVoiceQuery` 필수**(웹 `src/lib/format.ts` ↔ Kit `VoiceQuery.swift` 미러, 2026-07-26): STT가 붙이는 후행 마침표에 juso가 **0건으로 전멸**한다(마지막 토큰을 건물번호로 파싱하기 때문. 실측 "강동구 성내로 12" 15건 → "…12." 0건, 주소는 대부분 숫자로 끝나 주소 검색만 유독 죽는다). 카카오도 4,663→19건 열화. **엔진에서 끄는 길은 막혀 있다**: iOS 온디바이스 `SpeechTranscriber`엔 문장부호 옵션이 없고(`TranscriptionOption`은 `etiquetteReplacements` 하나뿐), Deepgram `punctuate=false`는 같은 STT 라우트를 쓰는 채팅 입력까지 망친다. **신규 음성 검색 소비 지점은 반드시 이 함수를 태운다**(통지 문자열도 정규화본으로. 들은 것과 검색된 것이 어긋나면 SR 사용자는 원인을 알 수 없다). 채팅 소비 지점은 미적용(문장부호가 정보). ⚠ 정규화는 **부호만 남은 전사를 구제하지 못한다** — 다 지우면 빈 문자열이라 "정규화는 파괴가 아니다" 규칙이 원문을 되돌린다(무발화 릴리스 전사 "." 실측 2026-08-01, 그대로 두면 채팅은 "."을 전송하고 검색은 "."으로 조회). *검색어를 다듬는* 정규화와 *소비할지 가르는* 판정은 다른 계층이라 후자는 `hasSpeechContent`(Kit, 글자·숫자 유무)가 맡고 **iOS는 `SpeechService.stop()` 한 곳에서 태워 nil로 돌린다** — 소비 지점 4곳(검색·길찾기·채팅 전송·잠금)에 가드 분산 금지. 내용 없는 전사는 빈 전사와 같은 침묵 경로(새 통지 없음).

### "내 주변" 거리순 정렬은 코드 책임

**"내 주변" 거리순 정렬은 코드 책임**(Haversine). 좌표 필터 없는 목록 API(따릉이·소아진료)는 전체 받아 서버 정렬→cap. ⚠ `totalCount`/`list_total_count`는 "그 페이지 row 수"일 수 있어 **신뢰 금지** — 종료조건은 받은 row 수. ⚠ **검색 탭은 거리순이 아니다**: 카카오 키워드는 `x`/`y`만 붙이고 `sort`·radius 미지정 — 정확도순에 근접이 블렌딩된다(실호출 확정 2026-07-20: 맥도날드=근처 지점 상위, 경복궁=15km 밖 본체·부속 최상단). 거리 **표기**는 `searchPlaces` 진입점의 `annotateDistances`(정렬 없는 주석)가 일원 담당 — 클라·provider 재정렬 금지(정확도 축 파괴, 랜드마크 매몰 회귀).

### 실시간 안내의 표시는 조인과 타입 수준에서 갈려 있다

**실시간 안내의 표시는 조인과 타입 수준에서 갈려 있다**(E27 잔여 ①, 2026-09-01, spec `2026-09-01-transit-guide-en-gate-design.md`): 안내가 쓰는 이름(노선·승차역·하차역·경유역·종착역·현재역)은 **조회 쿼리이자 표시 라벨**이라 영문으로 바꾸면 오류가 아니라 "실시간 정보가 영영 안 뜬다"(매핑표 미스)나 "현재역 표식이 영영 안 붙는다"(정규화 불일치)가 된다. 그래서 조인 필드는 en 세션에서도 한국어로 동결하고, 문장을 만드는 계층은 **조인 필드가 타입에 없는** 좁은 투영(`transit-display.ts` `TransitDisplayLeg`·`TransitDisplayItem` ↔ Kit `TransitDisplayProjection.swift`)만 받는다 — 소스 가드(`transit-display-guard.test.ts`, "조인 값이 문구 조회 호출과 같은 줄에 있는가")는 2선이고 그 타입이 1선이다. 문장 판정(키·인자 순서·줄 언어)은 공유 descriptor `transit-guide-text.ts` ↔ Kit `TransitGuideText.swift`(공유 fixture)가 하고 플랫폼은 조회만 한다 — 웹은 어댑터 표 `TRANSIT_TEXT_ARG_NAMES`(ko 문장 플레이스홀더 **순서**가 정본, iOS 인덱스 계약), iOS는 앱 리터럴 switch `TransitGuideTextRenderer`(동적 키는 xcstrings 키 린터가 못 센다. 앱 타깃에 테스트 레인이 없어 판정을 Kit에 둔 것이 이 배치의 요지이고, switch 망라성은 웹 가드가 `transitTextKeys`와 대조한다). ⚠ **이벤트가 ko와 en을 함께 나른다** — 소비자는 이벤트만 보고 문장을 만들고 폴 항목을 붙들지 않으므로, ko만 실으면 소비자가 "마지막 항목"을 기억해 짝지어야 하고 그 짝은 늦은 폴·국면 전이에서 조용히 어긋난다. ⚠ **`boardOverride`는 이름이 아니라 `viaStops` 인덱스다** — 이름으로 들면 정규화 후 동명 역이 둘일 때 첫 일치를 골라 다른 역의 영문명이 오류 없이 표시된다. ⚠ **`""`는 `TrackItem.message` 한 자리에서만 유효한 영문 조각이다**(TAGO는 ko에도 완성 문장이 없다) — 이름·방향·종착역의 `""`는 정보 소실이라 서버가 부재로 정규화하고, 안 하면 줄 원자성 판정이 "완비"로 읽어 `Boarded . Get off at .`가 된다. ⚠ **정규화는 두 방향이다** — 뒤집으면 **ko가 빈 조각은 언어 축이 아니다**(`transit-display.ts` `label()`): ko에도 없는 것을 "영문 결측"으로 세면 나머지가 전부 영문이어도 줄 전체가 한국어로 되돌아간다. 서울버스 `direction`이 구조적으로 `""`라 이 방향이 빠지면 서버가 만든 `In 6 min 47 sec`가 대기 목록에서 통째로 버려진다(2026-09-01 프로덕션 도달 BLOCKER, 리뷰어 2인 독립 검출). ⚠ **한국어 폴백 줄에는 `lang="ko"`를 준다**(웹 live region 포함) — 영어 틀에 한국어 이름이 섞인 줄이지만, 대안인 "영어 엔진이 한글을 만남"은 **그 이름이 통째로 침묵**하는 결과라 더 나쁘다. 잃으면 안 되는 것은 억양이 아니라 이름 그 자체다. iOS는 줄 단위 태깅 수단이 아직 없어 이것이 수용 위험이고 판정은 `docs/BACKLOG.md` §2 E28-①. ⚠ **게이트는 개수가 아니라 조건으로 검사한다** — 자리 수만 세면 같은 자리에 로케일 조건이 되돌아와도 통과한다. 계단 회피·자동차·도보 게이트가 **여전히 있다**는 반대 방향 단언이 "같이 지워지지 않았음"을 증명한다.

### 대중교통·역 정보의 영문은 `lang=en` 응답의 additive `*En`이고 한국어 필드는 어느 응답에서도 그대로다

**대중교통·역 정보의 영문은 `lang=en` 응답의 additive `*En`이고 한국어 필드는 어느 응답에서도 그대로다**(E27, 2026-08-31, spec `2026-08-31-transit-english-design.md`): `/api/route/transit`·`/api/station/{subway-arrival,subway-arrival/nearby,meta,timetable}`의 `lang`(`src/lib/lang-param.ts` `langParam()` — 누락=ko, 미지 값 400. 자체 `z.enum(...).catch("ko")` 금지: 미지 값이 조용히 ko로 떨어지면 en 소비자가 한국어를 받고도 모른다. ⚠ 이 계약이 걸린 라우트 목록의 정본은 `grep -rl langParam src/app/api`이고 여기 적은 다섯은 E27이 연 자리다 — `/api/transit/track`(E27 잔여 ①)·`/api/geocode/reverse`(A26 계열)·`/api/station/metro-facilities`(E27 잔여 ⓐ, 2026-09-02)가 뒤에 붙었다)이 en이면 ODsay `lang=1`·노선명 표(`src/lib/subway-line-names.ts`)·정류소명 정규화(`transit-name-en.ts`)·도착 영어 문장(`subway-arrival-en.ts`)을 서버가 만들어 `lineNameEn`·`fromNameEn`·`linesEn`·`messageEn`… 에 싣는다. ⚠ **`lineName`·`fromName`·`toName`·`stops[].name`은 en 응답에서도 한국어다** — 운행시간·빠른하차·실시간 추적·역명 매칭·TAGO `routeNo`의 조인 키라, 영문을 여기 넣는 순간 조인이 조용히 죽는다(ODsay 영문은 급행 표지도 잃는다: `수도권 9호선(급행)` → `Line 9`). `lang=1` 응답에 `*Kor`가 하나라도 빠지면 provider가 그 응답을 버리고 ko로 재조회한다(`assertKorComplete`, fail-closed) — 영문이 한국어 자리에 들어가는 경로는 없다. ⚠ **표 미지 노선·행렬 밖 도착 문장·seed 미매칭 역명은 전부 필드 부재**(음차·provider 영문 폴백 금지, 거짓 문장보다 부재) — 소비자는 한국어 원문으로 떨어진다. ⚠ **한 줄 안에서 언어를 섞지 않는다**: 줄을 만드는 자리는 웹 `pickLine`(`place-lines/pick-line.ts`) ↔ Kit `TransitDisplay.pickLine`만 지난다(영문 조각이 결측(`undefined`/`null`)이면 줄 전체 한국어 + `lang="ko"` — `""`는 ko에도 그 조각이 없다는 자리 표시라 영어 줄이 성립한다, 부재를 `""`로 채우면 결측이 자리 표시로 위장한다, 비-en 로케일의 순수 영어 줄은 `lang="en"`, UI 템플릿이 섞인 줄은 무태그). 역명 병기 `Gangnam (강남)`은 E28 `bilingualName`이 정본(괄호 한글은 시각 전용 — `aria-hidden`·iOS `accessibilityLabel` 영문만, SR 안전망으로 계산하지 않는다). Kit `RouteService.transit`·`StationService.*`·`NearbyService.subwayArrivals`의 `lang`은 **기본값 없는 필수 인자**(walk 규율). 노선명 표에 노선을 더하면 `subway-line-names-drift.test.ts`가 생산자 5축(seed·실시간 subwayId·ODsay 매핑표·관측 `nameKor`·TAGO `routeName`)을 전수 재판정한다.

### 서버가 합성하는 한국어 문장은 구조화 원재료를 함께 싣고, 클라이언트가 자기 언어로 조립한다

**서버가 합성하는 한국어 문장은 구조화 원재료를 함께 싣고, 클라이언트가 자기 언어로 조립한다**(A26, 2026-08-31): 문자열 필드(`name`·`detail`·`lineName`·`label`)는 CLI/MCP 계약이라 불변이고, 그 옆에 additive 필드(`SeoulMetroFacility.parts`·`TimetableLine.lineCore`·무장애 `key`·자동차 `guidanceLang`)를 둔다. 웹 `place-lines/*` ↔ iOS `StationSections`·`BarrierFreeInfoSection`이 그 조립을 미러하고, 부재(구버전 응답)는 문자열 그대로다. ⚠ **판정을 문장 부분 문자열에 걸지 말 것** — 표시 계층의 횡단 유닛이 ko 문장 "건너"로 판정돼 en 도보 안내에서 횡단 유닛이 한 번도 서지 않았다(지금은 서버 `WalkRouteStep.crossing` 플래그, 웹 `isCrossingStep` ↔ Kit 미러, 공유 fixture가 ko 카카오 기본 경로 불변을 잠근다 — ko+Tmap 폴백은 종전 "건너" 부재로 횡단 유닛이 없던 것이 이제 선다, 의도된 수정). 자동차 `/api/route/car`의 en→ko 폴백 사유는 셋(NCP 키 부재·경유지·**기하 요청**)이고 전부 `guidanceLang: "ko"`다 — 기하 요청을 NCP로 보내면 응답에 `provider`·기하가 없어 실시간 안내가 조용히 간략 강등된다. 클라이언트가 서버 한국어 `error`를 낭독하는 자리도 같은 계열이다 — status·`code`로 자기 언어 문장을 고른다(`useVoiceRecorder`·`CarRouteBriefing` 선례). en 페이지의 한국어 데이터 블록엔 `hasHangul` 판정으로 `lang="ko"`를 달되 **이미 별도 블록·줄인 곳만**(산문 템플릿 안 삽입은 분절 없이 못 다니 건너뛴다 — E28이 같은 날 로마자 병기로 대부분 해소했고 잔여는 E27 몫, `docs/BACKLOG.md` A26). ⚠ **노선 이름만은 이 조립 규칙의 예외다 — 표(`subwayLineNameEn`)가 정본이고 `subway.lineNumber`는 표 미스 폴백 전용이다**(2026-09-01): 로케일별 접미를 직접 붙이면 같은 화면의 역 메타 줄(`linesEn`, 표)과 갈려 es에서 한 노선이 "Línea 5"와 "Line 5" 두 이름으로 읽힌다. 비-ko는 전부 영문 데이터를 공유하므로 접미 로컬라이즈에 남는 자리가 없다. iOS `StationSections.facilityName`은 서버 additive `parts.lineEn`(`/api/station/metro-facilities?lang=en`, 2026-09-02)을 우선하고 표 미스·ko만 `subway.lineNumber` 조립이다 — Kit에 표를 이식하지 말 것(표는 서버 한 벌).

### 영문 원천 없는 이름의 병기는 서버 로마자 + 클라이언트 `bilingualName`이고, 괄호는 접근성 객체의 마지막 노드다

**영문 원천 없는 이름의 병기는 서버 로마자 + 클라이언트 `bilingualName`이고, 괄호는 접근성 객체의 마지막 노드다**(E28, 2026-08-31, spec `2026-08-31-place-name-bilingual-design.md`): 로마자는 `src/lib/romanize.ts` **한 곳**(국어원 표기법·음운 변화, 형태소 경계 의존 변화는 의도적으로 미적용 — `@romanize/korean`은 94어 표 30어 오답으로 기각)이 `nameRoman`류를 additive로 싣고(`romanNameOf` — 한글 있는 이름만, NFC), 웹 `src/lib/bilingual-name.ts` ↔ Kit `BilingualName.swift`(공유 fixture)가 비-ko에서 en 원천 → 로마자 → 한글 순으로 `{primary, secondary}`를 가른다. **한글이 섞인 후보는 후보가 아니다**(접근 가능한 이름에 한글이 새는 유일한 경로). ⚠ **웹은 괄호 span(`<KoTail>`, `aria-hidden`+`lang="ko"`)을 줄 가운데 두지 말 것** — Chrome AX 실측(2026-08-31)에서 가운데 hidden span은 앞뒤 텍스트 노드를 StaticText 둘로 가른다. 이름 단독 요소는 이름 뒤, `joinText` 합성 줄은 **줄 끝**, `<button>` 안만 이름 뒤 허용(이름 계산). 줄의 `lang`은 접근 텍스트 기준(`langFor`). iOS는 단일 `Text`가 한 객체라 `Roman (한글)` 그대로 + `.accessibilityLabel(primary)`(`bilingualLine`), 내비 타이틀만 로마자 단독 + 보조 한글 줄(의도된 예외). 카카오 분류엔 로마자를 만들지 않는다(정보 0). 주소는 `romanAddressOf`(행정 단위 붙임표 — `도`는 광역 도 허용 목록, 광역시 약칭은 단위 아님)이고 역지오코딩은 `lang=en`에서 juso 공식 영문이 먼저다. 실호출 게이트 `scripts/verify-reverse-geocode-en.mjs`.

### 카카오 분류 경로의 영문은 세그먼트 사전 + 서버 `categoryEn`이고 "전부-아니면-원문"이다

**카카오 분류 경로의 영문은 세그먼트 사전 + 서버 `categoryEn`이고 "전부-아니면-원문"이다**(A28, 2026-08-31, spec `2026-08-31-kakao-category-en-design.md`): 카카오는 en 분류를 주지 않고 로마자는 정보가 0이라, `src/lib/data/kakao-category-en.json`(ko 세그먼트 → en, 세션이 직접 쓴 번역 — 브랜드는 공식 영문 표기만, 모르면 넣지 않는다)을 `kakaoCategoryEn`이 읽어 **세그먼트 전부 등재일 때만** 영문 경로를 additive로 싣는다(`kakao-local`·`kids-places`·`surroundings`·`surroundings-scene` 투영, wire는 키 부재 — `null`을 싣지 않는다). 하나라도 미등재·빈 세그먼트·제어 문자면 부재이고 소비자는 한국어 원문 + `lang="ko"`로 떨어진다 — **부분 번역을 섞지 말 것**(어느 언어 엔진으로도 못 읽는다). 표시는 웹 `pickCategory`(`kakao-category.ts`) ↔ Kit `pickCategory`(공유 fixture) **한 자리**뿐이고, **판정 축(`isStation`·`categoryOf`·키즈 화이트리스트·채팅 컨텍스트·`router.ts`)은 원문 `category`만 읽는다** — `kakao-category-projection.test.ts`의 소스 가드가 그 파일들에 `categoryEn`·`pickCategory` 등장을 막는다. ⚠ **사전은 스냅샷이다**(`scripts/build-kakao-category-en.mjs` 실호출 스윕 4,000회, 코퍼스는 장소 데이터라 저장소에 넣지 않는다 — `--from-corpus`로 호출 0 재계산): 평탄 세그먼트 사전이 성립하는 근거는 "같은 세그먼트가 두 부모 아래 등장하지 않는다"는 실측(1,176경로 중 0건)이고 스윕이 그 수를 매번 출력한다 — 0이 아니면 그 세그먼트를 사전에서 뺀다. 커버리지 게이트 `scripts/verify-kakao-category-en.mjs`(4투영 경로·7지역, 카드 90% 합격선)는 "번역이 있다"만 재고 "맞다"는 `kakao-category.test.ts`의 실경로 기대값 표만 든다. 분류 줄에 한글 병기는 하지 않는다(분류는 번역이지 고유명사가 아니다).


---

## 실시간 안내 세션 상세

`CLAUDE.md`가 요지만 남기고 여기로 옮긴 상세 계약이다(2026-09-02 문서 축소). 각 절 제목은 `CLAUDE.md`의 해당 항목 제목과 같다.

### 잊힌 도보 세션은 국면 무관 안전망이 끝낸다

**잊힌 도보 세션은 국면 무관 안전망이 끝낸다**(2026-08-26 A23, spec `2026-08-26-imminent-triple-cue-and-session-idle-design.md` §2): 도착 추정(`presumedArrivalStep`)은 최종 접근 국면에 들어간 세션만 정리하므로 그 문을 못 지난 세션(GPS 두절·이탈 상태 종점 접근·간략 강등·150m 밖 실내 진입)은 종전에 상한이 0이었다(출근 안내가 몇 시간 켜져 있던 실사고). Kit `sessionIdleStep`(↔ 웹 `session-idle.ts`)이 usable fix 두절 10분·앵커 25m 무이동 20분을 보고 `BeaconModel` 워치독이 사용자 중지 모양(`stopLeavingSummary`)으로 끝낸다. ⚠ **도착 추정의 국면 게이트를 느슨하게 해서 이 공백을 메우지 말 것** — 경로 중간 자동 종료 금지가 그 spec의 1선 방어다. ⚠ 진행 앵커는 도착 추정 앵커(10m)와 **별도**(25m)다 — 실내 wifi 지터가 10m 앵커를 20분 내내 전진시키면 이 축이 영영 안 열린다. 대중교통 세션엔 없다. **자동차는 두 안전망 다 켜지만 모양이 다르다**(2026-08-31 K2-a, spec `2026-08-31-car-session-end-design.md`): 갈림 셋은 `GuideTuning` 데이터다 — `entersFinalApproachWithoutGeometry`(car true: 자동차 라우트는 `finalApproach` 기하가 없어 종전엔 `beginFinalApproach`가 간략 인계로 빠졌고 그래서 `carArrivalStep`이 **실주행에서 도달 불가한 코드**였다, 2026-08-29 실사고) · `presumedArrival`(수단별 `PresumedArrivalThresholds`, car 두절 120·무이동 300·캡 150 — 상수를 걷어 전역으로 되돌리지 말 것, 도보 재판정이 자동차를 끌고 간다) · `sessionIdleStationaryAxis`(car false — 무이동은 정체·휴게소 정차와 구분 불가라 `sessionIdleStep`의 무이동 인자가 nil). ⚠ `BeaconModel`에 `sessionKind` switch로 이 갈림을 다시 쓰지 말 것 — 앱 타깃은 테스트 레인이 없어 튜닝 데이터로 내린 것이 유일한 가드다. ⚠ 추정 종료의 `arrivalSessionKind` 대입은 car일 때만이다(도보 종료 상태 동결). 간략 경로는 `brief` 줄로 fix당 1줄 계측한다(거부 fix 포함) — 이 줄이 없어 08-29 세션이 몇 시간을 산 채로 로그 0줄이었다.

### 도착 추정의 국면 게이트는 "도착 창"이고 간략 창의 자격은 `nearby` 래치가 아니라 Kit 리듀서다

**도착 추정의 국면 게이트는 "도착 창"이고 간략 창의 자격은 `nearby` 래치가 아니라 Kit 리듀서다**(2026-09-02 A31, spec `2026-09-02-brief-session-arrival-end-design.md`): `maybePresumeArrival`은 `inArrivalWindow`(최종 접근 국면 ∨ `briefWindowActive`)를 보고, 간략 창은 `briefArrivalWindowStep`(래치 ∧ 정확도 ≤30m = `carArrivalMaxAccuracyMeters`)이 매 usable fix에 전이를 정한다. ⚠ **래치를 직접 창 근거로 읽지 말 것** — 래치는 정확도로 스케일돼 100m fix에서 관측 200m까지 켜져 있어 목적지 미도달 세션을 "부근 도착"으로 끝낸다(설계 리뷰 BLOCKER). ⚠ **창 에피소드 상태(`arrivalWindowEnteredAt`·앵커·거리·플래그)는 `resetArrivalWindow()` 한 곳이 지운다** — 모드를 바꾸는 자리(경로 커밋·재획득·간략 인계·간략 강등·래치 초기화)마다 부르지 않으면 옛 300초가 다음 창에서 즉시 충족된다. 종료 화면은 `ContinuousClock` 종료 시각 기준 30분(`isEndScreenStale`)을 **백그라운드를 거친 `.active` 복귀에서만** 판정하고(`wasBackgrounded`는 `.active` 맨 앞에서 소비 — 추적 가드 뒤에 두면 비추적 상태에서 영영 남아 제어센터 왕복이 복귀로 읽힌다), 앱 루트는 유휴 리셋보다 먼저 세션에 전경 전환을 전달한다. `clearArrival`이 상태 문장을 남기는 조건은 `status.isFailure`(denied·unavailable)뿐이다 — `endKind`로 가르면 안전망·사용자 중지 문장이 길찾기 탭 선두에 영영 남는다.

### 띠바는 탭 콘텐츠 안에 두지, TabView 자체에 걸지 않는다

**띠바는 탭 콘텐츠 안에 두지, TabView 자체에 걸지 않는다**(2026-08-23 K1): `.safeAreaInset(edge:.bottom)`을 `TabView`에 걸면 inset이 탭 바 자리에 그려져 탭 바가 시각·VoiceOver 모두에서 사라진다(실기기 2026-08-22 — 띠바가 화면 첫 객체). iOS 26.1+는 `tabViewBottomAccessory(isEnabled:)`, 26.0은 내용 비우기, 18~25는 각 탭 콘텐츠의 `safeAreaInset`(`withGuideBand`) — 콘텐츠 safe area가 탭 바를 제외하므로 탭 바 바로 위에 놓이고 AX 순서가 콘텐츠 → 띠바 → 탭 바가 된다. ⚠ 액세서리 모디파이어를 조건부로 붙였다 떼지 말 것(TabView 정체성 변경 = 탭 상태 소멸). ⚠ 띠바 배경은 `.background(.bar, ignoresSafeAreaEdges: [])` — 기본값 `.all`은 배경을 아래 safe area(= 이제 탭 바)까지 늘려 버튼 AX 프레임이 탭 바를 덮는다(AXe 실측 133pt → 50pt). 시뮬 AX 스냅샷(라벨·순서)은 이걸 못 잡고 `axe describe-ui` 프레임만 잡는다. ⚠ 폴백은 탭마다 띠바 인스턴스가 생기므로 착지 바인딩은 항목 정체성 옵셔널 `bandFocusedTab: AppTab?`이고 펼칠 때 nil로 비운다(Bool 하나를 여러 인스턴스가 들면 탭 전환마다 커서를 끌어가고, 안 비우면 두 번째 최소화의 같은 값 대입이 no-op이다). 시트의 접기 버튼은 제목 메뉴 헤더 행 우측의 작은 아이콘(`GuideMinimizeButton`, `guide.minimize` "안내 시트 접기")이고 띠바 복귀 착지(`returnedFromBand`)가 거기 떨어진다. ⚠ toolbar에 두지 말 것 — 제목 없는 시트의 내비게이션 바가 아이콘 하나로 한 행을 비우고 서서 "제목이 빠진 화면"으로 보인다(시뮬 실측 2026-08-23). **"안내 종료"는 목록 밖 최하단 고정**(`GuideStopButton`, `safeAreaInset(edge:.bottom)`)이라 내용 행 수와 무관하게 마지막 객체이고 VO 네 손가락 아래쪽 탭이 지름길이다 — 목록 행으로 되돌리지 말 것. 그래서 시트 진입·복귀 앵커는 중지가 아니라 **제목 행**(`titleFocused`·`SheetControl.title`)이다(위원장 판정 2026-08-23).

### `outputSuppressed`는 공유 Bool이라 받아쓰기 억제의 종료는 `이전 값 ∧ 현재 값`이다

**`outputSuppressed`는 공유 Bool이라 받아쓰기 억제의 종료는 `이전 값 ∧ 현재 값`이다**(2026-08-23 K1 ④): `SpeechService`가 시작에 `GuideSession.setDictationActive(true, owner:)`를 걸고 모든 종료 경로에서 푼다(소유자 집합 — 화면별 인스턴스가 겹쳐도 마지막이 떠날 때만 해제). 시트(목적지 검색 등)도 같은 플래그를 쓰므로 무조건 false면 열린 시트의 억제가 깨지고, 무조건 이전 값이면 그 사이 닫힌 시트의 해제가 되살아나 안내가 영구 침묵한다. ⚠ **세대가 어긋난(취소된) 시작 경로는 억제를 풀지 않는다** — `cancel()`이 이미 풀었고 그 뒤 시작된 새 세션이 억제를 쥐고 있을 수 있다(옛 세션의 뒤늦은 해제가 녹음 중인 새 세션을 억제 없이 돌린다, 리뷰 검출).

### 안내 조망은 수단별 시트가 아니라 능력 단위로 공유한다

**안내 조망은 수단별 시트가 아니라 능력 단위로 공유한다**(2026-08-23 E15-1, spec `2026-08-23-transit-progress-overview-design.md`): 셸 `GuideOverviewSheet`는 `GuideOverviewCapability`(앱 `Directions/GuideOverviewSheet.swift`)만 알고, 도보·대중교통은 어댑터가 행·행동을 투영한다. **프로토콜은 조망 전용으로 봉인** — 다음 능력(톤 등)은 자기 프로토콜을 새로 둔다(넓히면 셸이 분기 주머니 — 주변 확인은 대중교통 시트 전용이라 공유 셸 없이 Kit 순수 함수 + 시트 직접 배선으로 끝났다, E15-2). 판정은 Kit 순수 함수(`transitProgressOverview` ↔ 웹 `transit-progress-overview.ts`, 공유 fixture), 배선은 앱 프로토콜. ⚠ **"현재 위치" 표식은 신선한 추적 관측에서만**(`signal == tracking`·지하철·정규화 역명 유일 매칭) — 소실·실패·불확실 도착 중에 `state.currentLocation`이 남아 있어도 찍지 않는다(한 화면이 "위치를 모른다"와 "현재 위치는 X"를 동시에 주장하면 안 된다). ⚠ **조망 안 행동·국면 전이 착지는 전부 조망이 닫힌 뒤 부모 `onDismiss`에서**(`pendingFollowUp` 단일 슬롯) — `showOverview = false` 대입은 dismiss 완료가 아니라 모달 뒤 컨트롤에 착지하면 조용히 되돌아가고, 조망이 열린 채 `beginReboard()`를 부르면 부모 waiting 착지와 프롬프트 착지가 경쟁한다. ⚠ 조망 "다른 경로"는 시작 시 ODsay 대안 목록이 아니라 **현재 위치 기준 재조회**이고(출발점 근거 GPS → 현재역 앵커 → 실패, 승차역은 사용자 선언 버튼만), 커밋 가드는 시간(120초)이 보조·**근거 변화**(phaseGen·legIndex·앵커역)가 주다. 메뉴 목적지 전환(`pendingDestChange`)과 슬롯이 다르고 취소는 토큰 비교 — 한 슬롯을 source 플래그로 나누면 서로 덮는다.

### 안내 세션은 앱 수명이고 시트를 내리는 제스처는 최소화다

**안내 세션은 앱 수명이고 시트를 내리는 제스처는 최소화다**(2026-08-22 N1, spec `2026-08-22-guide-session-minimize-design.md`): `GuideSession.shared`가 `BeaconModel`·`TransitGuideModel`을 소유하고, 루트 `GildongmuApp`이 `.sheet(item: presentedScreen)` **하나**와 띄우고, 띠바(`GuideBandView`)는 각 탭 콘텐츠가 든다(배치 계약은 위 K1 항목). 길찾기 탭은 모델을 빌려 쓸 뿐이라 `onDisappear`에서 `teardown()`을 부르지 않는다(부르면 탭 전환이 곧 세션 종료 — 원증상). **시작은 전부 `GuideSession.startBeacon/startTransit`을 지난다**(거부 게이트 + 다른 모델 잔여 화면 소거) — `beacon.toggle`은 길찾기 탭 인라인 겸용 버튼(추적 중 "중지") 한 곳뿐이고 `guidance-gate-drift.test.ts`가 네 형태의 호출 수를 센다. `GuideSessionCoordinator.claim`은 점유 중 **nil(거부)**이지 종전처럼 기존 세션을 멈추지 않는다. ⚠ **dismiss 콜백은 모델 상태로 뜻을 정하지 않는다** — `.sheet` set(nil)은 무조건 `isMinimized = true`이고, 도착·중지 종료 화면과 핸드오프 제안의 소거는 그 화면 "닫기" 버튼의 명시 `clearArrival()`·`clearWalkHandoff()`뿐이다(`dismiss()`로 되돌리면 스와이프가 도착 직후 완료될 때 방금 생긴 도착 화면을 지우는 경합이 돌아온다). 루트 시트가 길찾기 폼에 닿는 길은 `GuideFormSyncStore.post/take`(탭이 안 보일 때 쌓인 값은 탭 `.task`가 소비). 폼 도착지 변경은 세션을 멈추지 않는다(조회 허용). 장소 상세가 대중교통 목적지 변경을 준비해도 **시트를 자동으로 올리지 않는다**(장소 상세가 이미 시트인 경로에서 루트 presentation이 조용히 거부된다) — 띠바가 "경로 선택 대기"를 보여 준다. 띠바는 live region이 아니고 거리는 10m 양자화(`bandDistanceMeters`), 낭독은 `spokenDistanceUnits`.

### 승차 전 도보(prewalk)는 대중교통 세션이 아니라 그 앞의 도보 세션이고, 종료 화면을 남기지 않는다

**승차 전 도보(prewalk)는 대중교통 세션이 아니라 그 앞의 도보 세션이고, 종료 화면을 남기지 않는다**(2026-08-30 A25, spec `2026-08-30-transit-prewalk-handoff-design.md`): `GuideSession.startTransit`이 `transitPrewalkTarget`(Kit ↔ 웹 미러, 공유 fixture `prewalk` 키)이 있으면 `BeaconModel`을 `markPrewalk` 상태로 먼저 돌리고, `onSessionEnd(reason)`로 `startAfterPrewalk(prewalkCompleted:)`를 잇는다(600ms, §14.2 동형). ⚠ **종료 화면 분기(확정·추정·`stopLeavingSummary`)는 `stop()` 뒤에 도는데 `stop()`이 `prewalkTarget`을 지우므로 `stop()` 앞에서 지역 변수로 캡처한다** — 빠뜨리면 `arrivalDest`가 되살아나 `screen`의 비콘 우선순위가 대중교통 시트를 영구 은폐한다. ⚠ **콜백 발화점은 `stop()` 말미(다음 MainActor 턴)와 `begin()` Task 말미(`.startFailed`) 둘뿐**이다 — 종료 경로가 7곳이라 경로마다 부르면 하나를 빠뜨린 경로가 조용히 연결을 끊는다. 사유는 `pendingEndReason` 대입(`stop()` 직전)이고 `stop()`·`begin()`이 `.ended`로 되돌린다. ⚠ prewalk 세션엔 잊힌 세션 안전망(`maybeEndIdleSession`)이 걸리지 않는다 — fix 두절 10분은 대개 지하 진입이고 그때 끝내면 그 경우를 위한 "{역} 도착" 선언 버튼까지 사라진다. 도보 중 사용자 중지·권한 상실은 전체 종료, 시작 실패는 `prewalkCompleted: false`로 바로 대기 국면(도보 문맥 유지 — 아직 걷지 않았다). 웹은 `TransitGuidePanel`의 `prewalk` 상태 + `DistanceBeacon.onSessionEnd`가 같은 정책(선언 버튼의 자기 유도 "ended"는 `declaredRef`로 무시). `transit.start`·`useTransitGuide.start` 시그니처는 불변이라 prewalk가 없는 경로는 새 분기를 지나지 않는다. ⚠ **prewalk 도보 세션의 `destinationLabel`은 표시 전용이라 대중교통 문구와 같은 언어의 같은 이름을 넘긴다**(iOS는 `transitPrewalkLabel`이 Kit 정규화기까지 봉해 준다) — `GuideText.periodicWalk`·`progress`·`finalApproachEnter`로만 가고 조인하는 소비자가 0이다. 한쪽만 영문화하면 en 세션 한 흐름이 `Walk to Cheonho` → `천호까지 200m` → `Arrived at Cheonho`로 들리고, 화면을 못 보는 사용자에겐 두 이름이 같은 곳이라는 근거가 없다(2026-09-01 a11y 감사 검출 — **부분 적용이 무적용보다 나쁜 자리**다).


---

## 통합 카탈로그 행 상세

`CLAUDE.md`가 요지만 남기고 여기로 옮긴 상세 계약이다(2026-09-02 문서 축소). 각 절 제목은 `CLAUDE.md`의 해당 항목 제목과 같다.

### 장소 검색

**정확도순+좌표 블렌딩**(`buildKakaoSearchUrl` — `x`/`y`만, `sort` 미지정, 2026-07-20 전환). ko는 両키 보유 시 `searchPlacesMergedKo` 병합(카카오 15 primary + 네이버 5 보강 뒤에 이어붙임, 좌표 4자리 dedupe, **재정렬 금지** — 네이버 전용 근처 가게가 하단에 오는 트레이드오프 수용). 거리 표기는 `searchPlaces` 진입점 `annotateDistances` 주석. 카카오 미등록 가게 보강(여의도 "백년찌개집 1971" 실측 2026-07-18). 폴백 kakao>naver>mock. **리뷰순(`sort=review`, 2026-08-17)은 네이버 단독이고 3금지가 걸린다**: 카카오 병합 금지(6번째부터 축이 아닌데 낭독은 경계가 안 들린다)·거리 재정렬 금지(`orderSupplementTail` 태우면 축 파괴 — 표기만)·키 부재 정확도순 폴백 금지(throw → 502). 별점·리뷰 수 **값은 없고 순서만** 있으며 5건 캡·좌표 무시(지역명은 질의에). 채팅 렌더엔 반드시 `sort`를 실어야 iOS 헤딩 "네이버 리뷰순 N곳"이 갈린다(낭독의 유일한 경계). 실호출 게이트 `scripts/verify-naver-review-sort.mjs`(두 정렬 집합 상이 + SE04 거절 둘 다). ⚠ 과거 명소 전용 라우트(`/api/places/attractions`)·kakao-attractions provider는 폐지 — 카카오 관광명소 판별이 필요하면 `category_name.startsWith("여행 > 관광,명소")`(AT4 group code 아님, 부속 명소는 빈 문자열)

### 목적지 출입구 승격

넓은 부지(학교·단지)는 검색 좌표가 본관이고 도보 경로는 정문에서 끝나 그 차이가 도착 판정을 영영 막는다(실측 58.8m → 승격 후 4.5m). 질의는 **`"{목적지명} 출입구"`**(이름 단독은 불안정 — `고덕그라시움`은 게이트 6개, 실제 POI명 `고덕그라시움아파트`는 0개), 판정은 **카테고리 `교통,수송 > 입출구` + 이름 잔여 토큰** 2중(잔여에 시설명이 남으면 부속시설이라 탈락 — `올림픽공원 SK…경기장 게이트1-3`·`서울아산병원 동관 후문`). ⚠ **잔여가 비면 후보가 아니다** — 이 규칙이 승격을 멱등으로 만든다(승격본 재조회가 자기를 다시 승격하지 않는다). ⚠ 지하철 출구는 `지하철출구`로 **다른 카테고리**라 오탐하지 않는다. ⚠ **출입구를 찾았다고 무조건 승격하지 않는다**(이득 게이트: 부지 부근 출발 200m·승격 폭 300m — 단지 안에서 출발하면 나갔다 돌아오는 경로가 되고, 부지가 크면 게이트 도착을 "목적지 도착"이라 부르는 것이 거짓이 된다). ⚠ **승격본은 좌표 층의 이름이고 입력 필드·최근 경로·URL은 원명을 유지한다** — 그 비대칭이 의도다. 종전의 승격 고지 문장("출입구를 찾아 …까지 안내합니다")은 행동을 바꾸지 않아 2026-08-18 위원장 판정으로 폐기했다(결과 이름 자체가 유일한 표시, 재도입 금지). spec `2026-08-16-destination-entrance-promotion-design.md`

### 서울 지하철역 시설

도시철도 보완, `stnNm` 포함필터→정확매칭 제외, `totalCount>300` throw. **보강 그룹 2종**(2026-07-22): 음성유도기 정적 seed(OA-22526 CSV cp949, `build-voice-guides.py`, 1~8호선 211역)+엘리베이터 위치 폴백(OA-21212 `tbTraficElvtr`, **wksn 엘베 부재 시만** — 9호선·우이신설 커버, 최근접 seed 좌표 기준 방위·거리 ko 합성). 보강 실패는 `supplementFailed`로 표기(groups 전멸 시에도 보존 — 실패 은폐 금지)

### 역 첫차·막차 (전국)

⚠ depTime HHMMSS·**00시대 심야열차가 배열 앞**(첫차·막차는 03:00 경계 +24h 서비스데이 보정, 요일 타입도 KST-3h 기준)·당역종착(`endSubwayStationId==자기`) 제외·keyword는 포함검색이라 정확매칭 코드 책임·item 1건은 객체. 노선명 축약("수인분당")은 `선` 접미 규칙(매핑 테이블 금지). 공휴일 보정은 특일정보(15012690) 게이트형(미신청·실패 시 요일 폴백+기준 라벨 명시). 레이트리밋 60초 10회. ⚠ **인증 정상(`00`)+`totalCount 0`은 "없음"의 증거가 아니다**(존재하지 않는 파라미터 값에도 같은 봉투, (역·노선) 단위로 상시 — 홍대입구 2호선·강남 신분당·서울역 공항): 매칭된 노선은 0행이어도 `lines`에서 빼지 않고 `coverage`(`ok`/`noTrains`/`unknown`/`unavailable`, 결합 순서가 불변식 — unknown이 참인 0을 이긴다)로 가르며, `judgeStationService`의 심야 단정은 `ok`·`noTrains`만 참여하는 allowlist다(A19, 2026-08-23). `deriveFirstLast`는 `subway-service-hours`가 null 계약으로 쓰므로 시그니처 불변. 실호출 게이트 `scripts/verify-korea-subway-timetable.mjs`(요일 무관 불변식만 단언)

### 문화행사

서울 `culturalEventInfo`(OA-15486). ⚠ **`DATE` 파라미터 금지** — "그날 열리는 행사"가 아니라 DATE **문자열 부분일치**라 7월 시작·9월 종료 행사가 8월 조회에서 탈락한다. 진행 판정은 `STRTDATE`/`END_DATE`로 코드가. ⚠ **안전한 페이지 절단선 없음**(시작일 내림차순이라 진행 중 행사가 183~18,587행에 흩어짐, 상위 2,000행이면 91%만) → 전수 20페이지 수집을 **일자 키 `unstable_cache`**(6h)로 감싼다. 캐시 대상은 좌표 무관 "오늘 진행 중" 슬림 투영 — 거리·반경(3km)·정렬·캡은 캐시 **바깥** service가. 정상 코드는 `INFO-000`+**`INFO-200`(범위 밖 페이지=끝 신호, throw 금지)**, 봉투 정책은 한 함수에만

### 소아 야간진료

좌표 보유는 `getBabyListInfoInqire`(15001674은 좌표 없음), 진료 3-state(KST). 정본은 **달빛 지정 명부(20km)+일반 소아청소년과 보완 소스(`QD=D002`·3km) 병합**(`src/lib/clinics.ts`, 2026-07-26 — 명부 단독이던 시절의 미지정 소아과 부재 회귀와 동명이원 함정은 spec `2026-07-26-clinic-coverage-expansion-design.md`). 진입점 `findNightClinicsNow`(라우트·채팅 공용)가 **진료중 우선 정렬**(`prioritizeOpen`: open>unknown>closed, 안정 정렬로 거리순 보존) 후 서버 캡 50 — ⚠ 거리순으로만 자르면 문 연 곳이 닫힌 곳에 밀려 절단된다. 표시 절단은 클라이언트 "더 보기" 몫(아래 UI 패턴), 절단 전 수는 `total`로 노출(침묵 금지). 공휴일은 `fetchIsHoliday`(특일정보) 재사용해 dutyTime8 판정, 실패 시 요일 폴백+`basis` 라벨 명시

### 보행 인프라

음향신호기 정본은 서울 열린데이터 **OA-15543**(EPSG:5186 — 5181·2097과 다름, `scripts/build-audio-signals.mjs` golden 가드). OSM 축(횡단보도·점자블록)은 **전국 79,575 노드 정적 seed**(2026-08-16 Overpass 실시간 호출에서 전환 — 그 호출이 429·504로 실패했고 110m 격자라 걸어가면 신규 타일이 연속돼 캐시가 가장 안 듣는 사용자가 보행자였다. 조회 1.4~3.9초 → **4~8ms** 실측). ⚠ **재생성은 `scripts/build-osm-walk-nodes.mjs`, 연 1회.** 그 스크립트의 함정 셋이 전부 조용한 실패다: ①**국경 판정 정본은 `area["ISO3166-1"="KR"]`** — bbox만으로 받으면 일본 노드 17,806개가 섞인다(대마도·규슈). ②**`out body`여야 한다** — `out tags`는 좌표를 생략해 결과가 통째로 0건이 되는데 파싱은 성공한다. ③**태그 질의는 위도 밴드로 쪼갠다** — 전국을 한 번에 요구하면 504다(`[timeout:N]`은 *실행* 시간만 재고 슬롯 대기는 포함하지 않아, 504·429는 질의 비용이 아니라 대기 큐 포화다). 가드 G1~G11이 전부 `throw`이고 **국외 부재(대마도 0건)·전국 존재(17개 시도)를 함께 본다** — 존재만 검사하면 "전부 담겼다"와 "남의 것도 담겼다"를 구분하지 못한다. ⚠ **OSM seed를 국내 공공데이터 seed와 한 파일로 합치지 말 것**: 병합본은 ODbL상 Derivative Database가 되어 "OSM 원본 가리키기"로 §4.6을 못 채우고, 그 순간 공공데이터 국외 반출 제한과 정면 충돌한다(두 제약이 서로를 잠근다). 병합은 런타임에서만. attribution은 화면 각주(`walkInfra.sourceOsm`) + iOS 설정 "정보 출처"에 있다. ⚠ **제공 지역 밖은 `unsupported: outsideKorea`이지 0건이 아니고, 그 판정은 provider가 아니라 `coverage.ts`의 `isInKorea`(국경 폴리곤)가 한다**(2026-08-23 E19로 링이 seed에서 `korea-boundary.json`으로 분리됐다 — seed는 2.7MB라 클라이언트가 import할 수 없다) — 사각형으로 판정하면 후쿠오카·기타큐슈·대마도·시모노세키가 "제공 지역 안"으로 통과해 "주변에 등록된 횡단보도가 없습니다"라는 거짓말이 되고(리뷰 검출 2026-08-16, 실호출로 확인), 사각형 뺄셈으로는 못 고친다(개성·해주가 파주와 위경도가 겹친다). `admin_level=2` 경계는 해안선이 아니라 영해 경계선이라 좌표점이 2,580개뿐이고 판정 비용이 사실상 0이다. 상수 사각형(`KOREA_COVERAGE_BBOX`)은 **판정에도 프리필터에도 쓰지 않고** crosswalk seed 생성 필터의 근거로만 남아 있다. 상태는 discriminated union(ok/unsupported/error), count류는 ok 안에만. 라우트·채팅 모두 `getWalkInfrastructure()`만 호출(provider 직접 금지)

### 부근 상황 재구성(M1)

입구 기준 좌우는 도로명 홀짝(시행령 7조④)+juso 건물 축 복원. ⚠ **축 표본은 juso 고정 — POI로 세우면 조회마다 축이 회전**해 경계 장소가 묶음을 오간다. ⚠ 맞은편은 같은 도로+본번(両부번 없음)+홀짝 반대일 때만. ⚠ juso 키워드 region은 `coordToRegionNames` 조각으로(표시 문자열 공백 분할 금지). ⚠ `SurroundingsScene`은 임베드 전용이라 **live region을 만들지 않는다**(DistanceBeacon 단일 live 계약 테스트가 강제) — 통지는 포커스·라벨 채널, 헤딩 레벨은 호출부가 지정. 축 실패=방위 폴백(200), 조회 실패만 502

### 횡단보도 차로 수·도로 폭

주석 파이프라인·3중 게이트의 상세는 위 「도보 경로 › 횡단보도 차로 수·도로 폭 주석」 절이 정본이고, 여기는 `CLAUDE.md` 카탈로그 행의 요지다.

단일 횡단보도 스텝 문장 끝에 `, N차로, 도로 폭 Mm`. **있는 곳만 말하고 없는 곳은 침묵**(수식이라 3-state 대상 아님). ⚠ seed는 교차로 횡단보도 여럿이 한 점에 겹쳐 등록돼(3,425곳 값 불일치) 최근접 1건이 어느 횡단보도인지 모른다 — **3중 게이트(중점 30m·연장≈구간 길이·후보 합의) 전부 통과일 때만** 붙이고 Tmap(provider 게이트, 기하 요청의 LineString은 횡단 길이가 아니다)·병합 스텝은 침묵. 파이프라인 마지막 단계라 기하 제거를 맡는다(음향신호기 단계는 `keepGeometry=true`). 서울은 동작구뿐. **상세 계약은 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) §횡단보도 차로 수**

### 장소 영업시간(E24, 웹·iOS 장소 상세)

Google Places(New). **어떤 실패도 `{hours:null}`**(키 없음·한국 밖·매칭 실패·부재·429·타임아웃) — 소비자는 줄을 만들지 않는다. 호출이 둘이고 캐시 정책이 정반대다: `place_id`는 **무기한 캐시 허용**(히트 365일·미스 30일 `unstable_cache`), 영업시간은 **캐시 금지**(약관 §3.2.3(b), `no-store`). ⚠ 과금 등급은 파라미터가 아니라 **필드마스크**가 정한다. ⚠ 예산 상한은 코드가 아니라 **GCP 소비자 쿼터**(`GetPlaceRequest` 33/일·`SearchTextRequest` 160/일 = 월 무료분)가 강제하고 초과는 429→침묵. ⚠ **약관 TTS 금지(§3.2.3(a)(iv))**: VoiceOver만 읽는다 — `TtsPlayer`·`speakGuidance`·채팅 산문·CLI/MCP에 절대 싣지 않고 `place-hours-tts-drift.test.ts`가 심볼 등장 파일 allowlist로 막는다(채팅 도구·내 주변 표기·정렬 반영·단정형 "지금 영업 중"은 E24 표기 규칙으로 재도입 금지 — 위험 방향 오류 9.1%). 매칭은 B1'(이름 완전 일치 + ≤50m 또는 도로명 키) / B2(브랜드 코어 + ≤50m)이고 좌표만으로는 매칭하지 않는다(대형 시설은 좌표가 85m 이격되는데 도로명 주소는 같다). "Google Maps"는 attribution 의무 표기(번역·변형 금지). 실호출 게이트 `scripts/verify-place-hours.mjs`. spec `2026-08-30-place-hours-google-design.md`
