# 웹 nearby 중복 추출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "내 주변" 계열 9종 컴포넌트의 복붙 골격(약 1,100줄)을 계약 테스트로 못 박은 뒤 공유 계층(순수 함수 1·훅 2·셸 1)으로 수렴시키고, 그 과정에서 8종 공유 잠복 결함(닫힌 패널 재열림·포커스 탈취)을 요청 ID latest-wins로 동시 수정한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-30-nearby-dedup-design.md`가 정본. 공유 계층 4개를 먼저 만들고(순수 함수 `nearbyLiveMessage` → 계약 테스트 → 훅 `useNearbyFetch`·`useRevealMore`·셸 `NearbyPanelShell`), 그다음 컴포넌트를 **파일당 1회 전량 이관**한다(훅+live+리빌+셸을 한 번에 — 같은 파일을 여러 태스크가 재편집하지 않는다). 계약 테스트는 이관 전 무수정 현행 코드에 대해 작성·green 커밋하고, 이관 태스크는 계약 테스트 파일 수정 금지(유일 예외: 교차 패널 결함 테스트의 `it.fails`→`it` 전환).

**Tech Stack:** Next.js 16 / React 19 / next-intl / Vitest 4(jsdom 파일 프라그마) / @testing-library/react

## Global Constraints

- **행동 byte-identical**(잠복 결함 수정 제외): DOM 구조·클래스명·live 문자열·포커스 계약·fetch URL·상태 전이를 바꾸지 않는다. 계약 테스트가 판정자다.
- **계약 테스트 파일 수정 금지**(Task 4 이후): `src/components/__tests__/*.contract.test.tsx`·`nearby-contract.tsx`는 이관 태스크에서 수정 금지. 유일 예외는 Task 7에서 교차 패널 테스트의 `it.fails`→`it` 전환(그 한 줄만).
- 접근성 헌장 준수: 단일 polite live region, `aria-disabled`(disabled 금지), done 헤딩 포커스는 `useEffect`(rAF 금지), "더 보기" 재포커스는 `useLayoutEffect`, 한 줄=한 객체.
- `src/lib/`는 React/Next import 금지(`nearby-live.ts`는 플레인 함수 타입만).
- i18n 키·메시지 무변경(이 마일스톤은 `messages/*.json`을 건드리지 않는다).
- 커밋: `git add -A` 금지, 의도 파일만 `git add <경로> && git commit -- <경로>`. 커밋 메시지 한국어. **push 금지**(컨트롤러가 최종 리뷰 후 일괄 push).
- 매 태스크 종료 시 `npm run lint && npm run test:run` 통과.
- 스펙 §4의 기각 판정 준수: BikeStations 서울 경계 신설 금지, `onRequestStart`/`onInvalidate` 확장 금지, AbortController 금지, 포커스 revision 카운터 금지(`focusedRef`+done 전이 보존), `claim()`은 in-flight 가드보다 앞(현행 순서).

## 대상 9종과 변이 좌표 (이관 태스크의 단일 진실)

| 컴포넌트 | fetch URL | done 데이터 `T` | empty 판정 | source | coverage | live done | 특이점 |
|---|---|---|---|---|---|---|---|
| NightClinicsNearby | `/api/clinic/nearby?lat&lng` | `{clinics, basis, supplementFailed}` | `body.clinics` 길이 0 | current | korea | 기본(`ready`) | notice 슬롯(basis·supplementFailed), 더 보기, 항목 h4 |
| KidsPlacesNearby | `/api/places/kids?lat&lng&limit=NEARBY_LIMIT_MAX` | `{kids}` | `body.kids` 길이 0 | current | korea | 기본 | 더 보기 |
| SurroundingsNearby | `/api/places/around?lat&lng&limit=NEARBY_LIMIT_MAX` | `{places}` | `body.places` 길이 0 | current | korea | 기본 | 더 보기 |
| SubwayArrivalsNearby | `/api/station/subway-arrival/nearby?lat&lng` | `{stations}` | `body.stations` 길이 0 | current | korea | 기본 | — |
| WhereAmI | `/api/where-am-i?lat&lng` | `{data: WhereAmIData}` | `body.data` null(res.ok일 때) | current | korea | `() => ""` | 산문 렌더(`buildLocationNarrative`), open 조건 done && narrative |
| BusArrivals | `/api/bus/nearby?lat&lng` | `{stops}` | `body.stops` 길이 0 | current 또는 place(props) | korea | `() => ""` → live 합성 `live \|\| routeStopsNotice` | load 시작 시 notice 리셋 래퍼, onClose에 notice 리셋, 트리거 라벨 모드 분기 |
| BikeStations | `/api/bike/nearby?lat&lng` | `{stations}` | `body.stations` 길이 0 | current 또는 place(props) | korea | 기본 | 트리거 라벨 모드 분기 |
| BarrierFreeNearby | `/api/places/barrier-free?lat&lng&limit=NEARBY_LIMIT_MAX` | `{places}` | `body.places` 길이 0 | current(+`autoLoad`) | korea | 기본 | autoLoad 시 트리거·닫기 미렌더·스토어 미참여, onClose에 openIds·detailCache 리셋, 더 보기, 항목별 상세 lazy fetch(무변경 보존) |
| WalkInfraNearby | `/api/walk/nearby?lat&lng` | `{walk}` | 없음(parse 항상 done) | current | **none** | `buildLive(walk)` 합성 | empty·outOfCoverage 상태 미발생, source prop 없음(footnote는 children), 그룹 h4 3개 |

공통: 요청은 전부 `cache: "no-store"`, `at`은 `new Date().toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"})`, 트리거 onClick은 `load(status.kind === "done")`(done이면 force 새로고침), heading 텍스트 `` `${t("ready")} ${t("asOf", { time })}` ``.

---

### Task 1: `nearbyLiveMessage` 순수 함수 + node 단위 테스트

**Files:**
- Create: `src/lib/nearby-live.ts`
- Test: `src/lib/__tests__/nearby-live.test.ts`

**Interfaces:**
- Produces: `nearbyLiveMessage(status, t, tCommon, doneMessage?)` — 이관 태스크(6~9)가 소비. React/Next import 없음.

- [ ] **Step 1: 구현 작성**

```ts
/**
 * nearby 계열 단일 polite live region 문자열 — 8종에 반복되던 삼항 사다리의 정본.
 * React 비의존 순수 함수(node 단위 테스트 대상). done 문구만 도메인이 주입한다:
 * 기본은 t("ready"), BusArrivals·WhereAmI는 () => ""(헤딩 포커스가 통지 담당),
 * WalkInfra는 두 소스 독립 강등 합성.
 */
type Translator = (key: string, params?: Record<string, string | number | Date>) => string;

export type NearbyLiveStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "done" };

export function nearbyLiveMessage(
  status: NearbyLiveStatus,
  t: Translator,
  tCommon: Translator,
  doneMessage?: () => string,
): string {
  switch (status.kind) {
    case "locating":
      return t("locating");
    case "loading":
      return t("loading");
    case "empty":
      return t("empty");
    case "error":
      return t("error");
    case "geoerror":
      return status.reason === "denied" ? t("geoDenied") : t("geoUnsupported");
    case "outOfCoverage":
      return tCommon("outOfCoverage");
    case "done":
      return doneMessage ? doneMessage() : t("ready");
    default:
      return "";
  }
}
```

- [ ] **Step 2: 테스트 작성** — node 환경(프라그마 불요). t mock은 `(key, params) => params ? `${key}${JSON.stringify(params)}` : key`. 케이스: 8개 kind 각각의 반환 키, geoerror 두 reason 분기, done 기본 vs doneMessage 주입(`""` 포함), idle 빈 문자열.
- [ ] **Step 3: `npm run lint && npm run test:run` 통과 확인**
- [ ] **Step 4: 커밋** `git add src/lib/nearby-live.ts src/lib/__tests__/nearby-live.test.ts && git commit -m "feat(web): nearby live 통지 순수 함수 추출 — 8종 삼항 사다리의 정본" -- src/lib/nearby-live.ts src/lib/__tests__/nearby-live.test.ts`

### Task 2: 계약 테스트 팩토리 + 표준 4종 (무수정 현행 코드 대상)

**Files:**
- Create: `src/components/__tests__/nearby-contract.tsx` (팩토리 — 테스트 파일 아님, `.test.` 미포함)
- Create: `src/components/__tests__/NightClinicsNearby.contract.test.tsx`, `KidsPlacesNearby.contract.test.tsx`, `SurroundingsNearby.contract.test.tsx`, `SubwayArrivalsNearby.contract.test.tsx`

**Interfaces:**
- Produces: `describeNearbyContract(config)` — Task 3 테스트 파일이 재사용.
- Consumes: 현행 컴포넌트(수정 금지 — 이 태스크는 컴포넌트 파일을 1줄도 바꾸지 않는다).

**팩토리 설계** (`nearby-contract.tsx`):

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/** 계약 스위트 설정 — 도메인 fixture만 주입하고 계약 자체는 공유한다(스펙 §1). */
export interface NearbyContractConfig {
  name: string;
  /** 무프롭 기본 렌더(홈/허브 문맥) */
  renderComponent: () => ReactElement;
  /** 트리거 버튼의 접근 가능한 이름(next-intl mock이 키를 돌려주므로 i18n 키) */
  triggerName: string;
  /** fetch가 받아야 할 URL 부분 문자열(쿼리 포함 정확 검증) */
  expectedUrl: (lat: number, lng: number) => string;
  /** done을 만드는 응답 body */
  successBody: unknown;
  /** done 패널에서 보여야 할 항목 텍스트 조각(도메인 렌더 검증) */
  successProbe: string;
  /** empty를 만드는 body(없으면 empty 계약 생략 — WalkInfra) */
  emptyBody?: unknown;
  /** outOfCoverage 계약 적용 여부(WalkInfra만 false) */
  hasCoverage: boolean;
  /** live done 기본(ready) 여부 — BusArrivals·WhereAmI는 false(빈 문자열) */
  liveReadyOnDone: boolean;
}
```

공통 계약(팩토리가 생성하는 it 블록들):

1. **idle → 트리거 클릭 → done**: `awaitGeolocation` ready mock, fetch 200 `successBody` → 패널 렌더(`successProbe` 존재), 헤딩(`ready` 포함) 포커스 = `document.activeElement`, live region(`role="status"`)이 `liveReadyOnDone`에 따라 `ready` 키 또는 빈 문자열.
2. **fetch URL 계약**: fetch mock 호출 인자가 `expectedUrl(lat, lng)` 포함 + `cache: "no-store"`.
3. **empty**(emptyBody 있을 때): live에 `empty` 키, 패널 미렌더.
4. **error**: fetch 500 → live에 `error` 키.
5. **geoerror denied/unsupported**: `awaitGeolocation`이 `{status:"denied"}`/`{status:"unsupported"}` → live 키 분기.
6. **outOfCoverage**(hasCoverage): ⓐ 해외 좌표(ready지만 `isInKorea` false — 실좌표 `{lat: 35.6762, lng: 139.6503}` 도쿄)로 **fetch 미호출** + live `common.outOfCoverage` ⓑ 응답 body `{outOfCoverage: true}` → 동일 live.
7. **busy 재클릭**: loading 중(fetch pending) 트리거 재클릭 → fetch 호출 수 1 유지.
8. **닫기 → 트리거 포커스 복원**: done에서 닫기 클릭 → 패널 언마운트, `waitFor`로 `document.activeElement === trigger`(rAF 경유).
9. **force 새로고침 실패 복원**: done → 트리거(새로고침) 클릭 → `awaitGeolocation` 두 번째 호출이 `{status:"denied"}` → 직전 done 데이터(`successProbe`) 유지.
10. **재조회 헤딩 재발화**: done → 새로고침 성공 → 헤딩이 다시 `document.activeElement`.

파일별 preamble(각 `.contract.test.tsx` 상단, 팩토리가 요구하는 고정 형태):

```tsx
// @vitest-environment jsdom
import { vi } from "vitest";
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    f.rich = (key: string) => `${ns}.${key}`;
    return f;
  },
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));
```

live 검증은 네임스페이스 접두 키(`clinicNearby.locating` 등)로 단언한다 — 보간 인자는 JSON 직렬화로 함께 못 박힌다(스펙 §1). `nearby-panel-store`는 실물 사용, 각 테스트 후 `cleanup` + 스토어 초기화(`releaseNearbyPanel`은 id 가드가 있어 fresh render마다 새 id — cross-test 오염은 cleanup으로 충분, 필요 시 `vi.resetModules` 대신 스토어의 현재 active를 다음 render가 claim으로 자연 획득).

- [ ] **Step 1: 팩토리 작성** (위 계약 10종을 it 블록으로)
- [ ] **Step 2: 표준 4종 테스트 파일 작성** — config 값은 "대상 9종과 변이 좌표" 표에서. successBody 예: NightClinics `{clinics:[{id:"c1", name:"서울아이병원", kind:"달빛어린이병원", distanceMeters: 350, hours:{}, openStatus:{state:"open", start:1800, end:2400}, phone:"02-1234-5678", address:"서울 강동구", directions:null}], basis:"weekday", supplementFailed:false}` (probe: `서울아이병원`). 타입은 각 컴포넌트 import에서 확인.
- [ ] **Step 3: `npm run test:run`으로 4파일 전부 green 확인** (현행 코드가 이 계약을 이미 충족함을 증명 — red가 나오면 계약 서술이 틀린 것이니 현행 행동에 맞춰 테스트를 고친다. 컴포넌트를 고치는 것이 아니다.)
- [ ] **Step 4: 커밋** (팩토리+4파일)

### Task 3: 계약 테스트 잔여 5종 + 도메인 고유 계약

**Files:**
- Create: `src/components/__tests__/BusArrivals.contract.test.tsx`, `BikeStations.contract.test.tsx`, `BarrierFreeNearby.contract.test.tsx`, `WalkInfraNearby.contract.test.tsx`, `WhereAmI.contract.test.tsx`

**Interfaces:**
- Consumes: `describeNearbyContract`(Task 2).

팩토리 공통 계약 + 파일별 고유 it:

- **BusArrivals**: mode="current"로 팩토리 적용(`liveReadyOnDone: false`). 고유: ⓐ done 시 live 빈 문자열(헤딩 포커스가 통지) ⓑ mode="place" 렌더 → 트리거 클릭 시 geolocation **미호출**·props 좌표로 fetch ⓒ `arrivalStatus: "unavailable"` 항목이 `arrivalUnavailable` 키 렌더(도착조회 실패 ≠ 버스 없음).
- **BikeStations**: current로 팩토리 적용. 고유: place 모드 geolocation 미호출.
- **BarrierFreeNearby**: 기본(autoLoad=false)로 팩토리 적용. 고유: ⓐ `autoLoad` 렌더 → 트리거 버튼 부재 + 마운트 즉시 fetch → done ⓑ 항목 "편의시설 보기" 토글 `aria-expanded` + lazy fetch 1회(재펼침 시 캐시).
- **WalkInfraNearby**: `hasCoverage: false`, `emptyBody` 없음, `liveReadyOnDone: false` + 고유 doneLive 검증: successBody `{walk:{audioSignals:{status:"ok", data:{deviceCount:2, baseDate:"20260101", sites:[{bearing:"north", distanceMeters:40, deviceCount:2}]}}, osm:{status:"error"}}}` → live가 `audioSummary` 키와 `osmError` 키의 joinText 합성(쉼표 구분) — 소스 독립 강등 계약.
- **WhereAmI**: `liveReadyOnDone: false`. 고유: ⓐ `body.data` null + 200 → empty ⓑ done 산문 렌더(narrative 텍스트 조각 probe).

- [ ] **Step 1: 5파일 작성** — successBody는 각 컴포넌트의 타입(`BusStop`·`BikeStation`·`BarrierFreePlace`·`WalkInfrastructure`·`WhereAmIData`, `src/lib/types.ts`·`src/lib/walk-infra.ts`)을 열어 최소 유효 객체로 구성.
- [ ] **Step 2: green 확인** (red면 계약 서술을 현행 행동에 맞춘다)
- [ ] **Step 3: 커밋**

### Task 4: 교차 패널 결함 재현 테스트 (`it.fails`로 red를 문서화)

**Files:**
- Create: `src/components/__tests__/nearby-cross-panel.test.tsx`

**Interfaces:**
- Consumes: NightClinicsNearby + KidsPlacesNearby(실물 2종 동시 렌더), 실물 `nearby-panel-store`.

- [ ] **Step 1: 테스트 작성** — jsdom 프라그마 + Task 2 preamble. 시나리오:

```tsx
it.fails(
  "패널 A 로딩 중 B를 열면 A의 늦은 응답이 폐기된다 — 닫힌 A가 재열리거나 포커스를 빼앗지 않는다",
  async () => {
    // A(NightClinics) fetch를 지연 프라미스로 보류
    let resolveA!: (v: Response) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((r) => { resolveA = r; }),
    );
    render(<><NightClinicsNearby /><KidsPlacesNearby /></>);
    fireEvent.click(screen.getByRole("button", { name: "clinicNearby.button" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // A loading
    // B 트리거 → claim이 A를 onDismiss(자동 닫힘)
    fetchMock.mockResolvedValueOnce(jsonResponse(kidsSuccessBody));
    fireEvent.click(screen.getByRole("button", { name: "kidsPlacesNearby.button" }));
    await screen.findByText(/키즈카페프로브/); // B done
    const bHeading = screen.getByRole("heading", { name: /kidsPlacesNearby.ready/ });
    expect(document.activeElement).toBe(bHeading);
    // A의 늦은 응답 도착
    resolveA(jsonResponse(clinicsSuccessBody));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)).catch(() => {});
    await new Promise((r) => setTimeout(r, 0)); // 마이크로태스크 배수
    // 계약: A 패널은 닫힌 채여야 하고(재열림 금지) 포커스는 B에 남아야 한다
    expect(screen.queryByText(/서울아이병원/)).toBeNull();
    expect(document.activeElement).toBe(bHeading);
  },
);
```

(`it.fails`: 현행 코드에서 이 단언이 **실패함**을 게이트가 보증 — 결함 재현 증명. Task 7이 `it`으로 전환해 수정을 증명한다. 스펙 §3 red→green 분리.)

- [ ] **Step 2: `npm run test:run` green 확인** (it.fails라 스위트는 green — 만약 여기서 fail이 나면 단언이 현행 결함을 재현하지 못한 것이니 시나리오를 재점검)
- [ ] **Step 3: 커밋** — 메시지에 "현행 결함 red 문서화(it.fails)" 명시

### Task 5: `useNearbyFetch` 훅 + 단위 테스트

**Files:**
- Create: `src/hooks/useNearbyFetch.ts`
- Test: `src/components/__tests__/useNearbyFetch.test.tsx` (jsdom, renderHook)

**Interfaces:**
- Consumes: `awaitGeolocation`·`isInKorea`·`isOutOfCoverageBody`·`useNearbyPanel`(전부 기존).
- Produces: 아래 시그니처 — 이관 태스크 6~9가 소비.

- [ ] **Step 1: 훅 구현** (전체 코드 — 그대로 옮겨 적는다):

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

export type NearbyStatus<T> =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "done"; data: T; at: string };

export type NearbySource =
  | { kind: "current"; autoLoad?: boolean }
  | { kind: "place"; lat: number; lng: number };

interface Options<T> {
  source: NearbySource;
  /** "korea": 클라 선분기 + 응답 마커(기본). "none": WalkInfra(전 지구 OSM — 스펙 §4). */
  coverage?: "korea" | "none";
  /** URL·쿼리 조립은 도메인 몫 — 훅은 호출·해석·상태만 소유한다(스펙 §2). */
  fetchAt: (coords: { lat: number; lng: number }) => Promise<Response>;
  /** 순수 함수(외부 setter 호출 금지). empty 개념 없는 도메인은 항상 done 반환. */
  parse: (body: unknown) => { kind: "done"; data: T } | { kind: "empty" };
  /** close 시 도메인 부수 상태 리셋(BarrierFree 캐시, BusArrivals notice). close 한정. */
  onClose?: () => void;
}

/**
 * nearby 계열 위치 취득 → fetch 상태 머신의 정본(9종 공유, 스펙 §2).
 *
 * 잠복 결함 수정(스펙 §3, 유일한 의도적 행동 변경): 단조 증가 요청 ID로
 * latest-wins를 보장한다. load·close마다 ID가 증가하고, 캡처 ID ≠ 현재 ID면
 * ① 위치 도착 후 fetch를 시작하지 않으며(쿼터·좌표 전송 방지)
 * ② 응답·복원·geoerror 등 어떤 상태도 반영하지 않는다.
 * in-flight 잠금도 boolean 대신 ID — 이전 요청의 해제가 새 요청의 잠금을 풀지 못한다.
 */
export function useNearbyFetch<T>({ source, coverage = "korea", fetchAt, parse, onClose }: Options<T>) {
  const [status, setStatus] = useState<NearbyStatus<T>>({ kind: "idle" });
  /** done 커밋마다 증가 — useRevealMore의 표시 수 리셋 신호(내부 배선, 포커스 신호 아님). */
  const [doneSeq, setDoneSeq] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);
  const seqRef = useRef(0);
  const lockRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /** 홈/허브 아코디언 참여 조건 — place(상세 단일 패널)·autoLoad(채팅 카드)는 불참. */
  const participates = source.kind === "current" && !source.autoLoad;

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    seqRef.current += 1;
    lockRef.current = null;
    setStatus({ kind: "idle" });
    onCloseRef.current?.();
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: participates && status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  function load(force = false) {
    const prevStatus = status;
    if (participates) claim();
    if (lockRef.current !== null) return;
    const id = (seqRef.current += 1);
    lockRef.current = id;
    const unlock = () => {
      if (lockRef.current === id) lockRef.current = null;
    };
    const run = async (lat: number, lng: number) => {
      setStatus({ kind: "loading" });
      try {
        const res = await fetchAt({ lat, lng });
        const body = await res.json();
        if (seqRef.current !== id) return; // 검사지점 ② — 반영 직전(스펙 §3)
        if (coverage === "korea" && isOutOfCoverageBody(body)) {
          setStatus({ kind: "outOfCoverage" });
          return;
        }
        if (!res.ok) {
          setStatus({ kind: "error" });
          return;
        }
        const parsed = parse(body);
        if (parsed.kind === "empty") {
          setStatus({ kind: "empty" });
          return;
        }
        const at = new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
        setStatus({ kind: "done", data: parsed.data, at });
        setDoneSeq((s) => s + 1);
      } catch {
        if (seqRef.current !== id) return;
        setStatus({ kind: "error" });
      }
    };
    if (source.kind === "place") {
      void run(source.lat, source.lng).finally(unlock);
      return;
    }
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
    void awaitGeolocation({ force }).then((g) => {
      if (seqRef.current !== id) {
        // 검사지점 ① — 닫힌(또는 대체된) 요청의 위치로 upstream을 호출하지 않는다.
        unlock();
        return;
      }
      if (g.status === "ready") {
        if (coverage === "korea" && !isInKorea(g.coords.lat, g.coords.lng)) {
          setStatus({ kind: "outOfCoverage" });
          unlock();
          return;
        }
        void run(g.coords.lat, g.coords.lng).finally(unlock);
      } else {
        // 새로고침(force) 실패 시 보던 데이터를 잃지 않는다 — done이면 직전 결과를
        // 복원하고, 첫 조회 실패면 geoerror(실내 GPS 재취득 실패로 데이터 소멸 방지).
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        unlock();
      }
    });
  }

  // autoLoad(채팅 카드): 마운트 시 자동 로드. 의존성 배열 비움은 의도적 — 1회만.
  useEffect(() => {
    if (source.kind === "current" && source.autoLoad) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // done 진입 시 결과 헤딩으로 포커스 이동(접근성 1급). fetch 완료 직후 rAF로
  // 옮기면 React 커밋과 인과관계가 없어 레이스가 생긴다 — useEffect는 커밋 이후
  // 실행이 보장되므로 안전하다(PlaceDetail·PlaceSearch 동형).
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

  const busy = status.kind === "locating" || status.kind === "loading";

  return { status, doneSeq, load, close, busy, headingRef, triggerRef };
}
```

- [ ] **Step 2: 단위 테스트** — jsdom renderHook 또는 최소 소비 컴포넌트로: ⓐ current 성공 경로 상태열(idle→locating→loading→done) ⓑ place 모드 geolocation 미호출 ⓒ 커버리지 클라 선분기 fetch 미호출 ⓓ **close 후 늦은 응답 폐기(idle 유지)** ⓔ **close 후 즉시 재로드 가능 + 이전 요청 unlock이 새 잠금을 풀지 않음**(지연 프라미스 2개로 검증) ⓕ force 실패 시 prevStatus 복원 ⓖ stale 요청의 prevStatus 복원 금지 ⓗ autoLoad 마운트 1회 로드.
- [ ] **Step 3: lint+test green, 커밋**

### Task 6: `useRevealMore` + `NearbyPanelShell` + 단위 테스트

**Files:**
- Create: `src/hooks/useRevealMore.ts`
- Create: `src/components/NearbyPanelShell.tsx`
- Test: `src/components/__tests__/NearbyPanelShell.test.tsx` (jsdom — 셸+리빌 훅 합동)

**Interfaces:**
- Produces: 아래 두 시그니처. Task 7~9가 소비.

- [ ] **Step 1: `useRevealMore` 구현**:

```ts
"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** 초기 표시 수·"더 보기" 1회 공개 수 — 4중 로컬 선언의 정본(iOS Model과 동일 값). */
export const NEARBY_INITIAL_VISIBLE = 10;
export const NEARBY_REVEAL_STEP = 10;

/**
 * "더 보기" 단계 공개(스펙 §2 ④). resetKey(useNearbyFetch.doneSeq)가 바뀌면
 * 렌더 단계에서 동기 리셋한다(React 공식 derived-state 패턴) — useEffect 리셋은
 * 새 done 첫 페인트에 이전 공개 수가 비치는 글리치를 만든다.
 * 재포커스는 useLayoutEffect(페인트 전) — 마지막 배치에서 "더 보기" 버튼이 같은
 * 커밋에 사라져도 body 이탈 창이 없다(헌장 §5).
 */
export function useRevealMore(resetKey: number) {
  const [state, setState] = useState({ key: resetKey, count: NEARBY_INITIAL_VISIBLE });
  if (state.key !== resetKey) {
    setState({ key: resetKey, count: NEARBY_INITIAL_VISIBLE });
  }
  const itemHeadingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  useLayoutEffect(() => {
    const i = pendingFocusIndex.current;
    if (i == null) return;
    pendingFocusIndex.current = null;
    itemHeadingRefs.current[i]?.focus();
  }, [state.count]);
  function reveal() {
    pendingFocusIndex.current = state.count;
    setState((s) => ({ ...s, count: s.count + NEARBY_REVEAL_STEP }));
  }
  return { visibleCount: state.count, reveal, itemHeadingRefs };
}
```

- [ ] **Step 2: `NearbyPanelShell` 구현** (DOM·클래스 byte-identical — 기존 8종 골격 그대로):

```tsx
"use client";

import type { ReactNode, RefObject } from "react";

interface Props {
  triggerLabel: string;
  onTrigger: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  /** autoLoad(채팅 카드)는 트리거를 렌더하지 않는다(라이브·패널은 유지). */
  showTrigger?: boolean;
  /** 단일 polite live region — 셸이 유일 소유자(스펙 §2). 자식은 자체 live 금지. */
  live: string;
  open: boolean;
  heading: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** 헤딩과 닫기 버튼 사이 조건부 공지 슬롯(진료 기준·보완 실패 등 — NightClinics). */
  notice?: ReactNode;
  /** undefined면 닫기 버튼 미렌더(autoLoad). */
  onClose?: () => void;
  closeLabel?: string;
  /** undefined면 미렌더 — WalkInfra는 children이 조건부 footnote를 소유. */
  source?: string;
  children: ReactNode;
}

/** nearby 8종 렌더 골격의 정본 — 트리거·live·패널 껍데기(h3·닫기·source). */
export function NearbyPanelShell({
  triggerLabel,
  onTrigger,
  triggerRef,
  busy,
  showTrigger = true,
  live,
  open,
  heading,
  headingRef,
  notice,
  onClose,
  closeLabel,
  source,
  children,
}: Props) {
  return (
    <div className="mt-3">
      {showTrigger && (
        <button
          ref={triggerRef}
          type="button"
          onClick={onTrigger}
          aria-disabled={busy}
          aria-busy={busy}
          className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
        >
          {triggerLabel}
        </button>
      )}

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {open && (
        <div className="mt-2 rounded-md border border-border p-3">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {heading}
          </h3>
          {notice}
          {onClose && (
            <button
              type="button"
              onClick={() => onClose()}
              className="mt-1 min-h-11 text-sm text-accent underline"
            >
              {closeLabel}
            </button>
          )}
          {children}
          {source && <p className="mt-2 text-xs opacity-70">{source}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 단위 테스트** — 셸: showTrigger false 시 트리거 부재+live 존재, open false 시 패널 부재, notice가 h3과 닫기 사이 순서, source 조건부. 리빌: resetKey 변경 시 10 복귀(글리치 없이 같은 렌더), reveal 시 +10과 인덱스 포커스.
- [ ] **Step 4: lint+test green, 커밋**

### Task 7: NightClinicsNearby 전량 이관 + 교차 패널 테스트 green 전환

**Files:**
- Modify: `src/components/NightClinicsNearby.tsx`
- Modify: `src/components/__tests__/nearby-cross-panel.test.tsx` (`it.fails` → `it` 한 줄만)

**Interfaces:**
- Consumes: `useNearbyFetch`·`useRevealMore`·`NearbyPanelShell`·`nearbyLiveMessage`.

이관 후 컴포넌트 형태(핵심부 — 도메인 렌더 `<li>` 내부는 무변경 유지):

```tsx
export function NightClinicsNearby() {
  const t = useTranslations("clinicNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<{ clinics: ClinicWithStatus[]; basis: HoursBasis; supplementFailed: boolean }>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/clinic/nearby?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        const b = body as { clinics?: ClinicWithStatus[]; basis?: string; supplementFailed?: boolean };
        const clinics = b.clinics ?? [];
        if (clinics.length === 0) return { kind: "empty" };
        return {
          kind: "done",
          data: {
            clinics,
            basis: b.basis === "holiday" ? "holiday" : "weekday",
            supplementFailed: b.supplementFailed === true,
          },
        };
      },
    });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(doneSeq);
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      notice={
        status.kind === "done" && (
          <>
            {status.data.basis === "holiday" && <p className="mt-1 text-sm">{t("basisHoliday")}</p>}
            {status.data.supplementFailed && (
              <p className="mt-1 text-sm">{t("supplementFailedNotice")}</p>
            )}
          </>
        )
      }
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          <ul className="mt-2 space-y-4">
            {status.data.clinics.slice(0, visibleCount).map((c, i) => (
              /* 기존 <li> 렌더 그대로 — status.clinics → status.data.clinics 참조만 변경 */
            ))}
          </ul>
          {status.data.clinics.length > visibleCount && (
            <button type="button" onClick={reveal} className="mt-2 min-h-11 text-sm text-accent underline">
              {tActions("showMore")}
            </button>
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
```

주의: 기존 notice 주석("공휴일 기준으로 읽은 날만…", "보완 소스 실패는 표기…")과 항목 렌더의 모든 주석·구조는 그대로 옮긴다. 삭제되는 것: Status 유니언·formatTime 외 로컬 상수(INITIAL_VISIBLE·REVEAL_STEP)·fetchAt·load·close·useNearbyPanel 배선·포커스 이펙트 2개·live 삼항.

- [ ] **Step 1: 이관** (위 형태로, 도메인 렌더·주석 보존)
- [ ] **Step 2: `nearby-cross-panel.test.tsx`의 `it.fails`를 `it`으로 전환**
- [ ] **Step 3: `npm run lint && npm run test:run`** — NightClinics 계약 10종 + 교차 패널이 전부 green이면 이관·결함 수정 동시 증명
- [ ] **Step 4: 커밋** (컴포넌트+테스트 전환 한 줄)

### Task 8: 표준 3종 이관 (KidsPlaces·Surroundings·SubwayArrivals)

**Files:**
- Modify: `src/components/KidsPlacesNearby.tsx`, `src/components/SurroundingsNearby.tsx`, `src/components/SubwayArrivalsNearby.tsx`

Task 7과 동일 변환을 "대상 9종과 변이 좌표" 표의 값으로 적용:

- KidsPlaces·Surroundings: `useRevealMore` 사용(더 보기), `limit=${NEARBY_LIMIT_MAX}` 유지(`nearby-limits` import 보존), notice 없음.
- SubwayArrivals: 더 보기 없음(`useRevealMore` 미사용, doneSeq 미소비), 항목 렌더(SubwayArrivalList 위임 포함) 무변경.
- 각 파일 이관 삭제 대상은 Task 7과 동일 목록.

- [ ] **Step 1~3: 3파일 이관, lint+test green(각 계약 스위트가 판정), 커밋**

### Task 9: 잔여 5종 이관 (BusArrivals·BikeStations·BarrierFree·WalkInfra·WhereAmI)

**Files:**
- Modify: `src/components/BusArrivals.tsx`, `src/components/BikeStations.tsx`, `src/components/BarrierFreeNearby.tsx`, `src/components/WalkInfraNearby.tsx`, `src/components/WhereAmI.tsx`

파일별 변환 좌표(표 + 아래 특이점 — 그 외는 Task 7 동형):

- **BusArrivals**: `source`는 `props.mode === "place" ? { kind: "place", lat: props.lat, lng: props.lng } : { kind: "current" }`. `onClose: () => setRouteStopsNotice("")`. 트리거 onClick은 래퍼로 현행 순서 보존: `const handleTrigger = () => { setRouteStopsNotice(""); load(status.kind === "done"); };` (notice 리셋이 claim보다 앞 — 현행 load 초입과 동일). live는 `nearbyLiveMessage(status, t, tCommon, () => "") || routeStopsNotice`(단일 채널 합성 — 기존 주석 "done 통지는 헤딩 포커스가 담당…" 이전). 트리거 라벨: done→refresh, 아니면 mode별 currentButton/placeButton.
- **BikeStations**: source 분기 동일, 라벨 분기 동일, 그 외 표준.
- **BarrierFreeNearby**: `source: { kind: "current", autoLoad }`. `onClose: () => { setOpenIds(new Set()); setDetailCache({}); }`. 셸 `showTrigger={!autoLoad}`, `onClose`는 `autoLoad ? undefined : () => close()`(닫기 버튼 미렌더). `useRevealMore` 사용. `toggleFacilities`·`detailInFlightRef`·상세 캐시 렌더는 무변경 보존.
- **WalkInfraNearby**: `coverage: "none"`, `parse: (body) => ({ kind: "done", data: { walk: (body as { walk: WalkInfrastructure }).walk } })`(empty 없음). live는 `nearbyLiveMessage(status, t, tCommon, () => (status.kind === "done" ? buildLive(status.data.walk) : ""))` — `buildLive`는 현행 그대로 보존. 셸 `source` 미전달, `WalkInfraPanel`은 h3·닫기를 셸에 내주고 그룹 3개+footnote만 children으로(내부 구조·주석 무변경).
- **WhereAmI**: `parse`는 `body.data` null이면 empty(`{ kind: "empty" }`), 아니면 `{ kind: "done", data: { data: body.data } }`. live done은 `() => ""`. open 조건 `status.kind === "done" && narrative !== null`. 산문 렌더 무변경.

- [ ] **Step 1~3: 5파일 이관, lint+test green, 커밋** (파일당 커밋 1개 권장 — 최소 BusArrivals·BarrierFree는 개별 커밋)

### Task 10: 문서 갱신 + 죽은 코드 확인

**Files:**
- Modify: `CLAUDE.md`(repo 루트) — 두 곳.
- Run: 워크스페이스 루트에서 `python sync_agent_docs.py`(형제 AGENTS.md 재생성).

- [ ] **Step 1: "개발 규칙" 정정** — "기능·버그픽스는 같은 커밋에 테스트 동반(node-env Vitest엔 컴포넌트 와이어링 레인 없음 → …)" 문장을 다음으로 교체: "기능·버그픽스는 같은 커밋에 테스트 동반. Vitest 전역은 node-env지만 **컴포넌트 테스트는 파일 상단 `// @vitest-environment jsdom` 프라그마 + @testing-library/react 레인이 관례**(`PlaceDetail.test.tsx`·nearby 계약 스위트가 선례). 순수 로직은 node-env fixture 단위테스트, 외부 API 통합은 실호출이 머지 게이트."
- [ ] **Step 2: "UI·상태 패턴" 절에 nearby 공유 계층 한 줄 추가**: "**신규 '내 주변' 도메인은 공유 계층으로 만든다**(2026-07-30 중복 추출): 상태 머신 `useNearbyFetch`(요청 ID latest-wins — 닫힌 패널의 늦은 응답 폐기 포함)+렌더 골격 `NearbyPanelShell`+통지 `nearbyLiveMessage`+단계 공개 `useRevealMore`. 골격 복붙 금지 — 계약은 `src/components/__tests__/nearby-contract.tsx` 스위트로 못 박는다(신규 도메인도 이 스위트 적용). 도메인 고유물(항목 렌더·parse·fetch URL)만 컴포넌트에 남긴다."
- [ ] **Step 3: 죽은 코드 확인** — `grep -rn "INITIAL_VISIBLE\|REVEAL_STEP" src/components/*.tsx`(로컬 선언 잔존 0 확인), 이관 후 미사용 import 잔존은 lint가 잡는다.
- [ ] **Step 4: `python sync_agent_docs.py` 실행(워크스페이스 루트), lint+test, 커밋** (CLAUDE.md·AGENTS.md 동커밋)

---

## 실행 후 게이트 (컨트롤러 담당 — 태스크 아님)

1. 최종 전체 브랜치 리뷰(최상위 모델) — 계약 테스트 무수정 검증(git log로 Task 4 이후 계약 파일 diff 0 확인) 포함.
2. a11y-auditor 점검(스펙 §성과의 판정 기준).
3. `npm run build` + push(자동 배포) + 프로덕션 스모크.
4. 수동 VO 시나리오 4종은 위원장 실사용 몫으로 PROGRESS에 기록.
