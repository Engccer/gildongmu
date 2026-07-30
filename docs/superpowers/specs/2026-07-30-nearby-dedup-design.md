# 웹 nearby 중복 추출 설계 (2026-07-30)

## 문제

"내 주변" 계열 컴포넌트 9종(`NightClinicsNearby`·`BarrierFreeNearby`·`WalkInfraNearby`·`KidsPlacesNearby`·`BusArrivals`·`SurroundingsNearby`·`SubwayArrivalsNearby`·`WhereAmI`·`BikeStations`, 합계 약 2,600줄)이 같은 골격을 복붙으로 반복한다. 2026-07-30 레거시 감사가 확정하고 전수 재맵핑으로 검증한 중복 축:

- **위치 취득 → fetch 상태 머신**(약 55줄 × 9): `Status` 8멤버 유니언(idle·locating·loading·empty·error·geoerror·outOfCoverage·done), `awaitGeolocation({force})`+`prevStatus` 복원, `isInKorea` 클라 선분기, body 파싱→`isOutOfCoverageBody`→`!res.ok` 순서, `inFlightRef` 가드 — 주석 문구까지 동일.
- **닫기 삼중주**(약 12줄 × 9): `close(restoreFocus)`+`onDismiss`+`onEscape`+`useNearbyPanel` 배선+rAF 트리거 포커스 복원.
- **live 통지 삼항 사다리**(약 18줄 × 8): locating→loading→empty→error→geoerror(denied|unsupported)→outOfCoverage→done, 네임스페이스만 다름.
- **"더 보기" 단계 공개**(약 25줄 × 4): `INITIAL_VISIBLE=10`/`REVEAL_STEP=10` 로컬 상수 4중 선언, `visibleCount`·`pendingFocusIndex`·`useLayoutEffect` 재포커스.
- **렌더 골격**(약 35줄 × 8): 트리거 버튼→live `<p>`→패널 div→`<h3 ref tabIndex={-1}>`→닫기→목록→source — 클래스명까지 문자 동일.

추출 가능 표면 약 1,100줄(40%). 이 층의 단위 테스트는 **0건**이다(인접 계층 — `nearby-panel-store`·`geolocation`·`out-of-coverage`·라우트 16종 — 은 촘촘하고, 비어 있는 건 정확히 컴포넌트 상태 머신 한 층).

### 8종 공유 잠복 결함 (이번에 함께 수정)

`close()`가 in-flight fetch를 취소하지도, `inFlightRef`를 리셋하지도 않는다. `engaged`는 locating/loading 중에도 true라 그 시점의 Esc·자동 닫힘(`onDismiss`)이 도달 가능하다: **패널 A 로딩 중 패널 B를 열면 A가 닫히지만, A의 응답이 도착하는 순간 `setStatus(done)`으로 닫힌 A가 다시 열리고 done 이펙트가 A의 h3로 포커스를 이동시켜 방금 연 B에서 포커스를 빼앗는다**(로딩 중 Esc도 동일 경로). 접근성 헌장 §5(포커스 이탈 방지)·§6⑨(이탈 후 도착 결과 폐기) 위반. 복붙이 이 결함을 8곳에 복제했으므로, 훅 추출 = 8곳 동시 수정이다.

## 방향 결정

- **A안 확정(위원장 승인 2026-07-30)**: 계약 테스트 선행 + 5덩어리 전량 추출(셸 포함). 이 마일스톤의 본질은 "검증 불가능한 층을 검증 가능한 층으로 옮기기"이며, 셸까지 가야 신규 nearby 추가 시 골격 복붙이 구조적으로 사라진다(옴니박스의 "신규 서비스는 허브에 한 줄"과 같은 정신). 대안(로직만 추출, 렌더 골격 유지)은 기각 — 문자 동일한 골격 8벌 자체가 드리프트성 접근성 위험이고, 계약 테스트가 마크업을 못 박으면 간접화 위험은 상쇄된다.
- **범위 경계**: 감사 목록(8종)에 없던 `BikeStations`(236줄)는 7개 축 전부 동형이라 **포함**(제외 시 당일부터 드리프트). `LocalConditions`는 트리거·패널·Status 유니언·live가 전부 없는 자동 등장 region 구조라 **제외**(포함하면 추출 계층이 두 세계를 떠안는다). 순 대상 9종.
- **무테스트 리팩토링 금지**: 감사 판정대로 계약 테스트가 선행한다. 컴포넌트 테스트 레인은 신설이 아니라 기존 관례를 쓴다 — `// @vitest-environment jsdom` 파일 프라그마 + `@testing-library/react`(`PlaceDetail.test.tsx`·chat 4종이 선례, 인프라 추가 0).

## 설계

### 1. 계약 테스트 (추출 전에 현재 행동을 못 박는다)

**순환 논증 차단(codex 검토 반영)**: 계약 테스트는 **무수정 현행 컴포넌트**에 대해 작성하고 green 확인 후 별도 커밋한다. 이후 추출 태스크는 이 테스트 파일을 **수정 금지**(유일 예외: §3 잠복 결함의 red→green 전이). 테스트가 구현과 함께 진화하면 "green = 불변"이 순환이 된다.

**형태는 공통 계약 스위트 팩토리 + 도메인 fixture 주입**(9벌 복붙이 새 중복 축이 되는 것을 차단): `src/components/__tests__/nearby-contract.ts`의 `describeNearbyContract({Component, fixture, …})`를 9종 테스트 파일이 호출하고, 도메인 고유 계약(BusArrivals done 침묵+`routeStopsNotice` 승격, WalkInfra 두 소스 독립 강등 합성, WhereAmI done 빈 문자열, "더 보기" 4종)만 개별 테스트로 얹는다.

공통 계약이 못 박는 것:

- 상태 전이: 트리거 클릭 → locating → loading → done(항목 렌더) / empty / error / geoerror(denied·unsupported) / outOfCoverage 각 분기.
- live 문자열: 각 상태의 단일 polite live region 내용. `next-intl` mock은 **키+보간 인자를 직렬화해 반환**(`key{"distance":"350m"}` 형태) — 키 반환만으로는 보간 인자 유실을 못 잡는다. 실제 문구·로케일 정합은 기존 `i18n-messages.test.ts` 게이트 몫(이 마일스톤은 키·인자를 바꾸지 않는다).
- fetch 계약: 상태별 fetch 호출 횟수(busy 중 재클릭 0회 추가, force 새로고침 1회), 요청 URL(쿼리 파라미터 포함).
- 포커스 계약: done 진입 시 결과 헤딩 1회 포커스(재조회 시 재발화 — 신호는 현행대로 done 전이+`focusedRef`), 직접 닫기 → 트리거 복원(rAF), 자동 닫힘(`onDismiss`) → 포커스 무이동.
- "더 보기"(4종): 초기 10건, 클릭당 +10, 첫 새 항목 헤딩 포커스, 재조회 시 10건 리셋.
- 새로고침 실패 복원: force 재취득 실패 시 직전 done 데이터 유지.
- mock 경계: `awaitGeolocation`(`vi.mock`)·전역 `fetch`. `nearby-panel-store`는 실물 사용(모듈 싱글턴, 기존 테스트 관례).

**교차 패널 통합 테스트 1개 추가**(잠복 결함의 실조건 재현): 서로 다른 nearby 2종을 함께 렌더하고 "A 로딩 중 B 트리거 클릭 → B가 점유 획득·A 자동 닫힘 → A의 늦은 응답 도착" 후 B의 열림·포커스가 유지되는지 검증. 이 테스트는 현행 코드에서 **red**여야 한다(§3의 순서 참조).

테스트가 전부 green인 상태(교차 패널 red 제외)가 추출의 베이스라인이다. 셸 추출 후에도 동일 테스트가 통과해야 한다.

### 2. 추출 계층 (값싼 것부터, 각 단계 독립 커밋)

| # | 추출물 | 형태 | 대상 |
|---|---|---|---|
| ① | live 삼항 사다리 → `nearbyLiveMessage(status, {t, tCommon, done})` | 순수 함수 (React 비의존) | 8종 |
| ② | `load`/`fetchAt` 상태 머신 → `useNearbyFetch` | 훅 (`src/hooks/`) | 9종 |
| ③ | 닫기 삼중주 → `useNearbyFetch`에 통합(`close` 반환) | 훅 확장 | 9종 |
| ④ | "더 보기" → `useRevealMore(total)` + 공유 상수 | 훅 | 4종 |
| ⑤ | 렌더 골격 → `<NearbyPanelShell>` | 슬롯 컴포넌트 | 8종 |

`useNearbyFetch`의 파라미터(직교 변이 축, codex 검토로 `fetchAt` 주입·조합 제한·parse 형태 확정):

- **요청 함수 주입(공식 파라미터)**: `fetchAt(coords: {lat, lng}) => Promise<Response>` — URL·쿼리 조립(limit·locale 포함)은 도메인 몫. 훅은 호출·해석·상태만 소유한다.
- **응답 해석**: `parse(body) => {kind:"done"; data:T} | {kind:"empty"}` 순수 함수 주입(외부 setter 호출 금지) — empty 판정 3갈래(배열 length 7종 / `body.data` null WhereAmI / empty 개념 부재 WalkInfra는 항상 done)를 흡수. done 부가 필드(basis·supplementFailed·total 등)는 `T` 안에 담는다.
- **좌표 출처·트리거 — 실존 조합만 discriminated union으로 제한**(임의 조합 금지):
  - `{source:"current"}` — 트리거 버튼 + geolocation 경유 + 패널 스토어 참여(7종 기본).
  - `{source:"place", coords}` — props 좌표 직행, geolocation·`claim`·스토어 생략(BusArrivals·BikeStations의 place 모드 — 좌표는 마운트 수명 동안 불변, `PlaceDetail`이 장소마다 재마운트).
  - `{source:"current", autoLoad:true}` — 마운트 즉시 로드, 트리거·닫기 미렌더, 스토어 미참여(BarrierFree). close 경로가 없으므로 `onClose`도 미호출.
- **coverage**: `korea`(클라 선분기+응답 마커, 기본) / `none`(WalkInfra — 아래 판정 기록).
- **닫기 부수 리셋**: `onClose` 콜백(BarrierFree `openIds`·`detailCache`, BusArrivals `routeStopsNotice`) — 발화 시점은 현행과 동일하게 close 한정.

도메인 고유물은 컴포넌트에 남는다: 항목 렌더(JSX)·`lang="ko"` 부여·부가 공지(basis·supplementFailed)·자식 위임(`BusRouteStops`·`SubwayArrivalList`)·BarrierFree 항목별 상세 fetch.

**`NearbyPanelShell`의 소유권 계약**: 트리거 버튼·**단일 polite live region**·패널 껍데기(h3·닫기·source)를 셸이 단독 소유하고 목록은 children 슬롯. 슬롯으로 들어가는 자식·부가 공지는 **자체 live region 금지**(평문 렌더만) — BusArrivals의 `routeStopsNotice` 승격은 셸의 live 메시지 입력(`liveOverride` 류 prop)으로 표현해 현행 `{live || routeStopsNotice}` 단일 채널을 보존한다. done 헤딩 포커스·트리거 복원도 셸(+훅) 소유이며 컴포넌트가 중복 구현하지 않는다.

### 3. 잠복 결함 수정 (유일한 의도적 행동 변경)

**단조 증가 요청 ID(latest-wins)** — close 한정 epoch는 불충분하다(codex 검토: 같은 epoch 안의 요청 경쟁·잠금 오해제 미해결):

- `load()`가 시작될 때마다, 그리고 `close()`될 때마다 요청 ID를 증가시키고, `load()`는 자기 ID를 캡처한다.
- **검사 2지점**: ① geolocation 완료 후·fetch 시작 전(닫힌 뒤 도착한 위치로 upstream을 호출하지 않는다 — 쿼터·좌표 전송 방지) ② 상태 반영(`setStatus`) 전. 캡처 ID ≠ 현재 ID면 **일체 반영하지 않는다**(done 전이·`prevStatus` 복원·geoerror 포함 전부. fetch abort는 불요 — 반영 차단으로 계약 충족).
- in-flight 잠금도 boolean 대신 ID로: 해제는 자기 ID가 여전히 현재일 때만(이전 요청의 `finally`가 새 요청의 잠금을 풀지 못한다).

회귀 테스트 순서(red→green 분리): 교차 패널 통합 테스트(§1)를 **현행 코드에서 red로 확인하는 커밋** → 훅 도입 태스크에서 수정 → green 커밋. "계약 테스트 선행"과 모순되지 않도록 이 테스트만 예외로 red 상태로 베이스라인에 들어간다.

### 4. 판정 기록 (행동 불변으로 보존하는 것)

- **WalkInfra의 커버리지 계층 부재는 의도된 계약**: 음향신호기 seed는 서울 한정이지만 Overpass(OSM)는 전 지구 데이터라 해외 좌표에서도 조회가 실제로 성립한다(서버 라우트에도 마커 없음 — 9종 중 유일하게 "한국 밖 = 무의미"가 성립하지 않는 도메인). `coverage: "none"`으로 보존하고 커버리지를 새로 박지 않는다.
- **트리거 버튼 `aria-expanded` 부재(8종 공통)는 범위 밖**: 조회형 버튼(펼침이 아니라 결과 로드, done 시 포커스가 결과로 이동)이라 disclosure 시맨틱 부여는 별도 판정 사안. 이번 마일스톤은 현 계약 유지.
- **`claim()`이 `inFlightRef` 가드보다 앞**: 8종 동일 순서 그대로 보존(byte-identical 원칙).
- WalkInfra의 `!res.ok`→body 순서 역전은 훅 통일(body 먼저)로 정렬되지만, 해당 라우트는 마커를 반환하지 않으므로 관측 가능한 행동 차이는 없다.
- **codex 검토 기각 4건(행동 불변 원칙 우선, 재도입 금지)**: ① BikeStations에 서울 서비스 경계 판정 신설 — 현행 "부산 좌표 → 근처 대여소 없음(empty)"은 정직한 응답이고 경계 신설은 신기능(비범위). ② `onClose`를 `onRequestStart`/`onInvalidate`로 확장 — 부수 상태 리셋이 close 한정인 것이 현행 계약이며 확장은 행동 변경. ③ 응답 AbortController — 반영 차단(요청 ID)으로 헌장 계약이 충족되고 현행 컴포넌트도 abort하지 않는다. ④ done 헤딩 포커스 신호를 revision 카운터로 교체 — 현행 `focusedRef`+done 전이 메커니즘을 훅으로 그대로 옮긴다.

### 5. 문서 갱신

- repo `CLAUDE.md` "개발 규칙"의 "node-env Vitest엔 컴포넌트 와이어링 레인 없음" 서술을 정정한다(jsdom 프라그마 레인 관례 명시). 워크스페이스 규칙에 따라 `python sync_agent_docs.py`로 형제 `AGENTS.md` 재생성.
- 추출 후 신규 nearby 추가 관례(훅+셸 사용)를 CLAUDE.md UI·상태 패턴 절에 한 줄로 반영.

## 비범위

- iOS Nearby 11모델 골격 추출(별도 마일스톤 후보), data.go.kr envelope 파서 공용화(동), `LocalConditions` 구조 변경(effect 주도·AbortController 구조라 이번 훅과 생명주기가 다름 — 훅 재사용 여부는 후속 검토로만 남기고 이번엔 무변경), `aria-expanded` 도입 판정, 채팅 카드(`MessageBubble`) 소비 계약 변경(7종을 카드로 재사용하는 현 배선은 무변경 소비자로 유지).

## 성과 (측정 가능)

- 9종 합계 약 2,600줄 → 약 1,700줄(중복 약 1,100줄이 공유 계층 약 200~300줄로 수렴).
- 컴포넌트 상태 머신 계약 테스트: 0건 → 9종 전부(상태 전이·live·포커스·더 보기·늦은 응답 폐기).
- 잠복 결함(닫힌 패널 재열림·포커스 탈취) 8곳 동시 해소 + 회귀 테스트.
- 게이트: `npm run lint`·`npm run test:run`·`npm run build` green, 잠복 결함 수정 외 행동 byte-identical(계약 테스트가 판정).
- a11y 게이트(판정 기준 명시): a11y-auditor가 접근성 헌장 기준으로 셸·훅 최종본을 점검(단일 live region 유지·과잉 ARIA 미유입·포커스 계약). jsdom이 증명 못 하는 낭독 순서는 프로덕션 배포 후 수동 확인 4시나리오 — ① 패널 A 로딩 중 B 열기(포커스 탈취 부재) ② 로딩 중 Esc 후 늦은 응답(재열림 부재) ③ done 재조회(헤딩 재발화) ④ 직접 닫기(트리거 복원).
