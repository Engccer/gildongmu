# 장소 상세 주소 복사 버튼 배치 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세의 복사 버튼을 주소 블록 오른쪽 상단에 묶어 정보 흐름을 개선하면서 기존 접근성과 복사 동작을 보존한다.

**Architecture:** `PlaceDetail` 내부의 주소 텍스트와 복사 버튼만 하나의 반응형 flex 블록으로 재배치한다. 클립보드 함수와 상태 통지는 변경하지 않고, jsdom 컴포넌트 테스트로 DOM 그룹·읽기 순서·터치 영역·복사 동작을 고정한 뒤 실제 브라우저에서 데스크톱과 모바일 배치를 비교한다.

**Tech Stack:** Next.js 16.2.9, React 19.2.4, TypeScript, Tailwind CSS 4, Vitest 4.1.8, React Testing Library, jsdom

## Global Constraints

- 주소 단락은 라벨과 값을 단일 텍스트 노드로 유지한다.
- 복사 버튼은 주소와 별도의 접근성 객체로 유지한다.
- 버튼의 접근 가능한 이름, 키보드 포커스, 최소 44×44px 터치 영역을 보존한다.
- 복사 성공 통지는 기존 단일 polite `role="status"` 경로를 유지한다.
- 클립보드 함수, 번역 문구, 외부 API, 상세 화면의 다른 동작은 바꾸지 않는다.
- 코드 주석·커밋 메시지는 한국어로 작성하고 의도 파일만 stage한다.

---

### Task 1: 주소 블록 배치 계약과 복사 동작 고정

**Files:**
- Create: `src/components/__tests__/PlaceDetail.test.tsx`
- Modify: `src/components/PlaceDetail.tsx:101-129`

**Interfaces:**
- Consumes: `PlaceDetail`의 기존 props와 `navigator.clipboard.writeText(address)` 동작
- Produces: 주소 텍스트 묶음과 복사 버튼을 같은 flex 컨테이너에 두는 DOM 계약

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`src/components/__tests__/PlaceDetail.test.tsx`를 만들고 모든 하위 기능 컴포넌트를 빈 컴포넌트로 mock한다. 핵심 테스트는 다음 내용을 포함한다.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/station-match", () => ({ isStation: () => false }));
vi.mock("../RouteLinks", () => ({ RouteLinks: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteBriefing: () => null }));
vi.mock("../StationMeta", () => ({ StationMeta: () => null }));
vi.mock("../StationFacilities", () => ({ StationFacilities: () => null }));
vi.mock("../SeoulMetroFacilities", () => ({ SeoulMetroFacilities: () => null }));
vi.mock("../SeoulSubwayArrival", () => ({ SeoulSubwayArrival: () => null }));
vi.mock("../BusArrivals", () => ({ BusArrivals: () => null }));
vi.mock("../BikeStations", () => ({ BikeStations: () => null }));
vi.mock("../LocalConditions", () => ({ LocalConditions: () => null }));
vi.mock("../BarrierFreeInfo", () => ({ BarrierFreeInfo: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteBriefing: () => null }));
vi.mock("../chat/ChatOverlay", () => ({ ChatOverlay: () => null }));

import { PlaceDetail } from "../PlaceDetail";

const place = {
  id: "place-1",
  name: "경복궁 관훈점",
  category: "음식점 > 한식",
  address: "서울 종로구 관훈동 198-42",
  roadAddress: "서울 종로구 인사동5길 38",
  englishAddress: "38 Insadong 5-gil, Jongno-gu, Seoul",
  lat: 37.5725,
  lng: 126.9842,
  phone: "02-722-7713",
};

function renderDetail() {
  return render(
    <PlaceDetail
      place={place}
      canBriefCarRoute={false}
      canShowBus={false}
      canShowBike={false}
      canShowSubway={false}
      canShowAir={false}
      canShowBarrierFree={false}
      canShowTransit={false}
      onBack={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("PlaceDetail 주소 복사", () => {
  it("주소 텍스트와 복사 버튼을 같은 반응형 블록에 묶는다", () => {
    renderDetail();
    const copyButton = screen.getByRole("button", { name: "place.copyAddress" });
    const address = screen.getByText(`place.address ${place.englishAddress}`);
    const addressBlock = address.parentElement?.parentElement;

    expect(addressBlock).toBeTruthy();
    expect(addressBlock?.contains(copyButton)).toBe(true);
    expect(addressBlock?.classList.contains("flex")).toBe(true);
    expect(addressBlock?.classList.contains("items-start")).toBe(true);
    expect(addressBlock?.classList.contains("gap-2")).toBe(true);
    expect(copyButton.classList.contains("min-h-11")).toBe(true);
    expect(copyButton.classList.contains("min-w-11")).toBe(true);
    expect(copyButton.classList.contains("shrink-0")).toBe(true);
  });

  it("주소 다음에 복사 버튼, 전화번호 순으로 읽힌다", () => {
    const { container } = renderDetail();
    const address = screen.getByText(`place.address ${place.englishAddress}`);
    const copyButton = screen.getByRole("button", { name: "place.copyAddress" });
    const phone = screen.getByText("02-722-7713").closest("p");

    expect(address.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copyButton.compareDocumentPosition(phone!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 테스트가 올바른 이유로 실패하는지 확인**

Run: `npm run test:run -- src/components/__tests__/PlaceDetail.test.tsx`

Expected: 첫 테스트가 기존 DOM에서 주소와 버튼이 같은 flex 블록에 있지 않고 버튼에 `min-w-11`·`shrink-0`이 없어 FAIL한다.

- [ ] **Step 3: 최소 배치 구현**

`PlaceDetail.tsx`의 주소 단락·상태 통지·복사 버튼을 다음 구조로 바꾼다. 전화번호 단락은 컨테이너 밖의 기존 위치를 유지한다.

```tsx
<div className="flex items-start gap-2">
  <div className="min-w-0 flex-1">
    <p lang={place.englishAddress ? undefined : "ko"}>
      {`${place.englishAddress ? t("place.address") : t("place.roadAddress")} ${place.englishAddress ?? (place.roadAddress || place.address)}`}
    </p>
    {place.englishAddress && (place.roadAddress || place.address) && (
      <p className="mt-0.5 text-xs text-muted" lang="ko">
        {place.roadAddress || place.address}
      </p>
    )}
  </div>
  <div ref={copyAnnouncerRef} role="status" aria-live="polite" className="sr-only" />
  <button
    type="button"
    onClick={copyAddress}
    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 text-xs font-medium text-accent"
  >
    <Copy aria-hidden="true" className="h-3.5 w-3.5" />
    {t("place.copyAddress")}
  </button>
</div>
```

- [ ] **Step 4: 대상 테스트 통과 확인**

Run: `npm run test:run -- src/components/__tests__/PlaceDetail.test.tsx`

Expected: 2 tests PASS.

- [ ] **Step 5: 전체 정적 게이트 실행**

Run: `npm run test:run && npm run lint && npm run build`

Expected: 모든 Vitest 테스트 통과, ESLint 오류 0, Next.js build exit 0.

### Task 2: 실제 화면 비교와 배포

**Files:**
- Create: `docs/audits/2026-07-01-place-detail-copy-button/03-adjusted-detail.png`
- Create: `docs/audits/2026-07-01-place-detail-copy-button/04-adjusted-detail-mobile.png`
- Modify: `docs/audits/2026-07-01-place-detail-copy-button/audit.md`

**Interfaces:**
- Consumes: Task 1의 주소 블록 DOM·스타일 계약
- Produces: 동일 장소·동일 뷰포트의 전후 비교 근거와 프로덕션 배포

- [ ] **Step 1: 로컬 개발 서버에서 같은 장소 상태 재현**

Run: `npm run dev`

브라우저에서 `Gyeongbokgung`을 검색하고 `경복궁 관훈점` 상세를 연다. 검색 API 키가 로컬에 없거나 외부 호출이 불안정하면 프로덕션에서 검증한 동일 `Place` 데이터로 접근 가능한 기존 경로를 사용하되 mock 데이터로 실데이터 성공을 주장하지 않는다.

- [ ] **Step 2: 데스크톱 화면 검증과 캡처**

기본 1280×720에서 다음을 확인하고 `03-adjusted-detail.png`로 저장한다.

- 주소 두 줄과 복사 버튼이 하나의 시각적 블록이다.
- 복사 버튼이 주소 블록 오른쪽 상단에 있다.
- 전화번호가 주소 블록 다음에 바로 이어진다.
- 주소나 버튼이 겹치거나 잘리지 않는다.

- [ ] **Step 3: 모바일 화면 검증과 캡처**

390×844에서 다음을 확인하고 `04-adjusted-detail-mobile.png`로 저장한다.

- 주소는 남은 너비에서 자연스럽게 줄바꿈한다.
- 복사 버튼 bounding box가 너비·높이 모두 44px 이상이다.
- `document.documentElement.scrollWidth <= document.documentElement.clientWidth`이다.
- DOM 순서는 주소 → 복사 → 전화번호이고 버튼 이름은 `Copy` 또는 현재 로케일 번역이다.

- [ ] **Step 4: 복사 동작 검증**

복사 버튼을 클릭하고 브라우저 세션 클립보드가 상세 화면의 주 주소와 일치하는지 확인한다. `role="status"`의 텍스트가 `Address copied to clipboard` 또는 현재 로케일 번역으로 바뀌는지도 확인한다.

- [ ] **Step 5: 감사 문서 갱신**

`audit.md`에 조정 후 판정과 `03-adjusted-detail.png`, `04-adjusted-detail-mobile.png` 링크를 추가한다. 접근성 한계에는 실제 VoiceOver 발화 검증이 별도라는 점을 유지한다.

- [ ] **Step 6: 의도 파일만 커밋**

```bash
git add src/components/PlaceDetail.tsx \
  src/components/__tests__/PlaceDetail.test.tsx \
  docs/superpowers/plans/2026-07-01-place-detail-copy-button-layout.md \
  docs/audits/2026-07-01-place-detail-copy-button/audit.md \
  docs/audits/2026-07-01-place-detail-copy-button/03-adjusted-detail.png \
  docs/audits/2026-07-01-place-detail-copy-button/04-adjusted-detail-mobile.png
git commit -m "fix(ui): 주소 복사 버튼을 주소 블록에 배치"
```

- [ ] **Step 7: push와 자동 배포 확인**

Run: `git push origin main`

Expected: push 성공. GitHub 연동 Vercel 배포가 생성되고 `https://gildongmu.vercel.app`에서 새 배치가 확인된다. 배포 직후 스테일 서비스워커가 이전 화면을 보이면 새 탭 또는 캐시 갱신으로 코드 결함과 분리해 확인한다.
