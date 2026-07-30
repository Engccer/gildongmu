# 레거시·중복 감사 수정 묶음 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-07-30 4도메인 감사(웹 UI·iOS·lib·라우트/i18n)에서 확정된 결함·레거시를 일괄 해소한다 — 채팅 경로 카드 크래시, SR 직격 결함 4건, 채팅 카드 상세 연결(위원장 결정), 죽은 코드·고아 키 정리, 저위험 중복 제거.

**Architecture:** 기존 패턴 재사용이 원칙이다. 커버리지 선분기는 `NightClinicsNearby.tsx` 정본 순서(body 파싱 → 마커 → `!res.ok`), 위치는 `awaitGeolocation()` 싱글턴, 대안 펼침은 `DirectionsView` disclosure 신계약, 채팅→상세 연결은 repo의 모듈 싱글턴 스토어 패턴(`geolocation.ts` 동형)으로 새 `place-open-request.ts`를 둔다. 새 추상화는 만들지 않는다.

**Tech Stack:** Next.js 16 / React 19 / next-intl / Vitest 4 / SwiftUI + GildongmuKit(SPM)

## Global Constraints

- `src/lib/`는 React/Next 비의존(이 계획의 Task 13이 마지막 위반을 제거한다).
- 접근성 헌장 준수: 단일 polite live region, `disabled` 금지(`aria-disabled`+in-flight ref), 포커스 이동은 `useEffect`(rAF 금지 — `NightClinicsNearby.tsx:164-167` 주석이 정본), 한 줄=한 객체(`joinText`), 3-state(0건 ≠ 정보 없음 ≠ 조회 실패).
- `messages/*.json`을 수정하는 모든 태스크는 6개 로케일(ko·en·es·fr·it·ja)을 함께 수정하고, 커밋 전에 `node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs`를 실행해 재생성된 xcstrings를 같은 커밋에 포함한다(`npm run test:run`의 i18n 게이트가 로케일 정합을 검사).
- 커밋: `git add -A` 금지, 의도 파일만 `git commit -- <경로들>`(pathspec 모드). 커밋 메시지 한국어, 이메일 `engccer@gmail.com`.
- 매 태스크 종료 시 `npm run lint && npm run test:run` 통과(웹 변경 시), iOS 변경 시 `swift test --package-path ios/GildongmuKit` + 앱 빌드 확인.
- em dash 금지, UI 라벨 이모지 금지.
- **이 계획의 의도적 비포함(별도 마일스톤)**: data.go.kr envelope 파서 6벌 공용화, 웹 nearby 8종 중복 추출(계약 테스트 선행 필요), iOS Nearby 11모델 골격 추출.

---

### Task 1: 채팅 경로 카드 2종 — 커버리지 선분기 + 위치 싱글턴 이관

**Files:**
- Modify: `src/components/CarRouteBriefing.tsx`
- Modify: `src/components/TransitRouteBriefing.tsx`

**Interfaces:**
- Consumes: `isOutOfCoverageBody`(`@/lib/out-of-coverage`), `awaitGeolocation`(`@/lib/geolocation`), `isInKorea`(`@/lib/coverage`), 기존 i18n `common.outOfCoverage`
- Produces: 두 컴포넌트의 `Status`에 `{ kind: "outOfCoverage" }` 추가(외부 소비자 없음)

배경: 이 두 컴포넌트만 ① `navigator.geolocation.getCurrentPosition`을 직접 호출(공유 스토어 우회, CLAUDE.md 금지 패턴)하고 ② 커버리지 마커 선분기가 없다. `/api/route/car`는 한국 밖 좌표에 **200** `{outOfCoverage:true}`를 반환하므로 현재 자동차 카드는 `done`으로 진입해 `briefing.taxiFare.toLocaleString()`에서 렌더 크래시, 대중교통 카드는 `!body.result`에 걸려 "경로를 찾지 못했습니다"로 오낭독된다.

- [ ] **Step 1: CarRouteBriefing.tsx 수정**

`Status` union에 `| { kind: "outOfCoverage" }` 추가. `useTranslations("common")`을 `tCommon`으로 추가 바인딩. `requestBriefing`을 아래로 교체(getCurrentPosition 제거, awaitGeolocation + 클라 선분기 + 응답 마커 검사 — body 파싱을 `!res.ok`보다 먼저):

```tsx
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
// ...
const tCommon = useTranslations("common");
const inFlightRef = useRef(false);

function requestBriefing() {
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  setStatus({ kind: "locating" });
  // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
  // 팝업 없이 재사용한다(내 주변 버튼들과 동형, getCurrentPosition 직접 호출 금지).
  void awaitGeolocation().then(async (g) => {
    try {
      if (g.status !== "ready") {
        setStatus({ kind: "error", message: t("geoError") });
        return;
      }
      if (!isInKorea(g.coords.lat, g.coords.lng)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
      setStatus({ kind: "loading" });
      const origin = `${g.coords.lat},${g.coords.lng}`;
      const res = await fetch(
        `/api/route/car?origin=${origin}&dest=${dest.lat},${dest.lng}&lang=${dataLocale(locale)}`,
      );
      const body = await res.json();
      // 커버리지 마커는 200이라 res.ok보다 먼저 검사한다(NightClinicsNearby 정본 순서).
      if (isOutOfCoverageBody(body)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: typeof body.error === "string" ? body.error : t("error"),
        });
        return;
      }
      setStatus({ kind: "done", briefing: body as Briefing });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error", message: t("error") });
    } finally {
      inFlightRef.current = false;
    }
  });
}
```

기존 `if (status.kind === "locating" || status.kind === "loading") return;` 클로저 가드는 in-flight ref로 대체된다(비동기 더블클릭 방어 — 헌장 §5). `liveMessage` 삼항 체인에 분기 추가: `: status.kind === "outOfCoverage" ? tCommon("outOfCoverage")`.

- [ ] **Step 2: TransitRouteBriefing.tsx 동형 수정**

`Status`에 `| { kind: "outOfCoverage" }` 추가, `tCommon` 바인딩 추가. `requestFromCurrent`에서 `navigator.geolocation` 블록 전체를 Step 1과 같은 `awaitGeolocation` 패턴으로 교체(기존 `inFlight` ref 재사용). `fetchRoute`에서 `const body = await res.json();` 직후·`!res.ok` 이전에 `isOutOfCoverageBody(body)` 검사를 삽입해 `{ kind: "outOfCoverage" }` 세팅. `liveMessage` 체인에 `outOfCoverage` 분기 추가.

- [ ] **Step 3: 검증**

Run: `npm run lint && npm run build`
Expected: PASS. `grep -n "getCurrentPosition" src/components/CarRouteBriefing.tsx src/components/TransitRouteBriefing.tsx` → 0건.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(chat): 경로 카드 2종 커버리지 선분기·위치 싱글턴 이관 — 해외 크래시 제거" -- src/components/CarRouteBriefing.tsx src/components/TransitRouteBriefing.tsx
```

---

### Task 2: TransitRouteBriefing — 출발지 미니 검색 제거 + 대안 disclosure 신계약

**Files:**
- Modify: `src/components/TransitRouteBriefing.tsx`
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json`
- Modify (재생성): `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: Task 1 이후의 `TransitRouteBriefing`, 같은 파일의 `TransitRouteResult`(`includeSummary` prop), `joinText`(`@/lib/format`)
- Produces: 없음(내부 UI 계약 변경)

배경(위원장 결정 ③): 채팅 대중교통 카드에만 있는 "출발지 바꾸기" 미니 검색은 길찾기 뷰 `EndpointField`와 겹치는 별도 구현이라 제거하고 진입점 일원화(7-30 결정)의 연장으로 정리한다. 대안 펼침은 구계약(일괄 토글+h4+요약 중복)을 `DirectionsView.tsx:666-701`의 신계약(대안별 `aria-expanded` disclosure, 라벨=요약 전문, 본문 `includeSummary=false`)으로 통일한다.

- [ ] **Step 1: 출발지 미니 검색 제거**

`TransitRouteBriefing.tsx`에서 제거: state `showOriginSearch`·`originQuery`·`originResults`, `originInputId`(useId), 함수 `runOriginSearch`·`selectOrigin`, JSX의 "출발지 바꾸기" 버튼(`:157-164`)과 `showOriginSearch` 블록(`:166-208`). 이제 불필요해진 import(`useId`, `Place`, `PlaceSearchResult`, `dataLocale`은 fetch lang 미사용이므로 유지 여부를 lint가 판정)를 정리한다. 컴포넌트 상단 주석의 "'출발지 바꾸기'로 좌표 지정 가능" 문구 삭제.

- [ ] **Step 2: 대안 펼침을 disclosure 신계약으로 교체**

state `showAlts`를 `const [expandedAlts, setExpandedAlts] = useState<Set<number>>(new Set());`로 교체하고, `fetchRoute` 성공 시 `setShowAlts(false)` 대신 `setExpandedAlts(new Set())`. 대안 렌더 블록(`:239-264`)을 DirectionsView 동형으로 교체:

```tsx
{status.result.alternatives.map((alt, i) => {
  const expanded = expandedAlts.has(i);
  return (
    <div key={i} className="mt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() =>
          setExpandedAlts((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
          })
        }
        className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
      >
        {joinText(
          t("alternativeHeading", { index: i + 1 }),
          t("summary", {
            minutes: alt.summary.totalMinutes,
            fare: alt.summary.fare.toLocaleString(locale),
            transfers: alt.summary.transfers,
          }),
          alt.summary.walkMinutes > 0
            ? t("walkSummary", { minutes: alt.summary.walkMinutes })
            : null,
        )}
      </button>
      {expanded && (
        <TransitRouteResult
          route={alt}
          t={t}
          locale={locale}
          dest={dest.name}
          includeSummary={false}
        />
      )}
    </div>
  );
})}
```

`joinText`를 `@/lib/format`에서 import.

- [ ] **Step 3: i18n 키 정리 (6 로케일)**

`route.transit`에서 삭제: `changeOrigin`, `originLabel`, `originPlaceholder`, `useCurrentLocation`(감사 확인 고아 — `directions.useCurrentLocation`과 별개), `showAlternatives`(disclosure 전환으로 사망). `geoError` 값 교체 — 기존 문구가 제거된 출발지 검색을 안내하므로: ko `"현재 위치를 확인할 수 없습니다. 위치 권한을 확인해 주세요."`, en `"Couldn't determine your current location. Please check location permission."`, es `"No se pudo determinar tu ubicación actual. Revisa el permiso de ubicación."`, fr `"Impossible de déterminer votre position actuelle. Vérifiez l'autorisation de localisation."`, it `"Impossibile determinare la posizione attuale. Controlla l'autorizzazione alla localizzazione."`, ja `"現在地を確認できません。位置情報の許可を確認してください。"`.

검증: `grep -rn "changeOrigin\|originLabel\|originPlaceholder\|route.transit.useCurrentLocation\|showAlternatives" src ios/Gildongmu ios/GildongmuKit/Sources packages` → 0건(문자열 참조 포함).

- [ ] **Step 4: xcstrings 재생성 + 게이트**

Run: `node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs && npm run lint && npm run test:run`
Expected: 전부 PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(chat): 대중교통 카드 출발지 미니 검색 제거·대안 disclosure 신계약 통일" -- src/components/TransitRouteBriefing.tsx messages ios/Gildongmu/Resources/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings
```

---

### Task 3: 채팅 진행 통지 라벨 보강 (웹 + iOS)

**Files:**
- Modify: `messages/*.json` 6개 (`chat.progress.tool`)
- Modify: `ios/Gildongmu/Chat/ChatModel.swift:144-163`
- Modify (재생성): xcstrings 2개

배경: 도구 18종 중 `get_nearby_barrier_free`·`get_walk_infrastructure` 라벨이 없어 SR이 i18n 키 경로 원문을 낭독한다(`ChatInterface.tsx:70` 주석의 인지된 부채). iOS `toolLabel` switch에는 위 2종 + `get_walk_route`(ko.json엔 있음)까지 3종이 빠져 영문 도구명이 낭독된다. `agent-loop.ts:56`의 `"unknown"` 폴백 키도 없다.

- [ ] **Step 1: 6 로케일 `chat.progress.tool`에 3키 추가**

| 키 | ko | en | es | fr | it | ja |
|---|---|---|---|---|---|---|
| `get_nearby_barrier_free` | 무장애 관광지 | Barrier-free places | Lugares accesibles | Lieux accessibles | Luoghi accessibili | バリアフリー観光地 |
| `get_walk_infrastructure` | 보행 인프라 | Walking infrastructure | Infraestructura peatonal | Infrastructures piétonnes | Infrastrutture pedonali | 歩行インフラ |
| `unknown` | 정보 | Information | Información | Informations | Informazioni | 情報 |

- [ ] **Step 2: iOS `toolLabel` switch에 case 3개 추가**

`case "get_car_route":` 줄 앞뒤 아무 곳에(웹 키 순서와 일치 권장):

```swift
case "get_nearby_barrier_free": appLocalized("chat.progress.tool.get_nearby_barrier_free")
case "get_walk_infrastructure": appLocalized("chat.progress.tool.get_walk_infrastructure")
case "get_walk_route": appLocalized("chat.progress.tool.get_walk_route")
```

`default: category`는 유지(미지 도구 원문 폴백 — 새 도구 추가 시 안전망).

- [ ] **Step 3: `ChatInterface.tsx:70` 주석 갱신** — "Task 6에서 채움" 문구를 "18개 도구 전 라벨 보유 — 새 도구 추가 시 `chat.progress.tool.<name>` 6로케일 동반 추가"로 교체.

- [ ] **Step 4: 재생성 + 게이트 + 커밋**

Run: `node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs && npm run test:run`

```bash
git commit -m "fix(a11y): 채팅 진행 통지 도구 라벨 3종 보강 — 키 원문 낭독 제거(웹·iOS)" -- messages ios/Gildongmu/Chat/ChatModel.swift src/components/chat/ChatInterface.tsx ios/Gildongmu/Resources/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings
```

---

### Task 4: 주소 검색 실패 통지 연결 (3-state 복구)

**Files:**
- Modify: `src/lib/search-sections.ts` (`combinedLiveMessage`)
- Modify: `src/components/PlaceSearch.tsx` (호출부 2곳)
- Test: `src/lib/__tests__/search-sections.test.ts` (기존 파일 확장)

**Interfaces:**
- Produces: `combinedLiveMessage` 입력에 `addrErrored: boolean` 추가(기존 호출부는 이 계획 안에서 전부 갱신)

배경: `performAddressSearch` 실패가 `addrStatus: error`로 남지만 `combinedLiveMessage`가 그 입력을 받지 않아, "장소 0건+주소 실패"가 **"결과 없음"으로 낭독**된다(3-state 위반). 문구 `search.addressError`는 6로케일에 이미 존재하므로 연결만 한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`search-sections.test.ts`에 추가)

```ts
it("주소 조회 실패는 '결과 없음'과 구분해 통지한다", () => {
  expect(
    combinedLiveMessage({
      loading: false, placeCount: 0, addrCount: null, webCount: null,
      spokenQuery: null, placeErrored: false, addrErrored: true,
    }),
  ).toEqual([{ key: "search.addressError" }]);
});
it("장소 결과가 있어도 주소 실패는 뒤에 덧붙인다", () => {
  expect(
    combinedLiveMessage({
      loading: false, placeCount: 3, addrCount: null, webCount: null,
      spokenQuery: null, placeErrored: false, addrErrored: true,
    }),
  ).toEqual([
    { key: "search.placeCount", values: { count: 3 } },
    { key: "search.addressError" },
  ]);
});
it("장소 에러가 주소 에러보다 우선한다", () => {
  expect(
    combinedLiveMessage({
      loading: false, placeCount: null, addrCount: null, webCount: null,
      spokenQuery: null, placeErrored: true, addrErrored: true,
    }),
  ).toEqual([{ key: "search.error" }]);
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- search-sections` → 새 테스트 FAIL(타입 에러 포함).

- [ ] **Step 3: 구현**

`combinedLiveMessage` 입력 타입에 `addrErrored?: boolean` 추가(기본 false 취급), idle 판정에 `&& !addrErrored` 추가, parts 조립 후:

```ts
if (addrErrored) parts.push({ key: "search.addressError" });
if (parts.length > 0) return parts;
if (placeErrored) return [{ key: "search.error" }];
if (addrErrored) return [{ key: "search.addressError" }];
return [{ key: "search.noResults" }];
```

(주의: `addrErrored`만 있고 parts가 0일 땐 위 push로 이미 parts에 들어가므로 마지막 `if (addrErrored)`엔 도달하지 않는다 — 도달 불가 분기를 만들지 말고 push 방식 하나로 통일: parts push 뒤 `placeErrored && parts.length === 1 && parts[0].key === "search.addressError"` 같은 복잡화 금지. 최종 형태는 테스트 3건을 모두 만족하는 최소 구현으로 — placeErrored가 참이고 카운트 parts가 0이면 addressError push를 생략하고 `search.error` 단독 반환.)

`PlaceSearch.tsx` 호출부 2곳(`liveParts`·`headingParts`)에 `addrErrored: addrStatus.kind === "error"` 전달(heading 쪽은 로딩 아님 시점이므로 그대로).

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm run test:run -- search-sections && npm run lint`

```bash
git commit -m "fix(a11y): 주소 검색 실패를 '결과 없음'과 분리 통지 — 3-state 복구" -- src/lib/search-sections.ts src/components/PlaceSearch.tsx src/lib/__tests__/search-sections.test.ts
```

---

### Task 5: 채팅 카드 → 장소 상세 연결 (위원장 결정 ②)

**Files:**
- Create: `src/lib/place-open-request.ts`
- Test: `src/lib/__tests__/place-open-request.test.ts`
- Modify: `src/components/PlaceSearch.tsx`, `src/components/chat/MessageBubble.tsx`

**Interfaces:**
- Produces: `requestOpenPlace(place: Place): void`, `subscribeOpenPlace(listener: (place: Place) => void): () => void` — 모듈 싱글턴(`geolocation.ts` 동형, React/Next 비의존)
- Consumes: `jusoAddressToPlace`(`@/lib/address-to-place`), `dataLocale`, `Place`/`JusoAddress`/`AddressMatch` 타입

배경: 채팅 장소·주소 카드가 버튼으로 낭독되지만 `onOpenPlace` 미주입으로 무동작이다. ChatOverlay 마운트점이 5곳(PlaceDetail + nearby 3종 + WhereAmI)이라 콜백 스레딩 대신 모듈 싱글턴 이벤트로 PlaceSearch에 전달한다. 상세 위 상세 스택은 만들지 않는다: 이미 상세가 열려 있으면 **같은 히스토리 엔트리에서 교체**(뒤로가기=결과 복귀, 기존 `onPop` 불변식 유지), 홈(idle)에서 열리면 기존 `openDetail` 경로.

- [ ] **Step 1: 스토어 + 실패하는 테스트**

`src/lib/place-open-request.ts`:

```ts
import type { Place } from "./types";

/**
 * 채팅 카드 → 장소 상세 진입 요청 브릿지(모듈 싱글턴, React/Next 비의존).
 * ChatOverlay 마운트점이 여러 곳이라 콜백 스레딩 대신 이벤트로 PlaceSearch에
 * 전달한다(geolocation.ts 공유 스토어와 동형 패턴). 구독자(PlaceSearch)가
 * 없으면 no-op — 카드 쪽은 발행만 책임진다.
 */
type Listener = (place: Place) => void;
const listeners = new Set<Listener>();

export function subscribeOpenPlace(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOpenPlace(place: Place): void {
  for (const l of listeners) l(place);
}

/** 테스트 전용 — 구독자 초기화. */
export function __resetOpenPlaceForTest(): void {
  listeners.clear();
}
```

테스트(`place-open-request.test.ts`): 구독 후 발행 시 place 전달, unsubscribe 후 미호출, 구독자 0에서 발행해도 throw 없음 — 3케이스.

- [ ] **Step 2: 테스트 통과 확인** — `npm run test:run -- place-open-request`

- [ ] **Step 3: PlaceSearch 구독**

`PlaceSearch`에 effect 추가(popstate effect 근처):

```tsx
import { subscribeOpenPlace } from "@/lib/place-open-request";
// ...
// 채팅 카드의 장소 열기 요청. 상세가 이미 열려 있으면 같은 히스토리 엔트리에서
// 교체(뒤로가기=결과 복귀 불변식 유지 — 상세 위 상세 스택은 비목표), 아니면
// 기존 openDetail(pushState). selectedRef로 최신값을 읽는다(마운트 1회 등록).
const selectedRef = useRef(selected);
useEffect(() => {
  selectedRef.current = selected;
}, [selected]);
useEffect(() => {
  return subscribeOpenPlace((place) => {
    setDirections(null);
    if (selectedRef.current) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), place: place.id },
        "",
      );
      setSelected(place);
    } else {
      openDetail(place);
    }
  });
}, []);
```

상세 렌더에 `key` 부여 — 같은 인스턴스 재사용 시 내부 `chatOpen` 상태가 남아 새 장소 위에 옛 채팅이 떠 있는 것을 막는다: `<PlaceDetail key={selected.id} ...>` (PlaceDetail의 헤딩 포커스 effect는 `[place.id]` 의존이라 key 없이도 동작하지만, key가 chatOpen 리셋까지 보장한다).

- [ ] **Step 4: MessageBubble 배선**

`MessageBubble.tsx`: `requestOpenPlace` import. `RenderBlock`의 places 분기를 `onOpen={onOpenPlace ?? requestOpenPlace}`로, addresses 분기는 새 내부 컴포넌트로 교체:

```tsx
case "addresses":
  return <ChatAddressResults addresses={render.results} />;
```

같은 파일 하단에 추가(좌표 지오코딩은 PlaceSearch `onSelectAddress` 동형 — in-flight ref + 실패는 카드 내 status 텍스트로 통지, 채팅엔 검색 live region이 없으므로 카드 지역 통지가 단일 채널):

```tsx
function ChatAddressResults({ addresses }: { addresses: JusoAddress[] }) {
  const t = useTranslations("search");
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  const resolvingRef = useRef(false);
  async function onSelect(addr: JusoAddress) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setFailed(false);
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(target)}&limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: AddressMatch[] };
      const coord = data.matches[0];
      if (!coord) {
        setFailed(true);
        return;
      }
      requestOpenPlace(
        jusoAddressToPlace(addr, { lat: coord.lat, lng: coord.lng }, dataLocale(locale)),
      );
    } catch {
      setFailed(true);
    } finally {
      resolvingRef.current = false;
    }
  }
  return (
    <>
      <AddressResultList addresses={addresses} onSelect={onSelect} />
      <p aria-live="polite" role="status" className="min-h-5 text-sm">
        {failed ? t("addressCoordFailed") : ""}
      </p>
    </>
  );
}
```

필요 import: `useRef`/`useState`(react), `useLocale`/`useTranslations`(next-intl), `JusoAddress`/`AddressMatch`(types), `jusoAddressToPlace`, `dataLocale`, `requestOpenPlace`. 컴포넌트 doc 주석의 "V1 채팅은 비목표 → 후속 Task 연결 예정"·"no-op" 문구를 현재 계약("카드 탭 = 상세 진입, 발행은 place-open-request 브릿지")으로 갱신. `onOpenPlace` prop은 유지(명시 주입 시 우선) — 단 주석에서 "미주입 시 no-op"을 "미주입 시 requestOpenPlace"로 교체.

- [ ] **Step 5: 검증 + 커밋**

Run: `npm run lint && npm run test:run && npm run build`
수동 확인(dev): 상세→채팅→장소 카드 탭 → 새 상세로 교체·포커스가 새 상세 제목, 뒤로가기 → 검색 결과. 홈 idle→소아진료→채팅→카드 탭 → 상세 진입.

```bash
git commit -m "feat(chat): 장소·주소 카드 탭으로 상세 진입 연결 — 무동작 버튼 해소" -- src/lib/place-open-request.ts src/lib/__tests__/place-open-request.test.ts src/components/PlaceSearch.tsx src/components/chat/MessageBubble.tsx
```

---

### Task 6: BusRouteStops — live region 승격·헤딩 레벨·rAF 정리

**Files:**
- Modify: `src/components/BusRouteStops.tsx`, `src/components/BusArrivals.tsx`

**Interfaces:**
- Produces: `BusRouteStops` props에 `onNotice: (message: string) => void` 추가(필수 — 유일 호출부 BusArrivals가 전달)

배경: 도착 행마다 `BusRouteStops`가 마운트되어 `aria-live` region이 정류소×노선 수만큼 생긴다(단일 polite 채널 붕괴). 헤딩 `h4`가 정류소명 `h4`와 같은 레벨로 납작하고, done 포커스가 rAF(repo가 배제한 패턴)다.

- [ ] **Step 1: BusRouteStops 수정**

- props에 `onNotice: (message: string) => void` 추가.
- 자체 live `<p aria-live="polite" role="status">` 제거. `live` 파생값 대신 상태 전이 지점에서 직접 통지: `load()` 시작 시 `onNotice(t("routeStopsLoading"))`, empty 시 `onNotice(t("routeStopsEmpty"))`, error 시 `onNotice(t("routeStopsError"))`, done 시 `onNotice("")`(헤딩 포커스가 통지 역할), `close()` 시 `onNotice("")`.
- done 헤딩 `h4` → `h5`(정류소명 h4의 하위), rAF 포커스 → `useEffect`+`focusedRef` 패턴(NightClinicsNearby `:168-177` 동형):

```tsx
const focusedRef = useRef(false);
useEffect(() => {
  if (status.kind === "done") {
    if (!focusedRef.current) {
      focusedRef.current = true;
      headingRef.current?.focus();
    }
  } else {
    focusedRef.current = false;
  }
}, [status.kind]);
```

`load()` 안의 `requestAnimationFrame(() => headingRef.current?.focus())` 삭제. `close()`의 트리거 복귀 rAF는 유지(포커스를 쥔 요소가 사라지는 전이 — 기존 관례).

- [ ] **Step 2: BusArrivals 수정**

`const [routeStopsNotice, setRouteStopsNotice] = useState("");` 추가. 기존 단일 live region 내용을 `{live || routeStopsNotice}`로. 새 조회 시작(`load`)에서 `setRouteStopsNotice("")` 리셋. `<BusRouteStops ... onNotice={setRouteStopsNotice} />` 전달.

- [ ] **Step 3: 검증 + 커밋**

Run: `npm run lint && npm run build`. `grep -c "aria-live" src/components/BusRouteStops.tsx` → 0.

```bash
git commit -m "fix(a11y): 경유정류소 통지를 BusArrivals 단일 live region으로 승격, h5·useEffect 포커스" -- src/components/BusRouteStops.tsx src/components/BusArrivals.tsx
```

---

### Task 7: WhereAmI — 조회 완료 통지 추가

**Files:**
- Modify: `src/components/WhereAmI.tsx:139-154`

- [ ] **Step 1:** `live` 삼항 체인의 `outOfCoverage` 분기 뒤에 done 분기 추가: `: status.kind === "done" ? t("ready") : ""` (키 `whereAmI.ready` 기존재 — 형제 nearby 8종과 동형).
- [ ] **Step 2:** `npm run lint` 후 커밋:

```bash
git commit -m "fix(a11y): 현재 위치 정위 완료를 live region에 통지 — 형제 nearby와 정합" -- src/components/WhereAmI.tsx
```

---

### Task 8: 웹 lib 죽은 코드 일괄 정리

**Files:**
- Modify: `src/lib/providers/night-clinic.ts`, `src/lib/__tests__/night-clinic.test.ts`, `src/lib/chat/declarations.ts`, `src/lib/deeplink-kakao.ts`, `src/lib/__tests__/kakao.test.ts`(경로는 grep로 확정), `src/components/BarrierFreeInfo.tsx`, `src/components/PlaceDetail.tsx`, `src/components/RouteLinks.tsx`, `src/lib/providers/tago-bus.ts`, `src/lib/providers/kakao-local.ts`, `src/lib/providers/tago-subway.ts`, `src/lib/beacon.ts`, `src/lib/recent-searches.ts`

각 항목은 감사에서 프로덕션 참조 0을 확인했다. 삭제 전 각 심볼을 `grep -rn "<심볼>" src packages scripts ios`로 재확인(0건 또는 테스트 전용이어야 함)하고, 남기는 쪽엔 근거 주석을 단다.

- [ ] **Step 1: `findNightClinicsNear` 제거** — `night-clinic.ts:209-218` 함수와 `night-clinic.test.ts`의 해당 테스트 블록(`:185` 부근, describe 단위) 삭제. 파일 끝 이설 주석(`:284-287`)은 유지(현재 계약 설명).
- [ ] **Step 2: `ALL_DECLARATIONS` 제거** — `declarations.ts:314-317` 삭제(`availableDeclarations`만 남김).
- [ ] **Step 3: `buildKakaoLookDeeplink` 제거** — `deeplink-kakao.ts:60-66` + 해당 테스트 삭제. 남는 `buildKakaoRouteDeeplink`·`buildKakaoPlaceDeeplink` doc 주석에 한 줄 추가: `⚠ 웹 미사용·iOS GildongmuKit Deeplink.swift 미러의 원본 — 죽은 코드 아님(제거 금지).`
- [ ] **Step 4: `canShow` prop 제거** — `BarrierFreeInfo.tsx`에서 prop 선언·`if (!canShow) return;`·의존성 배열 항목 제거, `PlaceDetail.tsx:228`에서 `canShow={canShowBarrierFree}` 제거(게이트는 호출부 `{canShowBarrierFree && ...}` 단일 책임).
- [ ] **Step 5: `RouteLinks.tsx:22-23` 이관 경위 주석 삭제**(아티팩트-메타 분리 규칙).
- [ ] **Step 6: 불필요 export 축소** — `tago-bus.ts:7`의 `export { haversineMeters } from "../geo"` 재수출 삭제(내부 사용은 import 유지), `kakao-local.ts:17` `ENDPOINT`·`tago-subway.ts:29-30` `BASE`/`PAGE_SIZE`·`beacon.ts:55-58` 튜닝 상수 4개·`recent-searches.ts:106` `sameEndpoint`의 `export` 키워드만 제거(각각 파일 밖 참조 0 재확인 후).
- [ ] **Step 7: 검증 + 커밋**

Run: `npm run lint && npm run test:run && npm run build`

```bash
git commit -m "chore: 감사 확정 죽은 코드 일괄 제거 — 레거시 진입점·미참조 export·죽은 prop" -- src/lib/providers/night-clinic.ts src/lib/__tests__ src/lib/chat/declarations.ts src/lib/deeplink-kakao.ts src/components/BarrierFreeInfo.tsx src/components/PlaceDetail.tsx src/components/RouteLinks.tsx src/lib/providers/tago-bus.ts src/lib/providers/kakao-local.ts src/lib/providers/tago-subway.ts src/lib/beacon.ts src/lib/recent-searches.ts
```

---

### Task 9: env 게이트 정합 (STT·TTS 키)

**Files:**
- Modify: `src/lib/env.ts`, `src/app/api/speech-to-text/route.ts`, `src/lib/tts/chirp.ts`, `CLAUDE.md`(키 표)

- [ ] **Step 1:** `env.ts` 스키마·parse에 `GOOGLE_CLOUD_TTS_API_KEY: z.string().min(1).optional(),` 추가(주석: `// Google Cloud TTS Chirp 3 HD — /api/tts 서버 합성. 미설정 시 502 → 클라 온디바이스 낭독 폴백(문서화된 경로라 게이트 함수 없음).`). 게이트 함수는 만들지 않는다(소비자 없음 — YAGNI).
- [ ] **Step 2:** `chirp.ts:92`를 `env.GOOGLE_CLOUD_TTS_API_KEY` 경유로 교체(`import { env } from "@/lib/env"` — 상대경로면 `../env`).
- [ ] **Step 3:** `speech-to-text/route.ts:48`을 `env.DEEPGRAM_API_KEY` 경유로 교체하고 상단에서 `hasDeepgramKey()`로 게이트(미설정 시 기존과 동일한 500 응답 유지 — 죽은 게이트 함수 부활).
- [ ] **Step 4:** `CLAUDE.md` API 키 표에 행 추가: `| GOOGLE_CLOUD_TTS_API_KEY | — (미설정=502→온디바이스 폴백) | iOS TtsPlayer 서버 낭독(Chirp 3 HD). 게이트 함수 없음 |`
- [ ] **Step 5:** `npm run lint && npm run test:run` 후 커밋:

```bash
git commit -m "refactor(env): STT·TTS 키를 zod env 계층으로 일원화 — 게이트 우회 제거" -- src/lib/env.ts src/app/api/speech-to-text/route.ts src/lib/tts/chirp.ts CLAUDE.md
```

---

### Task 10: 채팅 오류 코드 분기 (useChat)

**Files:**
- Modify: `src/hooks/useChat.ts:78`, `messages/*.json` 6개(`chat.error.rate_limited` 신설)
- Modify (재생성): xcstrings

배경: 라우트는 429 `rate_limited`·502 `chat_unavailable`을 구분해 내는데 클라이언트가 전부 `chat_failed`로 축약해 `chat.error.chat_unavailable`이 도달 불가다. 3-state 성향대로 본문 코드를 읽어 분기한다.

- [ ] **Step 1:** `useChat.ts:78`을 교체:

```ts
if (!res.ok || !res.body) {
  // 라우트가 내는 코드(rate_limited·chat_unavailable)를 읽어 분기 — 전부
  // chat_failed로 뭉개면 레이트리밋과 키 미설정이 일반 실패로 오낭독된다.
  let code = "chat_failed";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error === "rate_limited" || body.error === "chat_unavailable") {
      code = body.error;
    }
  } catch {
    // 본문 없음/비JSON — 일반 실패 유지
  }
  setError(code);
  return;
}
```

- [ ] **Step 2:** 6로케일 `chat.error`에 `rate_limited` 추가: ko `"요청이 많습니다. 잠시 후 다시 시도해 주세요."`, en `"Too many requests. Please try again shortly."`, es `"Demasiadas solicitudes. Inténtalo de nuevo en un momento."`, fr `"Trop de requêtes. Veuillez réessayer dans un instant."`, it `"Troppe richieste. Riprova tra poco."`, ja `"リクエストが多すぎます。しばらくしてからもう一度お試しください。"`.
- [ ] **Step 3:** 재생성 + 게이트 + 커밋:

```bash
node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs && npm run test:run
git commit -m "fix(chat): 오류 코드 분기 — 레이트리밋·키 미설정을 일반 실패와 구분 통지" -- src/hooks/useChat.ts messages ios/Gildongmu/Resources/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings
```

---

### Task 11: 고아 i18n 키 삭제

**Files:**
- Modify: `messages/*.json` 6개, xcstrings 재생성

- [ ] **Step 1:** 6로케일에서 삭제: `search.addressSearching`(합산 단일 통지로 대체된 잔재), `place.callAction`(위원장 결정 ① — 전화 링크는 현행 유지). ⚠ `search.addressError`는 Task 4가 연결했으므로 **삭제 금지**.
- [ ] **Step 2:** 참조 0 재확인: `grep -rn "addressSearching\|place.callAction\|callAction" src packages ios --include="*.ts" --include="*.tsx" --include="*.swift"` — `clinicNearby.callAction` 사용(`NightClinicsNearby.tsx`의 `t("callAction")`, `clinicNearby` 바인딩)만 남아야 정상.
- [ ] **Step 3:** 재생성 + 게이트 + 커밋:

```bash
node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs && npm run test:run
git commit -m "chore(i18n): 고아 키 2종 삭제(6로케일) — addressSearching·place.callAction" -- messages ios/Gildongmu/Resources/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings
```

---

### Task 12: 레거시 의존성 3종 제거

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1:** `npm uninstall react-naver-maps @types/navermaps @types/proj4` (앞 2종은 초기 부트스트랩 잔재·코드 참조 0, `@types/proj4`는 knip 판정 — proj4 본체는 유지).
- [ ] **Step 2:** `npm run build && npm run test:run` — `@types/proj4` 제거로 `air-quality.ts`에 타입 에러가 나면 `@types/proj4`만 되돌린다(계획 밖 코드 수정 금지).
- [ ] **Step 3:** 커밋:

```bash
git commit -m "chore(deps): 부트스트랩 잔재 의존성 제거 — react-naver-maps·types 2종" -- package.json package-lock.json
```

---

### Task 13: `src/lib` Next 의존 제거 (walk-infra 캐시 주입)

**Files:**
- Modify: `src/lib/walk-infra.ts`, `src/app/api/walk/nearby/route.ts`, `src/app/api/chat/route.ts`
- Test: `src/lib/__tests__/walk-infra.test.ts`(기존 — 캐시 주입 반영)

**Interfaces:**
- Produces: `walk-infra.ts`에 `export type TileCacheWrapper = (fetcher: () => Promise<RawWalkFeature[]>, key: string) => Promise<RawWalkFeature[]>;`와 `export function configureWalkInfraTileCache(wrapper: TileCacheWrapper): void`
- 기본값(미구성): 캐시 없이 직접 fetch(기존 single-flight·예산 로직은 그대로 유지)

배경: `walk-infra.ts:1`의 `unstable_cache`가 `src/lib` 전체의 유일한 Next 하드 의존(이식성 항구 규칙 위반). 캐시 래퍼를 Next 쪽(라우트)에서 주입한다.

- [ ] **Step 1:** `walk-infra.ts`에서 `import { unstable_cache } from "next/cache"` 삭제. 모듈 상태에 `let tileCache: TileCacheWrapper | null = null;` 추가, `configureWalkInfraTileCache`(멱등 — 재호출 시 덮어씀)와 타입 export. `cachedFetchTile`을 교체:

```ts
function cachedFetchTile(anchorLat: number, anchorLng: number, cacheKey: string): Promise<RawWalkFeature[]> {
  const fetcher = () => fetchWalkFeaturesTile(anchorLat, anchorLng, TILE_RADIUS_METERS);
  // Next 런타임이 주입한 지속 캐시(unstable_cache)가 있으면 사용, 없으면 직접
  // fetch(단발 스크립트·비-Next 이식 환경). single-flight·전역 예산은 별도 유지.
  return tileCache ? tileCache(fetcher, cacheKey) : fetcher();
}
```

`__resetWalkInfraForTest`에 `tileCache = null;` 추가. `CACHE_REVALIDATE_SECONDS` 상수는 라우트로 이동(아래).

- [ ] **Step 2:** 두 소비 라우트(`/api/walk/nearby/route.ts`, `/api/chat/route.ts`) 모듈 상단에 주입 3줄 추가:

```ts
import { unstable_cache } from "next/cache";
import { configureWalkInfraTileCache } from "@/lib/walk-infra";
// Overpass 타일 1시간 지속 캐시 주입 — walk-infra는 Next 비의존 유지(이식성 규칙).
configureWalkInfraTileCache((fetcher, key) =>
  unstable_cache(fetcher, [key], { revalidate: 3600 })(),
);
```

- [ ] **Step 3:** 기존 `walk-infra.test.ts`가 next/cache mock에 의존하면 주입 API로 교체(미구성 기본 경로 + 주입 경로 각 1케이스).
- [ ] **Step 4:** 검증: `grep -rn "from \"react\|from \"next" src/lib` → **0건**. `npm run test:run && npm run build`.
- [ ] **Step 5:** 커밋:

```bash
git commit -m "refactor(lib): walk-infra 캐시를 라우트 주입으로 전환 — src/lib Next 의존 0 달성" -- src/lib/walk-infra.ts src/app/api/walk/nearby/route.ts src/app/api/chat/route.ts src/lib/__tests__/walk-infra.test.ts
```

---

### Task 14: 웹 lib 소규모 중복 제거 (haversine·logFallback)

**Files:**
- Modify: `src/lib/geo/bearing.ts`, `src/lib/walk-infra.ts`, `src/lib/providers/audio-signals.ts`, `src/lib/providers/surroundings.ts`, `src/lib/providers/seoul-elevator.ts`, `src/lib/car-route.ts`, `src/lib/walk-route.ts`
- Create: `src/lib/route-fallback-log.ts`

- [ ] **Step 1: haversine 단일화** — `geo/bearing.ts:40-54`의 `haversineMeters` 삭제. 소비자 4곳(`walk-infra.ts`, `providers/audio-signals.ts`, `providers/surroundings.ts`, `providers/seoul-elevator.ts`)의 import를 `"./geo"`/`"../geo"`의 `haversineMeters`로 교체(각 파일의 기존 bearing import는 유지). `bearing.ts`의 `toRad`는 방위 계산용으로 잔존(정상).
- [ ] **Step 2: logFallback 공용화** — `src/lib/route-fallback-log.ts` 신설:

```ts
import { roundCoord } from "./coord-round";
import type { Coord } from "./types";

/**
 * 경로 서비스 폴백 원인 로그 — Vercel 로그로 폴백률·구간을 관측한다(파서 회귀
 * 조기 발견). 좌표는 4자리 반올림(약 ±5.5m, 로그 가독성용).
 */
export function logRouteFallback(
  prefix: string,
  origin: Coord,
  dest: Coord,
  reason: unknown,
): void {
  console.warn(
    prefix,
    roundCoord(origin.lat, 4),
    roundCoord(origin.lng, 4),
    "→",
    roundCoord(dest.lat, 4),
    roundCoord(dest.lng, 4),
    reason,
  );
}
```

`car-route.ts`의 `logFallback` 삭제 → `logRouteFallback("[car-route] Tmap 실패, 카카오모빌리티 폴백:", ...)`, `walk-route.ts` 동형(`"[walk-route] 카카오 실패, Tmap 폴백:"`).

- [ ] **Step 3:** `npm run lint && npm run test:run && npm run build` 후 커밋:

```bash
git commit -m "refactor(lib): haversine 정본 단일화(geo.ts)·경로 폴백 로그 공용화" -- src/lib/geo/bearing.ts src/lib/walk-infra.ts src/lib/providers/audio-signals.ts src/lib/providers/surroundings.ts src/lib/providers/seoul-elevator.ts src/lib/car-route.ts src/lib/walk-route.ts src/lib/route-fallback-log.ts
```

---

### Task 15: iOS 죽은 코드·낡은 미러 정리

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/StationMatch.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/StationModelsTests.swift:152-153`, `ios/GildongmuKit/Sources/GildongmuKit/BarrierFreeService.swift:27-33`, `ios/scripts/messages-to-xcstrings.mjs:41-44`
- Modify (재생성): `ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings`

- [ ] **Step 1: `normalizeStationName` 삭제(함정 제거)** — `StationMatch.swift:19-29` 함수와 `StationModelsTests.swift`의 참조 테스트 2건 삭제. 파일 헤더 주석을 갱신: "역명 매칭은 서버 몫(`StationSections.swift` 참조) — 웹 `station-match.ts`의 확장 정규화(`stripStationDecorations`·`lineHint`)는 iOS에 미러하지 않는다. `isStation` 판정만 웹 미러." (배선 시 웹이 겪은 "역 섹션 전체 사망" 회귀 재현 — 감사 2026-07-30).
- [ ] **Step 2: `BarrierFreeService.detail` 삭제** — 메서드 제거, struct doc 주석에서 detail 언급 제거하고 한 줄 추가: "`/api/places/barrier-free/detail` 라우트는 웹·CLI가 소비 — iOS 필요 시 재도입." 테스트의 `BarrierFreeDetailResponse` 디코딩 테스트는 유지(모델은 `match`가 공유).
- [ ] **Step 3: Kit xcstrings 축소** — `KIT_NAMESPACES`를 실참조 3종으로 교체: `const KIT_NAMESPACES = ['category', 'region', 'whereAmI'];` (주석 갱신: "Kit 소스 `kitLocalized` 실참조 도메인만 — 감사 2026-07-30에서 나머지 11종 180키 전량 미참조 확정"). 재생성:

```bash
node ios/scripts/messages-to-xcstrings.mjs && node scripts/check-xcstrings-keys.mjs
```

Expected: `[kit]` 카탈로그가 약 63키로 축소, 린터 PASS.

- [ ] **Step 4: 검증 + 커밋**

Run: `swift test --package-path ios/GildongmuKit` PASS.

```bash
git commit -m "chore(ios): 낡은 역명 미러·미사용 detail 제거, Kit xcstrings 180 죽은 키 축소" -- ios/GildongmuKit/Sources/GildongmuKit/StationMatch.swift ios/GildongmuKit/Tests ios/GildongmuKit/Sources/GildongmuKit/BarrierFreeService.swift ios/scripts/messages-to-xcstrings.mjs ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings
```

---

### Task 16: iOS 소규모 중복 제거

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Format.swift`, `ios/GildongmuKit/Sources/GildongmuKit/CoordQuery.swift`, `ios/Gildongmu/Chat/SuggestionButtonList.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/LocationNarrative.swift`, `ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift`, `ios/GildongmuKit/Sources/GildongmuKit/NearbyService.swift`, `ios/GildongmuKit/Sources/GildongmuKit/StationService.swift`, `ios/GildongmuKit/Sources/GildongmuKit/BarrierFreeService.swift`, `ios/GildongmuKit/Sources/GildongmuKit/WalkInfraService.swift`, `ios/GildongmuKit/Sources/GildongmuKit/WhereAmIService.swift`, `ios/Gildongmu/SearchView.swift`, `ios/Gildongmu/Nearby/AroundNearbyView.swift`, `ios/Gildongmu/Nearby/KidsNearbyView.swift`, `ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift`, `ios/Gildongmu/Nearby/ClinicNearbyView.swift`, `ios/Gildongmu/Nearby/WalkInfraNearbyView.swift`, `ios/Gildongmu/Chat/ChatTabView.swift`, `ios/Gildongmu/Chat/ChatView.swift`

**Interfaces:**
- Produces (Kit): `public func formatDistance(_ meters: Int) -> String`, `func firstNonEmpty(_ values: String?...) -> String?`(internal), `func coordQuery(lat: Double, lng: Double) -> [URLQueryItem]`(internal)
- Produces (앱): `struct SuggestionButtonList: View { let suggestions: [String]; let onTap: (String) -> Void }`

- [ ] **Step 1: Kit `Format.swift` 신설** — `LocationNarrative.swift`의 private `formatDistance`(`:56-61`)와 private `firstNonEmpty`(`:63-70`)를 새 파일로 이동, `formatDistance`는 `public`으로 승격(주석: "웹 `format.ts` formatDistance 미러 — 단일 정본, 앱 로컬 사본 금지"), `firstNonEmpty`는 internal. `PlaceProjection.swift:103` 부근의 private `firstNonEmpty` 중복 삭제.
- [ ] **Step 2: 앱 `formatDistanceKo` 제거** — `SearchView.swift:358-364` 삭제, 호출 7곳(`SearchView.swift:352`, `AroundNearbyView.swift:84`, `KidsNearbyView.swift:84`, `BarrierFreeNearbyView.swift:85`, `ClinicNearbyView.swift:119`, `WalkInfraNearbyView.swift:209,220`)을 Kit `formatDistance(Int(<기존 Double 인자>.rounded()))`로 교체(이미 Int인 인자는 캐스팅 불필요 — 호출부별 실타입 확인).
- [ ] **Step 3: Kit `CoordQuery.swift` 신설(internal)** — `NearbyService.swift:14-19`·`StationService.swift:55-60`의 private `coordQuery` 삭제 후 공용 free function 사용, `BarrierFreeService`·`WalkInfraService`·`WhereAmIService`의 인라인 lat/lng `URLQueryItem` 2줄도 같은 함수로 교체(⚠ `BarrierFreeService.nearby`는 limit 항목이 추가라 `coordQuery(...) + [URLQueryItem(name: "limit", ...)]` 형태).
- [ ] **Step 4: `SuggestionButtonList` 추출** — 새 파일:

```swift
import SwiftUI

/// 채팅 빈 상태 추천 질문 버튼 목록 — ChatTabView·ChatView 공용.
/// 각 버튼은 독립 접근성 객체(정상). 44pt frame은 label 안쪽(버튼 바깥 frame은
/// 히트 영역을 안 넓힌다). 탭=즉시 전송, 첫 전송 후 리스트 소멸.
struct SuggestionButtonList: View {
    let suggestions: [String]
    let onTap: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(suggestions, id: \.self) { suggestion in
                Button {
                    onTap(suggestion)
                } label: {
                    Text(suggestion)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}
```

`ChatTabView.swift`의 `suggestionList`를 `SuggestionButtonList(suggestions: suggestions) { model.send($0) }`로, `ChatView.swift`의 인라인 VStack도 동형 교체.

- [ ] **Step 5: 검증 + 커밋**

Run: `swift test --package-path ios/GildongmuKit` + 앱 빌드(`xcodebuildmcp` simulator build 또는 `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu build` — repo 관례 확인) PASS.

```bash
git commit -m "refactor(ios): 거리 포맷·coordQuery·firstNonEmpty·추천 버튼 목록 중복 제거" -- ios/GildongmuKit/Sources ios/Gildongmu
```

---

### Task 17: 문서 반영 + 최종 검증 + 배포

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`

- [ ] **Step 1: CLAUDE.md 갱신(항구 규칙만)** — ① "브리핑 진입점 일원화" 문장에 보충: "경로 렌더 카드는 웹 전용 — iOS 채팅은 산문이 정본(렌더 3종: places·addresses·webResults)". ② 채팅 절에 한 줄: "장소·주소 카드 탭=상세 진입(`place-open-request` 브릿지, 상세 열림 중엔 같은 히스토리 엔트리 교체)". ③ Task 9의 키 표 행이 반영됐는지 확인.
- [ ] **Step 2: PROGRESS.md에 감사·수정 요지 기록** — 4도메인 감사 결과 요약, 이 묶음에서 해소된 항목, **의도적 보류 3건**(envelope 파서 공용화·웹 nearby 추출(계약 테스트 선행)·iOS Nearby 골격 추출)을 다음 단계 후보로 명기.
- [ ] **Step 3: 전체 게이트** — `npm run lint && npm run test:run && npm run build`, `swift test --package-path ios/GildongmuKit`.
- [ ] **Step 4: a11y-auditor 서브에이전트 점검**(a11y 변경 다수 — repo 규칙) 후 지적 반영.
- [ ] **Step 5: Commit + push**(자동배포) + iOS 실기기 배포(`ios/deploy-device.sh`, 기기 연결 시 — iOS 수정은 커밋+실기기 배포까지 한 사이클).

```bash
git commit -m "docs: 레거시 감사 수정 묶음 반영 — 진입점·채팅 카드 계약 항구화, 보류 3건 기록" -- CLAUDE.md PROGRESS.md
git push
ios/deploy-device.sh
```
