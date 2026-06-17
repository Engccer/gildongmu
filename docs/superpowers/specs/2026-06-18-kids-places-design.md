# B3 근처 아이 놀 곳 (키즈 장소) — 설계 계약

**날짜**: 2026-06-18 · **상태**: 구현 착수 · **게이트**: 없음(기존 `KAKAO_REST_API_KEY` 재사용)

## 1. 목적·배치

여행/외출 중 가족이 **현재 위치 기준 아이 놀 곳**(키즈카페·실내놀이터·동네 놀이터·어린이공원)을 발굴. 홈(idle) "내 주변" 5번째 섹션 — 순서: **지하철 → 버스 → 따릉이 → 소아진료 → 아이 놀 곳**. 게이트 `canShowKids = hasKakaoKey()`(카카오는 핵심 검색 키라 사실상 항상 노출, 패턴 일관성 위해 게이트 유지).

가족→dodo-planet 다리 3순위(SPEC §3). dodo 본질인 "가족 여행 목적지 발굴".

## 2. 데이터 소스·실호출 규명 (2026-06-17 강동 길동 기준)

기존 **카카오 로컬 키워드 검색**(`dapi.kakao.com/v2/local/search/keyword.json`)에 좌표 파라미터(`x`/`y`/`radius`/`sort=distance`) 추가. 신규 API·게이트 없음.

- **`distance` 필드는 x/y 제공 시 채워짐**, `sort=distance`로 쿼리별 거리순 정렬. 자체 Haversine 불필요(에어코리아 `tm`처럼 API 거리 정본).
- **`category_name`은 `>` 구분 계층 문자열**: 예 "가정,생활 > 유아 > 놀이시설 > 키즈카페". 풍부한 분류 신호.

### ⚠ 핵심 데이터 현실 — 키워드 매칭 ≠ 키즈 장소 (정적 리뷰로 못 잡음)

"놀이터" 키워드 검색 실응답에 **거짓양성이 다수** 섞임(실제 category_name):
- 거부 대상: 향수(미용>화장품), 방탈출카페(여가시설), 동우회(친목), 작은도서관(학습시설), 미술학원, **노인복지시설·청소년복지시설**(사회복지), 당구장, **스킨스쿠버**(스포츠,레저), 음식점>카페.
- 진짜 키즈: "유아 > 놀이시설 > {키즈카페|놀이터|서울형키즈카페}", "유아교육 > 놀이교육"(플레이타임), "공원 > 도시근린공원"(어린이공원).

**시각장애인은 화면으로 노이즈를 걸러낼 수 없으므로**, 키워드 신뢰가 아니라 **카테고리 계층 화이트리스트**가 정본 불변식이다.

## 3. 불변식 (잠금)

### I1. 카테고리 화이트리스트(거짓양성 차단) — `classifyKidsPlace(categoryName, placeName)`
ACCEPT 규칙(그 외 전부 거부):
- `category_name` 포함 `"유아 > 놀이시설"` → `kind = 포함("키즈카페") ? "kidscafe" : "playground"`
- `category_name` 포함 `"놀이교육"` → `kind = "playcenter"`(실내 놀이교육)
- `category_name` 포함 `"공원"` **그리고** `place_name`이 `"어린이"|"놀이"|"유아"` 포함 → `kind = "park"`
  - (일반 도시근린공원/광장 유입 차단 — 이름 신호 결합)

### I2. 실내/실외 3-state(우천 판단 정보) — `indoorOutdoor`
- `kidscafe` · `playcenter` → `"indoor"`
- `park` → `"outdoor"`
- `playground`(유아>놀이시설>놀이터)는 **모호** → 이름 신호로만:
  - `place_name` 포함 `"실내"` → `"indoor"`
  - 포함 `"공원"|"자연"|"산"|"광장"` → `"outdoor"`
  - 그 외 → `"unknown"`(잘못된 단정 금지 — B1·B2 unknown 교훈)
- **V1은 라벨만**(각 항목에 실내/실외/정보 없음 표시). 우천 자동필터·날씨 연동은 비포함(날씨 소스 미연결, 가짜 판정 금지). 사용자가 라벨을 듣고 판단 — 미니멀 접근성(섹션 내 추가 컨트롤 없음). 칩 필터는 v2 여지.

### I3. 다중 키워드 병합·dedupe·재정렬
- 키워드 3종 `["키즈카페", "놀이터", "어린이공원"]` 병렬 호출(쿼터 ≤3/액션, subway-nearby 동형).
- 카카오 `id`로 dedupe(같은 장소가 여러 키워드에 중복). 거리는 항목 보존(쿼리 무관 동일 좌표).
- accept 필터 → **거리 오름차순 재정렬**(쿼리별 정렬이 병합 후 깨지므로) → 상위 8 cap. radius=2000m(도보권 "근처").

### I4. 부분 실패 불변식(subway-nearby 동형)
- 3 키워드 `Promise.allSettled`. 일부 rejected여도 fulfilled 실데이터 보존.
- **전부 rejected여야 throw → 502**("조회 실패"≠"근처에 없음"). 일부라도 성공하면 그 결과로 진행.
- 키 없음 → `[]`(게이트 이중 방어). 빈 결과 → `[]`(graceful 숨김).

### I5. 좌표·표시
- 카카오는 WGS84 그대로(변환 불필요). `lat=Number(y)`, `lng=Number(x)`.
- 항목 표시: 이름 · 종류(키즈카페/놀이터/놀이센터/어린이공원) + 실내/실외 라벨 · 거리(m, API 정본) · 카카오맵 링크(`place_url`).
- V1은 **자기완결 정보 리스트**(clinic 동형) — PlaceDetail 연동은 비포함(검색으로 상세 접근 가능, 결합도 축소). 길찾기는 카카오맵 링크로 위임.

## 4. 구현 매핑

| 계층 | 파일 | 책임 |
|---|---|---|
| 순수 로직 | `src/lib/providers/kids-places.ts` | `classifyKidsPlace`·`normalizeKidsDoc`·`rankKidsPlaces`(dedupe+filter+sort+cap)·`findKidsPlacesNear`(키게이트+3키워드 allSettled) |
| 타입 | `src/lib/types.ts` | `KidsPlaceKind`·`IndoorOutdoor`·`KidsPlace` |
| 라우트 | `src/app/api/places/kids/route.ts` | lat/lng zod 검증 → 키게이트 `{kids:[]}` → `findKidsPlacesNear` → `{kids}` / 502 |
| 컴포넌트 | `src/components/KidsPlacesNearby.tsx` | NightClinicsNearby 동형 auto-fetch(geolocation), aria-live, 라벨 |
| 진입점 | `PlaceSearch.tsx` | `canShowKids && idle` 5번째 섹션 |
| 게이트 | `page.tsx` | `canShowKids={hasKakaoKey()}` |
| i18n | `messages/{ko,en}.json` | `kidsNearby` 네임스페이스 |

## 5. 테스트(게이트, 결정적)
- `classifyKidsPlace`: 실 fixture의 진짜 키즈 ACCEPT + 노이즈(스킨스쿠버·노인복지·동우회·방탈출·도서관) REJECT, kind 정확.
- `indoorOutdoor` 3-state: kidscafe→indoor, park→outdoor, 놀이터 모호→unknown, 이름 신호.
- `rankKidsPlaces`: dedupe(중복 id), 거리 재정렬, cap, accept 필터 통합.
- `findKidsPlacesNear`: 키없음→[] fetch 미호출, 정상 병합, 전부실패→throw, 일부실패→부분보존.
- fixture: `kakao-kids-playground.json`·`kakao-kids-cafe.json`(실응답 캡처).
