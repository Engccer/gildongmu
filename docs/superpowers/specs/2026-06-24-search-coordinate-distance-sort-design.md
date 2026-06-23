# 검색에 좌표 연결 — 거리순 정렬 (설계)

> 2026-06-24. 메인 검색창·채팅 `search_places`가 사용자 좌표를 카카오 로컬 검색에
> 넘겨 거리순으로 정렬하도록 한다. 전국 정확도순 상위 15건만 받던 한계를 해결.

## 1. 문제

카카오 로컬 키워드 검색은 **페이지당 최대 15건**(`size` 1~15)이다. 현재
`kakao-local.ts`의 `searchPlacesKakaoLocal`은 `query`와 `size`만 넘기고
**좌표·`page`·`sort`를 전달하지 않는다**. 그 결과:

- 좌표 미전달 → 카카오 기본 정렬 = **정확도순(전국)**
- `page` 미사용 → **상위 15건만**

"맥도날드"처럼 전국에 수백 개인 체인은 `total_count`가 매우 커서, 정확도순
전국 상위 15건에 사용자 근처 지점이 들어가지 않는다. 위원장이 강동구 길동에서
"맥도날드"를 검색했을 때 찾던 지점이 통째로 누락된 것이 이 때문이다.

핵심은 "15건 제한"이 아니라 **"근처"라는 공간 맥락을 검색에 안 줬다**는 것.
앱은 이미 `useGeolocation`으로 사용자 좌표를 알고 있는데(거리 정렬·날씨에 사용),
그 좌표가 검색 경로(`/api/places`)에는 연결돼 있지 않았다.

## 2. 해결 — 좌표를 검색에 흘려보내 거리순 정렬

좌표가 있으면 카카오에 `x`/`y`/`sort=distance`를 넘긴다. **반경(`radius`)은
지정하지 않는다** — 좌표 기준 거리순으로 정렬만 하고 반경으로 자르지 않으므로,
근처에 없으면 먼 곳이라도 거리순으로 나온다(0건 위험 없음). 좌표가 없으면
(권한 거부·미준비) 현행 정확도순으로 graceful degrade.

별도 엔드포인트는 만들지 않는다 — 둘러보기·키즈가 이미 쓰는
`PlaceSearchParams` 확장 패턴을 그대로 따른다(YAGNI).

## 3. 변경 지점 (5곳)

### 3-1. 타입 — `PlaceSearchParams`에 좌표 추가 (`src/lib/types.ts`)

```ts
export interface PlaceSearchParams {
  query: string;
  limit?: number;
  lang?: "ko" | "en";
  lat?: number;  // 검색 기준 좌표 (있으면 거리순 정렬)
  lng?: number;
}
```

### 3-2. 카카오 provider — 좌표 있으면 거리순 (`src/lib/providers/kakao-local.ts`)

```ts
if (params.lat != null && params.lng != null) {
  url.searchParams.set("x", String(params.lng));  // 경도
  url.searchParams.set("y", String(params.lat));  // 위도
  url.searchParams.set("sort", "distance");       // radius 미지정 → 거리순 정렬만
}
```

좌표 없으면 기존 동작(정확도순). `sort=distance`는 카카오가 `x`/`y` 기준점으로
거리를 계산해 정렬하며, `radius`가 없어도 동작한다(전국 결과를 거리순으로).

### 3-3. API 라우트 — 좌표 파싱 (`src/app/api/places/route.ts`)

`lat`/`lng` 쿼리 파라미터를 zod로 선택적 검증(유효 위경도 범위)해 `searchPlaces`로
전달. 둘 중 하나만 있거나 범위를 벗어나면 좌표 없이 검색(현행 동작) — 좌표는
검색 품질 보조이지 필수가 아니므로 400으로 막지 않고 degrade.

### 3-4. 메인 검색창 (`src/components/PlaceSearch.tsx`)

`performSearch`가 `useGeolocation()`의 `userCoords`를 쿼리에 추가한다. 단
`ready` 상태일 때만 — `locating`/`denied`/`idle`이면 좌표 없이 호출. 좌표 흐름은
거리 정렬·날씨에 이미 쓰던 것을 검색 쿼리로 한 갈래 더 흘리는 것뿐.

### 3-5. 채팅 `search_places` (`src/lib/chat/router.ts`)

```ts
case "search_places": {
  const query = String(args.query ?? "");
  const anchor = anchorOf(ctx);  // placeAnchor ?? userLocation
  const result = await searchPlaces({
    query, lang: ctx.dataLocale, lat: anchor?.lat, lng: anchor?.lng,
  });
  ...
}
```

`anchorOf(ctx)`는 다른 좌표 도구(`get_subway_arrivals` 등)가 이미 쓰는 패턴이라
일관성이 확보된다. **`declaration`에는 좌표 파라미터를 넣지 않는다** — 컨텍스트
좌표를 서버가 자동 주입해, LLM이 좌표를 지어내는 경로를 차단한다.

⚠ `resolveCoord`(지명→좌표 변환용 `search_places` 단건 호출)는 **변경하지
않는다** — 지명을 좌표로 바꾸는 용도라 좌표 컨텍스트를 주면 안 된다(엉뚱한 정렬).
첫 결과만 쓰므로 정렬 무관.

## 4. 범위 밖 (의도적 제외)

- **네이버·TourAPI provider**: 좌표 정렬 미지원(네이버 정렬 옵션은 random/comment,
  TourAPI keyword 검색은 좌표 무관). en 병합(`searchPlacesMergedEn`)은 **카카오
  쪽만 거리순 혜택**을 받고 TourAPI는 현행 유지 — 회귀 없음. 두 provider에
  `lat`/`lng`를 넘겨도 무시되므로 안전.
- **페이지네이션(`page` 루프)**: 좌표+거리순이면 가까운 15건으로 대부분 해결되므로
  미포함(YAGNI). ChipFilter 풀이 부족하다고 판명되면 별도 사이클.
- **반경(`radius`) 필터**: §2 근거대로 미지정(0건 위험 회피).

## 5. 테스트

- `kakao-local.test`: 좌표 있을 때 `x`/`y`/`sort=distance`가 URL에 붙는지,
  좌표 없을 때 안 붙는지(기존 fetch mock 패턴).
- `/api/places` 라우트: `lat`/`lng` zod 파싱 — 유효 좌표 전달, 무효/누락 시 좌표
  없이 검색.
- 컴포넌트(`PlaceSearch`)·채팅(`router`) 와이어링은 node-env 테스트 레인이 없어
  `lint`+`build`+**실호출**(좌표 포함 `/api/places?query=맥도날드&lat=..&lng=..`가
  거리순으로 근처 지점 반환)이 머지 게이트.

## 6. 측정 가능한 성과

길동 좌표로 "맥도날드" 검색 시, **강동구 길동 인근 지점이 결과 상위에 포함**된다
(현재는 전국 정확도순이라 누락). 실호출로 before/after 대조.
