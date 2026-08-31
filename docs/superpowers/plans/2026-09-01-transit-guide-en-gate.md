# 실시간 대중교통 안내 en 게이트 해제 — 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`(이 마일스톤은 inline 실행이다 — 판정 근거는 아래 §구현 방식). 단계는 체크박스(`- [ ]`)로 추적한다.

**Goal:** 영어(비-ko) 로케일 사용자가 실시간 대중교통 안내를 시작할 수 있게 하고, 그 안내의 모든 발화·표시 줄이 영문 조각이 있을 때 영어로 나가게 한다.

**Architecture:** 조인 필드(한국어)는 동결하고, 서버가 additive 영문 조각을 실어 주며, 표시 계층은 조인 필드가 **타입에 없는** 좁은 투영(`TransitDisplayLeg`·`TransitDisplayItem`)만 받는다. 문장 판정(키·인자·언어)은 순수 공유 descriptor 계층이 하고 플랫폼은 카탈로그 조회만 한다.

**Tech Stack:** Next.js 16 / TypeScript / Vitest(node-env + jsdom 프라그마) / Swift 6 SPM(GildongmuKit, Swift Testing) / SwiftUI

**Spec:** `docs/superpowers/specs/2026-09-01-transit-guide-en-gate-design.md`

## 구현 방식 판정 (AUTONOMY §구현 방식)

**inline.** 태스크가 순차 의존이다 — 서버 영문 조각(T2)이 없으면 DTO(T4)가 실을 것이 없고, descriptor 계층(T6)이 확정되기 전에는 두 플랫폼 어댑터(T7·T8)의 인터페이스가 정해지지 않는다. 수정 파일도 겹친다(`transit-guide.ts`를 T4·T5가 함께 만진다). 리뷰는 판정과 무관하게 별도 컨텍스트(§리뷰).

## Global Constraints

- **조인 필드는 한국어로 동결.** `lineName`·`boardName`·`alightName`·`viaStops[].name`·`destinationName`·`currentLocation`·`TransitLock.routeId`/`direction` 값 무변경.
- **`lang` 부재·`ko` 응답은 종전과 키 집합이 정확히 같아야 한다**(CLI/MCP·구앱 무변화).
- **`""`는 `TrackItem.message` 슬롯에서만 유효한 영문 조각**이다. 나머지 슬롯의 `""`는 부재로 정규화한다.
- **언어 축은 `prefersEnglish(locale)`(웹)·`AppLanguage.dataLocale == "en"`(iOS)**. `locale === "en"` 같은 좁은 판정 금지.
- **`lang` 인자는 기본값을 두지 않는다**(Kit `TransitTrackService` 5개 메서드).
- 커밋은 pathspec으로: `git commit -- <경로>`. `git add -A` 금지. 커밋 직후 `git show HEAD --stat` 검증.
- 문서·주석·커밋 메시지는 한국어, 식별자는 영어. em dash 금지(에이전트 문서는 적용 제외).
- **소유 파일 밖 금지.** 불가피하게 건드린 파일(`src/lib/transit-progress-overview.ts`·`ios/Gildongmu/Directions/GuideOverviewSheet.swift`·`src/app/api/transit/track/route.ts`·`src/lib/transit-track.ts`·Kit `TransitTrackService.swift`)은 통합 보고에 자진 신고한다.

---

### Task 1: 버스 도착 문장 parser + 영어 생성기

**Files:**
- Create: `src/lib/bus-arrival-en.ts`
- Test: `src/lib/__tests__/bus-arrival-en.test.ts`
- Read-only 참조: `src/lib/providers/seoul-bus.ts`(`ARRMSG_REMAINING_TAIL`·`remainingFromArrmsg`)

**Interfaces:**
- Produces: `parseBusArrmsg(message: string): BusArrmsg`,
  `busArrivalMessageEn(parsed: BusArrmsg, phase: "wait" | "ride"): string | undefined`
- `type BusArrmsg = { kind: "eta" | "soon" | "waiting" | "ended" | "unknown"; minutes: number | null; seconds: number | null; remainingStops: number | null }`

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { busArrivalMessageEn, parseBusArrmsg } from "../bus-arrival-en";
import { remainingFromArrmsg } from "../providers/seoul-bus";

const CORPUS = [
  "6분47초후[4번째 전]", "15분후[9번째 전]", "55초후[1번째 전]",
  "3분54초후[2번째 전]", "곧 도착", "출발대기", "운행종료", "정보없음",
];

describe("parseBusArrmsg", () => {
  it("잔여 정거장 해석이 기존 remainingFromArrmsg와 일치한다", () => {
    for (const m of CORPUS) {
      expect(parseBusArrmsg(m).remainingStops, m).toBe(remainingFromArrmsg(m));
    }
  });
});

describe("busArrivalMessageEn", () => {
  it("국면마다 어순이 다르다", () => {
    expect(busArrivalMessageEn(parseBusArrmsg("6분47초후[4번째 전]"), "wait")).toBe("In 6 min 47 sec");
    expect(busArrivalMessageEn(parseBusArrmsg("6분47초후[4번째 전]"), "ride")).toBe("6 min 47 sec left");
    expect(busArrivalMessageEn(parseBusArrmsg("15분후[9번째 전]"), "wait")).toBe("In 15 min");
    expect(busArrivalMessageEn(parseBusArrmsg("55초후[1번째 전]"), "ride")).toBe("55 sec left");
  });
  it("고정 문구 3종", () => {
    expect(busArrivalMessageEn(parseBusArrmsg("곧 도착"), "wait")).toBe("Arriving soon");
    expect(busArrivalMessageEn(parseBusArrmsg("출발대기"), "wait")).toBe("Waiting to depart");
    expect(busArrivalMessageEn(parseBusArrmsg("운행종료"), "wait")).toBe("Service ended");
  });
  it("미지 모양과 범위 밖은 부재", () => {
    expect(busArrivalMessageEn(parseBusArrmsg("정보없음"), "wait")).toBeUndefined();
    expect(busArrivalMessageEn(parseBusArrmsg("3분99초후"), "wait")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/bus-arrival-en.test.ts` → 모듈 없음으로 FAIL
- [ ] **Step 3: 구현** — spec §3.11. 꼬리는 `ARRMSG_REMAINING_TAIL`을 **공유**해 뗀다(자체 정규식 금지). 미지 모양은 `console.warn`으로 숫자를 `N`으로 마스킹한 모양만 남긴다(중복 억제 Set).
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `git commit -- src/lib/bus-arrival-en.ts src/lib/__tests__/bus-arrival-en.test.ts`

---

### Task 2: `/api/transit/track`에 `lang` + 실시간 영문 조각

**Files:**
- Modify: `src/lib/transit-guide.ts`(`TrackItem`에 영문 4필드 추가 — 타입만)
- Modify: `src/lib/transit-track.ts`(`trackSeoulWait`·`trackSeoulRide`·`trackTago`·`trackSubway`·`resolveTagoStop`에 `lang`)
- Modify: `src/app/api/transit/track/route.ts`(`langParam()`)
- Test: `src/app/api/transit/track/__tests__/route.test.ts`(기존 파일 증분), `src/lib/__tests__/transit-track.test.ts`(증분)

**Interfaces:**
- Consumes: Task 1의 `parseBusArrmsg`·`busArrivalMessageEn`; 기존 `enrichArrivalEn`·`stationNameEn`(`src/lib/subway-arrival-en.ts`)
- Produces: `TrackItem.messageEn?`·`directionEn?`·`destinationNameEn?`·`currentLocationEn?`; 각 track 함수의 `lang: "ko" | "en"` **필수 인자**

- [ ] **Step 1: 실패 테스트** — ① `lang=xx`가 400 ② `lang` 미지정 응답의 키 집합이 종전과 정확히 동일(`Object.keys` 정렬 비교) ③ `lang=en` 지하철 항목에 `messageEn`·`directionEn`·`destinationNameEn`·`currentLocationEn` ④ `lang=en` TAGO 항목의 `messageEn === ""` ⑤ `lang=en` 서울버스 항목에 `directionEn`·`destinationNameEn`이 **없음**(구조적 부재)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — spec §3.2 행렬. `lang`은 `mode`/`phase` 분기 **앞**에서 한 번 파싱. 지하철은 `enrichArrivalEn`을 태운 뒤 투영하고 종착역은 `stationNameEn(ctx, a.destination, a.line)` 단독 호출.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/api/transit/track src/lib/__tests__/transit-track.test.ts`
- [ ] **Step 5: 커밋**

---

### Task 3: 클라이언트가 `lang`을 보낸다

**Files:**
- Modify: `src/hooks/useTransitGuide.ts`(`trackTargetUrl` 4갈래 + TAGO resolve)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/TransitTrackService.swift`(5개 메서드에 `lang` 필수 인자)
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`(호출부)
- Test: `src/hooks/__tests__/transit-track-url.test.ts`(신규 — 순수 함수로 노출해 URL 문자열 단언), `ios/GildongmuKit/Tests/GildongmuKitTests/TransitTrackServiceTests.swift`(증분 또는 신규)

**Interfaces:**
- Produces: `trackTargetUrl(leg, phase, resolvedTago, boardOverrideIndex, lang)` — **`lang` 필수 인자**

- [ ] **Step 1: 실패 테스트** — 네 갈래 URL에 `&lang=en`이 붙는지 문자열 완전 일치로 단언(파라미터 이름 오타는 서버가 조용히 무시한다)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

---

### Task 4: 안내 DTO·이벤트가 영문을 나른다

**Files:**
- Modify: `src/lib/transit-guide.ts`(`TransitGuideLeg` 3필드 · `TransitPrewalkTarget.nameEn` · 이벤트 영문 필드 · `buildTransitGuideRoute`·`transitPrewalkTarget` 승계 · 이벤트 방출부)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`(1:1 미러)
- Test: `src/lib/__tests__/transit-guide.test.ts`(증분), `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift`(증분)
- Modify: `src/lib/__tests__/fixtures/transit-guide-scenarios.json`(영문 시나리오 추가)

**Interfaces:**
- Produces: `TransitGuideLeg.lineNameEn?`·`boardNameEn?`·`alightNameEn?`, `TransitPrewalkTarget.nameEn?`, 이벤트 `messageEn?`·`currentLocationEn?`

- [ ] **Step 1: 실패 테스트** — ① `buildTransitGuideRoute`가 영문을 승계하고 **ko/en 폴백 순서가 짝을 이룬다**(`fromName` 있고 `fromNameEn` 없으면 `boardNameEn`은 `boardStop.nameEn`이 아니라 **부재**여야 한다 — 서로 다른 정류소를 가리키지 않게) ② 대기→선택→boarding→riding→현재역 갱신 시나리오에서 이벤트에 영문이 실린다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 영문 없는 입력은 출력도 무변경(기존 fixture green 유지)
- [ ] **Step 4: 통과 확인** — 웹 + `cd ios/GildongmuKit && swift test --filter TransitGuide`
- [ ] **Step 5: 커밋**

---

### Task 5: 좁은 표시 투영 + `boardOverride` 인덱스화

**Files:**
- Create: `src/lib/transit-display.ts`(`TransitLabel`·`TransitDisplayLeg`·`TransitDisplayItem`·`transitDisplayLeg`·`transitDisplayItem`)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/TransitDisplayProjection.swift`(미러)
- Create: `src/lib/__tests__/fixtures/transit-display-cases.json`(공유 fixture)
- Test: `src/lib/__tests__/transit-display.test.ts`, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitDisplayProjectionTests.swift`
- Modify: `src/hooks/useTransitGuide.ts`·`ios/Gildongmu/Directions/TransitGuideModel.swift`(`boardOverride` → `boardOverrideIndex`)

**Interfaces:**
- Consumes: Task 4의 영문 필드
- Produces: `transitDisplayLeg(leg, boardOverrideIndex: number | null): TransitDisplayLeg`, `transitDisplayItem(item): TransitDisplayItem`, `changeBoardingAt(index: number)`

- [ ] **Step 1: 실패 테스트** — ① 투영 결과에 `lineName`·`vehicleId`·`routeId` 키가 **없다**(타입만이 아니라 런타임 키 집합으로) ② `message`를 제외한 슬롯의 `""` 영문이 부재로 정규화된다 ③ `boardOverrideIndex`가 가리키는 정류소가 `board` 라벨이 된다 ④ 인덱스 범위 밖이면 override 없음으로 떨어진다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

---

### Task 6: 공유 문장 descriptor 계층

**Files:**
- Create: `src/lib/transit-guide-text.ts`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuideText.swift`
- Create: `src/lib/__tests__/fixtures/transit-guide-text-cases.json`
- Test: `src/lib/__tests__/transit-guide-text.test.ts`, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTextTests.swift`

**Interfaces:**
- Consumes: Task 5의 `TransitDisplayLeg`·`TransitDisplayItem`
- Produces: `TransitTextDescriptor = { key: string; args: string[]; lang: "ko" | "en" }` + descriptor 함수들(`waitContextText`·`boardingContextText`·`contextText`·`frameText`·`approachFrameText`·`vehicleSelectedText`·`vehiclePassedText`·`arrivedAtBoardStopText`·`boardedText`·`currentStationText`·`candidateDescText`·`terminatesEarlyText`·`selectLabelText`·`viaStopText`·`overviewLegText`·`prewalkText`) + `TRANSIT_TEXT_KEYS: readonly string[]`

- [ ] **Step 1: 실패 테스트(case registry)** — 함수마다 유효 입력·기대 `{key,args,lang}`을 담은 표를 만들고, ① 완비 en 입력에서 정확한 descriptor ② 조각을 하나씩 빼면 정확한 ko args + `lang:"ko"` ③ `message` 슬롯의 `""`는 en 유지 ④ **모듈의 전 export가 표에 등장**한다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 언어 판정은 `pickLine` 의미(전 조각 완비일 때만 en). 인자 순서는 **ko 문장 플레이스홀더 등장 순서**.
- [ ] **Step 4: 통과 확인** — 웹 + Kit
- [ ] **Step 5: 커밋**

---

### Task 7: 웹 어댑터 — 훅·패널이 descriptor만 쓴다

**Files:**
- Modify: `src/hooks/useTransitGuide.ts`(프레임 함수 제거 → descriptor 호출 + `TRANSIT_TEXT_ARG_NAMES` 어댑터)
- Modify: `src/components/TransitGuidePanel.tsx`(live region에 `lang` 동반 · 경유 목록 · 재선택 버튼 라벨/값 분리 · 후보 desc)
- Test: `src/lib/__tests__/transit-text-arg-names.test.ts`(표 완전성), `src/components/__tests__/TransitGuidePanel.test.tsx`(증분)

**Interfaces:**
- Consumes: Task 6 descriptor
- Produces: `TRANSIT_TEXT_ARG_NAMES: Record<string, readonly string[]>`

- [ ] **Step 1: 실패 테스트** — ① 모든 `TRANSIT_TEXT_KEYS`가 표에 있고, 표의 이름 수 == `messages/ko.json`의 그 키 플레이스홀더 수 ② 패널이 en 로케일에서 영문 줄을 렌더하고 ko 폴백 줄에 `lang="ko"`가 붙는다 ③ live region이 **하나**다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 재선택 버튼: 라벨은 `pickLine` 결과, `onClick` 값은 인덱스, `lang`은 라벨 언어에 따라 조건부.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

---

### Task 8: iOS 어댑터 — 리터럴 switch + 조망 행

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`(문장 조립을 descriptor + 리터럴 switch로)
- Modify: `ios/Gildongmu/Directions/TransitTrackingSheet.swift`(후보 목록·경유·재선택)
- Modify: `ios/Gildongmu/Directions/GuideOverviewSheet.swift`(조망 행 descriptor)
- Modify: `src/lib/transit-progress-overview.ts` + `ios/GildongmuKit/Sources/GildongmuKit/TransitProgressOverview.swift`(행에 영문 additive)
- Modify: `ios/Gildongmu/Directions/TransitGuideDiag.swift`(폴백 사유 계측)
- Test: `src/lib/__tests__/transit-progress-overview.test.ts`(증분)

- [ ] **Step 1: 실패 테스트** — 조망 행이 영문을 승계한다(입력에 영문이 없으면 출력도 없음 = 기존 fixture 무변경)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 앱 `localizedTransitText(_:)` 하나가 `TRANSIT_TEXT_KEYS` 전부를 리터럴 case로 조회하고 `default`는 `assertionFailure` + 키 노출.
- [ ] **Step 4: 통과 확인** — 웹 + `cd ios/GildongmuKit && swift test` + Xcode 빌드
- [ ] **Step 5: 커밋**

---

### Task 9: 게이트 해제 + 가드

**Files:**
- Modify: `src/components/DirectionsView.tsx`(대중교통 2자리에서 `!prefersEnglish(locale)` 제거 — **다른 자리 불변**)
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`(대중교통 2자리에서 `dataLocale == "ko"` 제거)
- Test: `src/lib/__tests__/guidance-gate-drift.test.ts`(증분), `src/components/__tests__/transit-display-guard.test.ts`(신규 소스 가드)

- [ ] **Step 1: 실패 테스트** — ① iOS 두 게이트 식에 로케일 조건이 **없고** 실험 플래그가 **있다** ② 웹 두 자리에 `prefersEnglish`가 없다 ③ 계단 회피·자동차·도보 게이트는 **여전히 있다**(반대 방향 단언 — 같이 지워지지 않았음을 증명) ④ 소스 가드: 표시 파일에서 조인 필드 직접 참조가 allowlist 밖에 없다 ⑤ descriptor 키 집합 ⊆ iOS 리터럴 키 집합
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

---

### Task 10: 실호출 게이트 + 문서 분배

**Files:**
- Create: `scripts/verify-transit-track-lang.mjs`
- Modify: `CHANGELOG.md`·`docs/BACKLOG.md`(E27 잔여 ① 종결)·`CLAUDE.md`(새 함정)·`PROGRESS.md`(한 줄)·`docs/FIELD-TEST.md`(대본)·spec §8 파일 목록

- [ ] **Step 1: 실호출 게이트 작성·실행** — 지하철·서울버스·TAGO 각 1건. **항목 0건은 합격이 아니라 미실측**으로 출력하고 exit code로 구분한다.
- [ ] **Step 2: 결과를 spec §5.5에 기록**(미실측 항목도 그대로)
- [ ] **Step 3: 문서 분배** — 서사→CHANGELOG, 남은 판정→BACKLOG, 새 함정→CLAUDE.md, 상태 한 줄→PROGRESS
- [ ] **Step 4: 게이트 전량** — `npm run test:run` + `npm run build` + `swift test`
- [ ] **Step 5: 커밋**

---

## 리뷰 (판정과 무관하게 별도 컨텍스트)

- `spec-compliance`·`code-quality` 서브에이전트 — 요구사항(spec)과 산출물(diff)만 넘긴다. 세션 히스토리·의도 금지.
- `a11y-auditor`(하위 repo·worktree에서 에이전트 타입이 안 뜨면 general-purpose + 역할 파일 Read로 대체).
- 리뷰 디스패치 전 커밋 SHA를 얼린다.

## 통합

`git fetch && git rebase origin/main` → `node ios/scripts/messages-to-xcstrings.mjs` 재생성 → CHANGELOG·BACKLOG `comm -23` 집합 차분으로 남의 줄 소실 전수 대조 → 게이트 → `git push origin feat/transit-en-gate:main`(ff만). **`AGENTS.md`는 재생성하지 않는다**(worktree에서 안 돈다 — 코디네이터가 웨이브 끝에).
