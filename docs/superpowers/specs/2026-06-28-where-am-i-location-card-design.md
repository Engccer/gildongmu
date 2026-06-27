# "현재 위치" 정위 카드 설계 (where-am-i)

> 2026-06-28. 낯선 지역에서 **"내가 지금 어디에 있는가"를 한눈에 파악**하는 텍스트 정위 카드.
> 네이버·카카오 지도의 "현 위치 핀" 그래픽 UI의 스크린리더 등가물 — 단, 정보의 정본은 텍스트 산문이다.

## 1. 목적과 차별점

낯선 지역에서 방향을 정위하고 "제대로 된 경로로 가고 있나"를 빠르게 확인하려는 요구. 기존 '내 주변 둘러보기'(카테고리별 시설 12종 나열, 탐색용)와 **목적이 다르다**:

| | 내 주변 둘러보기 | 현재 위치 (이 기능) |
|---|---|---|
| 질문 | "근처에 **뭐가** 있나" | "**내가** 어디 박혀 있나" |
| 형태 | 카테고리별 불릿 리스트 | **두세 단락 간결 산문** |
| 핵심 | 시설 탐색 | 자기 위치 고정(정위) |

**측정 가능한 성과**: 버튼 한 번 → 한 번에 쭉 읽어 자기 위치(행정동·도로명·가장 가까운 역·주변 기준점 방위)를 파악. 스크린리더로 카드 본문을 처음부터 끝까지 한 흐름으로 낭독했을 때 "어디에 있고 주변에 무엇이 어느 방향에 있는지"가 끊김 없이 전달되면 성공.

## 2. 아키텍처 — 새 엔드포인트 1개로 서버 조립

`GET /api/where-am-i?lat=&lng=&lang=`이 좌표를 받아 네 조각을 **`Promise.allSettled` 병렬**로 모아 한 번에 반환한다(클라 4회 호출 방지, 기존 nearby 라우트 패턴 동형 — 부분 실패 격리·캐시·비밀키 서버 격리).

| 조각 | 소스 | 키 | 상태 |
|---|---|---|---|
| 도로명/지번 주소 | `coordToAddress()` (`kakao-address.ts`, **기구현·미사용**) | 카카오 | 잠든 자산 깨우기 |
| **행정동** ("강동구 길동") | `coordToRegion()` **신규** (`kakao-address.ts`, `coord2regioncode`) | 카카오 | 같은 키, ~15줄 |
| 가장 가까운 역 + 방위·거리 | `findStationsNear()` (`subway-stations.ts` 정적 seed) + `bearing` | **불필요** | 1km 내 1역 |
| 주변 기준점 | `findSurroundingsNear()` (`surroundings.ts`, 카페·음식점 포함 10종) | 카카오 | 거리순 + 8방위 기구현 |

응답 shape (LLM·산문 모두 이걸로 렌더):

```ts
interface WhereAmI {
  address: { road?: string; jibun?: string } | null;  // coordToAddress
  region: string | null;                               // "서울특별시 강동구 길동" → 표시용 정규화
  nearestStation: { name: string; line?: string; bearing: CompassDirection; distanceMeters: number } | null;
  landmarks: SurroundingPlace[];   // 거리순 상위 N(=6), 각 항목에 bearing·distanceMeters·categoryRaw
}
```

**부분 실패 불변식**: 네 조각 독립. 주소 실패해도 역·기준점은 보존(allSettled). **네 조각 전부 비면** 502(조회 실패 ≠ 정보 없음). 카카오 의존 3조각이 다 죽어도 seed 기반 근접역은 살아 카드가 최소한 "가장 가까운 역"은 준다.

## 3. 산문 생성 — 결정론 템플릿 (LLM 아님)

정위는 **정확성이 생명**(시각장애 사용자가 틀린 위치/방향을 검증 불가)이라, 같은 좌표에 같은 글이 보장되는 결정론 템플릿으로 만든다. LLM 산문은 (1) 비용 (2) 비결정 (3) 데이터에 없는 특징 날조 위험([[agentic-llm-fabricates-unstated-fields]] 교훈)이라 배제. 검색 라우터 폐기([[gildongmu-search-router-removed-llm-antipattern]])와 같은 정신 — deterministic 위에 latent를 얹지 않는다.

**계층 분리** (`src/lib`는 React/Next 비의존 유지):
- 순수 함수 `buildLocationNarrative(data: WhereAmI): NarrativePart[]` — 데이터를 **구조화된 문장 조각 배열**로. 산술(거리 반올림)·방위·기준점 선정·정렬이 여기. 키 없음/빈 조각 graceful 생략.
- 컴포넌트가 next-intl `t.rich`로 언어별 문장 렌더(5개 언어). 고유명(역명·시설명·행정동)은 `lang="ko"`(영문 UI의 한글 음성 엔진 정합).

```ts
type NarrativePart =
  | { kind: "location"; region?: string; road?: string; jibun?: string }     // 단락1 앞부분
  | { kind: "station"; name: string; line?: string; bearing: CompassDirection; distanceMeters: number }  // 단락1 뒷부분
  | { kind: "landmarks"; items: { name: string; bearing: CompassDirection; distanceMeters: number }[] };  // 단락2
```

**산문 구성**(미리보기 확정안):
- **단락 1 — 내가 어디**: "현재 {행정동}, {도로명}에 계십니다. 가장 가까운 지하철역은 {방위} 약 {거리}m 거리의 {역명}({노선})입니다." (역 없으면 역 문장 생략, 행정동/도로명 한쪽만 있으면 있는 것만)
- **단락 2 — 주변 상황**: 거리순 상위 6개 기준점을 방위·거리와 함께 한 흐름 문장으로. "주변을 보면 {방위} {거리}m에 {시설}, …이 있습니다." 같은 방위 복수는 자연스럽게 묶음("서쪽으로 60m 거리에 약국과 카페가 모여 있습니다").

거리 표기: 결정론 반올림(10m 미만 "10m 이내", 1km 이상 "약 N.Nkm"). 방위는 8방위 한국어/언어별 단어. **상대 방향(앞/오른쪽) 안 줌** — heading 미보유, 절대 방위만(surroundings 설계 §5-4 정합).

## 4. 채팅 버튼 — '내 현재 위치에 관해 물어보기'

장소별 채팅(`ChatOverlay`·`usePlaceChat`)이 이미 `placeContext` 앵커 + `search_web`(Perplexity) 도구를 다 갖췄다. **새 채팅 인프라 0** — 현재 위치를 `Place`로 합성해 같은 오버레이를 연다.

- `src/lib/where-am-i-place.ts`의 순수 `whereAmIToPlace(data): Place` — `name`=행정동(없으면 도로명, 없으면 "현재 위치"), `roadAddress`/`address`=주소, `category`="현재 위치"(빈 분류로 `isStation` false 보장), 좌표=현재 위치. `nearby-place.ts` mapper 패턴 동형.
- 카드에 "내 현재 위치에 관해 물어보기" 버튼 → `usePlaceChat`의 `openChat(place, e.currentTarget)`. 닫기 시 트리거 복귀(rAF). Esc 경합 불변식([[stacked-global-esc-listener-conflict]]): 채팅 열린 동안 패널 `engaged` false.
- 앵커 좌표가 현재 위치라 채팅의 좌표 도구(get_surroundings 등)·search_web이 "여기 기준"으로 동작([[gildongmu]] 장소 앵커 불변식 I-1).

## 5. UX·접근성

- 홈 idle '내 주변' 묶음 **맨 위 별도 버튼** "현재 위치". 누르면 `awaitGeolocation({force:true})` **정밀 재취득**(낯선 곳·실내 정합) 후 fetch. force 실패 시 직전 데이터 복원(2026-06-28 force 정책 동형).
- 기존 6종 nearby와 **같은 `nearby-panel-store` 아코디언** 합류(한 번에 하나, Esc·닫기·포커스 복귀 동일). `useNearbyPanel`.
- **버튼으로 펼치는 패널이라 `<div>` 유지**(자동 등장 아님 → region 불필요, First Rule of ARIA 정합). 단일 polite live region(조회 상태). 산문은 보이는 본문 한 곳에만(live 복제 금지 — 채팅 중복낭독 교훈 정합).
- `canShowWhereAmI`=`hasKakaoKey()` 게이트(주소·행정동·기준점이 카카오 의존). 키 없으면 버튼 미노출, 회귀 0. **mock 폴백 없음**.
- 버튼은 nearby 6종과 동형 컴포넌트(`WhereAmI.tsx`). 항목/제목 heading은 nearby 정책 따름(섹션 h3).

## 6. 의도적으로 안 하는 것 (한계 — 직전 조사 반영)

- **정면-상대 방향** 안 줌(절대 방위만). heading 신뢰성 한계(iOS 권한·실내 자기간섭 30~90° 오차), 시각장애 사용자 오방향 위험.
- **실시간 추적** 범위 밖(단발 스냅샷). "경로대로 가고 있나 실시간"은 beacon 별도 마일스톤(보존 코드, 미작동).
- **건물명**은 카카오가 항상 주지 않음 → 주변 기준점 최근접 POI로 실용 보강(설계상 단락2가 메움).
- GPS 도심·실내 오차(20~100m)는 force 정밀화로 완화하나 물리 한계는 못 넘음(정직 표기).

## 7. 테스트

- 순수 로직 fixture 결정적 테스트: `buildLocationNarrative`(조각 조립·빈 조각 생략·거리 반올림·방위 묶음), `coordToRegion` 정규화, `whereAmIToPlace`(name 폴백·category 빈값→isStation false).
- 실호출 머지 게이트: 길동 좌표 → `/api/where-am-i`가 도로명·행정동·근접역(굽은다리역 등)·기준점 6개 방위 반환. 부분 실패(주소만 죽임) 시 나머지 보존. 좌표 범위 밖 graceful.
- 컴포넌트 와이어링(아코디언·채팅 런처)은 node-env 테스트 레인 부재라 lint+build 게이트.

## 8. 신규/재사용 정리

**신규**: `coordToRegion()`(kakao-address.ts), `/api/where-am-i` route, `src/lib/where-am-i.ts`(WhereAmI 조립 + buildLocationNarrative 순수), `src/lib/where-am-i-place.ts`, `src/components/WhereAmI.tsx`, i18n `whereAmI.*`(5개 언어) + `placeChat.launchForLocation`.
**재사용 무수정**: `coordToAddress`·`findStationsNear`·`findSurroundingsNear`·`bearing`·`ChatOverlay`·`usePlaceChat`·`useNearbyPanel`·`nearby-panel-store`·`awaitGeolocation`.
**신규 외부 API·키·비용 0** (카카오 기존 키, Perplexity는 기존 채팅 경유).
