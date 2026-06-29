# 무장애 여행 정보 통합 설계 (한국관광공사 KorWithService2)

> 작성 2026-06-30. 출처 트리거: 공공데이터포털 메일(`NOTICE_0000000004801`)이 한국관광공사 14종 API의 법정동 변경을 안내하던 중, 목록에 포함된 **「무장애 여행 정보」** API를 발견. 메일 자체(법정동 변경)는 gildongmu에 영향 없음(키워드 검색만 사용, areaCode 미사용). 통합 가치가 큰 쪽은 무장애 API.

## 1. 배경과 목표

gildongmu는 시각장애인·교통약자를 1급 시민으로 두는 접근성 우선 길찾기 앱이다. 한국관광공사 **무장애 여행 정보 서비스**(`KorWithService2`, data.go.kr ID 15101897)는 약 6만 건 관광지의 **장애유형별 무장애 편의시설 정보**(휠체어 대여·장애인화장실·점자블록·음성안내·안내견 동반·수어 안내 등)를 제공한다 — 이 앱 정체성에 가장 정확히 부합하는 공식 데이터.

**성과(측정 가능):** 시각장애·교통약자 사용자가 (a) "내 주변에서 접근 가능한 관광지"를 거리순으로 찾고, (b) 장소 상세에서 그 장소의 무장애 편의시설을 확인하고, (c) 채팅으로 자연어 질의할 수 있다. 확인 방법: 실호출로 무장애 관광지 목록·편의시설 필드가 3-state로 정확히 노출되는지(머지 게이트).

## 2. 선결조건 (활용신청) — 사용자 액션

⚠ **현재 `TOUR_API_KEY`로 `KorWithService2`는 HTTP 403 Forbidden**(2026-06-30 실측). data.go.kr은 **API별 활용신청·승인이 독립**이라, 기존 `KorService2`(200 OK)와 달리 무장애 서비스는 별도 활용신청이 필요하다.

- **신청처:** https://www.data.go.kr/data/15101897/openapi.do → 로그인 → "활용신청"
- **비용:** 무료 (개발계정 1,000회/일). 대부분 즉시 자동승인.
- **승인 후:** 동일 `TOUR_API_KEY`로 작동(신규 키 발급 불필요). GW 게이트웨이 전파에 승인 후 수 분~1시간(tour-api.ts 주석 실측: 약 10분) 소요될 수 있음.

이 선결조건은 **하드스톱이 아니다**(무료·회수가능·외부영향 없음). 설계·구현·테스트는 활용신청과 독립으로 진행하고, **실호출 검증만 승인 이후**로 미룬다.

## 3. 아키텍처 (기존 패턴 준수)

```
클라이언트 ──fetch──▶ Route Handler ──▶ tour-barrier-free provider ──▶ KorWithService2
                       (게이트: hasDataGoKrKey)
```

기존 provider 추상화·게이트 패턴·횡단 함정 규칙을 그대로 적용한다. 키 없으면(또는 403) 4계층 전부 0(死기능·회귀 0).

## 4. Provider 계층 — `src/lib/providers/tour-barrier-free.ts`

`tour-api.ts`의 형제. B551011/`KorWithService2`, envelope·키·좌표 규약 동일(mapx=경도/mapy=위도 WGS84 십진, 빈결과 `items:""`, `resultCode!=="0000"`→throw).

**게이트:** `hasDataGoKrKey()` (기존, `TOUR_API_KEY` 공유).

**오퍼레이션 3종:**

| 함수 | 오퍼레이션 | 용도 |
|---|---|---|
| `searchBarrierFreeNearby({lat,lng,radius,limit})` | `locationBasedList2` (mapX·mapY·radius·arrange=E) | nearby — API가 거리순·반경 필터 제공 → 따릉이식 전체 페이지 루프 불필요 |
| `getBarrierFreeDetail(contentId)` | `detailWithTour2` (contentId) | 장애유형별 편의시설 상세 |
| `matchBarrierFreePlace({lat,lng,name})` | `locationBasedList2`(좁은 radius) + 이름 교차검증 | 장소 상세 매칭 — §6 |

**무장애 편의시설 필드 처리 (철자 불확실성에 강건):**

한국 공공 API는 필드 철자가 비표준(`braile` 단철자 등)이므로, **알려진 필드명→한글 라벨 화이트리스트 맵**을 두고 **응답에 실제로 온 키 중 값이 비어있지 않은 것만** 라벨링한다. 추정 필드 그룹(⚠ 철자·존재는 §7 실호출로 확정):

- **지체/공통:** `wheelchair`(휠체어 대여), `restroom`(장애인화장실), `elevator`(엘리베이터), `parking`(장애인주차장), `route`(주출입구 접근로), `exit`(출입문), `publictransport`(대중교통)
- **시각:** `braileblock`(점자블록), `audioguide`(음성안내), `braileguide`(점자 안내책자), `guidehuman`(안내요원), `helpdog`(보조견 동반), `bigprint`(큰글씨 자료), `guidesystem`(음성안내 시스템)
- **청각:** `signguide`(수어 안내), `videoguide`(자막 영상안내), `hearinghandicapetc`(청각 기타)
- **영유아:** `lactationroom`(수유실), `stroller`(유모차 대여), `babysparechair`(유아의자)

**3-state 불변식:** 각 필드는 서술형 텍스트 — **값 있음**(노출) / **빈 문자열·미제공**(숨김, "시설 없음") / **조회 실패**(throw→502). "정보 없음"과 "시설 없음"과 "조회 실패"를 절대 뭉개지 않는다. 비어있는 필드는 화면에서 제거(나열하지 않음 — 미니멀).

**캐시:** 무장애 정보는 정적 → `revalidate`(검색·상세 86400, nearby는 좌표 가변이라 짧게 또는 `no-store`는 불필요·`revalidate 3600`).

## 5. nearby — "내 주변 무장애 관광지" (`BarrierFreeNearby.tsx`)

- **route:** `/api/places/barrier-free` (기존 `/api/places/around`·`/api/places/kids` 하위 일관)
- **디폴트:** 반경 **3km**(관광지는 도보권보다 넓게), **TOP 8**.
- **상태/패널:** `awaitGeolocation()` 공유 스토어 + `nearby-panel-store` 싱글턴(claim/close, 포커스 비대칭) 그대로. 채팅 오버레이 열린 동안 `engaged:false`.
- **N+1 회피:** 목록은 `locationBasedList2`의 이름·거리·카테고리만 먼저 표시. **각 항목 펼침(disclosure) 시 `detailWithTour2`로 편의시설 lazy fetch**. 한 번 가져온 contentId 상세는 컴포넌트 상태 캐시.
- **a11y(CLAUDE.md 규칙 그대로):** nearby 섹션 헤더 `h3` → 각 항목 이름 **`<h4>`**. 펼침 패널은 **버튼이 발견경로라 `<div>`**(자동 등장 region 아님). 터치 타깃 ≥44px, `:focus-visible`. 상태는 단일 polite live region.

## 6. 장소 상세 보조 섹션 (자동 등장 region)

`AirQuality`/`StationMeta`와 동형 — 장소 상세가 열리면 조용히 fetch되어 나타나는 섹션이므로 **region 랜드마크가 유일한 발견 수단**(`<section aria-labelledby>` + `useId` + `<h3 id>`).

**매칭(좌표+이름 교차검증, 보수적):**
1. 장소 좌표로 `locationBasedList2`(radius **50m**, arrange=E) 후보 조회.
2. 후보 중 `normalizeName`(공백·괄호·지점명 제거) 일치하는 것만 채택.
3. **둘 다 만족할 때만** 매칭 성립 → `detailWithTour2` → 편의시설 표시.
4. 매칭 실패(0건 또는 이름 불일치) → **섹션 미노출**. 틀린 무장애 정보가 정보 없음보다 위험하므로 false positive를 구조적으로 차단.

매칭 실패는 캐시 회피(throw 아님, null 반환 후 미노출). 매칭 성공 상세는 `revalidate`.

## 7. 채팅 도구 — `get_nearby_barrier_free`

- `src/lib/chat`의 도구로 추가(provider 직접 import 호출). **장소 앵커 불변식:** `placeContext` 있으면 `anchorOf(ctx)`=장소좌표 기준(출발지 아님). 없으면 `userLocation`.
- **declaration 게이트:** `availableDeclarations()`가 `hasDataGoKrKey` 통과 시에만 Gemini에 노출(키 없으면 LLM이 호출 불가).
- `ToolResult{data, render, source}` — 카드+출처(`SourceList`, "한국관광공사 무장애 여행 정보"). `data`는 LLM에만(특징 날조 금지 — systemInstruction 기존 규칙 적용).
- 도구 총수 14→15.

## 8. 테스트

- **provider 단위(fixture):** envelope 파싱, 빈결과 `items:""`, `resultCode!=="0000"`→throw, 무장애 필드 화이트리스트 라벨링(값 있는 키만, 빈 키 제외), 3-state.
- **매칭 로직 단위:** 좌표 50m 이내 ∩ `normalizeName` 일치 → 성립 / 좌표만·이름만 → 불성립(false positive 차단 케이스).
- **거리순:** `locationBasedList2` arrange=E가 거리순을 주지만, `dist` 필드 신뢰 가능 여부를 실호출로 확인. 미신뢰 시 서버 Haversine 폴백.
- **i18n:** 새 UI 키 `i18n-messages.test.ts` 게이트 통과(ko/en/es/fr/it). 데이터 언어는 `KorWithService2`만 존재 → 영어 사용자도 한글 데이터(`dataLocale` 분리, 무장애 정보는 ko 단일).
- ⚠ **실호출 머지 게이트(활용신청 승인 후):** 실제 무장애 관광지 contentId로 `detailWithTour2` 호출 → **응답 키 철자·존재를 확정해 §4 화이트리스트 맵 교정** → fixture를 실응답으로 갱신. 이것이 진짜 머지 게이트(fixture green ≠ 실계약).

## 9. 미니멀 점검 / 비범위

- 신규 키 0, 신규 의존성 0, 키(403) 없으면 4계층 전부 0.
- 비어있는 무장애 필드는 나열하지 않음(서술형 값 있는 것만). 카카오 카페·식당엔 자연히 미노출.
- **비범위:** TourAPI 무장애 정보의 이미지·반복정보·동기화목록 오퍼레이션, en 무장애 데이터(서비스 미제공), 무장애 정보 기반 길찾기(별개 — 본 통합은 정보 노출까지).

## 10. 진행 순서

1. (사용자) data.go.kr 무장애 API 활용신청 — §2.
2. provider + route + 단위테스트(fixture 추정) — 활용신청과 독립.
3. nearby UI → 장소 상세 region → 채팅 도구.
4. 활용신청 승인 후 실호출 → 필드 맵 교정·fixture 갱신 → 실호출 머지 게이트 통과 → commit+push(자동배포).
