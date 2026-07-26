# 내 주변 "더 보기" 단계 공개 V2(둘러보기·아이 놀 곳·무장애 관광지) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** V1(소아 진료, 커밋 df7a751..42c7f33, 실기기 VO 합격 2026-07-27)에서 검증된 "더 보기" 단계 공개 패턴을 둘러보기·아이 놀 곳·무장애 관광지 3개 도메인의 웹·iOS에 복제한다.

**Architecture:** 서버 캡 3종을 50으로 확대(`SERVER_CAP` 통일), 클라이언트는 10건 초기 표시 + "더 보기"마다 +10. **복제 정본은 V1 최종형 코드**: 웹 `src/components/NightClinicsNearby.tsx`(useLayoutEffect 페인트 전 재포커스), iOS `ios/Gildongmu/Nearby/ClinicNearbyView.swift`(ScrollViewReader scrollTo 선행 + AccessibilityFocusState). 초기 표시를 기존 12/8/8이 아니라 10으로 통일하는 이유: 기존 수치는 서버 상한의 우연이지 의도된 표시 수가 아니며, 도메인 간 일관 계약이 이번 작업의 취지.

**Tech Stack:** V1과 동일. **신규 i18n 키·xcstrings 재생성 없음** — `actions.showMore`가 이미 5로케일·앱 카탈로그에 수록됨(V1).

## Global Constraints

- 서버 캡 `SERVER_CAP = 50`(3개 provider 모두 이 이름), 초기 표시 `INITIAL_VISIBLE = 10`, 스텝 `REVEAL_STEP = 10`(iOS는 `initialVisible`/`revealStep`) — V1과 동일 값.
- 버튼 라벨은 수치 없는 `actions.showMore` 재사용. 별도 live region·VO Announcement 추가 금지(포커스 이동한 항목 라벨이 곧 신호).
- 웹 포커스 이동 훅은 **`useLayoutEffect`**(V1 fix 반영 — 마지막 배치 버튼 소멸 이탈 창 제거). iOS는 **`proxy.scrollTo(id, anchor: .top)` 선행 후 `DispatchQueue.main.async` 포커스 대입**(오프스크린 행 AX 컬링 대응) + 행 `.id(place.id)`.
- 채팅 도구 불변 확인: `src/lib/chat/router.ts`가 barrier-free/kids/around를 자체 `slice(0, 8)`/`slice(0, 8)`/`slice(0, 12)`로 절단 — 서버 캡 확대의 영향 없음(`count`는 확대되며 이는 V1 `total`과 같은 개선).
- 터치 타깃 ≥44px(웹 `min-h-11`), UI 라벨 이모지·em dash 금지, 주석·커밋 한국어.
- 커밋은 `git commit -- <의도 경로>` pathspec 모드(`git add -A` 금지, 신규 파일은 직전에 `git add <파일>`을 같은 명령으로 연결), 직후 `git show HEAD --stat` 검증, 이메일 `engccer@gmail.com`, 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. push는 최종 리뷰 후 컨트롤러가.
- 구버전 iOS 바이너리는 50행 무절단 표시 — V1과 동일하게 같은 사이클 실기기 배포로 해소(개인 배포 앱).

---

### Task 1: 서버 캡 3종 50

**Files:**
- Modify: `src/lib/providers/kids-places.ts:22` (`RESULT_CAP` → `SERVER_CAP`)
- Modify: `src/lib/providers/surroundings.ts:17` (`RESULT_CAP` → `SERVER_CAP`)
- Modify: `src/lib/providers/tour-barrier-free.ts:24` (`TOP_N` → `SERVER_CAP`)
- Test: `src/lib/__tests__/kids-places.test.ts`, `src/lib/__tests__/surroundings.test.ts`, `src/lib/__tests__/tour-barrier-free.test.ts`

**Interfaces:**
- Consumes: 각 provider의 기존 진입점 — `findKidsPlacesNear`, `findSurroundingsNear`, `searchBarrierFreeNearby`. 시그니처 전부 불변.
- Produces: 세 진입점이 최대 **50**건 반환(종전 8/12/8). Task 2·3이 이 배열을 받아 10건씩 공개. ⚠ `matchBarrierFreePlace`는 명시 `limit: 10` 호출이라 불변이어야 한다.

- [ ] **Step 1: 상수 교체(3파일 동일 패턴)** — 각 파일에서 상수명·값을 바꾸고 참조를 갱신한다. 주석은 V1 `clinics.ts`의 `SERVER_CAP` 주석과 같은 취지로:

`src/lib/providers/kids-places.ts` (교체 전 `const RESULT_CAP = 8;`):

```ts
/** 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫(V1 소아 진료 동형). */
const SERVER_CAP = 50;
```

같은 파일의 `rankKidsPlaces(lists, RESULT_CAP)` → `rankKidsPlaces(lists, SERVER_CAP)`.

`src/lib/providers/surroundings.ts` (교체 전 `const RESULT_CAP = 12;`):

```ts
/** 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫(V1 소아 진료 동형). */
const SERVER_CAP = 50;
```

같은 파일의 `rankSurroundings(lists, lat, lng, RESULT_CAP)` → `... SERVER_CAP)`.

`src/lib/providers/tour-barrier-free.ts` (교체 전 `const TOP_N = 8;`):

```ts
/** 서버 반환 상한(numOfRows로도 전달) — 표시 절단은 클라이언트 몫(V1 동형). */
const SERVER_CAP = 50;
```

같은 파일의 `const limit = opts.limit ?? TOP_N;` → `const limit = opts.limit ?? SERVER_CAP;`. ⚠ `matchBarrierFreePlace`의 `limit: 10`은 그대로 둔다.

- [ ] **Step 2: 진입점 캡 테스트 추가(도메인별 1개)** — 각 테스트 파일의 **기존 fetch mock 관례를 그대로 따라**(파일 상단 헬퍼·fixture 참조) 진입점이 새 캡을 쓰는지 단언한다. 단언부는 다음과 같이(fixture 생성은 각 파일의 기존 헬퍼 사용, 화이트리스트/카테고리를 통과하는 종류로 60건):

```ts
it("서버 캡 50 — 표시 절단은 클라이언트 몫(V1 동형)", async () => {
  // 60건 fixture를 기존 mock 관례로 주입한 뒤:
  expect(result.length).toBe(50);
});
```

barrier-free는 60건 fixture 대신 **요청 URL의 `numOfRows=50` 단언**으로 대체 가능(둘 중 파일 관례에 맞는 쪽 하나만).

- [ ] **Step 3: 실패 확인 → 구현 순서 준수** — Step 2 테스트를 먼저 쓰고 실패(8/12/8 반환)를 확인한 뒤 Step 1을 적용한다.

- [ ] **Step 4: 전체 게이트**

Run: `npm run test:run`
Expected: PASS (기존 캡 테스트는 rank 함수에 cap을 인자로 넘겨 무영향).

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(nearby): 둘러보기·아이 놀 곳·무장애 서버 캡 50 — 표시 절단을 클라이언트로 이관(V1 동형)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/providers/kids-places.ts src/lib/providers/surroundings.ts src/lib/providers/tour-barrier-free.ts src/lib/__tests__/kids-places.test.ts src/lib/__tests__/surroundings.test.ts src/lib/__tests__/tour-barrier-free.test.ts
```

---

### Task 2: 웹 3 컴포넌트 "더 보기"

**Files:**
- Modify: `src/components/SurroundingsNearby.tsx`, `src/components/KidsPlacesNearby.tsx`, `src/components/BarrierFreeNearby.tsx`
- 참조 정본(수정 금지, 패턴 원본): `src/components/NightClinicsNearby.tsx`

**Interfaces:**
- Consumes: Task 1의 확대 응답(최대 50건), 기존 i18n 키 `actions.showMore`(`tActions("showMore")` — 세 컴포넌트 모두 이미 `tActions` 보유).
- Produces: 없음(말단 UI). BarrierFreeNearby의 `autoLoad`(채팅 카드) 경로에도 같은 동작이 그대로 적용된다(분기 추가 금지).

세 컴포넌트 모두 **동일한 5개 변경**을 적용한다. 각 컴포넌트의 done 상태 배열 이름만 다르다: Surroundings=`status.places`, Kids=`status.kids`, BarrierFree=`status.places`.

- [ ] **Step 1: 상수·상태·ref 추가(각 컴포넌트)** — import에 `useLayoutEffect` 추가. 파일 상단(컴포넌트 밖):

```ts
/** 초기 표시 수·"더 보기" 1회 공개 수 — V1(NightClinicsNearby)과 동일 값 유지. */
const INITIAL_VISIBLE = 10;
const REVEAL_STEP = 10;
```

컴포넌트 안(`focusedRef` 선언 근처):

```ts
const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
/** 공개된 항목 헤딩 참조 — "더 보기" 후 첫 새 항목으로 포커스 이동(헌장 §1). */
const itemHeadingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
const pendingFocusIndex = useRef<number | null>(null);
```

- [ ] **Step 2: fetchAt 성공 분기 리셋(각 컴포넌트)** — `setStatus({ kind: "done", ... })` **직전**에:

```ts
setVisibleCount(INITIAL_VISIBLE);
```

- [ ] **Step 3: 포커스 이동 훅(각 컴포넌트)** — 기존 done-헤딩 `useEffect` 아래에 추가. **`useLayoutEffect`가 정본**(V1 fix: 마지막 배치에서 포커스 쥔 버튼이 같은 커밋에 사라져도 페인트 전에 재포커스되어 이탈 창이 없다):

```ts
// "더 보기"로 공개된 첫 새 항목으로 포커스 이동 — 새 항목의 라벨이 곧 통지라
// 별도 live region은 두지 않는다(중복 낭독). 마지막 배치로 버튼이 같은 커밋에서
// 사라져도 useLayoutEffect는 페인트 전에 실행되어 이탈 창이 없다(V1 동형).
useLayoutEffect(() => {
  const i = pendingFocusIndex.current;
  if (i == null) return;
  pendingFocusIndex.current = null;
  itemHeadingRefs.current[i]?.focus();
}, [visibleCount]);
```

- [ ] **Step 4: 목록 slice + h4 ref(각 컴포넌트)** — map을 표시 분만 순회로 바꾸고 인덱스를 받아 h4에 `tabIndex={-1}`·ref를 단다(기존 h4의 className·lang·joinText 내용은 그대로):

Surroundings: `{status.places.map((p) => (` → `{status.places.slice(0, visibleCount).map((p, i) => (` / Kids: `{status.kids.map((k) => (` → `{status.kids.slice(0, visibleCount).map((k, i) => (` / BarrierFree: `{status.places.map((p) => {` → `{status.places.slice(0, visibleCount).map((p, i) => {`

각 항목 h4에 (예: Surroundings — Kids·BarrierFree도 동일 형태, 기존 속성 유지):

```tsx
<h4
  className="font-medium"
  tabIndex={-1}
  ref={(el) => {
    itemHeadingRefs.current[i] = el;
  }}
>
```

- [ ] **Step 5: "더 보기" 버튼(각 컴포넌트)** — `</ul>` 직후, 출처 `t("source")` 문단 앞에(배열 이름만 컴포넌트별로):

```tsx
{status.places.length > visibleCount && (
  <button
    type="button"
    onClick={() => {
      pendingFocusIndex.current = visibleCount;
      setVisibleCount((v) => v + REVEAL_STEP);
    }}
    className="mt-2 min-h-11 text-sm text-accent underline"
  >
    {tActions("showMore")}
  </button>
)}
```

(Kids는 `status.kids.length`.)

- [ ] **Step 6: 게이트**

Run: `npm run lint && npm run test:run && npm run build`
Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(web): 둘러보기·아이 놀 곳·무장애 목록 더 보기 단계 공개 — V1 패턴 복제

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/components/SurroundingsNearby.tsx src/components/KidsPlacesNearby.tsx src/components/BarrierFreeNearby.tsx
```

---

### Task 3: iOS 3 뷰 "더 보기"

**Files:**
- Modify: `ios/Gildongmu/Nearby/AroundNearbyView.swift`, `ios/Gildongmu/Nearby/KidsNearbyView.swift`, `ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift`
- 참조 정본(수정 금지, 패턴 원본): `ios/Gildongmu/Nearby/ClinicNearbyView.swift`

**Interfaces:**
- Consumes: Task 1의 확대 응답, 기존 xcstrings 키 `actions.showMore`(V1 수록). 세 모델의 요소 타입 id는 전부 `String`(`SurroundingPlace.id`·`KidsPlace.id`·`BarrierFreePlace.id=contentId`).
- Produces: 없음(말단 UI).

세 뷰 모두 ClinicNearbyView 최종형과 동일한 4개 변경. 모델 이름만 다르다(AroundNearbyModel·KidsNearbyModel·BarrierFreeNearbyModel).

- [ ] **Step 1: 모델 확장(각 모델)** — 각 `@Observable` 모델에 추가(클래스명만 치환):

```swift
/// 초기 표시·공개 스텝 — 웹·V1 ClinicNearbyModel과 동일 값 유지.
static let initialVisible = 10
static let revealStep = 10
private(set) var visibleCount = AroundNearbyModel.initialVisible

/// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
func revealMore() -> String? {
    guard case .loaded(let places) = state, visibleCount < places.count else { return nil }
    let firstNewID = places[visibleCount].id
    visibleCount = min(visibleCount + Self.revealStep, places.count)
    return firstNewID
}
```

`load()` 성공 분기의 `state = .loaded(...)` **직전**에 `visibleCount = Self.initialVisible` 한 줄.

- [ ] **Step 2: 뷰 확장(각 뷰)** — 프로퍼티 추가:

```swift
/// "더 보기" 후 첫 새 행으로 VO 커서 이동(V1 포커스 계약 복제).
@AccessibilityFocusState private var focusedPlaceID: String?
```

`List { ... }`를 `ScrollViewReader { proxy in List { ... } }`로 감싸고(기존 `.navigationTitle` 등 모디파이어는 ScrollViewReader 바깥으로 이동 — ClinicNearbyView와 동일 배치), ForEach를 표시 분만 순회로:

```swift
ForEach(places.prefix(model.visibleCount)) { place in
    NavigationLink { ... 기존 그대로 ... } label: { ... 기존 PlaceRow 그대로 ... }
    // 화면 밖 행은 AX 트리에서 컬링되므로 scrollTo로 먼저 가시화 후 포커스(V1 동형).
    .id(place.id)
    .accessibilityFocused($focusedPlaceID, equals: place.id)
}
if places.count > model.visibleCount {
    Button(appLocalized("actions.showMore")) {
        if let id = model.revealMore() {
            proxy.scrollTo(id, anchor: .top)
            DispatchQueue.main.async { focusedPlaceID = id }
        }
    }
}
```

BarrierFreeNearbyView는 "더 보기" 버튼을 ForEach 직후·출처 `Section` **앞**에 둔다(출처는 항상 마지막 행 유지).

- [ ] **Step 3: 검증**

Run: `node ios/scripts/check-xcstrings-keys.mjs` → PASS(`actions.showMore` 기수록).
Run: `xcodebuildmcp` CLI로 시뮬레이터 빌드 성공 확인(세 뷰 컴파일). UI 재실측은 불요(패턴은 V1 실기기 합격본).

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(ios): 둘러보기·아이 놀 곳·무장애 목록 더 보기 단계 공개 — V1 패턴 복제

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Nearby/AroundNearbyView.swift ios/Gildongmu/Nearby/KidsNearbyView.swift ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift
```

---

### Task 4: 최종 리뷰 → push → 실기기 배포 → prod 검증

- [ ] **Step 1: 최종 브랜치 리뷰** — V1 정본과의 패턴 일치(3도메인 × 2플랫폼 드리프트 0)·회귀 중점. a11y 별도 감사는 생략(패턴 자체가 V1 감사+실기기 합격본 — over-review 회피).
- [ ] **Step 2: 리뷰 fix 반영 후 게이트 재통과** → push(Vercel 자동 배포).
- [ ] **Step 3: 실기기 배포** — `ios/deploy-device.sh`.
- [ ] **Step 4: prod 실호출** — 길동 좌표로 `/api/places/around`·`/api/places/kids`·`/api/places/barrier-free` 응답 건수가 종전 캡(12/8/8) 초과 가능함을 확인(데이터가 적은 도메인은 캡 미만이 정상 — 캡 확대 자체는 around로 확인).
- [ ] **Step 5: PROGRESS.md** — 해당 3개 행에 더 보기 V2 한 줄씩 기록, 커밋+push.
