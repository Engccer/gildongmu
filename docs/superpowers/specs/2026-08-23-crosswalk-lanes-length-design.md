# 전국횡단보도표준데이터 — 횡단보도 문장에 차로 수·도로 폭 덧붙이기 (E8) 설계

2026-08-23 확정. `docs/BACKLOG.md` E8(위원장 착수 확정 2026-08-16)을 구현하며 병렬 브리프 `docs/superpowers/plans/2026-08-23-backlog-sweep-parallel-plan.md` §1 E8 행을 따른다. 선행: 음향신호기 주석(`2026-07-22-walk-infrastructure-design.md` §2-A, `walk-route.ts` `annotateAudioSignals`), 낭독 재작성(`2026-08-08-walk-guidance-stepfree-design.md`).

## 0. 전제 (위원장·코디네이터 판정 — 재논의하지 않는다)

1. **있는 곳만 말하고 없는 곳은 침묵.** 차로 수·폭은 이미 안내되는 횡단보도에 덧붙는 수식이라 없을 때 취할 다른 행동이 없다 — 3-state 불변식의 적용 대상이 아니다(BACKLOG E8). "정보 없음"을 말하지 않는다.
2. `greenSgngnrTime`(채움률 19.5%)은 싣지 않는다.
3. 자리는 서버 `getWalkRoute`의 **주석 단계**(재작성 → 주석 순서 유지), 음향신호기 병합과 같은 계층에 함수 하나.
4. `walkStepAction`의 "횡단보도" 마커 판정과 기존 fixture는 깨지 않는다 — 주석은 문장 **끝에 쉼표로 이어 붙이기만** 하며 "횡단보도" 토큰을 추가·제거하지 않는다(음향신호기 주석 동형).
5. 웹·iOS·CLI 소비자는 서버 문장을 그대로 낭독하므로 **변경 없음**(확인만).

## 1. 성과 정의

도보 안내의 단일 횡단보도 스텝에서, 표준데이터가 그 횡단보도를 특정할 수 있을 때 **"몇 차로를, 몇 미터 건너는지"**를 들을 수 있다. 판정 도구: 실호출 게이트 `scripts/verify-crosswalk-annotation.mjs`(동작구 "덧붙는다" + 길동 "침묵한다").

## 2. 데이터 전달 — 정적 seed

- 이용허락: 공공데이터포털 15028201 파일데이터 탭 표기 **"이용허락범위 제한 없음 · 무료"**(2026-08-23 확인, `subway-stations.json`과 동일 조건). 국외 반출 제한 없음 → 정적 seed가 가능하고, OSM seed와는 **별도 파일**(`NOTICE.md` ODbL 분리 규칙).
- 파일: `src/lib/data/crosswalks.json`. 형태 `{ meta: { source, fetchedAt, counts: { total, unparsed, lengthOutOfRange, duplicates, kept } }, crosswalks: Array<[lat, lng, lanes, lengthM]> }`. lat/lng 5자리(≈1m), lengthM 1자리.
- 생성: `scripts/build-crosswalk-seed.mjs`(API `https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api`, 1,000건 × 59페이지, `DATA_GO_KR_API_KEY`). 반기 갱신이므로 **연 1~2회 수동 재생성**.
- 봉투: `response` 래퍼 없는 `{header:{resultCode,resultMsg}, body:{items:{item:[]}, totalCount, …}}` 최상위 — 공용 `readItems` 밖이라 스크립트가 직접 읽고, **빈 값은 공백 한 칸**이라 전 필드 `trim()`. 범위 밖 페이지는 `resultCode "03" NODATA_ERROR`·`body null`(끝 신호).
- 빌드 가드(전부 throw): 총건수 ≥ 50,000 · 좌표 한국 상자 안 100% · `cartrkCo`·`et` 수치 파싱률 ≥ 99% · 시도 ≥ 15종(2026-08-23 실측 58,831건·15시도·좌표 100%·차로·연장 100% 채움). 연장 1~60m 밖은 탈락(실측 >60m 22건, 최대 302m — 오기). 동일 `(lat,lng,lanes,lengthM)` 완전 중복 행은 1건으로.

## 3. 매칭 규칙 — 실측 근거

### 3.1 데이터의 진짜 한계 두 가지 (2026-08-23 실측)

1. **커버리지**: 63개 시군구, 서울은 **동작구 1,057건뿐**. 그래서 서울 대부분에서 이 주석은 구조적으로 침묵한다(길동 경로 3스텝 전부 최근접 없음).
2. **위치 정밀도**: 좌표 4,833곳에 2건 이상이 겹치고(16,697행) 그중 **3,425곳은 차로·연장 값이 서로 다르다** — 지자체가 교차로의 횡단보도 여럿을 교차로 중심 한 점에 등록한 형태다. 한 점에 `6차로/28.1m`·`5차로/21.1m`·`1차로/10.2m`가 동시에 있다(상도역 인근 실측). **최근접 1건만 고르면 어느 횡단보도인지 알 수 없고, 틀린 차로 수를 낭독하는 것은 침묵보다 나쁘다.**

### 3.2 실측 (동작구 카카오 도보 경로 15쌍, 단일 횡단보도 스텝 22건)

스텝 폴리라인의 양 끝점 A·B(카카오 단일 횡단보도 스텝은 2점)에서 구간 길이 L = haversine(A,B)와 중점 M을 구해 M 기준 60m 안 seed를 본 결과:

| 관측 | 수 |
|---|---|
| 30m 안 후보 없음 | 9 |
| 30m 안 후보 1건 | 6 |
| 30m 안 후보 2건 이상 | 7 (그중 값 불일치 5) |
| 중점 거리 분포(매칭 판정 건) | 8.8~29m |
| 40m 이상에서 나타나는 후보 | 전부 같은 교차로의 **다른** 횡단보도(예: 11.5m 구간에 `1차로/2.2m`·`7차로/20.5m`) |

핵심 발견: 위치만으로는 못 가르지만 **seed 연장(`et`)과 스텝 구간 길이 L은 같은 것을 재고 있다**(카카오 스텝은 횡단보도 양 끝 보도 사이의 직선이라 L ≥ et, 실측 비 0.6~1.1). 이 축이 교차로에 겹친 후보를 가른다: 20.1m 구간에 겹친 `28.1·21.1·10.2m` 중 `10.2`는 탈락하고 둘이 남아 불일치 → 침묵, 21.2m 구간의 `13.5m`·`6.6m` 중 `13.5`만 남아 → "3차로, 도로 폭 14m"(서달로, 실제 3차로).

### 3.3 규칙 (fail-closed 3중 게이트)

단일 횡단보도 스텝(description에 "횡단보도" 포함 ∧ 병합 표현 `MERGED_CROSSWALK` 아님 ∧ `pathCoords` ≥ 2점)에 대해:

1. **위치**: 구간 중점 M에서 **30m 이내** seed를 후보로(실측 매칭 8.8~29m, 타 횡단보도는 40m+).
2. **길이 타당성**: 후보 중 `|lengthM − L| ≤ max(5m, 0.4·L)`만 남긴다(실측 정답 비 0.6~1.1, 교차로 타 횡단보도는 이 띠 밖).
3. **합의**: 남은 후보가 1건 이상이고 **전부 같은 차로 수 ∧ 연장 차 ≤ 2m**이면 최근접 1건 채택. 아니면 침묵.

표본 22건 결과: 주석 8 · 침묵 14(후보 없음 9 + 불일치 5). 오탐 0(채택 8건은 도로명과 차로 수가 맞는다 — 노량진로 6~7차로·보라매로 4차로·서달로 3차로·만양로 2차로·여의대방로62길 1차로). Tmap 스텝은 **provider 게이트로 침묵**(`annotateCrosswalkInfo`의 `provider` 인자, 기본값 없음): 비기하 요청은 `coord` 1점이라 L이 없고, 기하 요청은 Point 스텝에 다음 결정 지점까지의 LineString이 붙어 2점 이상이 되지만 그 길이는 횡단 길이가 아니다(리뷰 검출). 폴백 경로라 손실 감수.

상수는 `src/lib/providers/crosswalks.ts`에 두고 위 표본으로 잠정 확정. 재측정 경로는 `scripts/verify-crosswalk-annotation.mjs`.

## 4. 문장

- 주석 형식: **`, {N}차로, 도로 폭 {M}m`**(M = `formatDistance(Math.round(lengthM))` — 거리 표기는 언제나 `formatDistance`, 드리프트 가드 준수).
- ⚠ 위원장 확정 문구는 "4차로, 15m"였다. 그런데 재작성된 횡단보도 문장은 이미 꼬리에 **"횡단보도 길이 21m"**(카카오 스텝 거리)를 달고 나가므로(2026-08-11 위원장 판정 — 벌거벗은 수치 금지), 그 뒤에 "15m"를 맨몸으로 붙이면 한 문장에 길이가 둘 나와 모순으로 들린다. 두 수치는 실제로 다른 것이다(스텝 거리 = 보도에서 보도까지 직선, 연장 = 차도 폭). 그래서 seed 쪽은 **무엇의 값인지 이름을 달아** "도로 폭"으로 낸다 — "벌거벗은 수치 금지" 판정의 적용이지 문구 변경이 아니다. 최종 낭독 예: `소망 메디컬약국 앞에서 횡단보도를 건너세요, 횡단보도 길이 21m, 3차로, 도로 폭 14m`. 라벨 선택은 실기기 낭독 판정(BACKLOG E8 잔여).
- 음향신호기 주석과 공존 시 순서: `…, 음향신호기 있음, 3차로, 도로 폭 14m`(음향신호기 먼저 — 안전 정보가 수식보다 앞).

## 5. 구현 위치

| 파일 | 역할 |
|---|---|
| `scripts/build-crosswalk-seed.mjs` (+ `.test.ts`) | API 전량 수집 → 가드 → `crosswalks.json` |
| `src/lib/data/crosswalks.json` | seed |
| `src/lib/providers/crosswalks.ts` (+ 테스트) | `matchCrosswalk(pathCoords) → {lanes, lengthM} \| null`(§3.3 순수 판정, 도(°) 상자 프리필터 + haversine) |
| `src/lib/walk-route.ts` | `annotateCrosswalkInfo(briefing, keepGeometry, provider)` — `annotateAudioSignals` 뒤에 같은 자리. **기하 제거는 마지막 주석 단계 한 곳에서만** |
| `scripts/verify-crosswalk-annotation.mjs` | 실호출 게이트: 동작구 경로에 "차로" 주석 ≥ 1, 길동 경로 0, 주석이 붙은 스텝은 전부 "횡단보도" 포함 ∧ 병합 아님 |
| `NOTICE.md` · `docs/INTEGRATIONS.md` §도보 경로 · `CLAUDE.md` 카탈로그 행 | 계약 |

파이프라인: `rewriteWalkBriefing → annotateAudioSignals(keep) → annotateCrosswalkInfo(keepGeometry)`. 음향신호기 단계는 기하를 **보존**하도록 호출하고(`keepGeometry=true`), 마지막 단계가 종전 계약대로 제거·통일한다. 기존 `annotateAudioSignals` 단독 테스트는 그대로 성립(시그니처 불변).

## 6. 설계 리뷰 판정

생략. 새 불변식·상태 머신·외부 계약의 첫 정의가 아니고(정적 seed + 주석 한 단계, 음향신호기 주석의 검증된 골격 재사용), 국소·가역이며, 정확성 축(오탐)은 §3 실측 + 실호출 게이트 + 구현 리뷰가 덮는다.

## 7. 검증

- 게이트 테스트: `crosswalks.test.ts`(3중 게이트 각 축의 변이 — 30m 밖·길이 띠 밖·불일치·합의), `walk-route.test.ts`(파이프라인 순서·음향신호기 공존·병합 침묵·Tmap 침묵·기하 제거), `build-crosswalk-seed.test.ts`(봉투·trim·가드·중복).
- 실호출 게이트(머지 조건): `node scripts/verify-crosswalk-annotation.mjs` 전부 PASS.
- `walk-action.test.ts` fixture 무변경 통과.
