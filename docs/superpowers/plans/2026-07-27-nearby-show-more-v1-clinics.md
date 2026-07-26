# 내 주변 "더 보기" 단계 공개 V1(소아 진료) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 소아 진료 목록의 상위 10 절단을 "더 보기" 버튼으로 단계 공개(+10)하도록 웹·iOS에 동시 도입한다(서버는 상한 50으로 전량 근사 반환, 표시 절단은 클라이언트 몫).

**Architecture:** 서버(`findNightClinicsNow`)가 진료중 우선 정렬 상위 50을 반환하고, 웹·iOS가 각자 10개 초기 표시 + "더 보기"마다 10개 공개한다. 재조회 방식(B안)은 목록 재셔플·SR 대기 문제로 기각(2026-07-27 검토 확정). 포커스 계약: 버튼 누르면 첫 새 항목으로 이동(새 항목 라벨이 곧 통지 — 별도 live region 금지), 마지막 배치로 버튼이 사라져도 포커스는 이미 새 항목에 있어 이탈 없음.

**Tech Stack:** Next.js 16 + React 19(웹), SwiftUI `@AccessibilityFocusState`(iOS), next-intl(웹 i18n 정본) → xcstrings 결정론 변환(iOS).

**V2 예고(이 플랜 범위 아님):** 같은 패턴을 둘러보기(12)·아이 놀 곳(8)·무장애 관광지(8)에 복제한다. 비적용 확정: 지하철역(3)·버스 정류소(5)·따릉이(5)·보행 인프라·랜드마크·채팅 카드(2026-07-27 검토 판정 — 절단 너머 항목이 행동을 바꾸지 않음).

## Global Constraints

- 서버 상한 `SERVER_CAP = 50`, 초기 표시 `10`, 공개 스텝 `10` (웹·iOS 동일 값).
- 버튼 라벨은 수치 없는 "더 보기"(`actions.showMore`) — 불변식 5(위원장 판정 2026-07-26: 절단 수치는 화면 미표기, `total`은 API·채팅에만) 유지.
- 새 항목 공개 시 별도 live region 통지 금지 — 포커스 이동한 항목의 라벨이 곧 신호(헌장 §5).
- i18n 키는 5로케일(ko/en/es/fr/it) 동시 추가 — `i18n-messages.test.ts`가 머지 게이트.
- iOS 문자열은 웹 messages 정본 → `node ios/scripts/messages-to-xcstrings.mjs app` 재생성(수동 편집 금지) + `node ios/scripts/check-xcstrings-keys.mjs` 린터 통과.
- 터치 타깃 ≥44px(웹 `min-h-11`), UI 라벨 이모지·em dash 금지, 주석·커밋 한국어.
- 커밋은 `git commit -- <의도 경로>`(pathspec 모드, `git add -A` 금지), 이메일 `engccer@gmail.com`, 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 채팅 도구는 불변: `router.ts`가 자체 `slice(0, 5)`라 서버 상한 확대의 영향 없음(확인만).
- 구버전 iOS 바이너리는 50행을 절단 없이 표시하게 됨 — 개인 배포 앱이라 같은 사이클의 실기기 배포로 해소(웹 push = 자동 배포, iOS = `ios/deploy-device.sh`).

---

### Task 1: 서버 상한 50 (`clinics.ts`)

**Files:**
- Modify: `src/lib/clinics.ts:40` (TOP_N 상수), `src/lib/clinics.ts:93` (limit 기본값)
- Test: `src/lib/__tests__/clinics.test.ts`

**Interfaces:**
- Consumes: 기존 `findNightClinicsNow(lat, lng, opts)` — 시그니처 불변.
- Produces: `ClinicsNowResult.clinics`가 최대 **50**개(종전 10). `total` 등 나머지 필드 불변. 웹·iOS(Task 2·3)는 이 배열을 받아 클라이언트에서 10개씩 공개한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/__tests__/clinics.test.ts`의 `describe` 블록 끝에 추가:

```ts
it("서버 상한 50 — 표시 절단은 클라이언트 몫, 절단 전 수는 total로 보존", async () => {
  // 3km 내 보완 기관 60곳(전부 진료중) → 50개 반환, total 60.
  mockSupplement.mockResolvedValue(
    Array.from({ length: 60 }, (_, i) =>
      clinic(`소아과${i}`, 0.0001 * (i + 1), { designated: false }),
    ),
  );
  const r = await run();
  expect(r.clinics.length).toBe(50);
  expect(r.total).toBe(60);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/clinics.test.ts -t "서버 상한 50"`
Expected: FAIL — `clinics.length`가 10.

- [ ] **Step 3: 구현** — `src/lib/clinics.ts`에서 상수 교체:

```ts
// 교체 전
const TOP_N = 10;
// 교체 후
/**
 * 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫.
 * 재조회 없이 단계 공개하기 위해 반경 내 전량을 근사로 실어 보낸다(50 초과는
 * 밀집 지역 폭주 방어 — total이 절단 전 수를 계속 보존한다).
 */
const SERVER_CAP = 50;
```

그리고 `const limit = opts.limit ?? TOP_N;` → `const limit = opts.limit ?? SERVER_CAP;`

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS (기존 케이스는 10건 미만 fixture라 무영향).

- [ ] **Step 5: 채팅 무영향 확인(읽기만)** — `src/lib/chat/router.ts:102`가 `clinics.slice(0, 5)`로 자체 절단함을 눈으로 확인(수정 없음).

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(clinics): 서버 반환 상한 10→50 — 표시 절단을 클라이언트 단계 공개로 이관

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/clinics.ts src/lib/__tests__/clinics.test.ts
```

---

### Task 2: i18n 키 + 웹 "더 보기" UI (`NightClinicsNearby.tsx`)

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json` (`actions` 네임스페이스)
- Modify: `src/components/NightClinicsNearby.tsx`

**Interfaces:**
- Consumes: Task 1의 `clinics` 최대 50개 응답. 기존 `tActions = useTranslations("actions")`.
- Produces: i18n 키 `actions.showMore` — Task 3의 iOS(`appLocalized("actions.showMore")`)와 V2의 3개 도메인 컴포넌트가 같은 키를 재사용한다.

- [ ] **Step 1: i18n 키 추가** — 각 로케일 파일의 `"actions"` 객체에 `"close"` 옆으로 추가:

| 파일 | 값 |
|---|---|
| ko.json | `"showMore": "더 보기"` |
| en.json | `"showMore": "Show more"` |
| es.json | `"showMore": "Mostrar más"` |
| fr.json | `"showMore": "Afficher plus"` |
| it.json | `"showMore": "Mostra altri"` |

- [ ] **Step 2: i18n 게이트 통과 확인**

Run: `npx vitest run src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS (5로케일 키 집합 일치).

- [ ] **Step 3: 컴포넌트 구현** — `src/components/NightClinicsNearby.tsx`:

(a) 파일 상단(컴포넌트 밖)에 상수:

```ts
/** 초기 표시 수·"더 보기" 1회 공개 수 — iOS ClinicNearbyModel과 동일 값 유지. */
const INITIAL_VISIBLE = 10;
const REVEAL_STEP = 10;
```

(b) 컴포넌트 안 상태·ref 추가(`focusedRef` 선언 근처):

```ts
const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
/** 공개된 항목 헤딩 참조 — "더 보기" 후 첫 새 항목으로 포커스 이동(헌장 §1). */
const itemHeadingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
const pendingFocusIndex = useRef<number | null>(null);
```

(c) `fetchAt` 성공 분기에서 done 세팅 **직전**에 초기화(재조회 시 공개 수 리셋):

```ts
setVisibleCount(INITIAL_VISIBLE);
```

(d) 포커스 이동 effect(기존 done-헤딩 effect 아래에 추가). rAF가 아니라 useEffect인 이유는 기존 주석과 동일(커밋 이후 실행 보장 — rAF 포커스 레이스 회귀 방지):

```ts
// "더 보기"로 공개된 첫 새 항목으로 포커스 이동 — 새 항목의 라벨이 곧 통지라
// 별도 live region은 두지 않는다(중복 낭독). 버튼이 마지막 배치로 사라져도
// 포커스는 이미 새 항목에 있어 이탈(§5)이 구조적으로 없다.
useEffect(() => {
  const i = pendingFocusIndex.current;
  if (i == null) return;
  pendingFocusIndex.current = null;
  itemHeadingRefs.current[i]?.focus();
}, [visibleCount]);
```

(e) 렌더: `status.clinics.map(...)` → 표시 분만 순회하도록 교체하고 h4에 ref·tabIndex 부여:

```tsx
{status.clinics.slice(0, visibleCount).map((c, i) => {
  const holiday = c.hours[7];
  return (
    <li key={c.id || `${c.name}-${c.distanceMeters}`}>
      <h4
        className="font-medium"
        lang="ko"
        tabIndex={-1}
        ref={(el) => {
          itemHeadingRefs.current[i] = el;
        }}
      >
```

(h4 이하 항목 본문·전화·주소·채팅 버튼 렌더는 기존 그대로 유지.)

(f) `</ul>` 직후, 출처(`t("source")`) 문단 앞에 버튼:

```tsx
{status.clinics.length > visibleCount && (
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

- [ ] **Step 4: 게이트 통과**

Run: `npm run lint && npm run test:run && npm run build`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(web): 소아 진료 목록 더 보기 단계 공개(+10) — 첫 새 항목 포커스 이동

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/components/NightClinicsNearby.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
```

---

### Task 3: iOS "더 보기" (`ClinicNearbyView.swift`) + xcstrings 재생성

**Files:**
- Modify: `ios/Gildongmu/Nearby/ClinicNearbyView.swift`
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings` (스크립트로만)

**Interfaces:**
- Consumes: Task 1의 확대 응답(모델 변경 불필요 — `ClinicNearbyResponse.clinics` 그대로), Task 2의 `actions.showMore` 키.
- Produces: `ClinicNearbyModel.visibleCount: Int`, `ClinicNearbyModel.revealMore() -> String?`(첫 새 항목 id 반환) — V2에서 3개 iOS 뷰가 같은 형태를 복제한다.

- [ ] **Step 1: xcstrings 재생성 + 린터**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 재생성 성공(앱 타깃은 전 네임스페이스 수록이라 `actions.showMore` 자동 포함), 린터는 이 시점엔 참조 없음이라 PASS.

- [ ] **Step 2: 모델 확장** — `ClinicNearbyModel`에 추가:

```swift
/// 초기 표시·공개 스텝 — 웹 INITIAL_VISIBLE/REVEAL_STEP과 동일 값 유지.
static let initialVisible = 10
static let revealStep = 10
private(set) var visibleCount = ClinicNearbyModel.initialVisible

/// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
/// 더 공개할 것이 없으면 nil.
func revealMore() -> String? {
    guard case .loaded(let clinics) = state, visibleCount < clinics.count else { return nil }
    let firstNewID = clinics[visibleCount].id
    visibleCount = min(visibleCount + Self.revealStep, clinics.count)
    return firstNewID
}
```

그리고 `load()` 성공 분기의 `state = .loaded(clinics)` **직전**에 리셋 한 줄:

```swift
visibleCount = Self.initialVisible
```

- [ ] **Step 3: 뷰 확장** — `ClinicNearbyView`:

(a) 프로퍼티 추가:

```swift
/// "더 보기" 후 첫 새 행으로 VO 커서 이동(웹 포커스 계약 미러).
@AccessibilityFocusState private var focusedClinicID: String?
```

(b) `ForEach(clinics)` → 표시 분만 순회 + 행에 포커스 바인딩:

```swift
ForEach(clinics.prefix(model.visibleCount)) { clinic in
    NavigationLink {
        PlaceDetailView(place: nightClinicToPlace(clinic)) {
            ClinicDomainSection(clinic: clinic)
        }
    } label: {
        PlaceRow(
            place: nightClinicToPlace(clinic),
            secondaryOverride: joinText(
                clinic.kind,
                clinicStatusText(clinic.openStatus),
                appLocalized("place.distance", formatDistanceKo(Double(clinic.distanceMeters)))),
            onAskAbout: { chatPlace = nightClinicToPlace(clinic) })
    }
    .accessibilityFocused($focusedClinicID, equals: clinic.id)
}
```

(c) ForEach 아래(같은 List 안, 마지막 행)에 버튼 — 라벨 갱신 재낭독을 피하려 정적 라벨, 새 행 렌더 커밋 뒤 포커스 대입(즉시 대입은 요소 미존재로 no-op 위험):

```swift
if clinics.count > model.visibleCount {
    Button(appLocalized("actions.showMore")) {
        if let id = model.revealMore() {
            DispatchQueue.main.async { focusedClinicID = id }
        }
    }
}
```

- [ ] **Step 4: 린터 재실행 + 시뮬레이터 빌드 확인**

Run: `node ios/scripts/check-xcstrings-keys.mjs` → PASS(`actions.showMore` 참조·수록 일치).
Run: `xcodebuildmcp simulator build-and-run` (xcodebuildmcp-cli 스킬 관용구) 후 소아 진료 탭에서 `ui-automation snapshot-ui`로 "더 보기" 행 존재·탭 후 11번째 행 등장 확인.
Expected: 빌드 성공, 더 보기 탭 시 목록 확장. ⚠ VO 포커스 이동 판정 정본은 실기기(스냅샷은 신호로만).

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(ios): 소아 진료 목록 더 보기 단계 공개 — 첫 새 행 VO 포커스 이동

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Nearby/ClinicNearbyView.swift ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 4: 리뷰 게이트 → push(자동 배포) → 실기기 배포

- [ ] **Step 1: 코드 리뷰** — `code-reviewer` 서브에이전트에 3커밋 diff 검토(포커스 계약·상수 동조·i18n 정합 중점).
- [ ] **Step 2: a11y 점검** — `a11y-auditor` 서브에이전트로 변경분 감사(헌장 기준: 과잉 없음 + §1/§5 포커스 계약).
- [ ] **Step 3: 리뷰 fix 반영 후** `npm run lint && npm run test:run && npm run build` 재통과.
- [ ] **Step 4: push** — `git push` (Vercel 자동 배포). [[gildongmu-auto-commit-push]]에 따라 확인 없이 진행.
- [ ] **Step 5: 실기기 배포** — 기기 연결 시 `ios/deploy-device.sh` 실행(iOS 수정은 커밋+실기기 배포까지가 한 사이클).
- [ ] **Step 6: prod 실호출 확인** — `curl "https://gildongmu.vercel.app/api/clinic/nearby?lat=37.5345&lng=127.1427"`에서 `clinics` 길이가 10 초과(≤50)임을 확인. PROGRESS.md에 검증 로그 1줄 추가.
