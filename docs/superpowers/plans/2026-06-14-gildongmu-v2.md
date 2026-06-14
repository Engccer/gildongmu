# 길동무 v2 업그레이드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 자산(장소검색·자동차 브리핑·주소·역 교통약자 편의시설)을 단일 검색창 → 결과 → 장소 상세 흐름으로 엮고, ko/en 언어 분리·접근성·미니멀 UI로 길동무를 일상용 내비게이션 앱으로 개편한다.

**Architecture:** 입력 지점은 검색창 하나. 결과는 카테고리 칩으로 필터, 장소 상세는 같은 페이지 내 뷰 전환 + History API(카카오 ID 단건 조회가 없어 메모리의 `Place`로 상세를 그림). 테스트는 `src/lib` 순수 함수 단위 테스트(기존 컨벤션, React 비의존 이식성 유지). 상호작용·접근성은 a11y-auditor + Vercel 프리뷰로 검증.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, next-intl 4, Tailwind v4, zod 4, Vitest 4(node env), lucide-react(신규).

---

## File Structure

신규/수정 파일과 책임:

- `src/lib/locale-href.ts` (신규) — pathname+query 결합 순수 함수(언어 전환 링크). 테스트.
- `src/components/Header.tsx` (신규) — 사이트 제목 + LanguageSwitcher 배치(서버 컴포넌트).
- `src/components/LanguageSwitcher.tsx` (신규) — 현재 경로·쿼리 보존 ko/en 전환(클라이언트).
- `src/app/[locale]/layout.tsx` (수정) — Header 삽입, locale별 metadata.
- `src/app/[locale]/page.tsx` (수정) — Header 제거(레이아웃으로 이동), 컨테이너만.
- `src/app/globals.css` (수정) — 디자인 토큰(액센트·표면·테두리), 라이트/다크.
- `src/lib/category.ts` (수정) — `bucketsPresent`·`filterPlacesByBucket` 추가. 테스트.
- `src/components/SearchBar.tsx` (신규) — 검색 입력·제출(클라이언트).
- `src/components/ChipFilter.tsx` (신규) — 버킷 필터 칩(클라이언트).
- `src/components/ResultList.tsx` (신규) — 그룹/카드 목록(클라이언트).
- `src/components/PlaceCard.tsx` (신규, PlaceSearch에서 추출) — 카드 요약 + 상세 진입 버튼.
- `src/components/RouteLinks.tsx` (신규, PlaceSearch에서 추출) — 네이버·카카오 딥링크.
- `src/components/PlaceDetail.tsx` (신규) — 상세 뷰(포커스·길찾기·브리핑·편의시설).
- `src/components/PlaceSearch.tsx` (수정) — 검색/필터/상세 뷰 전환 + History 오케스트레이션.
- `src/lib/station-match.ts` (신규) — `isStation`·`normalizeStationName`. 테스트.
- `src/lib/providers/korail-facilities.ts` (신규) — 철도공사 편의시설 파서+fetch. 파서 테스트.
- `src/lib/types.ts` (수정) — `StationFacilities` 타입.
- `src/app/api/station/facilities/route.ts` (신규) — 편의시설 프록시.
- `src/components/StationFacilities.tsx` (신규) — 편의시설 표시(클라이언트, 온디맨드).
- `messages/ko.json`·`messages/en.json` (수정) — 신규 키.

---

## M1: i18n 정리 · 레이아웃 셸 · 디자인 토큰

### Task 1.1: lucide-react 추가 + 디자인 토큰

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/app/globals.css`

- [ ] **Step 1: lucide-react 설치**

Run: `npm install lucide-react`
Expected: `package.json` dependencies에 `lucide-react` 추가, 설치 성공.

- [ ] **Step 2: globals.css 디자인 토큰 확장**

`src/app/globals.css`의 `:root`/다크 블록에 표면·테두리·액센트 토큰을 추가(기존 background/foreground 유지). WCAG AA 대비 확보(액센트 #2563eb은 흰 배경에서 4.5:1 이상).

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  --surface: #f7f7f8;
  --border: #d4d4d8;
  --muted: #52525b;
  --accent: #1d4ed8;
  --accent-foreground: #ffffff;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
    --surface: #18181b;
    --border: #3f3f46;
    --muted: #a1a1aa;
    --accent: #60a5fa;
    --accent-foreground: #0a0a0a;
  }
}
```

(기존 `@theme inline`의 background/foreground 매핑·body·focus-visible·reduced-motion 블록은 보존하고 위 토큰만 병합.)

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공(Tailwind가 새 토큰 클래스를 인식).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/app/globals.css
git commit -m "feat(ui): 디자인 토큰 + lucide-react 추가 (M1)"
```

### Task 1.2: locale-href 순수 함수 (TDD)

**Files:**
- Create: `src/lib/locale-href.ts`
- Test: `src/lib/__tests__/locale-href.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/__tests__/locale-href.test.ts
import { describe, it, expect } from "vitest";
import { withQuery } from "../locale-href";

describe("withQuery", () => {
  it("쿼리 문자열을 pathname에 결합한다", () => {
    expect(withQuery("/", "?q=서울역")).toBe("/?q=서울역");
  });
  it("빈 쿼리면 pathname만 반환", () => {
    expect(withQuery("/", "")).toBe("/");
  });
  it("물음표 없는 쿼리도 처리", () => {
    expect(withQuery("/place", "q=x")).toBe("/place?q=x");
  });
  it("이미 ?로 시작하면 중복 추가 안 함", () => {
    expect(withQuery("/place", "?q=x")).toBe("/place?q=x");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/locale-href.test.ts`
Expected: FAIL — `withQuery`가 정의되지 않음.

- [ ] **Step 3: 구현**

```ts
// src/lib/locale-href.ts
/**
 * 언어 전환 링크용 — next-intl usePathname()(로케일 프리픽스 제거된 경로)에
 * 현재 location.search를 결합한다. Link의 locale prop이 프리픽스를 붙이므로
 * 여기서는 경로+쿼리만 만든다.
 */
export function withQuery(pathname: string, search: string): string {
  if (!search) return pathname;
  const normalized = search.startsWith("?") ? search : `?${search}`;
  return `${pathname}${normalized}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/locale-href.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/locale-href.ts src/lib/__tests__/locale-href.test.ts
git commit -m "feat(i18n): 언어 전환 href 결합 함수 (M1)"
```

### Task 1.3: LanguageSwitcher + Header

**Files:**
- Create: `src/components/LanguageSwitcher.tsx`
- Create: `src/components/Header.tsx`
- Modify: `messages/ko.json`, `messages/en.json`

- [ ] **Step 1: 메시지 키 추가**

`messages/ko.json` 최상위에 추가:
```json
"nav": {
  "languageLabel": "언어",
  "korean": "한국어",
  "english": "English",
  "skipToContent": "본문 바로가기"
}
```
`messages/en.json` 최상위에 추가:
```json
"nav": {
  "languageLabel": "Language",
  "korean": "한국어",
  "english": "English",
  "skipToContent": "Skip to content"
}
```

- [ ] **Step 2: LanguageSwitcher 작성**

```tsx
// src/components/LanguageSwitcher.tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { withQuery } from "@/lib/locale-href";

/**
 * 언어 전환기 — 현재 경로와 ?q= 쿼리를 보존한 채 ko/en을 전환한다.
 * next-intl 미들웨어가 로케일 프리픽스 네비게이션 시 NEXT_LOCALE 쿠키를
 * 설정하므로, 한 번 고른 언어는 재방문 시 유지된다.
 * disabled 대신 aria-current로 현재 언어를 표시(포커스 보존).
 */
const LABEL_KEY: Record<string, "korean" | "english"> = {
  ko: "korean",
  en: "english",
};

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const active = useLocale();
  const pathname = usePathname();
  // 클라이언트에서만 search 접근 — SSR 시 빈 문자열
  const search = typeof window !== "undefined" ? window.location.search : "";
  const href = withQuery(pathname, search);

  return (
    <nav aria-label={t("languageLabel")}>
      <ul className="flex gap-1">
        {routing.locales.map((loc) => {
          const isActive = loc === active;
          return (
            <li key={loc}>
              <Link
                href={href}
                locale={loc}
                aria-current={isActive ? "true" : undefined}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium aria-[current]:bg-accent aria-[current]:text-accent-foreground"
              >
                {t(LABEL_KEY[loc])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 3: Header 작성**

```tsx
// src/components/Header.tsx
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./LanguageSwitcher";

/**
 * 사이트 헤더 — 제목 + 언어 전환기. 제목은 로케일 메시지에서 오므로
 * /ko·/en에서 각각 단일 언어로만 표시된다(한/영 혼용 제거).
 */
export async function Header() {
  const t = await getTranslations("app");
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div>
          <p className="text-lg font-bold">{t("title")}</p>
          <p className="text-xs text-muted">{t("tagline")}</p>
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git add src/components/Header.tsx src/components/LanguageSwitcher.tsx messages/
git commit -m "feat(i18n): 헤더 + 언어 전환기 (경로·쿼리·쿠키 보존) (M1)"
```

### Task 1.4: 레이아웃·페이지 통합 + locale 메타데이터

**Files:**
- Modify: `src/app/[locale]/layout.tsx`
- Modify: `src/app/[locale]/page.tsx`

- [ ] **Step 1: layout에 Header + generateMetadata**

`src/app/[locale]/layout.tsx`에서 정적 `metadata` export를 제거하고 locale별 `generateMetadata`로 교체, body에 Header + skip 링크 + main wrapper 추가.

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/Header";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: t("title"), description: t("tagline") };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-foreground"
          >
            {t("skipToContent")}
          </a>
          <Header />
          <main id="main" className="mx-auto max-w-2xl px-4 py-6">
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: page.tsx에서 header 제거**

`src/app/[locale]/page.tsx`를 컨테이너만 남기도록 수정(중복 제목/main 제거 — layout이 담당).

```tsx
import { setRequestLocale } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { activeProviderName } from "@/lib/providers/places";
import { hasKakaoKey } from "@/lib/env";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PlaceSearch
      isMockMode={activeProviderName() === "mock"}
      canBriefCarRoute={hasKakaoKey()}
    />
  );
}
```

- [ ] **Step 3: 전체 테스트 + 빌드 + lint**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 통과. `/ko`·`/en` 모두 정적 생성.

- [ ] **Step 4: 수동 확인(설명만)**

`npm run dev` 후 `/ko`는 "길동무", `/en`은 "Gildongmu"만 표시되고 언어 전환 시 `?q=` 쿼리가 보존되는지 확인. (실행은 M5 통합 검증에서.)

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/layout.tsx src/app/[locale]/page.tsx
git commit -m "feat(i18n): locale별 메타데이터 + 레이아웃 셸·skip 링크 (M1)"
```

---

## M2: 검색 결과 UX 개편

### Task 2.1: category 필터 헬퍼 (TDD)

**Files:**
- Modify: `src/lib/category.ts`
- Modify: `src/lib/__tests__/category.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`src/lib/__tests__/category.test.ts`에 추가:
```ts
import { bucketsPresent, filterPlacesByBucket } from "../category";

const sample = [
  { id: "1", name: "경복궁", category: "관광,명소>고궁", address: "", roadAddress: "", lat: 0, lng: 0 },
  { id: "2", name: "김밥천국", category: "음식점>분식", address: "", roadAddress: "", lat: 0, lng: 0 },
  { id: "3", name: "서울역", category: "교통,수송>지하철", address: "", roadAddress: "", lat: 0, lng: 0 },
];

describe("bucketsPresent", () => {
  it("결과에 존재하는 버킷만 BUCKET_ORDER 순서로 반환", () => {
    expect(bucketsPresent(sample)).toEqual(["attraction", "food", "transport"]);
  });
  it("빈 입력은 빈 배열", () => {
    expect(bucketsPresent([])).toEqual([]);
  });
});

describe("filterPlacesByBucket", () => {
  it("null이면 전체 반환", () => {
    expect(filterPlacesByBucket(sample, null)).toHaveLength(3);
  });
  it("특정 버킷만 필터", () => {
    expect(filterPlacesByBucket(sample, "food").map((p) => p.id)).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/category.test.ts`
Expected: FAIL — 함수 미정의.

- [ ] **Step 3: 구현**

`src/lib/category.ts`에 추가(파일 끝):
```ts
/** 결과 안에 실제로 존재하는 버킷만 BUCKET_ORDER 순서로 반환(칩 표시용). */
export function bucketsPresent(places: Place[]): CategoryBucket[] {
  const present = new Set(places.map((p) => categoryOf(p.category)));
  return BUCKET_ORDER.filter((b) => present.has(b));
}

/** 선택 버킷으로 필터. null이면 전체 반환(입력 순서 보존). */
export function filterPlacesByBucket(
  places: Place[],
  bucket: CategoryBucket | null,
): Place[] {
  if (bucket === null) return places;
  return places.filter((p) => categoryOf(p.category) === bucket);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/category.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/category.ts src/lib/__tests__/category.test.ts
git commit -m "feat(search): 버킷 칩 필터 헬퍼 (M2)"
```

### Task 2.2: SearchBar 컴포넌트 추출

**Files:**
- Create: `src/components/SearchBar.tsx`

- [ ] **Step 1: SearchBar 작성**

PlaceSearch의 form 부분을 props 기반 제어 컴포넌트로 추출. 기존 접근성 패턴(label sr-only, aria-disabled, min-h, type=search) 유지.

```tsx
// src/components/SearchBar.tsx
"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const t = useTranslations("search");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex gap-2"
      role="search"
    >
      <label htmlFor="place-query" className="sr-only">
        {t("label")}
      </label>
      <input
        id="place-query"
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("placeholder")}
        autoComplete="off"
        className="min-h-12 flex-1 rounded-md border border-border bg-background px-4 text-lg"
      />
      <button
        type="submit"
        aria-disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-5 text-lg font-semibold text-accent-foreground aria-disabled:opacity-50"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
        {t("button")}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공(아직 PlaceSearch에서 미사용이어도 OK — 미사용 경고 없으면 통과, lint 경고 시 Task 2.4에서 연결되므로 이 단계는 build만).

- [ ] **Step 3: Commit**

```bash
git add src/components/SearchBar.tsx
git commit -m "feat(search): SearchBar 컴포넌트 추출 (M2)"
```

### Task 2.3: ChipFilter 컴포넌트

**Files:**
- Create: `src/components/ChipFilter.tsx`

- [ ] **Step 1: ChipFilter 작성**

버킷 칩 목록 + "전체". 단일 선택 토글 그룹. aria로 선택 상태 통지(`aria-pressed`).

```tsx
// src/components/ChipFilter.tsx
"use client";

import { useTranslations } from "next-intl";
import type { CategoryBucket } from "@/lib/category";

export function ChipFilter({
  buckets,
  selected,
  counts,
  onSelect,
}: {
  buckets: CategoryBucket[];
  selected: CategoryBucket | null;
  counts: Record<CategoryBucket, number>;
  onSelect: (b: CategoryBucket | null) => void;
}) {
  const t = useTranslations("category");
  if (buckets.length <= 1) return null; // 버킷이 하나뿐이면 필터 불필요

  const chip = (
    key: string,
    label: string,
    isSelected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className="min-h-11 rounded-full border border-border px-4 text-sm font-medium aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      {label}
    </button>
  );

  return (
    <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
      {chip("all", t("all"), selected === null, () => onSelect(null))}
      {buckets.map((b) =>
        chip(b, `${t(b)} ${counts[b]}`, selected === b, () => onSelect(b)),
      )}
    </div>
  );
}
```

- [ ] **Step 2: 메시지 키 추가**

`messages/ko.json`의 `category`에 추가: `"filterLabel": "분류로 거르기", "all": "전체"`
`messages/en.json`의 `category`에 추가: `"filterLabel": "Filter by category", "all": "All"`

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChipFilter.tsx messages/
git commit -m "feat(search): 카테고리 칩 필터 컴포넌트 (M2)"
```

### Task 2.4: PlaceCard·RouteLinks 추출 + ResultList

**Files:**
- Create: `src/components/RouteLinks.tsx`
- Create: `src/components/PlaceCard.tsx`
- Create: `src/components/ResultList.tsx`

- [ ] **Step 1: RouteLinks 추출**

PlaceSearch의 `<nav aria-label=...>` 네이버/카카오 딥링크 블록 전체를 그대로 옮긴다(기존 마크업·aria·딥링크 빌더 import 유지). props: `place: Place`.

```tsx
// src/components/RouteLinks.tsx
"use client";

import { useTranslations } from "next-intl";
import type { Place, RouteMode } from "@/lib/types";
import {
  buildPlaceDeeplink,
  buildRouteDeeplink,
  buildWebFallbackUrl,
} from "@/lib/deeplink";
import {
  buildKakaoWebMapUrl,
  buildKakaoWebRouteUrl,
} from "@/lib/deeplink-kakao";

const APPNAME =
  process.env.NEXT_PUBLIC_APP_IDENTIFIER ?? "space.dodoplanet.gildongmu";
const ROUTE_MODES: RouteMode[] = ["public", "walk", "car"];

export function RouteLinks({ place }: { place: Place }) {
  const t = useTranslations();
  const dest = { lat: place.lat, lng: place.lng, name: place.name };
  // 기존 PlaceSearch.tsx의 <nav aria-label={t("route.heading", {name})}> …
  // 네이버/카카오 group 두 블록을 그대로 이식(마크업 변경 없음).
  // (실행자: PlaceSearch.tsx:220-306의 nav 블록을 복사해 dest/place로 연결)
  return (/* 이식한 nav 블록 */);
}
```

실행자 주의: 위 본문은 PlaceSearch.tsx의 기존 `<nav>` 블록(라인 220–306)을 마크업 그대로 옮긴 것이다. 디자인 토큰 적용(M5)이 아니라 이 단계는 *동작 동등 추출*이 목표 — 색 클래스는 추후 정리.

- [ ] **Step 2: PlaceCard 작성(요약 + 상세 진입)**

상세 진입 버튼을 가진 요약 카드. 기존 PlaceCard의 dl(분류·주소·전화)은 유지하되, 길찾기/브리핑은 카드에서 제거하고 상세로 이동. `onOpen` 콜백 + 카드 제목 버튼.

```tsx
// src/components/PlaceCard.tsx
"use client";

import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Place } from "@/lib/types";

export function PlaceCard({
  place,
  onOpen,
}: {
  place: Place;
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations();
  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => onOpen(place)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        aria-label={t("place.openDetail", { name: place.name })}
      >
        <span>
          <span className="block text-lg font-bold">{place.name}</span>
          <span className="mt-0.5 block text-sm text-muted">
            {place.category}
          </span>
          <span className="mt-0.5 block text-sm">
            {place.englishAddress ?? (place.roadAddress || place.address)}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
      </button>
    </li>
  );
}
```

- [ ] **Step 3: ResultList 작성**

필터된 그룹을 카테고리 섹션으로 렌더(기존 groupByCategory 구조 유지). props: `groups`, `onOpen`.

```tsx
// src/components/ResultList.tsx
"use client";

import { useTranslations } from "next-intl";
import type { CategoryGroup } from "@/lib/category";
import type { Place } from "@/lib/types";
import { PlaceCard } from "./PlaceCard";

export function ResultList({
  groups,
  onOpen,
}: {
  groups: CategoryGroup[];
  onOpen: (place: Place) => void;
}) {
  const t = useTranslations("category");
  return (
    <div className="mt-3 flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.bucket}>
          <h3 className="text-lg font-semibold">
            {t("groupHeading", { label: t(group.bucket), count: group.places.length })}
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {group.places.map((place) => (
              <PlaceCard key={place.id} place={place} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 메시지 키 추가**

`messages/ko.json`의 `place`에 `"openDetail": "{name} 상세 보기"`, `messages/en.json`의 `place`에 `"openDetail": "View details for {name}"`.

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 6: Commit**

```bash
git add src/components/RouteLinks.tsx src/components/PlaceCard.tsx src/components/ResultList.tsx messages/
git commit -m "feat(search): PlaceCard·RouteLinks·ResultList 추출 (M2)"
```

---

## M3: 장소 상세 뷰 + 검색 오케스트레이션

### Task 3.1: PlaceDetail 컴포넌트

**Files:**
- Create: `src/components/PlaceDetail.tsx`

- [ ] **Step 1: PlaceDetail 작성**

상세 컨테이너 — 제목(포커스 대상), 요약 dl, 전화, RouteLinks, CarRouteBriefing, (M4에서 StationFacilities), 목록 복귀 버튼. 진입 시 제목으로 포커스.

```tsx
// src/components/PlaceDetail.tsx
"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { Place } from "@/lib/types";
import { RouteLinks } from "./RouteLinks";
import { CarRouteBriefing } from "./CarRouteBriefing";

export function PlaceDetail({
  place,
  canBriefCarRoute,
  onBack,
}: {
  place: Place;
  canBriefCarRoute: boolean;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [place.id]);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("detail.back")}
      </button>

      <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-2xl font-bold">
        {place.name}
      </h2>

      <dl className="mt-2 text-sm leading-relaxed">
        <div>
          <dt className="inline font-medium">{t("place.category")}: </dt>
          <dd className="inline">{place.category}</dd>
        </div>
        <div>
          <dt className="inline font-medium">{t("place.roadAddress")}: </dt>
          <dd className="inline">
            {place.englishAddress ?? (place.roadAddress || place.address)}
          </dd>
          {place.englishAddress && (place.roadAddress || place.address) && (
            <dd className="mt-0.5 text-xs text-muted" lang="ko">
              {place.roadAddress || place.address}
            </dd>
          )}
        </div>
        {place.phone && (
          <div>
            <dt className="inline font-medium">{t("place.phone")}: </dt>
            <dd className="inline">
              <a href={`tel:${place.phone}`} className="underline">
                {place.phone}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <RouteLinks place={place} />
      {canBriefCarRoute && <CarRouteBriefing dest={{ lat: place.lat, lng: place.lng, name: place.name }} />}
      {/* M4: <StationFacilities place={place} /> 삽입 */}
    </div>
  );
}
```

- [ ] **Step 2: 메시지 키**

`ko.json` 최상위에 `"detail": { "back": "검색 결과로 돌아가기" }`, `en.json`에 `"detail": { "back": "Back to results" }`.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaceDetail.tsx messages/
git commit -m "feat(detail): 장소 상세 뷰 컴포넌트 (M3)"
```

### Task 3.2: PlaceSearch 오케스트레이션 + History API

**Files:**
- Modify: `src/components/PlaceSearch.tsx`

- [ ] **Step 1: PlaceSearch 재작성**

검색 상태 + 선택 필터 + 선택 장소(상세) 관리. 상세 진입 시 `history.pushState`, `popstate`에서 상세 해제. `?q=` URL 동기화.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CategoryBucket } from "@/lib/category";
import { bucketsPresent, filterPlacesByBucket, groupByCategory } from "@/lib/category";
import type { Place, PlaceSearchResult } from "@/lib/types";
import { SearchBar } from "./SearchBar";
import { ChipFilter } from "./ChipFilter";
import { ResultList } from "./ResultList";
import { PlaceDetail } from "./PlaceDetail";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; result: PlaceSearchResult };

export function PlaceSearch({
  isMockMode,
  canBriefCarRoute = false,
}: {
  isMockMode: boolean;
  canBriefCarRoute?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [bucket, setBucket] = useState<CategoryBucket | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  // 상세 진입/이탈을 브라우저 히스토리에 연동 — 백버튼이 목록으로 복귀.
  useEffect(() => {
    function onPop() {
      setSelected(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openDetail(place: Place) {
    window.history.pushState({ place: place.id }, "");
    setSelected(place);
  }
  function backToResults() {
    if (window.history.state?.place) window.history.back();
    else setSelected(null);
  }

  async function runSearch() {
    if (status.kind === "loading") return;
    const q = query.trim();
    if (!q) return;
    setBucket(null);
    setStatus({ kind: "loading" });
    // URL ?q= 동기화(공유·새로고침 보존)
    const url = new URL(window.location.href);
    url.searchParams.set("q", q);
    window.history.replaceState(window.history.state, "", url);
    try {
      const res = await fetch(
        `/api/places?query=${encodeURIComponent(q)}&lang=${locale}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as PlaceSearchResult;
      setStatus({ kind: "done", result });
      requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  // 첫 마운트 시 ?q= 있으면 자동 검색
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setQuery(q);
      // query state 반영 후 검색
      void (async () => {
        setStatus({ kind: "loading" });
        try {
          const res = await fetch(
            `/api/places?query=${encodeURIComponent(q)}&lang=${locale}`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setStatus({ kind: "done", result: (await res.json()) as PlaceSearchResult });
        } catch {
          setStatus({ kind: "error" });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveMessage =
    status.kind === "loading"
      ? t("search.searching")
      : status.kind === "error"
        ? t("search.error")
        : status.kind === "done"
          ? t("search.resultsAnnouncement", { count: status.result.places.length })
          : "";

  // 상세 화면이면 상세만 렌더(같은 페이지 뷰 전환)
  if (selected) {
    return (
      <PlaceDetail
        place={selected}
        canBriefCarRoute={canBriefCarRoute}
        onBack={backToResults}
      />
    );
  }

  const places = status.kind === "done" ? status.result.places : [];
  const buckets = bucketsPresent(places);
  const counts = Object.fromEntries(
    buckets.map((b) => [b, filterPlacesByBucket(places, b).length]),
  ) as Record<CategoryBucket, number>;
  const groups = groupByCategory(filterPlacesByBucket(places, bucket));

  return (
    <section aria-label={t("search.label")}>
      {isMockMode && (
        <p role="note" className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t("search.mockNotice")}
        </p>
      )}

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={runSearch}
        busy={status.kind === "loading"}
      />

      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <div className="mt-4">
          <h2 ref={resultsHeadingRef} tabIndex={-1} className="text-xl font-semibold">
            {t("search.resultsAnnouncement", { count: status.result.places.length })}
          </h2>
          {places.length === 0 ? (
            <p className="mt-2">{t("search.noResults")}</p>
          ) : (
            <>
              <div className="mt-3">
                <ChipFilter buckets={buckets} selected={bucket} counts={counts} onSelect={setBucket} />
              </div>
              <ResultList groups={groups} onOpen={openDetail} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 전체 테스트 + 빌드 + lint**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 통과. (기존 CarRouteBriefing import 경로 그대로 동작.)

- [ ] **Step 3: 수동 확인(설명만)**

검색 → 카드 클릭 → 상세 → 백버튼 → 목록 복귀, 포커스 이동, `?q=` 보존을 M5에서 확인.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaceSearch.tsx
git commit -m "feat(detail): 검색→상세 뷰 전환 + History·URL 동기화 (M3)"
```

---

## M4: 역 교통약자 편의시설

### Task 4.1: 역 판정 헬퍼 (TDD)

**Files:**
- Create: `src/lib/station-match.ts`
- Test: `src/lib/__tests__/station-match.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/__tests__/station-match.test.ts
import { describe, it, expect } from "vitest";
import { isStation, normalizeStationName } from "../station-match";

const place = (name: string, category: string) => ({
  id: "x", name, category, address: "", roadAddress: "", lat: 0, lng: 0,
});

describe("isStation", () => {
  it("카테고리에 지하철/철도/기차가 있으면 역", () => {
    expect(isStation(place("서울역", "교통,수송>지하철,전철"))).toBe(true);
    expect(isStation(place("행신역", "교통 > 기차"))).toBe(true);
  });
  it("이름이 역으로 끝나면 역", () => {
    expect(isStation(place("청량리역", "기타"))).toBe(true);
  });
  it("Station으로 끝나도 역(영문)", () => {
    expect(isStation(place("Seoul Station", "Transport > Subway"))).toBe(true);
  });
  it("음식점은 역 아님", () => {
    expect(isStation(place("역전국밥", "음식점>한식"))).toBe(false);
  });
});

describe("normalizeStationName", () => {
  it("접미사 역/station 제거 + 공백 정리", () => {
    expect(normalizeStationName("서울역")).toBe("서울");
    expect(normalizeStationName("Seoul Station")).toBe("seoul");
    expect(normalizeStationName("청량리역 ")).toBe("청량리");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/station-match.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/station-match.ts
import type { Place } from "./types";

const STATION_CATEGORY = /지하철|전철|철도|기차|Subway|Metro|Railway|Train|Station/i;

/** 장소가 철도/지하철 역인지 — 카테고리 또는 이름 접미사로 판정. */
export function isStation(place: Place): boolean {
  if (STATION_CATEGORY.test(place.category)) return true;
  const n = place.name.trim();
  return /역$/.test(n) || /station$/i.test(n);
}

/** 역 이름 정규화 — 접미사(역/station) 제거, 소문자/trim(매칭 키). */
export function normalizeStationName(name: string): string {
  return name
    .trim()
    .replace(/\s*station$/i, "")
    .replace(/역$/, "")
    .trim()
    .toLowerCase();
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/station-match.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/station-match.ts src/lib/__tests__/station-match.test.ts
git commit -m "feat(station): 역 판정·이름 정규화 헬퍼 (M4)"
```

### Task 4.2: 철도공사 API 실호출로 응답 형태 확정

**Files:**
- 없음(조사 단계) — 결과를 Task 4.3 fixture로 사용.

- [ ] **Step 1: 실호출(샌드박스 off 필수)**

`.env.local`의 `DATA_GO_KR_API_KEY`로 `apis.data.go.kr/B551457/convenience`를 호출해 (a) 역 코드 lookup 방식, (b) 교통약자 필드(`pwdbs_tolt_estnc`·`whlch_liftt_cnt` 등)를 실응답으로 확인한다. 서울역 등 알려진 역으로.

Run (예시, 실제 엔드포인트·파라미터는 응답 보며 조정):
```bash
source .env.local
curl -s "https://apis.data.go.kr/B551457/convenience/stationFacilities?serviceKey=${DATA_GO_KR_API_KEY}&format=json&...&numOfRows=10" | head -c 2000
```
Expected: HTTP 200 + JSON. (sandbox 비활성화 — Bash 호출 시 `dangerouslyDisableSandbox: true`. CLAUDE.md 기록대로 data.go.kr는 샌드박스 프록시가 차단함.)

- [ ] **Step 2: 응답 캡처**

대표 역 1~2건 응답을 `src/lib/__tests__/fixtures/korail-facilities.json`으로 저장(Task 4.3 파서 테스트 입력).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/fixtures/korail-facilities.json
git commit -m "test(station): 철도공사 편의시설 실응답 fixture (M4)"
```

### Task 4.3: korail-facilities provider + 타입 (TDD)

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/providers/korail-facilities.ts`
- Test: `src/lib/__tests__/korail-facilities.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/types.ts`에 추가:
```ts
/** 역 교통약자 편의시설 — 지도 없이 완결되는 접근성 정보 정본. */
export interface StationFacilities {
  /** 역명(정규화 전 표시용) */
  stationName: string;
  /** 장애인 화장실 유무 */
  accessibleToilet: boolean;
  /** 휠체어 리프트 수 */
  wheelchairLifts: number;
  /** 엘리베이터 유무/수(데이터에 있을 때) */
  elevators?: number;
  /** 장애인 주차구역 유무 */
  accessibleParking?: boolean;
}
```

- [ ] **Step 2: 실패 테스트(fixture 기반)**

```ts
// src/lib/__tests__/korail-facilities.test.ts
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/korail-facilities.json";
import { parseStationFacilities } from "../providers/korail-facilities";

describe("parseStationFacilities", () => {
  it("실응답을 StationFacilities로 정규화한다", () => {
    const result = parseStationFacilities(fixture as unknown);
    expect(result).not.toBeNull();
    expect(typeof result!.accessibleToilet).toBe("boolean");
    expect(typeof result!.wheelchairLifts).toBe("number");
  });
  it("빈 결과(items 없음)는 null", () => {
    expect(parseStationFacilities({ response: { body: { items: "" } } })).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/korail-facilities.test.ts`
Expected: FAIL.

- [ ] **Step 4: 파서 + fetch 구현**

실제 필드 경로는 Task 4.2 fixture에 맞춰 작성. 파서는 순수(테스트 대상), fetch는 키 사용.
```ts
// src/lib/providers/korail-facilities.ts
import type { StationFacilities } from "../types";

const BASE = "https://apis.data.go.kr/B551457/convenience";

/** data.go.kr 편의시설 응답을 StationFacilities로 정규화. 빈 결과는 null. */
export function parseStationFacilities(raw: unknown): StationFacilities | null {
  // 실응답 구조에 맞춰 안전하게 추출(Task 4.2에서 경로 확정).
  // 예시 가드: response.body.items.item[0]
  const item = pickFirstItem(raw);
  if (!item) return null;
  return {
    stationName: str(item.stinNm ?? item.stationName ?? ""),
    accessibleToilet: yn(item.pwdbs_tolt_estnc),
    wheelchairLifts: num(item.whlch_liftt_cnt),
    elevators: item.elvtr_cnt != null ? num(item.elvtr_cnt) : undefined,
  };
}

// 헬퍼(yn: "Y"/"있음"→true, num: 안전 정수, str, pickFirstItem) — 구현 포함.
function yn(v: unknown): boolean {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "Y" || s === "있음" || s === "1" || s === "TRUE";
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function pickFirstItem(raw: unknown): Record<string, unknown> | null {
  // response.body.items.item 가 배열/객체/"" 모두 올 수 있음
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (!items || items === "") return null;
  const item = (items as { item?: unknown }).item ?? items;
  if (Array.isArray(item)) return (item[0] as Record<string, unknown>) ?? null;
  if (item && typeof item === "object") return item as Record<string, unknown>;
  return null;
}

/** 역 코드/이름으로 편의시설을 가져온다. 키 없거나 실패 시 null(graceful). */
export async function fetchStationFacilities(
  stationName: string,
): Promise<StationFacilities | null> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  try {
    // 실제 엔드포인트/파라미터는 Task 4.2에서 확정(역명→코드 lookup 포함).
    const url = `${BASE}/stationFacilities?serviceKey=${key}&format=json&stinNm=${encodeURIComponent(stationName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseStationFacilities(await res.json());
  } catch {
    return null;
  }
}
```

실행자 주의: `pickFirstItem`/파라미터 경로는 Task 4.2 fixture 실구조에 맞춰 *반드시* 수정. 위는 data.go.kr 표준 envelope 가정 — 실제와 다르면 fixture 기준으로 교정하고 테스트로 고정.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/__tests__/korail-facilities.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/providers/korail-facilities.ts src/lib/__tests__/korail-facilities.test.ts
git commit -m "feat(station): 철도공사 편의시설 provider·파서 (M4)"
```

### Task 4.4: API 라우트 + StationFacilities 컴포넌트 + 상세 연결

**Files:**
- Create: `src/app/api/station/facilities/route.ts`
- Create: `src/components/StationFacilities.tsx`
- Modify: `src/components/PlaceDetail.tsx`
- Modify: `messages/ko.json`, `messages/en.json`

- [ ] **Step 1: API 라우트**

```ts
// src/app/api/station/facilities/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";

const schema = z.object({ station: z.string().trim().min(1).max(50) });

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const facilities = await fetchStationFacilities(parsed.data.station);
    return NextResponse.json({ facilities }); // null이면 미커버 역
  } catch {
    return NextResponse.json({ error: "편의시설 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: StationFacilities 컴포넌트(온디맨드)**

CarRouteBriefing 패턴(버튼→fetch→aria-live→텍스트 정본). 역이 아닐 때는 PlaceDetail이 렌더하지 않음.
```tsx
// src/components/StationFacilities.tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { StationFacilities as Facilities } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; facilities: Facilities };

export function StationFacilities({ stationName }: { stationName: string }) {
  const t = useTranslations("station");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  async function load() {
    if (status.kind === "loading") return;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/station/facilities?station=${encodeURIComponent(stationName)}`);
      const body = await res.json();
      if (!res.ok) { setStatus({ kind: "error" }); return; }
      if (!body.facilities) { setStatus({ kind: "empty" }); return; }
      setStatus({ kind: "done", facilities: body.facilities as Facilities });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  const live =
    status.kind === "loading" ? t("loading")
    : status.kind === "empty" ? t("empty")
    : status.kind === "error" ? t("error")
    : status.kind === "done" ? t("ready") : "";

  return (
    <div className="mt-3">
      <button type="button" onClick={load} aria-disabled={status.kind === "loading"}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50">
        {t("button")}
      </button>
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">{live}</p>
      {status.kind === "done" && (
        <section aria-labelledby={headingId} className="mt-2 rounded-md border border-border p-3">
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {t("heading", { name: status.facilities.stationName || stationName })}
          </h3>
          <ul className="mt-1 text-sm leading-relaxed">
            <li>{t("accessibleToilet")}: {status.facilities.accessibleToilet ? t("yes") : t("no")}</li>
            <li>{t("wheelchairLifts")}: {status.facilities.wheelchairLifts}</li>
            {status.facilities.elevators != null && (
              <li>{t("elevators")}: {status.facilities.elevators}</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 메시지 키**

`ko.json` 최상위 `station`:
```json
"station": {
  "button": "역 교통약자 편의시설 보기",
  "loading": "편의시설 조회 중…",
  "empty": "이 역의 교통약자 편의시설 정보가 없습니다.",
  "error": "편의시설 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  "ready": "편의시설 정보가 준비되었습니다.",
  "heading": "{name} 교통약자 편의시설",
  "accessibleToilet": "장애인 화장실",
  "wheelchairLifts": "휠체어 리프트",
  "elevators": "엘리베이터",
  "yes": "있음",
  "no": "없음"
}
```
`en.json` 최상위 `station`:
```json
"station": {
  "button": "View accessibility facilities",
  "loading": "Loading facilities…",
  "empty": "No accessibility facility data for this station.",
  "error": "Failed to load facilities. Please try again shortly.",
  "ready": "Facility information is ready.",
  "heading": "Accessibility facilities at {name}",
  "accessibleToilet": "Accessible restroom",
  "wheelchairLifts": "Wheelchair lifts",
  "elevators": "Elevators",
  "yes": "Available",
  "no": "Not available"
}
```

- [ ] **Step 4: PlaceDetail에 연결**

`src/components/PlaceDetail.tsx`에서 import 추가 + 역일 때만 렌더:
```tsx
import { isStation } from "@/lib/station-match";
import { StationFacilities } from "./StationFacilities";
// …CarRouteBriefing 아래에:
{isStation(place) && <StationFacilities stationName={place.name} />}
```

- [ ] **Step 5: 전체 테스트 + lint + 빌드**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 6: 실호출 스모크(설명)**

`npm run dev` 후 서울역 검색 → 상세 → "역 교통약자 편의시설 보기" → 실데이터 표시 확인(M5에서). data.go.kr 호출은 dev 서버(샌드박스 무관)에서 동작.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/station src/components/StationFacilities.tsx src/components/PlaceDetail.tsx messages/
git commit -m "feat(station): 편의시설 라우트·컴포넌트·상세 연결 (M4)"
```

---

## M5: 비주얼 마감 · 검증 · 배포

### Task 5.1: Vercel 프리뷰 + 비주얼 이터레이션

- [ ] **Step 1: 프리뷰 배포**

Run: `vercel deploy --yes` (프로덕션 아님 — 프리뷰 URL)
Expected: 프리뷰 URL 반환.

- [ ] **Step 2: 시각 점검·정리**

프리뷰에서 라이트/다크, 검색→칩→상세→복귀 흐름, 카드/칩 여백·정렬을 점검. RouteLinks의 기존 색 클래스(blue-700/amber-600 등)를 디자인 토큰(`border-accent` 등)과 충돌 없게 정리. 라벨 이모지 없음 확인.

- [ ] **Step 3: Commit(스타일 정리)**

```bash
git add -A
git commit -m "style(ui): 비주얼 정리·토큰 일관화 (M5)"
```

### Task 5.2: 접근성 감사

- [ ] **Step 1: a11y-auditor 서브에이전트 실행**

변경 컴포넌트(Header/LanguageSwitcher/SearchBar/ChipFilter/PlaceCard/PlaceDetail/StationFacilities/RouteLinks)와 흐름(포커스 이동·aria-live·키보드 도달·44px·aria-disabled)을 점검. 지적 사항 수정 후 재점검.

- [ ] **Step 2: 수정 커밋**

```bash
git add -A && git commit -m "fix(a11y): 감사 지적 반영 (M5)"
```

### Task 5.3: 마일스톤 codex-rescue 리뷰

- [ ] **Step 1: diff 직접 주입 리뷰**

`git diff main..feat/gildongmu-v2`를 codex에 직접 주입(파일 자율 탐색 금지 — 글로벌 규칙). 리뷰 포커스: i18n 누출·History/포커스 정합성·provider graceful 폴백·접근성 invariant. 지엽 패치 전 아키텍처 대조.

- [ ] **Step 2: fix 반영 커밋**

```bash
git add -A && git commit -m "fix: codex 리뷰 반영 (M5)"
```

### Task 5.4: 최종 검증 + 문서 + 배포

- [ ] **Step 1: 게이트 통과**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 통과.

- [ ] **Step 2: 문서 갱신**

`docs/SPEC.md` 실험 백로그에 "v2 UI 개편(검색→상세, 역 편의시설 노출)" 반영, `CLAUDE.md` 아키텍처에 상세 뷰·역 편의시설 흐름 한 줄 추가. 워크스페이스 루트에서 `python sync_agent_docs.py` 실행(AGENTS.md 재생성).

- [ ] **Step 3: main 병합 + 푸시(프로덕션 배포)**

```bash
git checkout main
git merge --no-ff feat/gildongmu-v2 -m "feat: 길동무 v2 — 검색→상세 흐름·역 편의시설·언어 분리 UI"
git push origin main
```
Expected: GitHub 연결로 Vercel 프로덕션 자동 배포. (push는 사용자가 명시 요청 — "커밋 및 푸시까지 진행".)

- [ ] **Step 4: 배포 확인**

`vercel ls` 또는 프로덕션 URL(https://gildongmu.vercel.app)에서 `/ko`·`/en`·검색·상세·편의시설 동작 확인.

---

## Self-Review (작성자 체크)

- **스펙 커버리지**: 단일 검색창(M2/M3) · 칩 필터(M2) · 장소 상세 집약(M3) · 역 편의시설(M4) · ko/en 분리·전환·기억(M1) · 비주얼/Vercel(M5) · 접근성(전반+M5.2) · 마일스톤 검증/배포(M5) — 모두 태스크 존재.
- **placeholder**: 철도공사 실파라미터는 Task 4.2 실호출로 확정하는 *명시된 단계*(추측 금지) — placeholder 아님.
- **타입 일관성**: `StationFacilities`(types.ts) ↔ provider 반환 ↔ 컴포넌트 props 일치. `CategoryBucket` 칩/필터 시그니처 일치. `Place` 전 컴포넌트 공유.
