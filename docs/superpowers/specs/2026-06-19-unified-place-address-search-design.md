# 장소·주소 통합 단일 검색 설계 (2026-06-19)

## 배경·동기

행안부 juso 통합(C2-b) 때 주소 검색을 `SearchKindToggle`(장소/주소 라디오) **모드 분기**로 추가했다. 막상 사용해 보니 이 앱의 가장 큰 장점인 **미니멀한 단일 검색창** 레이아웃이 토글로 무너지고, 주소 검색 모드가 검색 전부터 화면에 노출돼 UX가 저하됐다(위원장 직접 피드백, 2026-06-19).

목표: **토글을 제거하고 단일 검색창으로 되돌리되, 주소 검색 기능은 보존**한다. 주소 검색을 "별도 모드"가 아니라 "검색 결과의 한 종류"로 흡수한다.

## 결정 사항 (브레인스토밍 확정)

1. **통합 방식 = 병렬 호출 + 결과 내 주소 섹션.** 단일 검색창에 입력하면 장소 검색(`/api/places`)과 주소 검색(`/api/address/search`, juso)을 **동시에** 호출한다. juso는 무료·무제한이라 매 검색 병렬 호출의 비용 부담이 없다. 장소(POI=상호)와 주소(도로명/지번/우편번호)는 거의 겹치지 않아 보통 한쪽 섹션만 결과가 있다.
2. **읽기 순서 = 결과 있는 섹션을 위로 (적응형).** 결과 0건 섹션은 통째로 숨긴다. 둘 다 결과가 있으면 **건수 많은 섹션을 위로**, 동률이면 **장소 우선**(일상 검색이 다수라 예측 가능한 tiebreak).
3. **단일 섹션일 땐 구분 헤딩 없이 바로 렌더** — 흔한 장소-only 경험을 오늘과 동일하게 보존(미니멀). **둘 다 있을 때만** 각 섹션에 `h3`("장소"/"주소") 구분 헤딩을 넣어 스크린 리더가 분리 탐색.
4. **합산 통지 문구 = "장소 N건, 주소 M건"** (단일 polite 채널).

## 아키텍처

### 진입 단일화

```
단일 검색창 ──제출──▶ runSearch
                        ├─ performSearch(q)         → status   (/api/places)
                        └─ performAddressSearch(q)  → addrStatus(/api/address/search)  ※ canSearchAddress일 때만
```

- `SearchKindToggle` 컴포넌트와 `searchKind`/`searchKindRef` 상태, 별도 주소 검색창(`addrQuery`), 모드별 렌더 분기를 **제거**한다.
- 검색창은 하나(`query`). `runSearch`가 장소·주소를 병렬 발사한다. juso 키 없으면(`canSearchAddress === false`) 주소 호출 자체를 생략한다(死기능·빈 fetch 방지 — 기존 게이트 정신 유지).
- 음성 받아쓰기(`handleTranscribed`)도 동일하게 장소·주소 병렬 발사로 단일화한다.
- `?q=` URL 동기화는 단일 쿼리로 자연히 단순화된다(기존 place 경로의 `?q=` 동기화·첫 마운트 자동검색 유지).

### 재사용 (변경 없음)

- `addrStatus` 상태머신(idle/loading/error/coordError/done), `performAddressSearch`, `onSelectAddress`(juso 항목 → 카카오 지오코딩 → `jusoAddressToPlace` → `openDetail`), `AddressResultList` 컴포넌트, `coordError` 통지.
- 장소·주소 두 흐름의 **종착점은 동일**(`openDetail(Place)`)하므로 하부 상세 흐름(`PlaceDetail`)은 불변.
- reqId stale 가드(`reqIdRef`/`addrReqIdRef`), in-flight 가드(`addrResolveRef`)는 그대로.

### 결과 화면 구조

검색 완료 시 단일 결과 영역(`<div>`)에 두 서브섹션을 적응형 순서로 렌더:

- **장소 섹션**: 기존 그대로 — 결과 헤딩(건수) + `ChipFilter`(분류·지역) + `ResultList`(카테고리 그룹). `places.length === 0`이면 섹션 숨김.
- **주소 섹션**: `AddressResultList`. `addrStatus.kind === "done" && addresses.length > 0`일 때만 렌더.
- **순서**: `orderResultSections(placeCount, addrCount)` 순수 함수가 `["place","address"]` 또는 `["address","place"]`를 반환. 규칙: 건수 내림차순, 동률·장소 우선.
- **구분 헤딩**: 두 섹션이 **모두** 렌더될 때만 각 섹션 위에 `h3`(`search.placeSection`/`search.addressSection`). 단일 섹션이면 헤딩 생략(오늘과 동일).
- **둘 다 0건**: `search.noResults`.

### 접근성

- **단일 polite live region** (기존 위치 유지): 둘 중 하나라도 로딩이면 "검색 중"(음성 검색이면 "‘{질의}’ 검색 중…"), 둘 다 정착하면 **합산 통지**:
  - 장소·주소 둘 다 결과 있음 → `search.combinedAnnouncement` ("장소 {place}건, 주소 {addr}건")
  - 장소만 → `search.resultsAnnouncement` (기존 "검색 결과 {count}건")
  - 주소만 → `search.addressResultsAnnouncement` ("주소 검색 결과 {count}건")
  - 둘 다 0건 → `search.resultsAnnouncement` count 0 (기존 "검색 결과 0건")
- **부분 실패 처리** (검색 완료 통지와 분리):
  - **주소 검색이 에러**(`addrStatus.kind === "error"`)면 합산 통지·정렬에서 **주소 0건으로 취급**(장소 결과는 보존, 장소 통지만 나감). 주소 섹션은 렌더하지 않는다(V1은 별도 에러 배너 없음 — 미니멀). 장소가 정상이면 주소 실패가 화면을 죽이지 않는다.
  - **`coordError`**(juso 항목 선택 후 카카오 지오코딩 실패)는 검색 완료가 아니라 **이후 상호작용** 단계라, 검색 통지와 경합하지 않는다 → 기존 `addressCoordFailed` 메시지를 그대로 유지(같은 polite 채널, 시점이 달라 충돌 없음).
- **단일 포커스 이동**: 두 호출이 **모두 정착(neither loading)**한 뒤 결과 영역 최상단 헤딩으로 1회 이동. 서로 다른 시점에 끝나도 포커스 점프가 없도록, "둘 다 settled" 전이에서만 `requestAnimationFrame` 포커스. juso 키 없으면 장소 settled만으로 판정.
- assertive 미사용(발화 경합 0), 기존 미니멀 접근성 기준 유지.

### 순수 로직 (테스트 대상)

`src/lib/search-sections.ts` (React/Next 비의존, 이식성):

- `orderResultSections(placeCount: number, addrCount: number): ("place"|"address")[]` — 적응형 순서. 빈 섹션 제외 후 건수 내림차순·동률 장소 우선.
- `combinedLiveMessage` 선택 로직 — 두 상태(place done count, addr done count, 로딩 여부)를 받아 어떤 i18n 키·인자를 쓸지 결정하는 순수 함수(문구 자체는 컴포넌트에서 `t()`로 번역). 반환은 `{ key, values }` 형태로 두어 i18n 분리.

## i18n 변경

`messages/{ko,en}.json`:

- **제거**: `search.kind.*`(토글 라벨 3개), `search.addressLabel`, `search.addressPlaceholder`(별도 주소 검색창 전용 — 단일 검색창은 기존 `search.label`/`search.placeholder` 사용).
- **추가**:
  - `search.placeSection`: "장소" / "Places"
  - `search.addressSection`: "주소" / "Addresses"
  - `search.combinedAnnouncement`: "장소 {place}건, 주소 {addr}건" / "{place} places, {addr} addresses found"
- **유지**: `addressResultsAnnouncement`, `addressNoResults`, `addressError`, `addressCoordFailed`, `addressSearching`, `address.*`(jibun/postalCode 라벨).

## 테스트

게이트 테스트(Vitest, 결정적):

- `orderResultSections`: 장소만/주소만/둘다(건수 대소·동률)/둘다0 → 기대 배열.
- `combinedLiveMessage`: 로딩/장소만/주소만/둘다/둘다0/음성질의 → 기대 키·인자.
- 기존 PlaceSearch 관련 테스트가 있으면 토글 제거에 맞춰 갱신.

수동 검증(실호출, dev 서버):

- "경복궁"(장소-only) → 장소 섹션만, 헤딩 없음, 오늘과 동일.
- "세종대로 110"(주소-only) → 주소 섹션만 상단.
- 장소·주소 모두 매칭되는 질의(있으면) → 건수 많은 쪽 위, 둘 다 `h3` 헤딩.
- juso 키 없는 환경 → 주소 호출·섹션 없음, 순수 장소 검색(회귀 0).
- 스크린 리더: 합산 통지 1회, 포커스 결과 헤딩으로 1회 이동.

## 범위 밖 (YAGNI)

- 주소-like 질의 휴리스틱(질의 형태로 주소 호출 여부 결정) — juso 무료·무제한이라 항상 병렬이 단순·신뢰. 불필요.
- 주소 섹션 페이지네이션·필터 칩 — 주소 결과는 소수라 불요.
- 딥링크 주소 상세 복원 — 기존 비목표 유지.

## 영향받는 파일

- `src/components/PlaceSearch.tsx` — 모드 분기 제거, 병렬 발사, 적응형 결과 렌더.
- `src/components/SearchKindToggle.tsx` — **삭제**.
- `src/components/AddressResultList.tsx` — 재사용(변경 없음 또는 헤딩 맥락만 조정).
- `src/lib/search-sections.ts` — **신규**(순수 로직).
- `src/lib/__tests__/search-sections.test.ts` — **신규**.
- `messages/ko.json`, `messages/en.json` — 키 정리.
- `src/components/PlaceSearch.tsx`의 `canSearchAddress` prop·`page.tsx` 전달은 유지(병렬 호출 게이트로 의미만 전환).
- `CLAUDE.md` — C2-b 아키텍처 항목을 "토글 모드"에서 "통합 단일 검색"으로 갱신.
