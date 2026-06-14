# 길동무 v2.1 — 음성 받아쓰기 + PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색창에 Deepgram 서버 STT 음성 받아쓰기(탭-토글)를 dodo-planet에서 수입·적응하고, Serwist로 PWA(설치·앱셸 캐싱·오프라인 폴백)를 더해 모바일 접근성·UX를 끌어올린다.

**Architecture:** 받아쓰기는 MediaRecorder로 녹음 → `/api/speech-to-text`(Deepgram Nova-2) → 전사 텍스트로 자동 검색. dodo의 훅 2개는 외부 의존이 없어 거의 그대로 수입, 버튼은 gildongmu 토큰·aria-live로 재작성(sonner·useSound·모달 제거). PWA는 Serwist(@serwist/next)로 manifest·SW·오프라인 폴백을 구성하되 Turbopack 비호환 시 수제 SW로 폴백.

**Tech Stack:** Next.js 16(App Router·Turbopack·proxy.ts), React 19, next-intl 4, Tailwind v4, zod 4, Vitest 4(node), lucide-react, Deepgram(`nova-2-conversationalai`), @serwist/next + serwist(신규).

---

## File Structure

신규/수정:
- `src/lib/deepgram.ts` (신규) — Deepgram 응답 → `{text,language_code,confidence}` 정규화 순수 파서. 테스트.
- `src/app/api/speech-to-text/route.ts` (신규) — STT 프록시(FormData→Deepgram). 파서 사용.
- `src/lib/env.ts` (수정) — `DEEPGRAM_API_KEY`·`hasDeepgramKey()` 추가.
- `src/hooks/useMicrophonePermission.ts` (신규, dodo 수입) — 마이크 권한 상태.
- `src/hooks/useVoiceRecorder.ts` (신규, dodo 수입) — MediaRecorder 녹음→STT.
- `src/components/VoiceRecordButton.tsx` (신규, dodo 적응) — 탭-토글 마이크 버튼.
- `src/components/SearchBar.tsx` (수정) — 마이크 버튼 통합.
- `src/components/PlaceSearch.tsx` (수정) — `onTranscribed`→자동검색 배선, `runSearch(query?)` 일반화.
- `messages/ko.json`·`messages/en.json` (수정) — `voice` 키.
- `next.config.ts` (수정) — `withSerwist` 합성.
- `src/app/manifest.ts` (신규) — PWA manifest.
- `src/app/sw.ts` (신규) — Serwist 서비스워커(또는 폴백 `public/sw.js`).
- `public/icons/*` (신규) — PWA 아이콘(192·512·maskable·apple-touch).
- `src/app/[locale]/offline/page.tsx` (신규) — 오프라인 폴백.
- `src/app/[locale]/layout.tsx` (수정) — theme-color·apple-touch 메타·SW 등록(폴백 경로 시).
- `.env.local` (수정) — `DEEPGRAM_API_KEY`.

---

## M1: 음성 받아쓰기

### Task 1.1: Deepgram 응답 파서 (TDD)

**Files:**
- Create: `src/lib/deepgram.ts`
- Test: `src/lib/__tests__/deepgram.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/__tests__/deepgram.test.ts
import { describe, it, expect } from "vitest";
import { parseDeepgramTranscript } from "../deepgram";

const ok = {
  results: {
    channels: [
      {
        detected_language: "ko",
        alternatives: [{ transcript: "경복궁", confidence: 0.98, words: [] }],
      },
    ],
  },
};

describe("parseDeepgramTranscript", () => {
  it("전사 텍스트·언어·신뢰도를 추출한다", () => {
    expect(parseDeepgramTranscript(ok, "en")).toEqual({
      text: "경복궁",
      language_code: "ko",
      confidence: 0.98,
    });
  });
  it("detected_language 없으면 fallback locale", () => {
    const noLang = {
      results: { channels: [{ alternatives: [{ transcript: "hi", confidence: 0.9 }] }] },
    };
    expect(parseDeepgramTranscript(noLang, "en")?.language_code).toBe("en");
  });
  it("transcript 없으면 null", () => {
    expect(parseDeepgramTranscript({ results: { channels: [{ alternatives: [] }] } }, "ko")).toBeNull();
  });
  it("빈 transcript는 null", () => {
    const empty = { results: { channels: [{ alternatives: [{ transcript: "", confidence: 0 }] }] } };
    expect(parseDeepgramTranscript(empty, "ko")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/deepgram.test.ts`
Expected: FAIL — `parseDeepgramTranscript` 미정의.

- [ ] **Step 3: 구현**

```ts
// src/lib/deepgram.ts
/**
 * Deepgram STT 응답을 앱 공통 형태로 정규화한다(React/Next 비의존).
 * 전사 텍스트가 비면 null(인식 실패) — 가짜 결과를 만들지 않는다.
 */
export interface Transcript {
  text: string;
  language_code: string;
  confidence: number;
}

export function parseDeepgramTranscript(
  raw: unknown,
  fallbackLocale: string,
): Transcript | null {
  const channel = (
    raw as {
      results?: {
        channels?: {
          detected_language?: string;
          alternatives?: { transcript?: string; confidence?: number }[];
        }[];
      };
    }
  )?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const text = alt?.transcript?.trim();
  if (!text) return null;
  return {
    text,
    language_code: channel?.detected_language || fallbackLocale,
    confidence: typeof alt?.confidence === "number" ? alt.confidence : 0,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/deepgram.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deepgram.ts src/lib/__tests__/deepgram.test.ts
git commit -m "feat(voice): Deepgram 전사 응답 파서 (M1)"
```

### Task 1.2: env에 DEEPGRAM_API_KEY 추가

**Files:**
- Modify: `src/lib/env.ts`

- [ ] **Step 1: env.ts 확인 후 추가**

`src/lib/env.ts`를 읽고, 기존 패턴(예: `hasKakaoKey`)과 동일하게 `DEEPGRAM_API_KEY` 접근자와 `hasDeepgramKey()`를 추가한다. 기존 `env` 객체에 `DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY` 형태로, 그리고:
```ts
export function hasDeepgramKey(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}
```
(파일의 실제 구조에 맞춰 일관된 스타일로. 기존 키 접근자 정의 방식을 그대로 따른다.)

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(voice): DEEPGRAM_API_KEY env 접근자 (M1)"
```

### Task 1.3: STT 라우트

**Files:**
- Create: `src/app/api/speech-to-text/route.ts`

- [ ] **Step 1: 라우트 작성**

```ts
// src/app/api/speech-to-text/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseDeepgramTranscript } from "@/lib/deepgram";

/**
 * 음성 받아쓰기 프록시 — 클라이언트가 녹음한 오디오 Blob을 Deepgram
 * Nova-2로 보내 전사한다. DEEPGRAM_API_KEY는 서버에만 존재.
 * (dodo-planet에서 수입, gildongmu 파서/스타일로 적응)
 */
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const audio = formData.get("audio");
  const locale = (formData.get("locale") as string | null) ?? "ko";

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "오디오가 필요합니다." }, { status: 400 });
  }
  if (audio.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "오디오가 너무 큽니다. (최대 25MB)" },
      { status: 400 },
    );
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error("[stt] DEEPGRAM_API_KEY 미설정");
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const params = new URLSearchParams({
    model: "nova-2-conversationalai",
    smart_format: "true",
    punctuate: "true",
    diarize: "false",
    detect_language: "true",
  });

  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "audio/webm",
      },
      body: await audio.arrayBuffer(),
    });
    if (!res.ok) {
      console.error("[stt] Deepgram 오류:", res.status);
      return NextResponse.json(
        { error: "음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    const transcript = parseDeepgramTranscript(await res.json(), locale);
    if (!transcript) {
      return NextResponse.json(
        { error: "음성을 인식하지 못했습니다. 다시 말씀해 주세요." },
        { status: 422 },
      );
    }
    return NextResponse.json(transcript);
  } catch (e) {
    console.error("[stt] 처리 실패:", e);
    return NextResponse.json(
      { error: "음성 인식 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공, `/api/speech-to-text` 동적 라우트 등록.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/speech-to-text/route.ts
git commit -m "feat(voice): Deepgram STT 라우트 (M1)"
```

### Task 1.4: 권한·녹음 훅 수입

**Files:**
- Create: `src/hooks/useMicrophonePermission.ts`
- Create: `src/hooks/useVoiceRecorder.ts`

- [ ] **Step 1: useMicrophonePermission 수입**

dodo 파일을 그대로 복사한다(외부 의존 없음 — React만 사용):
원본: `~/Mac-Projects/dodo-planet/src/hooks/useMicrophonePermission.ts`
대상: `src/hooks/useMicrophonePermission.ts`
변경 없이 복사. (`MicPermissionState`, `checkPermission`, `requestPermission`, `reset` export — Permissions API + Safari localStorage 폴백.) 복사 후 `npx tsc --noEmit`이 통과하는지 확인(타입 호환).

- [ ] **Step 2: useVoiceRecorder 수입**

원본: `~/Mac-Projects/dodo-planet/src/hooks/useVoiceRecorder.ts`
대상: `src/hooks/useVoiceRecorder.ts`
변경 없이 복사(외부 의존 없음 — `fetch("/api/speech-to-text")` 사용, gildongmu 라우트와 동일 경로). `RecordingState`(`idle|recording|processing`), `startRecording/stopRecording/cancelRecording`, `isSupported`, `maxDuration=60`, 최소 0.3초 가드 포함.
**주의**: dodo 원본의 `eslint-disable react-hooks/exhaustive-deps` 주석이 gildongmu lint(`react-hooks` 규칙)와 충돌하면(특히 `react-hooks/set-state-in-effect`는 effect 내 setState만 대상이라 무관할 가능성 높음), 막무가내 disable 말고 앞선 마일스톤들처럼 정석 패턴 유지. lint 통과가 목표.

- [ ] **Step 3: lint + 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 통과. (훅은 아직 미사용이어도 export-only라 경고 없음.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMicrophonePermission.ts src/hooks/useVoiceRecorder.ts
git commit -m "feat(voice): 마이크 권한·녹음 훅 수입 (dodo) (M1)"
```

### Task 1.5: VoiceRecordButton (gildongmu 적응)

**Files:**
- Create: `src/components/VoiceRecordButton.tsx`
- Modify: `messages/ko.json`, `messages/en.json`

- [ ] **Step 1: voice 메시지 키 추가**

`messages/ko.json` 최상위에:
```json
"voice": {
  "start": "음성으로 검색",
  "stop": "녹음 정지",
  "recognizing": "음성 인식 중",
  "notSupported": "이 브라우저는 음성 입력을 지원하지 않습니다",
  "started": "녹음을 시작합니다. 다시 누르면 정지합니다.",
  "stopped": "녹음을 정지하고 인식합니다.",
  "cancelled": "녹음을 취소했습니다.",
  "transcribed": "인식 결과: {text}",
  "permissionDenied": "마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.",
  "error": "음성 인식에 실패했습니다. 다시 시도해 주세요."
}
```
`messages/en.json` 최상위에:
```json
"voice": {
  "start": "Search by voice",
  "stop": "Stop recording",
  "recognizing": "Recognizing speech",
  "notSupported": "This browser does not support voice input",
  "started": "Recording started. Tap again to stop.",
  "stopped": "Stopping and recognizing.",
  "cancelled": "Recording cancelled.",
  "transcribed": "Recognized: {text}",
  "permissionDenied": "Microphone permission is required. Please allow it in browser settings.",
  "error": "Voice recognition failed. Please try again."
}
```

- [ ] **Step 2: VoiceRecordButton 작성 (sonner·useSound·cn·모달 제거)**

```tsx
// src/components/VoiceRecordButton.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, Loader2, MicOff } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";

/**
 * 음성 받아쓰기 버튼 — 탭-토글(탭=시작, 다시 탭=정지·전사), Esc=취소.
 * dodo-planet에서 수입·적응(토스트/사운드/모달 제거, gildongmu 토큰·aria-live).
 * 상태 변화는 sr-only aria-live(assertive)로 통지. 오류는 onError로 부모에도 전달.
 */
export function VoiceRecordButton({
  onTranscribed,
  onError,
}: {
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const t = useTranslations("voice");
  const locale = useLocale();
  const announcerRef = useRef<HTMLDivElement>(null);
  const { permissionState, checkPermission, requestPermission } =
    useMicrophonePermission();

  const announce = useCallback((msg: string) => {
    if (announcerRef.current) {
      announcerRef.current.textContent = msg;
      setTimeout(() => {
        if (announcerRef.current) announcerRef.current.textContent = "";
      }, 2000);
    }
  }, []);

  const { state, startRecording, stopRecording, cancelRecording, isSupported } =
    useVoiceRecorder({
      maxDuration: 60,
      locale,
      onTranscribed: (text) => {
        announce(t("transcribed", { text }));
        onTranscribed(text);
      },
      onError: (msg) => {
        announce(msg);
        onError?.(msg);
      },
    });

  const beginRecording = useCallback(async () => {
    announce(t("started"));
    await startRecording();
  }, [announce, t, startRecording]);

  const handleClick = useCallback(async () => {
    if (!isSupported || state === "processing") return;
    if (state === "recording") {
      announce(t("stopped"));
      await stopRecording();
      return;
    }
    // idle → 권한 확인 후 녹음
    if (permissionState === "ready") {
      await beginRecording();
      return;
    }
    const result =
      permissionState === "idle" || permissionState === "checking"
        ? await checkPermission()
        : permissionState;
    if (result === "ready") {
      await beginRecording();
    } else if (result === "denied") {
      announce(t("permissionDenied"));
      onError?.(t("permissionDenied"));
    } else {
      // needsPermission → 네이티브 프롬프트로 직접 요청
      const granted = await requestPermission();
      if (granted) await beginRecording();
      else {
        announce(t("permissionDenied"));
        onError?.(t("permissionDenied"));
      }
    }
  }, [
    isSupported, state, permissionState, checkPermission, requestPermission,
    beginRecording, announce, t, onError,
  ]);

  // Esc로 녹음 취소
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && state === "recording") {
        announce(t("cancelled"));
        cancelRecording();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancelRecording, announce, t]);

  if (!isSupported) {
    // 미지원 브라우저: 버튼 자리에 아무것도 두지 않고 텍스트 검색만 — 단,
    // SR 사용자를 위해 비활성 버튼 + 안내를 둔다.
    return (
      <button
        type="button"
        aria-disabled="true"
        aria-label={t("notSupported")}
        className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-3 text-muted opacity-50"
      >
        <MicOff aria-hidden="true" className="h-5 w-5" />
      </button>
    );
  }

  const label =
    state === "recording" ? t("stop") : state === "processing" ? t("recognizing") : t("start");
  const icon =
    state === "recording" ? (
      <Square aria-hidden="true" className="h-5 w-5 fill-current" />
    ) : state === "processing" ? (
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
    ) : (
      <Mic aria-hidden="true" className="h-5 w-5" />
    );

  return (
    <>
      <div ref={announcerRef} role="status" aria-live="assertive" aria-atomic="true" className="sr-only" />
      <button
        type="button"
        onClick={handleClick}
        aria-disabled={state === "processing"}
        aria-busy={state === "recording" || state === "processing"}
        aria-label={label}
        className={
          "inline-flex min-h-12 items-center justify-center rounded-md border px-3 aria-disabled:opacity-50 " +
          (state === "recording"
            ? "border-red-600 bg-red-600 text-white"
            : "border-border text-accent")
        }
      >
        {icon}
      </button>
    </>
  );
}
```

- [ ] **Step 3: lint + 빌드**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 4: Commit**

```bash
git add src/components/VoiceRecordButton.tsx messages/
git commit -m "feat(voice): VoiceRecordButton 적응 (탭-토글·aria-live, dodo 의존성 제거) (M1)"
```

### Task 1.6: SearchBar 통합 + PlaceSearch 자동 검색

**Files:**
- Modify: `src/components/SearchBar.tsx`
- Modify: `src/components/PlaceSearch.tsx`

- [ ] **Step 1: SearchBar에 마이크 버튼 추가**

`src/components/SearchBar.tsx`에 `onTranscribed` prop을 추가하고 검색 버튼 옆에 `VoiceRecordButton`을 둔다.
```tsx
// import 추가
import { VoiceRecordButton } from "./VoiceRecordButton";

// props 타입에 추가:
//   onTranscribed: (text: string) => void;
//   onVoiceError?: (message: string) => void;

// <button type="submit" ...>{...}</button> 뒤(form 안)에 추가:
<VoiceRecordButton onTranscribed={onTranscribed} onError={onVoiceError} />
```
(form의 `flex gap-2` 안에 검색 input·검색 버튼·마이크 버튼이 나란히. 마이크는 form submit과 무관한 `type="button"`이라 폼 제출 안 됨.)

- [ ] **Step 2: PlaceSearch에서 runSearch 일반화 + 배선**

`src/components/PlaceSearch.tsx`의 `runSearch`(또는 `performSearch`)가 **인자 query를 우선** 받도록 한다(미전달 시 state `query` 사용). 그리고 SearchBar에 `onTranscribed`를 배선:
```tsx
// performSearch 시그니처: async function performSearch(q: string) { ... } 가 이미 있으면 그대로 사용.
// 전사 핸들러:
const handleTranscribed = (text: string) => {
  setQuery(text);
  void performSearch(text); // 자동 검색
};
// SearchBar에 전달:
<SearchBar
  query={query}
  onQueryChange={setQuery}
  onSubmit={runSearch}
  busy={status.kind === "loading"}
  onTranscribed={handleTranscribed}
  onVoiceError={() => setStatus({ kind: "error" })}
/>
```
주의: v2의 `performSearch`는 이미 `reqIdRef` 가드를 갖고 `?q=` 동기화·포커스 이동을 한다. 전사 자동검색도 같은 `performSearch`를 타므로 그 보장(최신 요청만 반영·URL 동기화·결과 헤딩 포커스)을 그대로 받는다. `runSearch`(폼 제출용, 인자 없는 래퍼)와 `performSearch`(인자 받는 본체)의 관계가 현재 코드와 맞는지 확인하고, `handleTranscribed`는 본체 `performSearch(text)`를 호출한다.

- [ ] **Step 3: 전체 게이트**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 4: 수동 확인(설명)**

`npm run dev` → 검색창 마이크 탭 → 권한 허용 → 말하기 → 다시 탭 → 인식 텍스트로 자동 검색·결과 표시. (실 STT는 dev에서 `DEEPGRAM_API_KEY` 필요 — Task 1.7 후. M3 스모크에서 검증.)

- [ ] **Step 5: Commit**

```bash
git add src/components/SearchBar.tsx src/components/PlaceSearch.tsx
git commit -m "feat(voice): SearchBar 마이크 통합 + 전사 자동검색 배선 (M1)"
```

### Task 1.7: DEEPGRAM_API_KEY 이관

**Files:**
- Modify: `.env.local`

- [ ] **Step 1: dodo 키를 gildongmu .env.local로 복사**

Run (값 노출 없이):
```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
grep -q '^DEEPGRAM_API_KEY=' .env.local || \
  grep '^DEEPGRAM_API_KEY=' ~/Mac-Projects/dodo-planet/.env.local >> .env.local
grep -c '^DEEPGRAM_API_KEY=' .env.local   # 1 이어야 함
```
Expected: `.env.local`에 `DEEPGRAM_API_KEY=` 1줄. (`.env.local`은 gitignore — 커밋 안 함.)

- [ ] **Step 2: dev 서버로 실 STT 스모크(설명만, M3에서 수행)**

`.env.local` 적용 후 dev 재시작 필요. 실제 음성 스모크는 M3 검증 단계에서.

- [ ] **Step 3: 커밋할 것 없음**

`.env.local`은 추적 제외. 이 Task는 커밋 없음.

---

## M2: PWA (Serwist)

### Task 2.1: Serwist 설치 + Turbopack 호환 검증

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`

- [ ] **Step 1: 패키지 설치**

Run: `npm install @serwist/next && npm install -D serwist`
Expected: 설치 성공.

- [ ] **Step 2: next.config.ts 합성**

```ts
// next.config.ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // 개발 중 SW 비활성(HMR 간섭 방지)
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {};

export default withSerwist(withNextIntl(nextConfig));
```

- [ ] **Step 3: 호환 검증 (게이트)**

Run: `npm run build`
Expected: 성공 + `public/sw.js` 생성.
**만약 Turbopack 빌드가 Serwist로 실패하면**(예: webpack 전용 플러그인 에러): 폴백으로 전환 — 이 Task와 Task 2.4의 Serwist 경로를 버리고, (a) `next.config.ts`를 원복(withSerwist 제거), (b) Task 2.4의 "폴백: 수제 SW" 경로를 따른다. 실패 로그 요지를 보고에 남길 것.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "feat(pwa): Serwist 도입 + next.config 합성 (M2)"
```

### Task 2.2: PWA 아이콘 생성

**Files:**
- Create: `public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`

- [ ] **Step 1: 브랜드 아이콘 SVG 작성**

`public/icons/icon.svg` — accent(#1d4ed8) 배경 라운드 사각 + 흰색 위치 핀 + "길" 글리프(고대비). 512x512 viewBox.
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1d4ed8"/>
  <path d="M256 120c-61.9 0-112 50.1-112 112 0 84 112 180 112 180s112-96 112-180c0-61.9-50.1-112-112-112z" fill="#ffffff"/>
  <circle cx="256" cy="232" r="44" fill="#1d4ed8"/>
</svg>
```
(위치 핀 모티프 — 길찾기 앱 정체성. "길" 글리프는 폰트 의존 회피 위해 핀+점 도형으로 단순화.)

- [ ] **Step 2: PNG 생성**

가용 도구로 SVG→PNG 변환. 우선순위: `rsvg-convert` → `npx --yes sharp-cli` → macOS `qlmanage`/`sips`.
Run (rsvg-convert 있을 때 예시):
```bash
cd public/icons
for s in 192 512; do rsvg-convert -w $s -h $s icon.svg -o icon-$s.png; done
rsvg-convert -w 512 -h 512 icon.svg -o icon-maskable-512.png
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png
ls -la
```
없으면 sharp:
```bash
npx --yes sharp-cli -i icon.svg -o icon-192.png resize 192 192
```
(maskable은 안전영역상 핀이 중앙에 충분히 들어와 현재 SVG로 무방 — 별도 패딩 버전 불필요.) 각 PNG가 생성됐는지 `ls`로 확인.

- [ ] **Step 3: Commit**

```bash
git add public/icons
git commit -m "feat(pwa): 브랜드 아이콘(위치 핀) + PWA 사이즈 PNG (M2)"
```

### Task 2.3: manifest

**Files:**
- Create: `src/app/manifest.ts`

- [ ] **Step 1: manifest 작성**

```ts
// src/app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "길동무 Gildongmu",
    short_name: "길동무",
    description: "누구나 쓸 수 있는 대한민국 길찾기",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공, `/manifest.webmanifest` 생성. (proxy.ts matcher가 `.webmanifest`(점 포함) 제외라 로케일 라우팅 미간섭 — 확인.)

- [ ] **Step 3: Commit**

```bash
git add src/app/manifest.ts
git commit -m "feat(pwa): web app manifest (M2)"
```

### Task 2.4: 서비스워커 + 오프라인 폴백

**Files:**
- Create: `src/app/sw.ts` (Serwist 경로) **또는** `public/sw.js` + 등록 코드 (폴백 경로)
- Create: `src/app/[locale]/offline/page.tsx`
- Modify: `messages/ko.json`, `messages/en.json`

- [ ] **Step 1: 오프라인 페이지 + 메시지**

`src/app/[locale]/offline/page.tsx`:
```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("offline");
  return (
    <section aria-label={t("heading")}>
      <h2 className="text-xl font-semibold">{t("heading")}</h2>
      <p className="mt-2">{t("body")}</p>
    </section>
  );
}
```
`messages/ko.json` 최상위 `offline`: `{ "heading": "오프라인 상태입니다", "body": "인터넷 연결을 확인한 뒤 다시 시도해 주세요. 검색은 온라인에서만 동작합니다." }`
`messages/en.json` 최상위 `offline`: `{ "heading": "You are offline", "body": "Check your connection and try again. Search works only online." }`

- [ ] **Step 2a: Serwist 서비스워커 (Task 2.1이 성공한 경우)**

```ts
// src/app/sw.ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // 페이지는 network-first, 실패 시 /ko/offline 폴백. API는 캐시 안 함.
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [{ url: "/ko/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
```
(API 비캐시: `defaultCache`는 `/api`를 NetworkFirst로 두므로, 검색 결과가 캐시되지 않도록 `runtimeCaching`에서 `/api/` 경로를 제외하거나 NetworkOnly로 둔다 — 구현 시 `defaultCache`를 필터해 `/api/`는 NetworkOnly 규칙을 앞에 추가. 실데이터 원칙.)

- [ ] **Step 2b: 폴백 — 수제 서비스워커 (Task 2.1이 실패한 경우만)**

`public/sw.js`(평문 SW):
```js
const SHELL = "gildongmu-shell-v1";
const OFFLINE_URL = "/ko/offline";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // API 비캐시(실데이터)
  if (req.destination === "document") {
    // 페이지: network-first → 오프라인 폴백
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});
```
그리고 등록 코드 — `src/app/[locale]/layout.tsx`의 body 끝에 클라이언트 등록 컴포넌트(`src/components/SWRegister.tsx`, `"use client"`, `useEffect`로 `navigator.serviceWorker?.register("/sw.js")`)를 추가. Serwist 경로(2a)는 자동 등록이라 이 단계 불필요.

- [ ] **Step 3: 게이트**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 통과 + `public/sw.js` 존재(2a면 Serwist 생성, 2b면 직접 작성).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(pwa): 서비스워커(앱셸·오프라인 폴백, API 비캐시) + 오프라인 페이지 (M2)"
```

### Task 2.5: 메타데이터(theme-color·apple-touch)

**Files:**
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: viewport·아이콘 메타 추가**

`src/app/[locale]/layout.tsx`에 `viewport` export와 apple-touch 아이콘 메타 추가(기존 generateMetadata와 별개):
```ts
import type { Viewport } from "next";
export const viewport: Viewport = { themeColor: "#1d4ed8" };
```
그리고 `generateMetadata` 반환에 아이콘 추가:
```ts
return {
  title: t("title"),
  description: t("tagline"),
  appleWebApp: { capable: true, title: "길동무", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
```
(2b 폴백 경로면 여기에 `<SWRegister />`도 body에 포함 — Task 2.4 Step 2b 참조.)

- [ ] **Step 2: 게이트**

Run: `npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/layout.tsx
git commit -m "feat(pwa): theme-color·apple-touch 메타 (M2)"
```

---

## M3: 검증 · 배포 (컨트롤러 수행)

### Task 3.1: a11y 감사

- [ ] a11y-auditor로 VoiceRecordButton·SearchBar 통합·오프라인 페이지 점검(마이크 버튼 aria-label 상태별 정확, aria-live 통지, 44px, 키보드 도달, 미지원/거부 graceful). 지적 수정.

### Task 3.2: codex 마일스톤 리뷰

- [ ] `git diff main..feat/gildongmu-v2.1-voice-pwa`(docs 제외)를 codex에 직접 주입(파일 탐색 금지). 포커스: STT 라우트 검증·graceful degrade, 녹음 훅 race/클린업, SW 캐시 정책(API 비캐시 보장), manifest/아이콘 경로. fix 반영.

### Task 3.3: 키 등록 + 최종 게이트 + 배포

- [ ] `DEEPGRAM_API_KEY` Vercel Production 등록: `printf '%s' "$VAL" | vercel env add DEEPGRAM_API_KEY production`(값은 `.env.local`에서).
- [ ] `npm run test:run && npm run lint && npm run build` 통과.
- [ ] 문서: `SPEC.md` 백로그·`CLAUDE.md`(받아쓰기·PWA 아키텍처) 갱신 + 루트 `python sync_agent_docs.py`.
- [ ] main 병합 + 푸시(프로덕션 자동 배포).
- [ ] 프로덕션 스모크: `/manifest.webmanifest` 200, `/sw.js` 200, STT 라우트(작은 오디오로 또는 UI에서), 모바일 "홈 추가" 가능 여부.

---

## Self-Review (작성자 체크)

- **스펙 커버리지**: STT 라우트+파서(1.1/1.3) · env(1.2) · 훅 수입(1.4) · 버튼 적응(1.5) · SearchBar 통합+자동검색(1.6) · 키 이관(1.7/3.3) · Serwist+호환검증+폴백(2.1/2.4) · manifest(2.3) · 아이콘(2.2) · SW+오프라인+API비캐시(2.4) · 메타(2.5) · graceful degrade(1.5 미지원 분기) · 검증/배포(M3) — 전부 태스크 존재.
- **placeholder**: Serwist 실패 시 폴백은 *명시된 분기*(2.1 Step3 + 2.4 Step2b)이지 placeholder 아님. 아이콘 변환 도구는 가용 순위 명시.
- **타입 일관성**: `Transcript`(deepgram.ts) ↔ STT 라우트 응답 ↔ 훅 `onTranscribed(text)`. `VoiceRecordButton` props(`onTranscribed`/`onError`) ↔ SearchBar ↔ PlaceSearch `handleTranscribed`. `performSearch(q)` 인자 경로는 1.6에서 기존 코드와 대조해 연결.
