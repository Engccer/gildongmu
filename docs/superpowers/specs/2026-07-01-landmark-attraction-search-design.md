# 랜드마크(관광지·명소) 검색 결과 설계

> 2026-07-01 · gildongmu · 검색 랭킹
> 상태: 설계 확정(브레인스토밍 승인)

## 문제

"경복궁"을 검색하면 종로의 진짜 관광지 경복궁이 안 나오고 길동 근처 **경복궁 삼계탕·경복궁 방이점·경복궁 요양센터** 같은 동명(同名) 음식점만 나온다. 여행자(외국인·SR 사용자 포함)는 "유명한 그 경복궁"을 찾고 싶은데 도달할 수 없다.

### 근본 원인 (실호출로 확정)

`buildKakaoSearchUrl`(`src/lib/providers/kakao-local.ts`)이 사용자 좌표가 있으면 `sort=distance`를 건다. 거리순 정렬은 "가장 가까운 동명 장소"를 최적화하므로, 길동에서 검색하면 근처 음식점 15곳이 결과창을 다 채우고 15km 떨어진 진짜 경복궁은 창 밖으로 밀려난다.

반대로 **정확도순**(좌표·sort 미지정)은 진짜 경복궁을 **1위**로, 경회루·근정전 등 궁궐 POI를 상위에 자동 배치한다. 즉 카카오는 이미 "명소성"을 알고 있고, `sort=distance`가 그 신호를 덮어쓴다.

거리순은 "카페·약국·편의점"처럼 **가까운 게 정답**인 일반 검색엔 옳다. 문제는 고유명사 랜드마크 검색뿐이다. 그러므로 거리순을 없애면 안 되고, **명소를 별도로 병치**해야 한다.

## 목표

- "경복궁"·"남산타워" 등 랜드마크 검색에서 진짜 관광지를 **최상단**에 노출.
- "카페"·"약국" 등 일반 검색의 거리순 동작은 **오늘과 byte-identical** 유지.
- 근처 동명 장소(경복궁 삼계탕)도 **버리지 않고** 함께 보존.
- 접근성: 명소 섹션은 주소·웹 섹션과 동형으로 취급(빈 결과 자동 숨김, 단일 polite 통지, `<h4>` 항목 이름, 한 줄=한 객체).

### 성과 측정

- 로컬 검증(머지 게이트): 사용자 좌표를 넣고 "경복궁" 실호출 → **명소 섹션 1위 = 진짜 경복궁**(category_name `여행 > 관광,명소`). "카페" 실호출 → 명소 섹션 **미노출**, 내 주변 결과는 변경 전과 동일.
- 게이트 테스트: `orderResultSections`·`combinedLiveMessage`·명소 필터의 순수 로직 단위테스트.

## 판별 신호 — category_name 계층 (⚠ AT4 group code 아님)

실호출로 확정한 결정적 사실: **`category_group_code === "AT4"`는 대표 명소 1곳만 잡는다.** 경복궁 본궁은 `AT4`지만 경회루·근정전·집옥재·향원정·흥례문·신무문은 group code가 **빈 문자열(`''`)**이다. 남산에서도 N서울타워만 `AT4`, YTN서울타워는 빈 값이다.

신뢰할 신호는 **`category_name`이 `"여행 > 관광,명소"`로 시작**하는지다. 위 항목 전부 이 계층을 단다. 이는 이 repo가 이미 쓰는 패턴이다 — kids-places도 group code가 아니라 category_name 계층 화이트리스트로 분류한다("키워드 매칭 ≠ 키즈").

```ts
const ATTRACTION_PREFIX = "여행 > 관광,명소";
const isAttraction = (p: Place) => p.category.startsWith(ATTRACTION_PREFIX);
```

## 설계

### ① 데이터 소스 & 명소 추출

검색 시 카카오를 **2회 병렬 호출**:
- **내 주변** = 기존 `/api/places` (`sort=distance`, 지금 그대로).
- **명소** = 신규 `/api/places/attractions` — 정확도순 호출(좌표·sort 없이) 결과에서 `isAttraction`인 것만 필터. 정확도순이라 진짜 경복궁이 1위.

세부:
- **cap**: 명소 최대 5개(대표 명소 + 상위 부속). accuracy 순서 유지(대표가 맨 위).
- **거리 표기**: 명소는 멀 수 있으므로(경복궁 ≈15km) 사용자 좌표로 Haversine 계산해 표시(정렬용 아님 — "여긴 근처 아님"을 알리는 정보). 좌표 없으면 거리 생략. "거리순 정렬/거리계산은 코드 책임" 패턴 재사용.
- **게이트**: `hasKakaoKey`(place와 동일 키). 키 없으면 명소 섹션·라우트·호출 전부 0(死기능 0).
- 카카오 로컬은 무료 쿼터 + 300초 캐시라 2회 호출의 비용·성능 부담은 미미. 하드 스톱(유료 대량 호출) 비해당.

### ② 섹션 순서 — 명소 우선

현재 `orderResultSections`는 건수 내림차순이다. 그대로 두면 "경복궁"에서 내 주변 15건이 명소 5건을 위로 밀어내 고친 의미가 없다.

**규칙**: 명소 섹션은 **결과가 있으면 항상 최상단**(건수 무시). 근거 — 명소가 쿼리와 매칭됐다는 건 "이 이름의 유명한 그곳"을 원한다는 가장 강한 의도 신호라, 여행자·SR 사용자 모두에게 먼저 낭독돼야 한다. 그 아래로 기존 place·web·address는 지금 규칙(건수 내림차순, 동률 시 place>web>address) 유지.

```
"경복궁" → 명소(경복궁…) → 내 주변(삼계탕…) → 주소
"카페"   → 명소 없음(미노출) → 내 주변(오늘과 동일)
```

`orderResultSections` 시그니처에 `attractionCount`를 추가하고, `>0`이면 결과 배열 맨 앞에 `"attraction"`을 unshift한 뒤 나머지를 기존 규칙으로 정렬한다.

### ③ 아키텍처 & 배선

- **provider**: `src/lib/providers/`에 명소 검색 함수 신규(정확도순 카카오 호출 + `isAttraction` 필터 + 거리계산 + cap). `src/lib`는 React/Next 비의존 유지(dodo 이식성). buildKakaoSearchUrl과 대칭되는 순수 URL 빌더 + fetch.
- **route**: `src/app/api/places/attractions/route.ts` 신규. `/api/places`와 동형(zod query 스키마: query·lat·lng·lang, 게이트, 502 에러 처리). 캐시는 준정적이므로 place와 동일 `revalidate: 300`.
- **오케스트레이션**(`PlaceSearch.tsx`): `attractionStatus` 상태 + `attractionReqIdRef` + `performAttractionSearch`(place performSearch와 동형 stale 가드) 추가. **`runQuerySearch`의 `Promise.all`에 명소 호출을 합류**(place·address와 병렬). 단일 진입점 유지 — 세 진입 경로(폼·음성·`?q=` 자동)가 이 한 경로를 공유(과거 DRY 회귀 방지).
- **섹션 통합**:
  - `SectionKind`에 `"attraction"` 추가.
  - `orderResultSections(attractionCount, placeCount, addrCount, webCount)` — 명소 우선 규칙.
  - `combinedLiveMessage`에 `attractionCount` 추가(0건 섹션은 통지 제외 로직 그대로).
  - i18n 키 `search.attractionCount`("관광지 N곳") 추가 — `i18n-messages.test.ts` 게이트 통과 위해 전 로케일.
- **렌더**: 명소 섹션 본체 컴포넌트. 내 주변 결과 항목과 동형 — `<h4>` 이름, 한 줄=한 객체(`joinText`로 이름·분류·거리 합침, 인터랙티브는 분리 유지). ResultList 재사용 가능하면 재사용, 명소 전용 표시(거리·"관광지" 맥락)가 필요하면 얇은 전용 리스트.

### ④ 접근성

- 명소 섹션 헤딩은 다른 섹션과 함께 노출될 때만(`showSectionHeadings`), 계층 `h3`(섹션)→`h4`(항목). 단일 섹션이면 헤딩 없이(기존 규칙).
- 명소는 자동 등장이 아니라 검색 결과의 일부라 별도 region 랜드마크 불필요(place·address·web과 동일 취급).
- 통지는 단일 polite 채널 합산(`combinedLiveMessage` → "관광지 N곳, 장소 M곳, …").
- 각 명소 항목의 한 줄(이름 + 분류 + 거리)은 `joinText`로 단일 텍스트. 장소 상세로 여는 버튼/링크는 별도 객체 유지.

## 범위 경계

- **v1은 ko 우선.** 신고된 경복궁 케이스 해결이 목표. 카카오 정확도순은 한글 이름만 준다.
- **en은 fast-follow.** 외국인은 카카오 한글 명소명을 못 읽으므로, en 명소 섹션은 TourAPI(영문 명소명 보유)로 채우는 별도 작업으로 분리(YAGNI — v1에 억지로 끼우지 않음). v1에서 en 로케일은 명소 섹션을 노출하지 않는다(`canAttraction = … && dataLocale === "ko"` 게이트). **v1 구현 시 en 경로는 기존 동작 불변**을 보장한다.

## en 명소 (fast-follow 확정 — 2026-07-01 실호출)

v1의 ko-only 게이트를 풀고 en 로케일도 명소 섹션을 채운다. ko(kakao)와 **소스만 다르고 나머지 배선은 로케일 무관이라 그대로 재사용**한다.

### 판별 신호 — TourAPI `contentTypeId=76` (Tourist Attraction)

실호출 확정: EngService2 `searchKeyword2`에서 **`Gyeongbokgung` + `contentTypeId=76` → 정확히 1건 "Gyeongbokgung Palace"**(동명 매장 전부 79 Shopping으로 배제, 궁궐 1위). 이는 ko의 kakao `category_name` "여행 > 관광,명소" 필터에 대응하는 en 신호다. 78(Cultural Facility=박물관·도서관)은 ko의 관광,명소 트리에 없으므로 **제외**(parity).

kakao(ko)는 서버측 명소 필터가 없어 클라 필터(`isAttraction`)가 불가피했지만, TourAPI(en)는 소스에서 `contentTypeId`로 걸러줘 매장·잡음이 제거되고 궁궐이 1위가 된다 — 클라 필터 불필요, 쿼터 낭비 최소.

### 소스 분리 — en 명소는 TourAPI 단독

일반 장소 섹션(`/api/places`)의 en은 kakao+TourAPI **병합**(`searchPlacesMergedEn`)이지만, **명소 섹션 en은 TourAPI 단독**이다. kakao는 명소명을 한글로만 줘 외국인이 못 읽으므로 병합하면 반쪽이다. 영문명을 주는 TourAPI만 쓴다.

### 아키텍처 — provider 계층 로케일 분기

`searchPlaces`가 이미 쓰는 "provider 계층에서 lang 분기" 패턴을 그대로 따른다. `searchAttractions(params)`를 디스패처로:

```
searchAttractions(params):
  if params.lang === "en" && hasTourApiKey() → searchAttractionsTourApi(params)  // 신규
  else → searchAttractionsKakao(params)  // 기존 body, byte-identical
```

- **provider**: `tour-api.ts`에 `searchAttractionsTourApi` 신규 — EngService2 `searchKeyword2` + `contentTypeId=76`, 좌표 있으면 Haversine 거리 주입, cap 5. 순수 추출 로직 `extractTourAttractions`는 단위테스트.
- **정렬(⚠ ko와 다름 — 실호출로 확정)**: TourAPI엔 인기/정확도순 `arrange`가 없다(A 제목·O/Q/R 이미지·수정일 전부 실측). "Namsan"에서 어떤 `arrange`도 청도·경주 남산(수백 km)을 서울 남산 케이블카(479m)보다 위에 올린다. ko(kakao)는 정확도순이 대표를 1위로 올리지만 en은 불가능하므로, **좌표가 있으면 거리순 정렬**해 가장 가까운 실제 관광지를 먼저 보인다(위치 사용자에겐 근접성이 유일한 관련도 신호). 좌표 없으면 소스(제목) 순서. "경복궁"은 결과 1건이라 정렬 무영향 → 신고 케이스 그대로 해결. 소스별 최선 신호를 쓰는 정당한 비대칭(ko 정확도 / en 거리).
- **route**(`/api/places/attractions`): `lang` 파싱은 이미 존재. 게이트를 `hasKakaoKey() || hasTourApiKey()`로 넓혀 en(TourAPI)도 통과. 디스패처가 소스별 키를 재확인.
- **client**(`PlaceSearch.tsx`): v1 게이트에서 `&& dataLocale(locale) === "ko"`만 제거 → `canAttraction = canSearchAttractions`. `performAttractionSearch`는 이미 `lang=${dataLocale(locale)}`를 보내므로 그대로. 순서·통지·포커스·렌더는 로케일 무관이라 무변경.
- **page.tsx**: `canSearchAttractions`를 `hasKakaoKey() || hasTourApiKey()`로(둘 중 하나면 어떤 로케일이든 명소 섹션 가능).

### 수용된 발산 (ko ≠ en)

"cafe"+76 → "Apsan Cafe Street" 등 4건(TourAPI가 카페거리를 관광지로 실분류). ko "카페"는 명소 0건(kakao 관광,명소 없음)이라 섹션 미노출이지만 en은 4건 노출 — **날조 아닌 실분류**라 수용(외국인엔 유효 랜드마크, cap 5로 제한). TourAPI 관광지 범주가 kakao보다 넓은 소스 특성.

## 열린 항목

- 명소 cap 5가 적절한지(경복궁은 부속이 6곳) — 실호출 후 조정 여지. 대표 1 + 부속 4 노출이 기본.
- ResultList 재사용 vs 전용 컴포넌트 — 구현 중 명소 표시 요구(거리·맥락)를 보고 결정.
