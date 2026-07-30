# 옴니박스 중심 웹 IA 재편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹 홈을 옴니박스(검색+AI 질문 듀얼 액션) 중심으로 비우고, "내 주변" 9종을 허브 뷰로 이동, 채팅 진입점 5→2 축소, 장소 상세 딥링크 9~10→3~4 압축.

**Architecture:** `PlaceSearch.tsx`의 기존 "같은 페이지 뷰 전환"(directions/selected 조건부 렌더 + History pushState/popstate + 쿼리 파라미터 동기화) 패턴을 그대로 확장해 `nearbyOpen` 뷰를 추가한다. 9개 아코디언 컴포넌트는 무수정 이동(계약 보존), 채팅은 `ChatOverlay`의 place를 옵셔널화해 범용 모드를 얻는다.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4, Tailwind v4, Vitest(node env — 순수 로직만 단위 테스트, 컴포넌트는 lint+build+실측).

**정본 스펙:** `docs/superpowers/specs/2026-07-30-omnibox-web-ia-redesign-design.md`

## Global Constraints

- 접근성 헌장(`~/.claude/ACCESSIBILITY.md`) 및 repo CLAUDE.md 접근성 절 준수: 과잉 ARIA 금지, 한 줄=한 접근성 객체, 터치 타깃 `min-h-11`, 단일 polite live region, UI 라벨 이모지 금지, em dash 금지.
- SVG 아이콘(lucide-react)은 `aria-hidden="true"`.
- i18n: 신규 UI 문자열은 `messages/{ko,en,es,fr,it,ja}.json` 6로케일 동시 추가(`i18n-messages.test.ts`가 머지 게이트). 문자열 하드코딩 금지.
- 버튼 비활성화는 `disabled` 금지, `aria-disabled`+핸들러 가드.
- 커밋: `git add <명시 파일>`만(`-A` 금지), 이메일 `engccer@gmail.com`, 메시지 한국어, 각 커밋 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 매 태스크 종료 전 `npm run lint && npm run test:run` green 확인.
- [AI에게 질문]은 `?q=` 미기록·검색 API 미호출(스펙 §1).
- 기존 컴포넌트를 옮길 때 `aria-labelledby`·`useId`·heading 계층을 삭제하지 말 것(자동 등장 region 계약).

---

### Task 1: 장소 상세 딥링크 압축 (RouteLinks 9~10 → 2~3)

`PlaceDetail`에는 이미 "여기까지 길찾기" 버튼(`directions.toHere`)이 RouteLinks 바깥에 있다. RouteLinks는 프로바이더 대표 "열기" 버튼만 남긴다: 네이버(모바일=앱 스킴+미설치 폴백, 데스크톱=웹 지도) + 카카오(웹 URL이 앱 전환 자체 처리) + 조건부 상세페이지.

**Files:**
- Modify: `src/lib/deeplink.ts` (isMobileUserAgent 추가)
- Modify: `src/components/RouteLinks.tsx` (전면 교체)
- Test: `src/lib/__tests__/deeplink.test.ts` (기존 파일 있으면 추가, 없으면 생성)
- Modify: `messages/ko.json` 외 5로케일 (사용 종료 키 제거는 Task 6에서)

**Interfaces:**
- Consumes: `buildPlaceDeeplink(place, appName)`, `buildWebFallbackUrl(query)` (deeplink.ts 기존), `buildKakaoWebMapUrl(place)` (deeplink-kakao.ts 기존)
- Produces: `isMobileUserAgent(ua: string): boolean` (deeplink.ts export — 순수 함수)

- [ ] **Step 1: isMobileUserAgent 실패 테스트 작성**

```ts
// src/lib/__tests__/deeplink.test.ts 에 추가 (파일 없으면 생성, 기존 테스트 관례 따름)
import { describe, expect, it } from "vitest";
import { isMobileUserAgent } from "@/lib/deeplink";

describe("isMobileUserAgent", () => {
  it("iPhone UA는 모바일", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe(true);
  });
  it("Android UA는 모바일", () => {
    expect(
      isMobileUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36"),
    ).toBe(true);
  });
  it("iPad UA는 모바일(앱 딥링크 유효)", () => {
    expect(
      isMobileUserAgent("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15"),
    ).toBe(true);
  });
  it("macOS 데스크톱 UA는 비모바일", () => {
    expect(
      isMobileUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      ),
    ).toBe(false);
  });
  it("Windows 데스크톱 UA는 비모바일", () => {
    expect(
      isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:run -- src/lib/__tests__/deeplink.test.ts` / Expected: FAIL (`isMobileUserAgent` export 없음)

- [ ] **Step 3: deeplink.ts에 구현**

```ts
// src/lib/deeplink.ts 끝에 추가
/**
 * 모바일 UA 판별 — 네이버 "열기" 버튼의 경로 분기(모바일=앱 스킴 시도, 데스크톱=웹 지도).
 * iPadOS 13+ 사파리는 Macintosh로 위장하지만, 위장 UA에서 nmap:// 실패 시에도
 * 아래 폴백 타이머가 웹 지도로 회복하므로 오판의 실해가 없다(과잉 판별 금지).
 */
export function isMobileUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:run -- src/lib/__tests__/deeplink.test.ts` / Expected: PASS

- [ ] **Step 5: RouteLinks.tsx 전면 교체**

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { Place } from "@/lib/types";
import {
  buildPlaceDeeplink,
  buildWebFallbackUrl,
  isMobileUserAgent,
} from "@/lib/deeplink";
import { buildKakaoWebMapUrl } from "@/lib/deeplink-kakao";

const APPNAME =
  process.env.NEXT_PUBLIC_APP_IDENTIFIER ?? "space.dodoplanet.gildongmu";

/**
 * 외부 지도 앱 "열기" 버튼 묶음 — 프로바이더당 대표 1개(스펙 2026-07-30 §4).
 * 모드(도보·대중교통·자동차) 선택은 길찾기 뷰의 책임이라 여기서 전개하지 않는다.
 * 네이버는 환경별 폴백 내장: 모바일=nmap:// 시도 후 미설치 시 웹 지도 타이머 폴백
 * (앱이 열리면 pagehide/visibilitychange가 타이머를 취소), 데스크톱=웹 지도 직행.
 * 카카오는 웹 URL이 모바일 앱 전환을 자체 처리하므로 앵커 하나로 충분.
 */
export function RouteLinks({ place }: { place: Place }) {
  const t = useTranslations();

  function openNaver() {
    const webUrl = buildWebFallbackUrl(place.name);
    if (!isMobileUserAgent(navigator.userAgent)) {
      window.open(webUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const timer = window.setTimeout(() => {
      window.location.href = webUrl;
    }, 1500);
    const cancel = () => window.clearTimeout(timer);
    window.addEventListener("pagehide", cancel, { once: true });
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.location.href = buildPlaceDeeplink(place, APPNAME);
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={openNaver}
        className="min-h-11 rounded-md border border-border px-4 py-2 text-sm font-medium"
      >
        {t("place.openInNaverMap")}
      </button>
      <a
        href={buildKakaoWebMapUrl({ lat: place.lat, lng: place.lng, name: place.name })}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-sm font-medium"
      >
        {t("place.openInKakaoMap")}
      </a>
      {place.link && (
        <a
          href={place.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-sm"
        >
          {t("place.detailPage")}
        </a>
      )}
    </div>
  );
}
```

주의: `buildKakaoWebMapUrl`의 정확한 파라미터 형태는 `src/lib/deeplink-kakao.ts:87` 시그니처를 열어 맞출 것(기존 호출은 `dest = { lat, lng, name }` 객체를 넘겼다). `place.openInNaverMap`·`place.openInKakaoMap`·`place.detailPage` 키는 6로케일에 이미 존재(신규 키 없음).

- [ ] **Step 6: lint+test+수동 확인** — Run: `npm run lint && npm run test:run` / Expected: green. `npm run dev`로 장소 상세를 열어 링크가 3개(link 있으면 4개)인지, 데스크톱에서 네이버 버튼이 새 탭 웹 지도를 여는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/deeplink.ts src/lib/__tests__/deeplink.test.ts src/components/RouteLinks.tsx
git commit -m "feat(web): 장소 상세 딥링크 압축 — 프로바이더당 대표 열기 1개, 모드 선택은 길찾기 뷰 위임

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 채팅 진입점 축소 (내 주변 항목별·WhereAmI 채팅 버튼 제거)

**Files:**
- Modify: `src/components/WhereAmI.tsx`, `src/components/NightClinicsNearby.tsx`, `src/components/KidsPlacesNearby.tsx`, `src/components/SurroundingsNearby.tsx` (각각 `canShowChat` prop·채팅 버튼·ChatOverlay 사용 제거)
- Modify: `src/components/PlaceSearch.tsx:853-889` (네 컴포넌트 호출부에서 `canShowChat` prop 제거)

**Interfaces:**
- Produces: 네 컴포넌트의 props에서 `canShowChat` 소멸. `PlaceDetail`만 `canShowChat`을 유지.

- [ ] **Step 1: 사용처 전수 조사** — Run: `grep -n "canShowChat\|ChatOverlay\|chatOpen" src/components/WhereAmI.tsx src/components/NightClinicsNearby.tsx src/components/KidsPlacesNearby.tsx src/components/SurroundingsNearby.tsx` — 각 파일에서 제거 대상 라인을 확정한다(항목별 채팅 버튼은 `NightClinicsNearby.tsx:341`, `KidsPlacesNearby.tsx:277`, `SurroundingsNearby.tsx:263` 부근).

- [ ] **Step 2: 네 컴포넌트에서 제거** — 각 파일에서 ① props 타입·구조분해의 `canShowChat` ② 채팅 트리거 버튼 JSX ③ `ChatOverlay` import·렌더·`chatOpen` state·트리거 ref ④ 채팅 전용 헬퍼(장소 합성 등, 다른 곳에서 안 쓰이면)를 제거한다. 항목 렌더 줄의 나머지(이름 heading·정보 텍스트·전화 링크)는 건드리지 않는다.

- [ ] **Step 3: PlaceSearch 호출부 정리** — `<WhereAmI canShowChat={canShowChat} />` → `<WhereAmI />` 등 4곳. `PlaceSearch`의 `canShowChat` prop 자체는 유지(Task 5의 범용 채팅과 `PlaceDetail`에 필요).

- [ ] **Step 4: 잔존 참조 0 확인** — Run: `grep -rn "canShowChat" src/components/WhereAmI.tsx src/components/NightClinicsNearby.tsx src/components/KidsPlacesNearby.tsx src/components/SurroundingsNearby.tsx` / Expected: 출력 없음. `npm run lint && npm run test:run && npm run build` green.

- [ ] **Step 5: 커밋**

```bash
git add src/components/WhereAmI.tsx src/components/NightClinicsNearby.tsx src/components/KidsPlacesNearby.tsx src/components/SurroundingsNearby.tsx src/components/PlaceSearch.tsx
git commit -m "feat(web): 채팅 진입점 축소 — 내 주변 항목별·WhereAmI 채팅 버튼 제거(상세 경유로 수렴)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ChatOverlay 범용 모드 (place 옵셔널 + 첫 질문 자동 전송)

**Files:**
- Modify: `src/components/chat/ChatOverlay.tsx` (place 옵셔널, initialMessage 전달, 범용 제목)
- Modify: `src/components/chat/ChatInterface.tsx` (initialMessage 1회 자동 전송)
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json` (범용 제목 키)

**Interfaces:**
- Consumes: `useChat({ placeContext })` — `placeContext` undefined면 기존 동작 byte-identical(기존 계약).
- Produces: `ChatOverlay({ place?, initialMessage?, onClose })`, `ChatInterface({ inputRef?, placeContext?, examplePrompts?, initialMessage? })`

- [ ] **Step 1: ChatInterface에 initialMessage 추가**

```tsx
// props에 initialMessage?: string 추가 후, useChat 선언 아래에:
// 범용 채팅(옴니박스 [AI에게 질문])의 첫 질문 자동 전송 — 마운트 1회만.
// playSend는 생략: effect는 사용자 제스처 콜스택 밖이라 AudioContext unlock이
// 안 되며, 무음 재생 시도는 노이즈다(완료음은 이후 제스처 시점부터 정상).
const initialSentRef = useRef(false);
useEffect(() => {
  if (!initialMessage || initialSentRef.current) return;
  initialSentRef.current = true;
  void sendMessage(initialMessage);
}, [initialMessage, sendMessage]);
```

- [ ] **Step 2: ChatOverlay의 place 옵셔널화** — `{ place, initialMessage, onClose }: { place?: Place; initialMessage?: string; onClose: () => void }`로 바꾸고:
  - `placeContext`: `place ? { name: place.name, lat: place.lat, lng: place.lng, category: place.category, isStation: isStation(place) } : undefined`
  - `examplePrompts`: `place ? placeChatPrompts(place).map((key) => t(key)) : undefined` (범용 채팅은 예시 프롬프트 없이 — 미니멀, 빈 상태 문구는 기존 `placeChat.empty` 재사용 여부를 열어 확인하고 place 없을 땐 `chat.generalEmpty` 신규 키 사용)
  - 제목(h2) 텍스트: place 있으면 기존 그대로, 없으면 `t("chat.generalTitle")`. ChatOverlay.tsx 80행 이후 렌더부를 열어 기존 제목 키를 확인 후 분기.
  - `<ChatInterface placeContext={placeContext} examplePrompts={examplePrompts} initialMessage={initialMessage} inputRef={chatInputRef} />`로 전달(기존 전달 방식 확인 후 동일하게).

- [ ] **Step 3: i18n 키 추가** — 6로케일 모두 `chat.generalTitle`(ko: "AI에게 질문"), `chat.generalEmpty`(ko: "장소, 길찾기, 주변 정보를 물어보세요.") 추가. 각 로케일은 해당 언어로 자연스럽게 번역(en: "Ask AI" / "Ask about places, directions, or what's nearby." 등).

- [ ] **Step 4: 게이트 테스트 확인** — Run: `npm run test:run` / Expected: green (`i18n-messages.test.ts`가 6로케일 키 일치를 검증). `npm run lint` green. 기존 장소 앵커 채팅 호출부(`PlaceDetail`)는 place를 넘기므로 무변경 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/components/chat/ChatOverlay.tsx src/components/chat/ChatInterface.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
git commit -m "feat(chat): ChatOverlay 범용 모드 — place 옵셔널 + 첫 질문 자동 전송(옴니박스 준비)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 내 주변 허브 뷰 (9개 섹션 이동 + `?panel=nearby` + History)

**Files:**
- Create: `src/components/NearbyHub.tsx`
- Modify: `src/components/PlaceSearch.tsx` (nearbyOpen 상태·popstate·마운트 복원·홈 섹션 제거·칩 추가)
- Modify: `messages/*.json` 6로케일 (`nearby.hubTitle`, `nearby.hubEntry`, `nearby.hubBack`)

**Interfaces:**
- Consumes: 9개 섹션 컴포넌트(무수정 — Task 2 이후 형태), `LocalConditions`, `useGeolocation`, `getActiveNearbyPanel`/`subscribeNearbyPanel`(`src/lib/nearby-panel-store.ts`)
- Produces: `NearbyHub({ canShowWhereAmI, canShowSubway, canShowBus, canShowBike, canShowClinic, canShowBarrierFree, canShowKids, canShowSurroundings, canShowAir, onBack }: { ...전부 boolean; onBack: () => void })`

- [ ] **Step 1: NearbyHub.tsx 생성**

```tsx
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  getActiveNearbyPanel,
  getServerActiveNearbyPanel,
  subscribeNearbyPanel,
} from "@/lib/nearby-panel-store";
import { WhereAmI } from "./WhereAmI";
import { SubwayArrivalsNearby } from "./SubwayArrivalsNearby";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { NightClinicsNearby } from "./NightClinicsNearby";
import { BarrierFreeNearby } from "./BarrierFreeNearby";
import { KidsPlacesNearby } from "./KidsPlacesNearby";
import { SurroundingsNearby } from "./SurroundingsNearby";
import { WalkInfraNearby } from "./WalkInfraNearby";
import { LocalConditions } from "./LocalConditions";

/**
 * "내 주변" 허브 — 홈에 평면 나열되던 9개 도메인 섹션의 새 거처(스펙 2026-07-30 §2).
 * 섹션 컴포넌트들은 무수정 이동: 아코디언·단일 점유(nearby-panel-store)·포커스 계약을
 * 그대로 보존하고, 허브 자체의 열림/닫힘만 PlaceSearch의 URL·History가 소유한다.
 *
 * Esc = 뒤로가기 동등(스펙 §2). 단 아코디언 패널이 점유 중이면 그 패널의 자체 Esc가
 * 우선이므로 허브 Esc는 비활성(스택된 전역 Esc 경합 규칙과 동형).
 */
export function NearbyHub({
  canShowWhereAmI,
  canShowSubway,
  canShowBus,
  canShowBike,
  canShowClinic,
  canShowBarrierFree,
  canShowKids,
  canShowSurroundings,
  canShowAir,
  onBack,
}: {
  canShowWhereAmI: boolean;
  canShowSubway: boolean;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowClinic: boolean;
  canShowBarrierFree: boolean;
  canShowKids: boolean;
  canShowSurroundings: boolean;
  canShowAir: boolean;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const geo = useGeolocation();
  const userCoords = geo.status === "ready" ? geo.coords : null;
  const activePanel = useSyncExternalStore(
    subscribeNearbyPanel,
    getActiveNearbyPanel,
    getServerActiveNearbyPanel,
  );

  // 뷰 전환 포커스 이동(접근성 1급 — PlaceDetail·DirectionsView와 동형 rAF 패턴).
  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc = 뒤로가기. 아코디언 패널 점유 중엔 그 패널 Esc가 우선(경합 차단).
  useEffect(() => {
    if (activePanel !== null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, onBack]);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("nearby.hubBack")}
      </button>
      <h2 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold">
        {t("nearby.hubTitle")}
      </h2>
      {/* 날씨·공기질 — 홈에서 이동. 좌표 준비 시 자동 등장 region(계약 유지). */}
      {canShowAir && userCoords && (
        <div className="mt-4">
          <LocalConditions lat={userCoords.lat} lng={userCoords.lng} />
        </div>
      )}
      {canShowWhereAmI && <WhereAmI />}
      {canShowSubway && (
        <div className="mt-4">
          <SubwayArrivalsNearby />
        </div>
      )}
      {canShowBus && (
        <div className="mt-4">
          <BusArrivals mode="current" />
        </div>
      )}
      {canShowBike && (
        <div className="mt-4">
          <BikeStations mode="current" />
        </div>
      )}
      {canShowClinic && (
        <div className="mt-4">
          <NightClinicsNearby />
        </div>
      )}
      {canShowBarrierFree && (
        <div className="mt-4">
          <BarrierFreeNearby />
        </div>
      )}
      {canShowKids && (
        <div className="mt-4">
          <KidsPlacesNearby />
        </div>
      )}
      {canShowSurroundings && (
        <div className="mt-4">
          <SurroundingsNearby />
        </div>
      )}
      {/* 게이트 없음(음향신호기=무인증 seed, OSM=무키 공개 인스턴스) — 항상 노출. */}
      <div className="mt-4">
        <WalkInfraNearby />
      </div>
    </div>
  );
}
```

주의: `LocalConditions`를 섹션 최상단에 두는 이유는 스펙 §2(허브 상단 자동 region). 홈에서는 "내 주변 버튼 아래 배치"가 위원장 선호였으나 허브에서는 상단이 스펙 확정값이다.

- [ ] **Step 2: PlaceSearch에 nearbyOpen 상태·History·URL 연동 추가**

```tsx
// state 추가 (directions 아래):
// "내 주변" 허브 뷰(스펙 2026-07-30). 열림/닫힘은 URL(?panel=nearby)이 정본,
// History 스택은 directions와 동형 규율(직접 진입 시 스택 합성 없음 — 닫기가
// URL을 정리하는 방어 경로).
const [nearbyOpen, setNearbyOpen] = useState(false);

// 진입(홈 칩): pushState + URL 동기화. 화면 전환이므로 pushState(스펙 §2).
function openNearbyHub() {
  const url = new URL(window.location.href);
  url.searchParams.set("panel", "nearby");
  window.history.pushState(
    { ...(window.history.state ?? {}), nearby: true },
    "",
    url,
  );
  window.dispatchEvent(new Event("gildongmu:locationchange"));
  setNearbyOpen(true);
}
function backFromNearbyHub() {
  if (window.history.state?.nearby) {
    window.history.back();
  } else {
    // 방어: ?panel=nearby 딥링크 직진입. 닫으면서 URL 정리(backFromDirections 동형).
    const url = new URL(window.location.href);
    url.searchParams.delete("panel");
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event("gildongmu:locationchange"));
    setNearbyOpen(false);
    nearbyEntryRef.current?.focus();
  }
}
```

`onPop` 핸들러(`PlaceSearch.tsx:231` 부근)를 다음 형태로 확장한다(directions 분기 유지, nearby 분기 추가, 마지막 분기에서 허브 닫힘 포커스 복원). `nearbyEntryRef`는 Step 3에서, `nearbyOpenRef`는 `statusRef` 미러 패턴과 동형으로 선언한다:

```tsx
function onPop(e: PopStateEvent) {
  const st = e.state as {
    place?: string;
    directions?: boolean;
    nearby?: boolean;
  } | null;
  if (st?.directions) {
    const parsed = parseDir(
      new URLSearchParams(window.location.search).get("dir"),
    );
    setDirections(parsed ?? { to: null });
    return;
  }
  setDirections(null);
  if (st?.nearby) {
    // 앞으로가기 재진입 포함 — URL ?panel=nearby가 정본이므로 상태만 복원.
    setNearbyOpen(true);
    return;
  }
  if (st?.place) {
    setNearbyOpen(false);
    return;
  }
  // 홈 복귀: 닫힌 뷰가 허브였으면 진입 칩으로(트리거 복귀 계약), 아니면 기존
  // 결과 헤딩/길찾기 버튼 복귀.
  const wasNearby = nearbyOpenRef.current;
  setSelected(null);
  setNearbyOpen(false);
  if (wasNearby) {
    requestAnimationFrame(() => nearbyEntryRef.current?.focus());
  } else {
    focusResultsHeadingIfDone();
  }
}
```

첫 마운트 복원(didAutoSearch effect 안, `?dir=` 복원 다음):

```tsx
// ?panel=nearby 딥링크·새로고침 복원(스택 합성 없음 — 뒤로가기는 브라우저 기본).
if (params.get("panel") === "nearby")
  queueMicrotask(() => setNearbyOpen(true));
```

- [ ] **Step 3: 렌더 우선순위·홈 개편** — 렌더 분기(`if (directions)` → `if (selected)`)에 이어 `if (nearbyOpen)` 추가:

```tsx
if (nearbyOpen) {
  return (
    <NearbyHub
      canShowWhereAmI={canShowWhereAmI}
      canShowSubway={canShowSubway}
      canShowBus={canShowBus}
      canShowBike={canShowBike}
      canShowClinic={canShowClinic}
      canShowBarrierFree={canShowBarrierFree}
      canShowKids={canShowKids}
      canShowSurroundings={canShowSurroundings}
      canShowAir={canShowAir}
      onBack={backFromNearbyHub}
    />
  );
}
```

홈 idle에서 9개 섹션 렌더 블록(`PlaceSearch.tsx:852-904`, WhereAmI~LocalConditions)을 전부 삭제하고, 길찾기 진입 버튼 옆에 [내 주변] 칩을 추가해 한 행으로 묶는다:

```tsx
{/* 결정론 내비 칩: [길찾기] [내 주변] — 홈의 기능 진입은 이 행 하나로 수렴. */}
<div className="mt-4 flex flex-wrap gap-2">
  {canShowDirections && (
    <button
      ref={dirEntryRef}
      type="button"
      onClick={() => openDirections(null)}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
    >
      <Route aria-hidden="true" className="h-4 w-4" />
      {t("directions.title")}
    </button>
  )}
  {status.kind === "idle" && (
    <button
      ref={nearbyEntryRef}
      type="button"
      onClick={openNearbyHub}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
    >
      <Compass aria-hidden="true" className="h-4 w-4" />
      {t("nearby.hubEntry")}
    </button>
  )}
</div>
```

`nearbyEntryRef`는 `dirEntryRef` 옆에 선언: `const nearbyEntryRef = useRef<HTMLButtonElement>(null);`. `Compass`는 lucide-react에서 import. `nearbyOpenRef` 미러는 `statusRef` 패턴과 동형으로 선언.

- [ ] **Step 4: i18n 키 추가** — 6로케일에 `nearby.hubTitle`(ko: "내 주변"), `nearby.hubEntry`(ko: "내 주변"), `nearby.hubBack`(ko: "뒤로") — 기존에 동등 키(`actions.back` 류)가 있으면 신설하지 말고 재사용(grep으로 확인).

- [ ] **Step 5: 검증** — Run: `npm run lint && npm run test:run && npm run build` / Expected: green. `npm run dev` 수동 시나리오: ① 홈→내 주변→아코디언 펼침→Esc(패널만 닫힘)→Esc(허브 닫힘·칩 포커스) ② 허브에서 새로고침→허브 복원→뒤로가기 ③ `?panel=nearby` 직접 진입→닫기 버튼→URL 정리 ④ 홈에 9개 섹션이 없는지.

- [ ] **Step 6: 커밋**

```bash
git add src/components/NearbyHub.tsx src/components/PlaceSearch.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
git commit -m "feat(web): 내 주변 허브 뷰 — 홈 9개 섹션 이동, ?panel=nearby URL·History 연동

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 옴니박스 듀얼 액션 (+범용 채팅 진입)

**Files:**
- Modify: `src/components/SearchBar.tsx` (onAsk 옵셔널 prop → [AI에게 질문] 버튼)
- Modify: `src/components/PlaceSearch.tsx` (범용 채팅 상태·ChatOverlay 렌더)
- Modify: `messages/*.json` 6로케일 (`search.askAi`)

**Interfaces:**
- Consumes: `ChatOverlay({ place?, initialMessage?, onClose })` (Task 3 산출)
- Produces: `SearchBar`에 `onAsk?: () => void` prop — 있으면 검색 버튼 뒤에 [AI에게 질문] 버튼 렌더

- [ ] **Step 1: SearchBar에 onAsk 추가** — props에 `onAsk?: () => void` 추가, 제출 버튼 다음에:

```tsx
{onAsk && (
  <button
    type="button"
    onClick={onAsk}
    className="inline-flex min-h-12 items-center rounded-md border border-accent px-4 text-lg font-semibold text-accent"
  >
    {t("askAi")}
  </button>
)}
```

`useTranslations("search")` 스코프이므로 키는 `search.askAi`. Enter는 기존대로 폼 제출=검색(듀얼 액션 계약: 분기는 버튼 선택, 추측 0).

- [ ] **Step 2: PlaceSearch에 범용 채팅 연결**

```tsx
// 범용 채팅(옴니박스 [AI에게 질문], 스펙 §1·§3). 입력 텍스트는 1회성 전달 —
// ?q= 미기록·검색 API 미호출. 닫기는 트리거(SearchBar 영역)로 포커스 복귀 대신
// 검색 입력창으로 복귀한다(질문 흐름의 자연스러운 다음 행동 = 재입력).
const [generalChat, setGeneralChat] = useState<{ seed?: string } | null>(null);

function openGeneralChat() {
  setGeneralChat({ seed: query.trim() || undefined });
}
```

렌더(반환 JSX의 SearchBar 아래 아무 위치, 조건부):

```tsx
{generalChat && (
  <ChatOverlay
    initialMessage={generalChat.seed}
    onClose={() => {
      setGeneralChat(null);
      searchInputRef.current?.focus();
    }}
  />
)}
```

SearchBar 호출부에 `onAsk={canShowChat ? openGeneralChat : undefined}` 추가. `ChatOverlay` import 추가. 홈이 아닌 뷰(directions/selected/nearby)는 early return이라 오버레이는 홈에서만 성립 — 의도와 일치.

- [ ] **Step 3: i18n 키 추가** — 6로케일 `search.askAi`(ko: "AI에게 질문", en: "Ask AI", 나머지 로케일 자연 번역).

- [ ] **Step 4: 검증** — Run: `npm run lint && npm run test:run && npm run build` / Expected: green. 수동: ① 입력 후 [AI에게 질문] → 오버레이가 그 텍스트로 첫 질문 자동 전송, URL에 ?q= 없음 ② 빈 입력 → 빈 채팅 ③ Esc 닫기 → 검색 입력창 포커스 ④ Enter는 여전히 검색.

- [ ] **Step 5: 커밋**

```bash
git add src/components/SearchBar.tsx src/components/PlaceSearch.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
git commit -m "feat(web): 옴니박스 듀얼 액션 — [AI에게 질문] 범용 채팅 진입(1회성 전달, ?q= 미기록)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 죽은 키 정리 + 문서 갱신 + 최종 게이트

**Files:**
- Modify: `messages/*.json` 6로케일 (미사용 키 제거)
- Modify: `PROGRESS.md` (마일스톤 기록), `CLAUDE.md` (UI·상태 패턴 절의 홈/허브·채팅 진입·딥링크 관련 서술 현행화 — 항구 규칙만, 간결)

- [ ] **Step 1: 미사용 i18n 키 제거** — Task 1·2로 사용이 끝났을 후보를 grep으로 확정 후 6로케일에서 동시 제거: `route.naverLabel`, `route.kakaoLabel`, `route.naverModeAction`, `route.kakaoModeAction`, `route.deeplinkHint`(각각 `grep -rn "naverModeAction" src packages` 출력 0일 때만 — `route.walk`·`route.public`·`route.car`는 DirectionsView가 쓰므로 제거 금지), WhereAmI·목록 3종의 채팅 라벨 키(해당 컴포넌트 diff에서 사라진 키만).

- [ ] **Step 2: 문서 갱신** — `PROGRESS.md`에 이번 마일스톤(홈 컨트롤 17→약 9, 딥링크 9~10→3~4, 채팅 진입 5→2, `?panel=nearby`) 기록. `CLAUDE.md`의 "내 주변 패널" 서술에 "홈이 아니라 허브 뷰(`NearbyHub`) 안"임을, 채팅 절에 "메인 진입은 옴니박스 [AI에게 질문](범용)" 한 줄을 반영.

- [ ] **Step 3: 전체 게이트** — Run: `npm run lint && npm run test:run && npm run build` / Expected: green.

- [ ] **Step 4: a11y-auditor 서브에이전트 점검** — 변경 파일(RouteLinks·NearbyHub·PlaceSearch·SearchBar·ChatOverlay) 대상으로 헌장 기준 감사(과잉 ARIA 추가 여부·포커스 계약·heading 계층). 지적은 헌장 기준으로 판정 후 수정.

- [ ] **Step 5: 스펙 검증 행렬 수동 확인** — 스펙 "성과" 절의 행렬: ① 화면 전환 포커스 이동(허브·채팅·복귀) ② 딥링크 직접 진입·새로고침·뒤로가기 중첩 ③ 게이트 관련 폴백 ④ 채팅 오버레이 Esc 경합(허브 Esc는 이 계획에서 activePanel 조건으로 차단됨 — 범용 채팅은 홈 전용이라 허브와 비공존) ⑤ 포커스 비대칭. 데스크톱+모바일(실기기 Safari) 각 1회.

- [ ] **Step 6: 커밋 + push(자동배포) + 프로덕션 확인**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json PROGRESS.md CLAUDE.md
git commit -m "docs+i18n: 옴니박스 IA 재편 마무리 — 죽은 키 정리·문서 현행화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

push 후 https://gildongmu.vercel.app 에서 검색→상세→길찾기→채팅 흐름과 허브를 실사용 확인(배포 직후 hydration #418 transient는 스테일 SW — 코드 결함으로 오진 금지).
