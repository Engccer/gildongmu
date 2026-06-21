# 장소별 채팅 재배치 구현 계획 (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅을 메인 페이지 모드 분기에서 떼어내, 각 장소 상세 화면의 "이 장소에 관해 물어보기" 오버레이 진입점으로 재배치한다(채팅 엔진은 그대로 재사용).

**Architecture:** 채팅 엔진·UI 코어(`/api/chat`·`runAgentLoop`·router·`ChatInterface`·`useChat`·`MessageBubble`)는 불변. (1) 메인 분기(`ModeToggle`·`mode-state`·`keyboard-shortcuts`·`useAppMode`)를 제거하고 `PlaceSearch`를 순수 검색으로 환원, (2) `DistanceBeacon` 마운트만 제거(코드 보존), (3) `PlaceDetail`에 진입 버튼 + `ChatOverlay`(dialog·포커스 트랩·Esc·닫기 버튼) 추가, (4) `/api/chat`에 선택적 `placeContext`를 더해 좌표 도구가 장소를 앵커로 동작하게 한다(길찾기 출발지는 현위치 보존).

**Tech Stack:** Next.js 16, React 19, next-intl 4, Vitest 4(node-env), Gemini function-calling, Tailwind v4.

## Global Constraints

- 언어: 코드 주석·커밋 메시지·문서 한국어, 변수/함수명 영어. UI 라벨 이모지 금지(lucide 아이콘은 `aria-hidden` 허용).
- 접근성(미니멀 ARIA): 새 live region·landmark·skip link 신설 금지. dialog는 `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + 포커스 트랩 + Esc로 충분. 닫기 3요건: 명시적 닫기 버튼·Esc 모두 트리거 버튼으로 포커스 복귀.
- 테스트 동반: 기능·버그픽스는 같은 커밋에 테스트(순수 로직). node-env라 컴포넌트 와이어링은 lint+build+dev 실호출이 게이트.
- 외부 데이터 분기는 `dataLocale`/`prefersEnglish` 경유(원시 `useLocale()` 직접 금지) — 이 plan은 신규 외부 fetch 없음(기존 도구 재사용).
- `i18n-messages.test.ts`가 5개 언어(`ko/en/es/fr/it`) 키 집합·ICU 플레이스홀더 패리티를 강제 — placeChat.* 키는 5개 모두에 동일 구조로 추가.
- 커밋 이메일 `engccer@gmail.com`. `git add -A` 금지(의도 파일만 stage).
- **불변식 I-1**: 장소 컨텍스트(placeAnchor)일 때 좌표 도구의 LLM 데이터는 장소 좌표 기준. **I-2**: 길찾기 도구(car/transit) 출발지는 실제 `userLocation`(장소로 덮어쓰지 않음). **I-3**: `placeContext` 없으면 기존 동작 불변(하위호환).

---

### Task 1: i18n placeChat.* 키 추가 (5개 언어)

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`
- Test: `src/__tests__/i18n-messages.test.ts` (기존, 게이트)

**Interfaces:**
- Produces: `placeChat.launch`·`placeChat.title`·`placeChat.close`·`placeChat.empty`·`placeChat.prompt.{stationArrivals,stationFacilities,stationSurroundings,foodRoute,foodSimilar,foodWeather,generalRoute,generalSurroundings,generalWeather}` — Task 2/6/7/8이 참조.

- [ ] **Step 1: ko.json에 placeChat 블록 추가**

`messages/ko.json`의 최상위 객체에 다음 키 블록을 추가한다(기존 `chat` 블록과 형제 레벨, 알파벳/논리 순서 적당히):

```json
  "placeChat": {
    "launch": "이 장소에 관해 물어보기",
    "title": "이 장소에 관해 물어보기",
    "close": "채팅 닫기",
    "empty": "무엇이 궁금하세요? 아래에서 골라도 됩니다.",
    "prompt": {
      "stationArrivals": "이 역 실시간 지하철 도착 정보 알려줘",
      "stationFacilities": "이 역 교통약자 편의시설 알려줘",
      "stationSurroundings": "이 역 주변에 뭐가 있어?",
      "foodRoute": "여기까지 가는 법 알려줘",
      "foodSimilar": "이 근처에 비슷한 곳 더 있어?",
      "foodWeather": "이 지역 날씨 어때?",
      "generalRoute": "여기까지 가는 법 알려줘",
      "generalSurroundings": "주변에 뭐가 있어?",
      "generalWeather": "이 지역 공기질이랑 날씨 알려줘"
    }
  },
```

- [ ] **Step 2: en.json에 동일 구조로 추가**

```json
  "placeChat": {
    "launch": "Ask about this place",
    "title": "Ask about this place",
    "close": "Close chat",
    "empty": "What would you like to know? You can pick one below.",
    "prompt": {
      "stationArrivals": "Show real-time subway arrivals for this station",
      "stationFacilities": "What accessibility facilities does this station have?",
      "stationSurroundings": "What's around this station?",
      "foodRoute": "How do I get here?",
      "foodSimilar": "Any similar places nearby?",
      "foodWeather": "What's the weather like here?",
      "generalRoute": "How do I get here?",
      "generalSurroundings": "What's nearby?",
      "generalWeather": "Tell me the air quality and weather here"
    }
  },
```

- [ ] **Step 3: es.json에 동일 구조로 추가**

```json
  "placeChat": {
    "launch": "Preguntar sobre este lugar",
    "title": "Preguntar sobre este lugar",
    "close": "Cerrar chat",
    "empty": "¿Qué te gustaría saber? Puedes elegir una opción abajo.",
    "prompt": {
      "stationArrivals": "Muéstrame las llegadas de metro en tiempo real de esta estación",
      "stationFacilities": "¿Qué instalaciones de accesibilidad tiene esta estación?",
      "stationSurroundings": "¿Qué hay alrededor de esta estación?",
      "foodRoute": "¿Cómo llego hasta aquí?",
      "foodSimilar": "¿Hay lugares similares cerca?",
      "foodWeather": "¿Qué tiempo hace aquí?",
      "generalRoute": "¿Cómo llego hasta aquí?",
      "generalSurroundings": "¿Qué hay cerca?",
      "generalWeather": "Dime la calidad del aire y el tiempo aquí"
    }
  },
```

- [ ] **Step 4: fr.json에 동일 구조로 추가**

```json
  "placeChat": {
    "launch": "Poser une question sur ce lieu",
    "title": "Poser une question sur ce lieu",
    "close": "Fermer le chat",
    "empty": "Que voulez-vous savoir ? Vous pouvez en choisir une ci-dessous.",
    "prompt": {
      "stationArrivals": "Afficher les arrivées de métro en temps réel pour cette station",
      "stationFacilities": "Quels équipements d'accessibilité possède cette station ?",
      "stationSurroundings": "Qu'y a-t-il autour de cette station ?",
      "foodRoute": "Comment puis-je m'y rendre ?",
      "foodSimilar": "Y a-t-il des lieux similaires à proximité ?",
      "foodWeather": "Quel temps fait-il ici ?",
      "generalRoute": "Comment puis-je m'y rendre ?",
      "generalSurroundings": "Qu'y a-t-il à proximité ?",
      "generalWeather": "Indique-moi la qualité de l'air et la météo ici"
    }
  },
```

- [ ] **Step 5: it.json에 동일 구조로 추가**

```json
  "placeChat": {
    "launch": "Chiedi informazioni su questo luogo",
    "title": "Chiedi informazioni su questo luogo",
    "close": "Chiudi chat",
    "empty": "Cosa vuoi sapere? Puoi sceglierne una qui sotto.",
    "prompt": {
      "stationArrivals": "Mostra gli arrivi della metro in tempo reale per questa stazione",
      "stationFacilities": "Quali servizi di accessibilità ha questa stazione?",
      "stationSurroundings": "Cosa c'è intorno a questa stazione?",
      "foodRoute": "Come ci arrivo?",
      "foodSimilar": "Ci sono luoghi simili nelle vicinanze?",
      "foodWeather": "Che tempo fa qui?",
      "generalRoute": "Come ci arrivo?",
      "generalSurroundings": "Cosa c'è nelle vicinanze?",
      "generalWeather": "Dimmi la qualità dell'aria e il meteo qui"
    }
  },
```

- [ ] **Step 6: i18n 패리티 테스트 실행**

Run: `npm run test:run -- i18n-messages`
Expected: PASS (5개 언어 placeChat.* 키 집합 동일).

- [ ] **Step 7: Commit**

```bash
git commit -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json -m "i18n(chat): placeChat 장소별 채팅 키 5개 언어 추가"
```

---

### Task 2: placeChatPrompts 순수 함수

**Files:**
- Create: `src/lib/chat/place-prompts.ts`
- Test: `src/lib/chat/__tests__/place-prompts.test.ts`

**Interfaces:**
- Consumes: `isStation(place)` from `@/lib/station-match`, `categoryOf(category)` from `@/lib/category`, `Place` from `@/lib/types`.
- Produces: `placeChatPrompts(place: Place): string[]` — 길이 3, 각 원소는 i18n 키 문자열. Task 7(ChatOverlay)이 이 키들을 `useTranslations()`로 번역해 ChatInterface에 전달.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/chat/__tests__/place-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Place } from "@/lib/types";
import { placeChatPrompts } from "../place-prompts";

function place(over: Partial<Place>): Place {
  return {
    id: "1", name: "테스트", category: "기타",
    address: "", roadAddress: "", lat: 37.5, lng: 127.0,
    ...over,
  };
}

describe("placeChatPrompts", () => {
  it("역이면 station 프롬프트 3개", () => {
    const p = place({ name: "강남역", category: "지하철" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.stationArrivals",
      "placeChat.prompt.stationFacilities",
      "placeChat.prompt.stationSurroundings",
    ]);
  });

  it("이름이 '역'으로 끝나도 역으로 판정", () => {
    const p = place({ name: "서울역", category: "기타" });
    expect(placeChatPrompts(p)[0]).toBe("placeChat.prompt.stationArrivals");
  });

  it("음식/카페면 food 프롬프트 3개", () => {
    const p = place({ name: "스타벅스 강남점", category: "음식점 > 카페" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.foodRoute",
      "placeChat.prompt.foodSimilar",
      "placeChat.prompt.foodWeather",
    ]);
  });

  it("그 외(관광 등)는 general 프롬프트 3개", () => {
    const p = place({ name: "경복궁", category: "여행 > 관광,명소 > 고궁" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.generalRoute",
      "placeChat.prompt.generalSurroundings",
      "placeChat.prompt.generalWeather",
    ]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- place-prompts`
Expected: FAIL ("Cannot find module '../place-prompts'").

- [ ] **Step 3: 구현**

`src/lib/chat/place-prompts.ts`:

```ts
/**
 * 장소 유형별 채팅 예시 프롬프트 키를 고른다(순수·React 비의존).
 *
 * 빈 채팅 오버레이의 "물어볼 만한 예시 3개"를 장소 성격에 맞춰 제시한다.
 * 역(실시간 도착·편의시설·주변) / 음식·카페(길찾기·유사·날씨) / 일반(길찾기·주변·환경).
 * 반환은 i18n 키 — 번역은 호출 측(ChatOverlay)이 useTranslations로 수행한다.
 */
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { categoryOf } from "@/lib/category";

export function placeChatPrompts(place: Place): string[] {
  if (isStation(place)) {
    return [
      "placeChat.prompt.stationArrivals",
      "placeChat.prompt.stationFacilities",
      "placeChat.prompt.stationSurroundings",
    ];
  }
  if (categoryOf(place.category) === "food") {
    return [
      "placeChat.prompt.foodRoute",
      "placeChat.prompt.foodSimilar",
      "placeChat.prompt.foodWeather",
    ];
  }
  return [
    "placeChat.prompt.generalRoute",
    "placeChat.prompt.generalSurroundings",
    "placeChat.prompt.generalWeather",
  ];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- place-prompts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git commit -- src/lib/chat/place-prompts.ts src/lib/chat/__tests__/place-prompts.test.ts -m "feat(chat): placeChatPrompts 장소 유형별 예시 프롬프트 키 선택"
```

---

### Task 3: 장소 앵커 — ExecutionContext + router 좌표 분기

**Files:**
- Modify: `src/lib/chat/types.ts:17-24` (ExecutionContext)
- Modify: `src/lib/chat/router.ts:26-101` (anchorOf + resolveCoord + 4 nearby + bus/bike)
- Test: `src/lib/chat/__tests__/router-anchor.test.ts`

**Interfaces:**
- Consumes: `ExecutionContext` from `./types`.
- Produces: `anchorOf(ctx: ExecutionContext): { lat: number; lng: number } | undefined` exported from `router.ts`. `ExecutionContext.placeAnchor?: { lat: number; lng: number; name: string }` — Task 4(route)가 세팅.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/chat/__tests__/router-anchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ExecutionContext } from "../types";
import { anchorOf } from "../router";

function ctx(over: Partial<ExecutionContext>): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

describe("anchorOf", () => {
  it("placeAnchor가 있으면 장소 좌표를 쓴다", () => {
    const c = ctx({
      userLocation: { lat: 1, lng: 1 },
      placeAnchor: { lat: 37.58, lng: 126.97, name: "경복궁" },
    });
    expect(anchorOf(c)).toEqual({ lat: 37.58, lng: 126.97, name: "경복궁" });
  });

  it("placeAnchor가 없으면 현재 위치를 쓴다", () => {
    const c = ctx({ userLocation: { lat: 2, lng: 3 } });
    expect(anchorOf(c)).toEqual({ lat: 2, lng: 3 });
  });

  it("둘 다 없으면 undefined", () => {
    expect(anchorOf(ctx({}))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- router-anchor`
Expected: FAIL ("anchorOf is not a function" 또는 placeAnchor 타입 에러).

- [ ] **Step 3: ExecutionContext에 placeAnchor 추가**

`src/lib/chat/types.ts`의 `ExecutionContext`(17-24행)를 다음으로 교체:

```ts
/** 도구 실행 컨텍스트 — 각 도구 함수에 전달되는 공유 상태. */
export interface ExecutionContext {
  /** 사용자 현재 위치 (WGS84). 위치 권한 없으면 undefined. 길찾기 출발지로 쓴다. */
  userLocation?: { lat: number; lng: number };
  /**
   * 장소 컨텍스트 앵커 (WGS84 + 이름). 장소 상세에서 연 채팅일 때만 존재한다.
   * 주변/앰비언트 좌표 도구의 기준 좌표가 되며(I-1), userLocation을 덮어쓰지 않아
   * 길찾기 출발지는 현재 위치로 보존된다(I-2). 없으면 기존 동작(I-3).
   */
  placeAnchor?: { lat: number; lng: number; name: string };
  /** UI 로케일 (ko|en|es|fr|it) */
  locale: string;
  /** 외부 데이터 언어 — dataLocale()로 파생 (ko|en) */
  dataLocale: "ko" | "en";
}
```

- [ ] **Step 4: router.ts에 anchorOf 추가 + resolveCoord·4 nearby·bus/bike 분기**

`src/lib/chat/router.ts`의 `resolveCoord`(26-37행)를 다음으로 교체:

```ts
/** 좌표 도구의 기준 좌표 — 장소 앵커 우선, 없으면 현재 위치. */
export function anchorOf(
  ctx: ExecutionContext,
): { lat: number; lng: number } | undefined {
  return ctx.placeAnchor ?? ctx.userLocation;
}

/** 지명 → 좌표(카카오 지오코딩 첫 결과). 미지정이면 장소 앵커/현재 위치. */
async function resolveCoord(
  place: string | undefined,
  ctx: ExecutionContext,
): Promise<{ lat: number; lng: number } | undefined> {
  if (place) {
    const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
    const p = r.places[0];
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }
  return anchorOf(ctx);
}
```

이어 4개 nearby 케이스(58-77행: `get_subway_arrivals`·`get_night_clinics`·`get_kids_places`·`get_surroundings`)를 다음으로 교체. **핵심**: 데이터는 앵커 기준, **카드(render)는 장소 앵커일 때 생략**(self-fetch 카드가 기기 위치를 써서 산문과 어긋나는 것 방지 — 산문이 정본):

```ts
    case "get_subway_arrivals": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const arrivals = await fetchNearbySubwayArrivals(anchor.lat, anchor.lng);
      // 장소 앵커일 땐 device-self-fetch 카드가 장소와 어긋나므로 생략(산문이 정본).
      const render = ctx.placeAnchor ? undefined : ({ type: "subway-nearby" } as const);
      return { data: { count: arrivals.length, arrivals }, render, source: src };
    }
    case "get_night_clinics": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const clinics = await findNightClinicsNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "clinics-nearby" } as const);
      return { data: { count: clinics.length, clinics: clinics.slice(0, 5) }, render, source: src };
    }
    case "get_kids_places": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const kids = await findKidsPlacesNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "kids-nearby" } as const);
      return { data: { count: kids.length, places: kids.slice(0, 8) }, render, source: src };
    }
    case "get_surroundings": {
      const anchor = anchorOf(ctx);
      if (!anchor) return { data: NO_LOCATION };
      const around = await findSurroundingsNear(anchor.lat, anchor.lng);
      const render = ctx.placeAnchor ? undefined : ({ type: "surroundings-nearby" } as const);
      return { data: { count: around.length, places: around.slice(0, 12) }, render, source: src };
    }
```

이어 `get_bus_arrivals`(78-87행)와 `get_bike_stations`(88-96행)를 교체. **좌표 보유 카드는 장소 앵커일 때 place 모드로 그 좌표를 fetch**:

```ts
    case "get_bus_arrivals": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stops = await fetchNearbyBusStops(coord.lat, coord.lng);
      // 명시 지명 또는 장소 앵커 → place 모드(카드가 그 좌표를 fetch). 아니면 current.
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bus" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bus" as const, mode: "current" as const };
      return { data: { count: stops.length, stops: stops.slice(0, 5) }, render, source: src };
    }
    case "get_bike_stations": {
      const explicit = args.place ? String(args.place) : undefined;
      const coord = await resolveCoord(explicit, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stations = await fetchNearbyBikeStations(coord.lat, coord.lng);
      const placeMode = !!explicit || !!ctx.placeAnchor;
      const render = placeMode
        ? { type: "bike" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bike" as const, mode: "current" as const };
      return { data: { count: stations.length, stations: stations.slice(0, 5) }, render, source: src };
    }
```

> 참고: `get_air_quality`는 이미 `resolveCoord`→render에 좌표를 싣고 있어 변경 불필요(resolveCoord가 장소 앵커를 돌려주므로 자동으로 장소 기준). `get_car_route`·`get_transit_route`는 출발지로 `ctx.userLocation`을 그대로 쓰므로 변경 금지(I-2). `search_places`·`search_address`·`get_station_meta`·`get_station_facilities`는 좌표 비의존이라 변경 불필요.

- [ ] **Step 5: 테스트 통과 + 전체 타입체크**

Run: `npm run test:run -- router-anchor`
Expected: PASS (3 tests).
Run: `npm run build`
Expected: 타입 에러 없이 성공(RenderPayload union이 `undefined` render를 이미 옵셔널로 허용).

- [ ] **Step 6: Commit**

```bash
git commit -- src/lib/chat/types.ts src/lib/chat/router.ts src/lib/chat/__tests__/router-anchor.test.ts -m "feat(chat): 장소 앵커(placeAnchor) — 주변도구=장소기준·길찾기=현위치 출발 불변식"
```

---

### Task 4: /api/chat — placeContext 수신 + systemInstruction

**Files:**
- Modify: `src/app/api/chat/route.ts:12-46`

**Interfaces:**
- Consumes: `ExecutionContext.placeAnchor` (Task 3).
- Produces: `/api/chat` POST body가 선택적 `placeContext: { name: string; lat: number; lng: number; category?: string; isStation?: boolean }`를 받는다 — Task 5(useChat)가 전송.

- [ ] **Step 1: ChatRequest 인터페이스에 placeContext 추가**

`src/app/api/chat/route.ts`의 `ChatRequest`(12-16행)를 교체:

```ts
interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
  /** 장소 상세에서 연 채팅일 때 — 좌표 도구의 장소 앵커(I-1) + LLM 지시(I-3). */
  placeContext?: { name: string; lat: number; lng: number; category?: string; isStation?: boolean };
}
```

- [ ] **Step 2: ctx에 placeAnchor 주입 + systemInstruction 보강**

`route.ts`의 ctx 생성(35-36행)과 systemInstruction(38-46행) 사이를 다음으로 교체:

```ts
  const locale = body.locale ?? "ko";
  const pc = body.placeContext;
  const ctx: ExecutionContext = {
    userLocation: body.userLocation,
    placeAnchor: pc ? { lat: pc.lat, lng: pc.lng, name: pc.name } : undefined,
    locale,
    dataLocale: dataLocale(locale),
  };

  const placeInstruction = pc
    ? `\n[장소 컨텍스트]\n` +
      `- 사용자는 지금 '${pc.name}'${pc.category ? `(${pc.category})` : ""}에 관해 묻고 있다. "여기/이곳/근처/주변"은 이 장소를 가리킨다.\n` +
      `- 주변 시설·교통·공기질 등 위치 기반 조회는 이 장소를 기준으로 한다(지명을 따로 주지 않아도 이 장소가 기본 위치다).\n` +
      `- 단 "여기까지 가는 법" 같은 길찾기는 사용자의 현재 위치에서 '${pc.name}'(으)로 가는 경로다 — 길찾기 도구의 목적지로 '${pc.name}'을(를) 넘겨라.`
    : "";

  const systemInstruction =
    `너는 한국 로컬 정보 에이전트다. 사용자 언어(${locale})로 답한다.\n` +
    `[도구 사용]\n` +
    `- 사용자 의도를 충족하는 데 필요한 도구를 충분히 호출하라. 관련 정보(경로 질문이면 날씨·공기질 등)는 자율적으로 연쇄 조회하되, 명백히 무관한 건 호출하지 마라.\n` +
    `- "확인 중", "잠시만요" 같은 대기 멘트로 턴을 끝내지 마라. 이 채팅엔 자동 후속이 없다 — 도구를 쓸 거면 같은 턴에 호출하고, 충분한 결과를 모은 뒤에만 최종 답변하라.\n` +
    `[신뢰성]\n` +
    `- 도구가 돌려준 필드(이름·분류·주소·수치·등급·경로 등)만 사실로 전달하라. 장소의 분위기·평판·메뉴·인테리어처럼 도구가 주지 않은 특징은 네 사전지식으로라도 지어내지 마라(사용자는 시각으로 검증할 수 없다). 더 알아야 하면 도구를 호출하고, 없으면 그 한계를 인정하라.\n` +
    `- 도구가 실패하거나 빈 결과면 지어내지 말고, 실패를 분명히 알린 뒤 구체적 대안 한 가지를 제시하라.\n` +
    `- 출처·딥링크는 시스템이 응답 하단에 자동으로 붙인다. 본문엔 URL을 나열하지 말고 간결하게 핵심만 종합하라.` +
    placeInstruction;
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공(타입 에러 없음).

- [ ] **Step 4: Commit**

```bash
git commit -- src/app/api/chat/route.ts -m "feat(chat): /api/chat placeContext 수신 — 장소 앵커 주입 + LLM 장소 지시"
```

---

### Task 5: useChat — placeContext 파라미터

**Files:**
- Modify: `src/hooks/useChat.ts:19-67,113`

**Interfaces:**
- Consumes: 없음(POST body에 추가만).
- Produces: `useChat(opts?: { placeContext?: PlaceContext })` — `PlaceContext = { name: string; lat: number; lng: number; category?: string; isStation?: boolean }`. Task 6(ChatInterface)이 호출.

- [ ] **Step 1: PlaceContext 타입 + useChat 시그니처 변경**

`src/hooks/useChat.ts`의 `export function useChat() {`(19행)을 다음으로 교체하고, 상단 import 아래에 타입을 추가한다:

```ts
export interface PlaceContext {
  name: string;
  lat: number;
  lng: number;
  category?: string;
  isStation?: boolean;
}

export function useChat(opts?: { placeContext?: PlaceContext }) {
  const placeContext = opts?.placeContext;
```

- [ ] **Step 2: POST body에 placeContext 포함**

`useChat.ts`의 fetch body(61-65행)를 교체:

```ts
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, text: m.text })),
            userLocation,
            locale,
            placeContext,
          }),
```

- [ ] **Step 3: sendMessage deps에 placeContext 추가**

`useChat.ts`의 sendMessage `useCallback` deps(113행 `[userLocation, locale]`)를 교체:

```ts
    [userLocation, locale, placeContext],
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git commit -- src/hooks/useChat.ts -m "feat(chat): useChat placeContext 파라미터 — 장소 컨텍스트 전송"
```

---

### Task 6: ChatInterface — placeContext + 빈 상태 예시 프롬프트

**Files:**
- Modify: `src/components/chat/ChatInterface.tsx:22-87`

**Interfaces:**
- Consumes: `useChat({ placeContext })` (Task 5), `PlaceContext` from `@/hooks/useChat`.
- Produces: `ChatInterface({ inputRef?, placeContext?, examplePrompts? })` — `examplePrompts?: string[]`(번역 완료된 문구). Task 7(ChatOverlay)이 마운트.

- [ ] **Step 1: props 확장 + useChat에 placeContext 전달**

`src/components/chat/ChatInterface.tsx`의 함수 시그니처(22행)와 useChat 호출(24행)을 교체:

```ts
import { useCallback, useEffect, useRef, type Ref } from "react";
import { useTranslations } from "next-intl";
import { useChat, type PlaceContext } from "@/hooks/useChat";
import { useChatSound } from "@/hooks/useChatSound";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

export function ChatInterface({
  inputRef,
  placeContext,
  examplePrompts,
}: {
  inputRef?: Ref<HTMLInputElement>;
  placeContext?: PlaceContext;
  examplePrompts?: string[];
}) {
  const t = useTranslations("chat");
  const { messages, isLoading, error, progressCategories, sendMessage } = useChat({ placeContext });
```

- [ ] **Step 2: 빈 상태 예시 프롬프트 렌더 추가**

`ChatInterface.tsx`의 return 블록 안, 메시지 목록 `<div>`(71-80행) 바로 다음에 빈 상태 블록을 삽입한다. 메시지가 없고 examplePrompts가 있을 때만 노출하며, 클릭 시 그 문구를 첫 메시지로 전송한다:

```tsx
      <div className="flex flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            isLastQuery={m.role === "user" && m.id === lastUserId}
            lastQueryRef={lastQueryRef}
          />
        ))}
      </div>
      {messages.length === 0 && examplePrompts && examplePrompts.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("../placeChat.empty" as never)}</p>
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleSend(prompt)}
              className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-left text-sm hover:bg-accent/10"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
```

> 주의: `t("chat")` 스코프라 placeChat.empty는 스코프 밖이다. 위 `t("../placeChat.empty" as never)` 대신, **상단에서 별도 번역기를 만들어** 사용한다 — 다음 Step에서 정정한다.

- [ ] **Step 3: placeChat 스코프 번역기로 정정**

ChatInterface는 `useTranslations("chat")`만 갖고 있으므로 placeChat.empty 번역을 위해 루트 번역기를 추가한다. `const t = useTranslations("chat");`(23행) 아래에 추가:

```ts
  const tp = useTranslations("placeChat");
```

그리고 Step 2의 빈 상태 문구를 `{t("../placeChat.empty" as never)}`에서 `{tp("empty")}`로 교체한다.

- [ ] **Step 4: 빌드 + lint 확인**

Run: `npm run build && npm run lint`
Expected: 성공(미사용 import 없음, handleSend는 기존 정의 재사용).

- [ ] **Step 5: Commit**

```bash
git commit -- src/components/chat/ChatInterface.tsx -m "feat(chat): ChatInterface placeContext 전달 + 빈 상태 예시 프롬프트 3개"
```

---

### Task 7: ChatOverlay — dialog 셸(포커스 트랩·Esc·닫기 버튼)

**Files:**
- Create: `src/components/chat/ChatOverlay.tsx`

**Interfaces:**
- Consumes: `ChatInterface` (Task 6), `placeChatPrompts` (Task 2), `Place` from `@/lib/types`, `isStation` from `@/lib/station-match`.
- Produces: `ChatOverlay({ place, onClose })` — `place: Place`, `onClose: () => void`(닫힐 때 부모가 트리거 버튼 포커스 복귀를 수행). Task 8(PlaceDetail)이 마운트.

- [ ] **Step 1: ChatOverlay 구현**

`src/components/chat/ChatOverlay.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { ChatInterface } from "./ChatInterface";
import { placeChatPrompts } from "@/lib/chat/place-prompts";

/**
 * 장소별 채팅 오버레이 — role="dialog" aria-modal 풀스크린 셸.
 *
 * 접근성:
 * - 열릴 때 제목(h2, tabIndex=-1)으로 포커스 이동.
 * - Esc·닫기 버튼 두 경로로 닫고, 닫힘은 부모 onClose가 트리거 버튼으로 포커스 복귀.
 * - 포커스 트랩: Tab이 오버레이 밖(뒤의 상세)으로 새지 않게 첫/마지막 포커서블을 순환.
 * - aria-modal="true"로 스크린 리더 가상 커서를 dialog에 제한(미니멀 ARIA — inert 미사용).
 *
 * 채팅 내용은 기존 ChatInterface를 장소마다 새로 마운트한다(언마운트로 대화 초기화 =
 * "장소마다 새 대화"). placeContext로 좌표 도구가 이 장소를 앵커로 동작한다(I-1).
 *
 * 뒤로가기(History) 닫기는 V1 비포함 — PlaceSearch의 기존 popstate 상세 트랩과
 * 충돌(어느 것을 닫을지 모호)하므로 Esc/버튼으로 한정한다.
 */
export function ChatOverlay({ place, onClose }: { place: Place; onClose: () => void }) {
  const tp = useTranslations("placeChat");
  const t = useTranslations();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const placeContext = {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    isStation: isStation(place),
  };
  const examplePrompts = placeChatPrompts(place).map((key) => t(key));

  // 열릴 때 제목으로 포커스 이동(맥락 안내).
  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc 닫기 + 포커스 트랩(Tab 순환).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {tp("title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tp("close")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border hover:bg-accent/10"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <ChatInterface
        inputRef={chatInputRef}
        placeContext={placeContext}
        examplePrompts={examplePrompts}
      />
    </div>
  );
}
```

- [ ] **Step 2: 빌드 + lint 확인**

Run: `npm run build && npm run lint`
Expected: 성공(ChatOverlay는 아직 미마운트지만 미사용 모듈은 빌드 에러 아님).

- [ ] **Step 3: Commit**

```bash
git commit -- src/components/chat/ChatOverlay.tsx -m "feat(chat): ChatOverlay dialog 셸 — 포커스 트랩·Esc·닫기 버튼"
```

---

### Task 8: PlaceDetail — 거리추적 마운트 제거 + 진입 버튼 + 오버레이 연결

**Files:**
- Modify: `src/components/PlaceDetail.tsx:3,18,32-50,107-108`

**Interfaces:**
- Consumes: `ChatOverlay` (Task 7).
- Produces: `PlaceDetail`가 `canShowChat?: boolean` prop을 받는다 — Task 9(PlaceSearch)가 전달. true일 때만 진입 버튼 노출.

- [ ] **Step 1: import 교체(DistanceBeacon 제거, useState·MessageSquare·ChatOverlay 추가)**

`src/components/PlaceDetail.tsx` 상단 import에서 `DistanceBeacon` import(18행)를 제거하고, 1·3행과 lucide import를 교체한다:

```ts
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, MessageSquare } from "lucide-react";
```

그리고 컴포넌트 import 목록(8-17행) 끝에 추가(`DistanceBeacon` 줄은 삭제):

```ts
import { ChatOverlay } from "./chat/ChatOverlay";
```

> 보존: `DistanceBeacon.tsx`·`useDistanceBeacon`·`beacon.ts`·`useBeaconSound`·`useScreenWakeLock`·`beacon.*` i18n은 **삭제 금지**(미래 Phase 4 브랜치). 여기서는 import·마운트만 제거한다.

- [ ] **Step 2: props에 canShowChat 추가 + 오버레이 상태**

`PlaceDetail` 함수의 props 구조분해(32-50행)에 `canShowChat`을 추가하고, 함수 본문 상단(`const t = ...` 다음)에 상태·ref를 추가한다:

```ts
export function PlaceDetail({
  place,
  canBriefCarRoute,
  canShowBus,
  canShowBike,
  canShowSubway,
  canShowAir,
  canShowTransit,
  canShowChat = false,
  onBack,
}: {
  place: Place;
  canBriefCarRoute: boolean;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowSubway: boolean;
  canShowAir: boolean;
  canShowTransit: boolean;
  canShowChat?: boolean;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 채팅 오버레이 열림 상태 + 트리거 버튼 ref(닫을 때 포커스 복귀 대상).
  const [chatOpen, setChatOpen] = useState(false);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [place.id]);
```

- [ ] **Step 3: 거리추적 마운트 → 진입 버튼 교체 + 오버레이 렌더**

`PlaceDetail.tsx`의 `<RouteLinks place={place} />`(107행) 다음의 `<DistanceBeacon .../>`(108행)을 삭제하고, 그 자리에 진입 버튼을 넣는다(거리추적이 있던 위치 = RouteLinks 뒤):

```tsx
      <RouteLinks place={place} />
      {canShowChat && (
        <button
          type="button"
          ref={chatTriggerRef}
          onClick={() => setChatOpen(true)}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
        >
          <MessageSquare aria-hidden="true" className="h-4 w-4" />
          {t("placeChat.launch")}
        </button>
      )}
```

그리고 컴포넌트 최상위 `<div>`가 닫히기 직전(133행 `{canShowAir && ...}` 다음, 마지막 `</div>` 앞)에 오버레이를 조건부 렌더한다. 닫을 때 트리거 버튼으로 포커스를 복귀한다:

```tsx
      {canShowAir && <LocalConditions lat={place.lat} lng={place.lng} />}
      {chatOpen && (
        <ChatOverlay
          place={place}
          onClose={() => {
            setChatOpen(false);
            // 닫기 버튼/Esc 공통 — 트리거 버튼으로 포커스 복귀(맥락 유지).
            requestAnimationFrame(() => chatTriggerRef.current?.focus());
          }}
        />
      )}
    </div>
```

- [ ] **Step 4: 빌드 + lint 확인**

Run: `npm run build && npm run lint`
Expected: 성공. (PlaceSearch가 아직 canShowChat을 안 넘기므로 버튼은 기본 미노출 — 다음 Task에서 연결.)

- [ ] **Step 5: Commit**

```bash
git commit -- src/components/PlaceDetail.tsx -m "feat(chat): PlaceDetail 거리추적 마운트 제거 + '이 장소에 관해 물어보기' 진입 버튼·오버레이"
```

---

### Task 9: PlaceSearch — 모드 분기 해체 + canShowChat 전달 + 폐기 모듈 삭제

**Files:**
- Modify: `src/components/PlaceSearch.tsx` (다수 — 아래 명시)
- Delete: `src/components/ModeToggle.tsx`, `src/lib/chat/mode-state.ts`, `src/lib/chat/keyboard-shortcuts.ts`, `src/hooks/useAppMode.ts`
- Delete tests: `src/components/__tests__/ModeToggle.test.tsx`, `src/components/__tests__/PlaceSearch-mode.test.tsx`, `src/lib/chat/__tests__/keyboard-shortcuts.test.ts`, `src/lib/chat/__tests__/mode-state.test.ts`
- Modify: `messages/{ko,en,es,fr,it}.json` (switchToChat·switchToSearch 키 제거)

**Interfaces:**
- Consumes: `PlaceDetail` `canShowChat` prop (Task 8).
- Produces: 메인 페이지에서 채팅 분기·단축키·토글 완전 제거. `PlaceSearch`는 순수 검색.

- [ ] **Step 1: PlaceSearch에서 모드 관련 import 제거**

`src/components/PlaceSearch.tsx`의 20-23행(mode-state·useAppMode·keyboard-shortcuts)과 36-37행(ModeToggle·ChatInterface) import를 모두 삭제한다.

- [ ] **Step 2: 모드 상태·effect·핸들러 제거**

다음 블록을 모두 삭제한다:
- 131-189행: 모드 상태(`appMode`/`mode`/`chatInputRef`/`searchInputRef` 중 chat 전용·`isMountRef`·`changeMode`·모드 포커스 effect·키보드 단축키 effect). **단 `searchInputRef`는 SearchBar가 쓰므로 보존** — `searchInputRef`만 남기고 `chatInputRef`·`isMountRef`·`appMode`·`mode`·`changeMode`와 두 effect를 제거한다.
- 542-555행: `if (mode === "chat" && canShowChat) { ... ChatInterface ... }` 블록 전체 삭제.
- 547-551 및 568-573행의 `{canShowChat && <ModeToggle .../>}` 두 군데 삭제.

> `searchInputRef`(139행)는 유지. `useGeolocation`·`userCoords` 등 나머지는 유지.

- [ ] **Step 3: PlaceDetail 렌더에 canShowChat 전달**

`PlaceSearch.tsx`의 PlaceDetail 렌더(446-458행)에 `canShowChat` prop을 추가한다:

```tsx
  if (selected) {
    return (
      <PlaceDetail
        place={selected}
        canBriefCarRoute={canBriefCarRoute}
        canShowBus={canShowBus}
        canShowBike={canShowBike}
        canShowSubway={canShowSubway}
        canShowAir={canShowAir}
        canShowTransit={canShowTransit}
        canShowChat={canShowChat}
        onBack={backToResults}
      />
    );
  }
```

- [ ] **Step 4: 폐기 모듈·테스트 삭제**

```bash
git rm src/components/ModeToggle.tsx \
       src/lib/chat/mode-state.ts \
       src/lib/chat/keyboard-shortcuts.ts \
       src/hooks/useAppMode.ts \
       src/components/__tests__/ModeToggle.test.tsx \
       src/components/__tests__/PlaceSearch-mode.test.tsx \
       src/lib/chat/__tests__/keyboard-shortcuts.test.ts \
       src/lib/chat/__tests__/mode-state.test.ts
```

- [ ] **Step 5: 미사용 i18n 키 제거(switchToChat·switchToSearch)**

5개 메시지 파일의 `chat` 블록에서 `switchToChat`·`switchToSearch` 키를 제거한다. 먼저 위치를 확인:

Run: `grep -n "switchToChat\|switchToSearch" messages/*.json`

각 파일에서 해당 두 줄을 삭제한다(`chat` 객체 내부, 다른 키의 콤마 정합 유지).

- [ ] **Step 6: 잔여 참조 없음 확인 + 빌드/lint/테스트**

Run: `grep -rn "mode-state\|useAppMode\|ModeToggle\|matchChatShortcut\|setAppMode\|CHAT_SHORTCUT_KEYS\|appendShortcutHint\|switchToChat\|switchToSearch" src/ messages/`
Expected: 출력 없음(완전 제거).
Run: `npm run lint && npm run build && npm run test:run`
Expected: 모두 성공(i18n 패리티 포함).

- [ ] **Step 7: Commit**

```bash
git commit -- src/components/PlaceSearch.tsx \
  src/components/ModeToggle.tsx src/lib/chat/mode-state.ts src/lib/chat/keyboard-shortcuts.ts src/hooks/useAppMode.ts \
  src/components/__tests__/ModeToggle.test.tsx src/components/__tests__/PlaceSearch-mode.test.tsx \
  src/lib/chat/__tests__/keyboard-shortcuts.test.ts src/lib/chat/__tests__/mode-state.test.ts \
  messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json \
  -m "refactor(chat): 메인 검색⇄채팅 모드 분기·단축키 제거, 채팅을 장소 상세 진입으로 일원화"
```

---

### Task 10: dev 실호출 검증 + 최종 게이트 + push

**Files:** 없음(검증·배포)

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev`
별도 터미널/브라우저에서 `http://localhost:3000/ko` 접속.

- [ ] **Step 2: 진입·오버레이·포커스 검증(수동)**

확인 항목:
1. 메인 페이지에 모드 토글·채팅 진입점이 **없다**(순수 검색창).
2. 검색("경복궁") → 결과 → 장소 선택 → 상세 화면에 "이 장소에 관해 물어보기" 버튼이 RouteLinks 뒤에 있고, "목적지 거리 추적"은 **없다**.
3. 버튼 클릭 → 오버레이 열림, 포커스가 "이 장소에 관해 물어보기" 제목으로 이동, 예시 프롬프트 3개(일반: 가는 법/주변/공기질·날씨) 노출.
4. 예시 프롬프트 클릭 → 첫 메시지 전송, 응답 도착.
5. **장소 기준 검증**: 오버레이에서 "근처에 뭐가 있어?" → 응답이 경복궁 주변 기준인지(현위치 아님). "여기까지 가는 법" → 현위치 출발·경복궁 도착 경로인지.
6. **닫기**: "채팅 닫기" 버튼 → 오버레이 닫히고 포커스가 "이 장소에 관해 물어보기" 버튼으로 복귀. Esc로도 동일.
7. **새 대화**: 상세 복귀 → 다른 장소("강남역") 상세 → 채팅 열면 이전 대화 없이 새로 시작, 예시 프롬프트가 역 유형(실시간 도착/편의시설/주변)으로 바뀜.

- [ ] **Step 3: 최종 게이트**

Run: `npm run lint && npm run build && npm run test:run`
Expected: 모두 PASS.

- [ ] **Step 4: push(자동 배포)**

gildongmu 관례(리뷰 게이트 통과 후 자동 commit+push, 저위험 repo). 푸시 전 직전 커밋들이 내 것인지 확인:

```bash
git log --oneline -10
git push
```

푸시 후 Vercel 자동 배포. `GEMINI_API_KEY`는 이미 프로덕션 등록됨(canShowChat 게이트 통과). 신규 env 추가 없음 → 재배포만으로 반영.

- [ ] **Step 5: 프로덕션 스모크(배포 후)**

`https://gildongmu.vercel.app/ko`에서 Step 2의 1·2·3·6을 재확인(장소 상세 진입 버튼·오버레이·닫기 포커스 복귀).

---

## Self-Review

**1. Spec coverage** (Spec A 대조):
- §4 분기 제거 → Task 9. §5 거리추적 숨김(코드 보존) → Task 8 Step1 주석 + 파일 미삭제. §6-1 진입 버튼 → Task 8. §6-2 ChatOverlay(dialog·트랩·Esc·닫기 버튼·포커스 복귀) → Task 7+8. §6-3 장소마다 새 대화 → Task 7(언마운트 초기화). §6-4 예시 프롬프트 → Task 2+6+7. §7 장소 앵커 불변식 I-1/I-2/I-3 → Task 3+4. §8 게이트(hasGeminiKey) → Task 8 canShowChat. §9 테스트 → Task 2/3 순수 테스트 + Task 10 실호출.
- **정정(spec 대비 의도적 deviation)**: §6-2의 "뒤로가기(History 트랩) 닫기"는 PlaceSearch 기존 popstate 상세 트랩과 충돌하므로 V1 제외(Esc+버튼으로 충분, WAI-ARIA dialog 표준). Task 7 주석에 명시.
- **정밀화(spec 대비 구체화)**: §7에서 self-fetch nearby 카드 4종은 장소 앵커일 때 카드 생략(산문 정본), 좌표 보유 카드(버스·따릉이·공기질)는 장소 좌표로 노출 — Task 3에 반영.

**2. Placeholder scan**: TBD/TODO 없음. 모든 코드 스텝에 실제 코드. i18n 5개 언어 실제 문구 제공.

**3. Type consistency**: `PlaceContext`(useChat)·`placeAnchor`(ExecutionContext)·`anchorOf` 시그니처가 Task 3/4/5/6/7에서 일관. `placeChatPrompts`→string[] 키, ChatOverlay에서 `t(key)`로 번역해 `examplePrompts: string[]`로 전달(ChatInterface 시그니처와 일치). `ChatOverlay({place,onClose})`·`PlaceDetail canShowChat?`·`ChatInterface({inputRef?,placeContext?,examplePrompts?})` 호출부 정합.
