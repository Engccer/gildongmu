# 행안부 juso 공식 주소 통합 (C2) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** en 카카오 카드 영문 주소를 행안부 공식 데이터(juso)로 교체(NCP는 폴백 강등)하고, juso 검색으로 주소·우편번호 검색 진입점을 신설한다.

**Architecture:** 신규 provider `juso-address.ts` 하나가 두 기능을 받친다 — (C2-a) `geocodeEnglishAddressJuso`가 `enrichEnglishAddresses`의 폴백 체인 맨 앞에 들어가고, (C2-b) `searchJusoAddresses`가 `/api/address/search` 라우트를 통해 PlaceSearch의 "주소" 검색 모드에 데이터를 공급한다. 좌표는 기존 `/api/geocode`(카카오)를 재사용해 juso(공식 주소)와 카카오(좌표) 역할을 분리한다.

**Tech Stack:** Next.js 16 (App Router, async request API), next-intl 4, zod 4, Vitest 4, TypeScript. `src/lib/`는 React/Next 비의존(dodo-planet 이식성).

## Global Constraints

- 모든 키는 선택(optional) — 키 없으면 graceful degrade. `hasJusoKey()` 게이트로 분기.
- `src/lib/` 코드는 React/Next 비의존. 컴포넌트·라우트만 next-intl/next 사용.
- provider 격리: 라우트·컴포넌트는 juso 응답 필드명을 모른다(`JusoAddress` shape로만 소통).
- `geocodeEnglishAddressJuso`는 best-effort — **절대 throw하지 않고** null로 흡수(NCP `geocodeEnglishAddress`와 동일 계약). `searchJusoAddresses`는 검색 본류라 에러를 throw(라우트가 502 분류).
- 영문 주소는 en 로케일에서만 표시 — ko UI에 영문 주소가 새면 안 된다.
- a11y: 정보 정본은 텍스트, 상태 변화는 단일 polite `aria-live`. 과잉 ARIA 금지. 터치 타깃 ≥44px(`min-h-11`). UI 라벨에 이모지 금지.
- 커밋 메시지: 한국어 conventional commits. 변수/함수명: 영어. 커밋 이메일 `engccer@gmail.com`.
- juso 엔드포인트: `https://business.juso.go.kr/addrlink/addrLinkApi.do`, params `confmKey`·`currentPage`·`countPerPage`·`keyword`·`resultType=json`. 키: `JUSO_CONFM_KEY`(`.env.local`에 이미 등록됨).
- juso envelope: `results.common.errorCode`("0"=정상, 무결과도 "0"+`totalCount`"0"), `results.juso[]`. 필드: `roadAddr`·`roadAddrPart1`·`jibunAddr`·`engAddr`·`zipNo`·`bdNm`.

---

# 묶음 1 — C2-a 영문 주소 폴백 체인 (회귀 0, juso 키 없이도 NCP 폴백으로 머지 가능)

### Task 1: env에 JUSO_CONFM_KEY + hasJusoKey 추가

**Files:**
- Modify: `src/lib/env.ts` (스키마 + parse + 게이트 함수)

**Interfaces:**
- Produces: `hasJusoKey(): boolean`, `env.JUSO_CONFM_KEY: string | undefined`

- [ ] **Step 1: 스키마에 키 추가**

`src/lib/env.ts`의 `envSchema` 안, `ODSAY_API_KEY` 정의 바로 다음에 추가:

```ts
  // 행안부 도로명주소 검색 API — business.juso.go.kr confmKey (서버 전용).
  // 검색 응답에 공식 영문 주소(engAddr)·우편번호(zipNo)가 포함된다.
  JUSO_CONFM_KEY: z.string().min(1).optional(),
```

- [ ] **Step 2: parse 객체에 매핑 추가**

`envSchema.parse({ ... })` 안, `ODSAY_API_KEY: process.env.ODSAY_API_KEY,` 다음에 추가:

```ts
  JUSO_CONFM_KEY: process.env.JUSO_CONFM_KEY,
```

- [ ] **Step 3: 게이트 함수 추가**

파일 맨 끝 `hasOdsayKey` 함수 다음에 추가:

```ts

/** 행안부 도로명주소 검색 API 사용 가능 여부 */
export function hasJusoKey(): boolean {
  return Boolean(env.JUSO_CONFM_KEY);
}
```

- [ ] **Step 4: 빌드로 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/env.ts
git commit -m "feat(address): JUSO_CONFM_KEY 환경변수 + hasJusoKey 게이트 추가"
```

---

### Task 2: juso-address provider — JusoAddress 타입 + 정규화 + 영문주소 추출

**Files:**
- Modify: `src/lib/types.ts` (JusoAddress 인터페이스 추가)
- Create: `src/lib/providers/juso-address.ts`
- Test: `src/lib/__tests__/juso-address.test.ts`

**Interfaces:**
- Consumes: `env.JUSO_CONFM_KEY` (Task 1)
- Produces:
  - `interface JusoAddress { roadAddr, roadAddrPart1, jibunAddr, engAddr, zipNo, bdNm: string }`
  - `normalizeJusoResults(raw): JusoAddress[]` — errorCode "0"이면 매핑, 그 외 throw
  - `extractEnglishAddressJuso(raw): string | null` — 첫 결과 engAddr 또는 null(throw 안 함)
  - `geocodeEnglishAddressJuso(koreanAddress: string): Promise<string | null>` — best-effort, throw 안 함

- [ ] **Step 1: JusoAddress 타입 추가**

`src/lib/types.ts`의 `AddressMatch` 인터페이스 정의 바로 다음에 추가:

```ts

/**
 * 행안부 도로명주소 검색(juso) 결과 하나 — provider가 응답을 정규화한 형태.
 * 라우트·컴포넌트는 juso 원본 필드를 모르고 이 shape로만 소통한다(이식성).
 */
export interface JusoAddress {
  /** 전체 도로명주소(참고항목 포함, 예 "서울특별시 중구 세종대로 110 (태평로1가)") */
  roadAddr: string;
  /** 도로명주소(참고항목 제외, 예 "서울특별시 중구 세종대로 110") */
  roadAddrPart1: string;
  /** 지번 주소 */
  jibunAddr: string;
  /** 공식 영문 주소(국가명 미포함, 예 "110 Sejong-daero, Jung-gu, Seoul") */
  engAddr: string;
  /** 우편번호(예 "04524") */
  zipNo: string;
  /** 건물명(없으면 "") */
  bdNm: string;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/juso-address.test.ts` 생성:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeJusoResults,
  extractEnglishAddressJuso,
  geocodeEnglishAddressJuso,
} from "../providers/juso-address";

/**
 * 행안부 juso 도로명주소 검색 — 실응답 구조(2026-06-19 실호출 확정):
 * results.common.errorCode "0"=정상(무결과도 "0"+totalCount "0"),
 * results.juso[]에 roadAddr·roadAddrPart1·jibunAddr·engAddr·zipNo·bdNm.
 */
function ok(juso: object[]) {
  return {
    results: {
      common: {
        errorCode: "0",
        errorMessage: "정상",
        totalCount: String(juso.length),
        currentPage: "1",
        countPerPage: "10",
      },
      juso,
    },
  };
}

const RAW = {
  roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
  roadAddrPart1: "서울특별시 중구 세종대로 110",
  jibunAddr: "서울특별시 중구 태평로1가 31",
  engAddr: "110 Sejong-daero, Jung-gu, Seoul",
  zipNo: "04524",
  bdNm: "서울특별시청",
};

describe("normalizeJusoResults", () => {
  it("정상 응답을 JusoAddress[]로 정규화한다", () => {
    const [a] = normalizeJusoResults(ok([RAW]));
    expect(a.roadAddr).toBe("서울특별시 중구 세종대로 110 (태평로1가)");
    expect(a.roadAddrPart1).toBe("서울특별시 중구 세종대로 110");
    expect(a.engAddr).toBe("110 Sejong-daero, Jung-gu, Seoul");
    expect(a.zipNo).toBe("04524");
    expect(a.bdNm).toBe("서울특별시청");
  });

  it("무결과(errorCode 0 + 빈 juso)는 빈 배열", () => {
    expect(normalizeJusoResults(ok([]))).toEqual([]);
  });

  it("juso가 null이어도 빈 배열로 처리한다", () => {
    const raw = ok([]);
    (raw.results as { juso: unknown }).juso = null;
    expect(normalizeJusoResults(raw)).toEqual([]);
  });

  it("errorCode가 0이 아니면 throw한다", () => {
    const raw = ok([]);
    raw.results.common.errorCode = "E0005";
    raw.results.common.errorMessage = "검색어가 너무 짧습니다.";
    expect(() => normalizeJusoResults(raw)).toThrow();
  });
});

describe("extractEnglishAddressJuso (throw 안 함)", () => {
  it("첫 결과의 engAddr를 반환한다", () => {
    expect(extractEnglishAddressJuso(ok([RAW]))).toBe(
      "110 Sejong-daero, Jung-gu, Seoul",
    );
  });

  it("무결과면 null", () => {
    expect(extractEnglishAddressJuso(ok([]))).toBeNull();
  });

  it("engAddr가 빈 문자열이면 null", () => {
    expect(extractEnglishAddressJuso(ok([{ ...RAW, engAddr: "" }]))).toBeNull();
  });

  it("errorCode가 0이 아니어도 throw하지 않고 null", () => {
    const raw = ok([]);
    raw.results.common.errorCode = "E0001";
    expect(extractEnglishAddressJuso(raw)).toBeNull();
  });
});

describe("geocodeEnglishAddressJuso (실패는 throw하지 않고 graceful null)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답이면 영문 주소를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ok([RAW])), { status: 200 })),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBe(
      "110 Sejong-daero, Jung-gu, Seoul",
    );
  });

  it("HTTP 에러는 throw하지 않고 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBeNull();
  });

  it("네트워크 예외도 null로 흡수한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBeNull();
  });

  it("빈 주소는 호출 없이 null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await geocodeEnglishAddressJuso("  ")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/juso-address.test.ts`
Expected: FAIL — `Failed to resolve import "../providers/juso-address"`

- [ ] **Step 4: provider 구현**

`src/lib/providers/juso-address.ts` 생성:

```ts
import { env } from "../env";
import type { JusoAddress } from "../types";

/**
 * 행안부 도로명주소 검색 API provider — 공식 영문 주소·우편번호의 정본 소스.
 *
 * 두 쓰임:
 * - geocodeEnglishAddressJuso: en 카카오 카드 영문 주소 보강(C2-a, NCP 대체).
 * - searchJusoAddresses: 주소·우편번호 검색 진입점(C2-b, 묶음 2에서 추가).
 *
 * 엔드포인트: https://business.juso.go.kr/addrlink/addrLinkApi.do
 * 인증: confmKey 쿼리 파라미터(서버 전용).
 * 실응답(2026-06-19): results.common.errorCode "0"=정상(무결과도 "0"+totalCount "0"),
 * results.juso[]에 roadAddr·roadAddrPart1·jibunAddr·engAddr·zipNo·bdNm.
 */

const ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

interface JusoRawItem {
  roadAddr: string;
  roadAddrPart1: string;
  jibunAddr: string;
  engAddr: string;
  zipNo: string;
  bdNm: string;
}

interface JusoApiResponse {
  results: {
    common: {
      errorCode: string;
      errorMessage: string;
      totalCount: string;
      currentPage: string;
      countPerPage: string;
    };
    juso: JusoRawItem[] | null;
  };
}

/**
 * 응답 → JusoAddress[]. errorCode "0"이면 juso[]를 매핑(무결과는 빈 배열),
 * 그 외 코드는 throw한다 — 검색 본류의 장애를 빈 결과로 가리지 않기 위해.
 */
export function normalizeJusoResults(raw: JusoApiResponse): JusoAddress[] {
  const code = raw.results?.common?.errorCode;
  if (code !== "0") {
    throw new Error(
      `juso 주소 검색 오류: ${code} ${raw.results?.common?.errorMessage ?? ""}`,
    );
  }
  return (raw.results.juso ?? []).map((j) => ({
    roadAddr: j.roadAddr,
    roadAddrPart1: j.roadAddrPart1,
    jibunAddr: j.jibunAddr,
    engAddr: j.engAddr,
    zipNo: j.zipNo,
    bdNm: j.bdNm,
  }));
}

/**
 * 첫 결과의 공식 영문 주소만 추출 — best-effort라 throw하지 않는다.
 * 무결과·빈 문자열·에러코드는 모두 null(geocodeEnglishAddressJuso가 흡수).
 */
export function extractEnglishAddressJuso(raw: JusoApiResponse): string | null {
  try {
    const eng = normalizeJusoResults(raw)[0]?.engAddr?.trim();
    return eng ? eng : null;
  } catch {
    return null;
  }
}

/**
 * 한글 주소 → 공식 영문 주소. 무결과·실패면 null.
 *
 * 영문 주소는 best-effort 보강이므로 절대 throw하지 않는다 — juso 장애·HTTP
 * 에러·네트워크 예외는 모두 null로 흡수하고, 호출부(enrichEnglishAddresses)는
 * 다음 폴백(NCP) 또는 한글 주소로 graceful degrade한다.
 * (NCP geocodeEnglishAddress와 동일 계약 — 폴백 체인이 ?? 로 합성된다.)
 */
export async function geocodeEnglishAddressJuso(
  koreanAddress: string,
): Promise<string | null> {
  if (!koreanAddress.trim()) return null;
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
    url.searchParams.set("currentPage", "1");
    url.searchParams.set("countPerPage", "1");
    url.searchParams.set("keyword", koreanAddress);
    url.searchParams.set("resultType", "json");

    const res = await fetch(url, {
      // 주소→영문 주소는 사실상 불변 — 하루 캐시(NCP geocode 동형)
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as JusoApiResponse;
    return extractEnglishAddressJuso(data);
  } catch (e) {
    console.error("[juso-address] 영문 주소 변환 실패:", koreanAddress, e);
    return null;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/juso-address.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/providers/juso-address.ts src/lib/__tests__/juso-address.test.ts
git commit -m "feat(address): juso provider 정규화·영문주소 추출 추가 (C2-a 코어)"
```

---

### Task 3: enrichEnglishAddresses 폴백 체인(juso 우선 → NCP) + 호출 게이트 확장

**Files:**
- Modify: `src/lib/providers/places.ts` (import + enrich 본문 + line 106 게이트)
- Test: `src/lib/__tests__/enrich-english.test.ts` (폴백 체인 매트릭스로 재작성)

**Interfaces:**
- Consumes: `geocodeEnglishAddressJuso` (Task 2), `hasJusoKey` (Task 1), 기존 `geocodeEnglishAddress`·`hasNcpMapsKeys`
- Produces: `enrichEnglishAddresses(places: Place[]): Promise<Place[]>` (시그니처 불변, 내부만 변경)

- [ ] **Step 1: 폴백 체인 테스트로 재작성**

`src/lib/__tests__/enrich-english.test.ts` 전체를 교체:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichEnglishAddresses } from "../providers/places";
import { geocodeEnglishAddress } from "../providers/ncp-geocode";
import { geocodeEnglishAddressJuso } from "../providers/juso-address";
import { hasJusoKey, hasNcpMapsKeys } from "../env";
import type { Place } from "../types";

// places.ts가 ../env에서 import하는 모든 게이트를 명시적으로 mock한다
// (auto-mock 부작용 회피). enrich는 hasJusoKey·hasNcpMapsKeys만 쓴다.
vi.mock("../providers/ncp-geocode");
vi.mock("../providers/juso-address");
vi.mock("../env", () => ({
  hasJusoKey: vi.fn(),
  hasNcpMapsKeys: vi.fn(),
  hasKakaoKey: vi.fn(() => false),
  hasNaverLocalKeys: vi.fn(() => false),
  hasTourApiKey: vi.fn(() => false),
  env: {},
}));

const ncpMock = vi.mocked(geocodeEnglishAddress);
const jusoMock = vi.mocked(geocodeEnglishAddressJuso);
const hasJuso = vi.mocked(hasJusoKey);
const hasNcp = vi.mocked(hasNcpMapsKeys);

function place(over: Partial<Place> & Pick<Place, "id">): Place {
  return {
    name: "",
    category: "",
    address: "지번주소",
    roadAddress: "한글 도로명 주소",
    lat: 37.5,
    lng: 127.0,
    ...over,
  };
}

describe("enrichEnglishAddresses 폴백 체인 (juso 우선 → NCP)", () => {
  beforeEach(() => {
    ncpMock.mockReset();
    jusoMock.mockReset();
    hasJuso.mockReset();
    hasNcp.mockReset();
  });

  it("juso 키 있고 juso 성공 → juso 영문주소, NCP 미호출", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue("110 Sejong-daero, Jung-gu, Seoul");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).toHaveBeenCalledWith("한글 도로명 주소");
    expect(ncpMock).not.toHaveBeenCalled();
    expect(out.englishAddress).toBe("110 Sejong-daero, Jung-gu, Seoul");
  });

  it("juso null → NCP 폴백 성공", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue(null);
    ncpMock.mockResolvedValue("161, Sajik-ro, Jongno-gu, Seoul");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).toHaveBeenCalled();
    expect(ncpMock).toHaveBeenCalledWith("한글 도로명 주소");
    expect(out.englishAddress).toBe("161, Sajik-ro, Jongno-gu, Seoul");
  });

  it("juso·NCP 둘 다 null → 한글 주소 유지", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue(null);
    ncpMock.mockResolvedValue(null);

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBeUndefined();
    expect(out.roadAddress).toBe("한글 도로명 주소");
  });

  it("juso 키 없음 → juso 미호출, NCP만 사용", async () => {
    hasJuso.mockReturnValue(false);
    hasNcp.mockReturnValue(true);
    ncpMock.mockResolvedValue("161, Sajik-ro");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).not.toHaveBeenCalled();
    expect(ncpMock).toHaveBeenCalled();
    expect(out.englishAddress).toBe("161, Sajik-ro");
  });

  it("juso 키만 있고 NCP 키 없음 → juso 성공 시 NCP 미호출", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(false);
    jusoMock.mockResolvedValue("110 Sejong-daero");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBe("110 Sejong-daero");
    expect(ncpMock).not.toHaveBeenCalled();
  });

  it("juso 키만 있고 juso null → NCP 키 없으면 한글 유지(NCP 미호출)", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(false);
    jusoMock.mockResolvedValue(null);

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBeUndefined();
    expect(ncpMock).not.toHaveBeenCalled();
  });

  it("TourAPI 카드(kakao- 아님)는 변환하지 않고 그대로 둔다", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);

    const [out] = await enrichEnglishAddresses([place({ id: "tour-1" })]);

    expect(jusoMock).not.toHaveBeenCalled();
    expect(ncpMock).not.toHaveBeenCalled();
    expect(out.englishAddress).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/enrich-english.test.ts`
Expected: FAIL — 새 테스트가 juso 우선 호출을 기대하지만 현재 enrich는 NCP만 호출

- [ ] **Step 3: places.ts import 추가**

`src/lib/providers/places.ts` 상단 import 수정 — `hasNcpMapsKeys`가 포함된 `../env` import에 `hasJusoKey` 추가하고, ncp-geocode import 다음 줄에 juso import 추가:

```ts
import {
  hasJusoKey,
  hasKakaoKey,
  hasNaverLocalKeys,
  hasNcpMapsKeys,
  hasTourApiKey,
} from "../env";
```

그리고 `import { geocodeEnglishAddress } from "./ncp-geocode";` 다음 줄에 추가:

```ts
import { geocodeEnglishAddressJuso } from "./juso-address";
```

- [ ] **Step 4: enrichEnglishAddresses 본문을 폴백 체인으로 교체**

`enrichEnglishAddresses` 함수 전체(주석 포함)를 교체:

```ts
/**
 * 카카오 출신 카드(한글 주소)에만 영문 주소를 폴백 체인으로 보강한다.
 * TourAPI 카드는 이미 영문 주소(addr1)를 가지므로 변환하지 않는다.
 *
 * 폴백 우선순위: juso(행안부 공식) → NCP. 둘 다 best-effort(throw 안 함)라
 * ?? 로 합성된다. 각 provider는 키가 있을 때만 호출해 빈 키 fetch 낭비를 막는다.
 * 둘 다 null/키없음이면 영문 주소 없이 한글만 남는다(graceful degrade).
 */
export async function enrichEnglishAddresses(
  places: Place[],
): Promise<Place[]> {
  return Promise.all(
    places.map(async (p) => {
      if (!p.id.startsWith("kakao-")) return p;
      const addr = p.roadAddress || p.address;
      if (!addr) return p;
      const english =
        (hasJusoKey() ? await geocodeEnglishAddressJuso(addr) : null) ??
        (hasNcpMapsKeys() ? await geocodeEnglishAddress(addr) : null);
      return english ? { ...p, englishAddress: english } : p;
    }),
  );
}
```

- [ ] **Step 5: searchPlacesMergedEn의 enrich 호출 게이트 확장**

`searchPlacesMergedEn` 안의 return 문에서 enrich 게이트를 juso OR NCP로 넓힌다. 다음 줄을 찾는다:

```ts
    places: hasNcpMapsKeys() ? await enrichEnglishAddresses(merged) : merged,
```

다음으로 교체:

```ts
    places:
      hasJusoKey() || hasNcpMapsKeys()
        ? await enrichEnglishAddresses(merged)
        : merged,
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/enrich-english.test.ts src/lib/__tests__/places-merge-en.test.ts`
Expected: PASS — enrich 7 tests + merge-en 3 tests 모두 통과(merge-en은 env mock 없어 게이트 false라 영향 없음)

- [ ] **Step 7: 전체 게이트 테스트 + 타입 확인**

Run: `npm run test:run && npx tsc --noEmit`
Expected: 전체 PASS, 타입 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add src/lib/providers/places.ts src/lib/__tests__/enrich-english.test.ts
git commit -m "feat(address): 영문주소 폴백 체인(juso 우선 → NCP) + enrich 게이트 확장 (C2-a)"
```

- [ ] **Step 9: 실호출 머지 게이트 (C2-a)**

`.env.local`에 `JUSO_CONFM_KEY`가 있는 상태에서 dev 서버로 en 검색이 juso 영문 주소를 쓰는지 확인:

```bash
npm run dev
# 다른 터미널에서:
curl -s "http://localhost:3000/api/places?query=서울시청&lang=en" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.places.slice(0,3).map(p=>({name:p.name,eng:p.englishAddress})))})"
```

Expected: 카카오 출신 카드의 `englishAddress`가 juso 형식(국가명 없는 "..., Jung-gu, Seoul")으로 채워짐. 키가 정상 동작하면 이 형식이 NCP 형식("..., Seoul, Republic of Korea")과 구분된다.

---

# 묶음 2 — C2-b 주소 검색 진입점 (신규 UI, juso 실호출 검증 후 머지)

### Task 4: searchJusoAddresses 추가

**Files:**
- Modify: `src/lib/providers/juso-address.ts` (검색 함수 추가)
- Test: `src/lib/__tests__/juso-address.test.ts` (검색 fetch 테스트 추가)

**Interfaces:**
- Consumes: `normalizeJusoResults` (Task 2), `env.JUSO_CONFM_KEY`
- Produces: `searchJusoAddresses(keyword: string, page?: number, size?: number): Promise<JusoAddress[]>` — 에러 시 throw

- [ ] **Step 1: 검색 테스트 추가**

`src/lib/__tests__/juso-address.test.ts`의 import에 `searchJusoAddresses`를 추가:

```ts
import {
  normalizeJusoResults,
  extractEnglishAddressJuso,
  geocodeEnglishAddressJuso,
  searchJusoAddresses,
} from "../providers/juso-address";
```

그리고 파일 맨 끝에 describe 블록 추가:

```ts
describe("searchJusoAddresses (검색 본류 — 에러는 throw)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답을 JusoAddress[]로 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ok([RAW])), { status: 200 })),
    );
    const list = await searchJusoAddresses("세종대로 110");
    expect(list).toHaveLength(1);
    expect(list[0].zipNo).toBe("04524");
  });

  it("무결과면 빈 배열(throw 아님)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ok([])), { status: 200 })),
    );
    expect(await searchJusoAddresses("없는주소")).toEqual([]);
  });

  it("HTTP 에러는 throw한다(라우트가 502 분류)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    await expect(searchJusoAddresses("세종대로")).rejects.toThrow();
  });

  it("errorCode가 0이 아니면 throw한다", async () => {
    const raw = ok([]);
    raw.results.common.errorCode = "E0001";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 })),
    );
    await expect(searchJusoAddresses("세종대로")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/juso-address.test.ts`
Expected: FAIL — `searchJusoAddresses is not a function`

- [ ] **Step 3: searchJusoAddresses 구현**

`src/lib/providers/juso-address.ts`의 `geocodeEnglishAddressJuso` 함수 다음에 추가:

```ts

/**
 * 키워드 → 정규화된 주소 목록. 검색 본류라 에러를 throw한다(라우트가 502 분류).
 * 무결과는 errorCode "0"이라 빈 배열로 정상 반환된다.
 */
export async function searchJusoAddresses(
  keyword: string,
  page = 1,
  size = 10,
): Promise<JusoAddress[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
  url.searchParams.set("currentPage", String(page));
  url.searchParams.set("countPerPage", String(size));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const res = await fetch(url, {
    // 주소는 준정적 — 1시간 캐시(쿼터 보호, 카카오 주소검색 동형)
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`juso 주소 검색 실패: HTTP ${res.status} ${body}`);
  }

  const data = (await res.json()) as JusoApiResponse;
  return normalizeJusoResults(data);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/juso-address.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers/juso-address.ts src/lib/__tests__/juso-address.test.ts
git commit -m "feat(address): searchJusoAddresses 검색 함수 추가 (C2-b 코어)"
```

---

### Task 5: /api/address/search 라우트

**Files:**
- Create: `src/app/api/address/search/route.ts`

**Interfaces:**
- Consumes: `searchJusoAddresses` (Task 4), `hasJusoKey` (Task 1)
- Produces: `GET /api/address/search?query=` → `{ addresses: JusoAddress[], query: string }` (200), 키없음 503, 검증실패 400, 장애 502

- [ ] **Step 1: 라우트 작성**

`src/app/api/address/search/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasJusoKey } from "@/lib/env";
import { searchJusoAddresses } from "@/lib/providers/juso-address";

/**
 * 행안부 juso 도로명주소 검색 프록시.
 *
 * 주소 변환은 실데이터만 의미가 있으므로 mock 폴백 없이 키 미등록 시 503.
 * (/api/geocode 동형 — 키 없으면 PlaceSearch가 주소 토글을 미노출하지만,
 *  방어적으로 503을 둔다.) confmKey는 서버 전용이라 프록시가 필수.
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "주소가 비어 있습니다").max(200),
});

export async function GET(request: NextRequest) {
  if (!hasJusoKey()) {
    return NextResponse.json(
      { error: "주소 검색은 도로명주소 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  try {
    const addresses = await searchJusoAddresses(parsed.data.query);
    return NextResponse.json({ addresses, query: parsed.data.query });
  } catch (e) {
    console.error("[api/address/search] 주소 검색 실패:", e);
    return NextResponse.json(
      { error: "주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/address/search/route.ts
git commit -m "feat(address): /api/address/search juso 검색 프록시 라우트"
```

---

### Task 6: jusoAddressToPlace 순수 합성 함수

**Files:**
- Create: `src/lib/address-to-place.ts`
- Test: `src/lib/__tests__/address-to-place.test.ts`

**Interfaces:**
- Consumes: `JusoAddress` (Task 2), `Place` (기존)
- Produces: `jusoAddressToPlace(addr: JusoAddress, coord: { lat: number; lng: number }, locale: "ko" | "en"): Place`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/address-to-place.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { jusoAddressToPlace } from "../address-to-place";
import type { JusoAddress } from "../types";

const ADDR: JusoAddress = {
  roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
  roadAddrPart1: "서울특별시 중구 세종대로 110",
  jibunAddr: "서울특별시 중구 태평로1가 31",
  engAddr: "110 Sejong-daero, Jung-gu, Seoul",
  zipNo: "04524",
  bdNm: "서울특별시청",
};

describe("jusoAddressToPlace", () => {
  it("도로명·지번·좌표를 Place로 합성한다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5663, lng: 126.9779 }, "ko");
    expect(p.roadAddress).toBe("서울특별시 중구 세종대로 110");
    expect(p.address).toBe("서울특별시 중구 태평로1가 31");
    expect(p.lat).toBeCloseTo(37.5663, 4);
    expect(p.lng).toBeCloseTo(126.9779, 4);
  });

  it("건물명이 있으면 이름으로 쓴다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "ko");
    expect(p.name).toBe("서울특별시청");
  });

  it("건물명이 없으면 도로명을 이름으로 쓴다", () => {
    const p = jusoAddressToPlace({ ...ADDR, bdNm: "" }, { lat: 37.5, lng: 127 }, "ko");
    expect(p.name).toBe("서울특별시 중구 세종대로 110");
  });

  it("ko 로케일에서는 englishAddress를 채우지 않는다 (영문 누수 방지)", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "ko");
    expect(p.englishAddress).toBeUndefined();
  });

  it("en 로케일에서는 공식 영문 주소를 채운다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "en");
    expect(p.englishAddress).toBe("110 Sejong-daero, Jung-gu, Seoul");
  });

  it("roadAddrPart1이 비면 roadAddr로 폴백한다", () => {
    const p = jusoAddressToPlace(
      { ...ADDR, roadAddrPart1: "" },
      { lat: 37.5, lng: 127 },
      "ko",
    );
    expect(p.roadAddress).toBe("서울특별시 중구 세종대로 110 (태평로1가)");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/address-to-place.test.ts`
Expected: FAIL — `Failed to resolve import "../address-to-place"`

- [ ] **Step 3: 구현**

`src/lib/address-to-place.ts` 생성:

```ts
import type { JusoAddress, Place } from "./types";

/**
 * juso 주소 항목 + 좌표 → Place 합성.
 *
 * 좌표는 카카오 지오코딩(/api/geocode)이 채운다 — juso는 공식 주소/영문/우편번호,
 * 카카오는 좌표 정본으로 역할을 분리한다(juso 좌표 API 별도 승인 불요).
 *
 * englishAddress는 en 로케일에서만 채운다 — PlaceCard/PlaceDetail이
 * englishAddress가 있으면 우선 표시하므로, ko UI에 영문 주소가 새지 않게 한다
 * (기존 enrich 동작과 동일하게 영문은 en 전용).
 */
export function jusoAddressToPlace(
  addr: JusoAddress,
  coord: { lat: number; lng: number },
  locale: "ko" | "en",
): Place {
  const road = addr.roadAddrPart1 || addr.roadAddr;
  return {
    id: `juso-${addr.roadAddr}`,
    name: addr.bdNm || road,
    category: "",
    address: addr.jibunAddr,
    roadAddress: road,
    englishAddress: locale === "en" && addr.engAddr ? addr.engAddr : undefined,
    lat: coord.lat,
    lng: coord.lng,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/address-to-place.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/address-to-place.ts src/lib/__tests__/address-to-place.test.ts
git commit -m "feat(address): juso 주소 → Place 합성 순수 함수"
```

---

### Task 7: i18n 키 추가 (ko + en)

**Files:**
- Modify: `messages/ko.json` (`search`에 키 종류·주소 검색 키, `address` 네임스페이스 신설)
- Modify: `messages/en.json` (동일 키 영문)

**Interfaces:**
- Produces: `search.kind.{label,place,address}`, `search.address{Placeholder,Searching,ResultsAnnouncement,NoResults,Error,CoordFailed,Label}`, `address.{postalCode,jibun}`

- [ ] **Step 1: ko.json에 키 추가**

`messages/ko.json`의 `search` 객체 안(마지막 `mockNotice` 다음에 콤마 추가 후) 키를 추가:

```json
    "kind": {
      "label": "검색 종류",
      "place": "장소",
      "address": "주소"
    },
    "addressLabel": "주소 검색",
    "addressPlaceholder": "예: 세종대로 110, 강남대로 396",
    "addressSearching": "주소 검색 중…",
    "addressResultsAnnouncement": "주소 검색 결과 {count}건",
    "addressNoResults": "해당 주소를 찾지 못했습니다. 다시 입력해 보세요.",
    "addressError": "주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    "addressCoordFailed": "이 주소의 좌표를 찾지 못해 상세를 열 수 없습니다."
```

그리고 최상위에 `address` 네임스페이스를 추가(`place` 네임스페이스 옆, 적절한 위치):

```json
  "address": {
    "postalCode": "우편번호",
    "jibun": "지번"
  },
```

- [ ] **Step 2: en.json에 키 추가**

`messages/en.json`의 `search` 객체 안에 추가:

```json
    "kind": {
      "label": "Search type",
      "place": "Place",
      "address": "Address"
    },
    "addressLabel": "Search addresses",
    "addressPlaceholder": "e.g. 110 Sejong-daero, 396 Gangnam-daero",
    "addressSearching": "Searching addresses…",
    "addressResultsAnnouncement": "{count} addresses found",
    "addressNoResults": "No matching address. Try a different term.",
    "addressError": "Address search failed. Please try again shortly.",
    "addressCoordFailed": "Couldn't locate coordinates for this address; cannot open details."
```

그리고 최상위에 `address` 네임스페이스 추가:

```json
  "address": {
    "postalCode": "Postal code",
    "jibun": "Lot number"
  },
```

- [ ] **Step 3: JSON 유효성 + 키 정합 확인**

Run: `node -e "const ko=require('./messages/ko.json'),en=require('./messages/en.json'); const ks=o=>Object.keys(o.search.kind).sort().join(); if(ks(ko)!==ks(en))throw new Error('search.kind 키 불일치'); if(JSON.stringify(Object.keys(ko.address))!==JSON.stringify(Object.keys(en.address)))throw new Error('address 키 불일치'); console.log('OK', ko.search.addressLabel, '|', en.search.addressLabel);"`
Expected: `OK 주소 검색 | Search addresses`

- [ ] **Step 4: 커밋**

```bash
git add messages/ko.json messages/en.json
git commit -m "feat(address): 주소 검색 i18n 키(ko/en) 추가"
```

---

### Task 8: SearchKindToggle 컴포넌트 (장소/주소 라디오)

**Files:**
- Create: `src/components/SearchKindToggle.tsx`

**Interfaces:**
- Consumes: i18n `search.kind.*` (Task 7)
- Produces: `<SearchKindToggle value={"place"|"address"} onChange={(v) => void} />`

- [ ] **Step 1: 컴포넌트 작성**

라디오 그룹을 시맨틱 `<fieldset>`/`<legend>`로 구성한다(과잉 ARIA 없이 스크린리더가 그룹·선택 상태를 정확히 낭독). 터치 타깃 `min-h-11`.

`src/components/SearchKindToggle.tsx` 생성:

```tsx
"use client";

import { useTranslations } from "next-intl";

/**
 * 검색 종류 토글 — 장소(POI) ⁄ 주소(도로명·우편번호).
 * 라디오 그룹(fieldset/legend)으로 스크린리더가 종류·선택 상태를 정확히 낭독한다
 * (탭/칩보다 시맨틱 정확 — 미니멀 접근성: 네이티브 시맨틱으로 충분, ARIA 불요).
 */
export function SearchKindToggle({
  value,
  onChange,
}: {
  value: "place" | "address";
  onChange: (v: "place" | "address") => void;
}) {
  const t = useTranslations("search.kind");
  return (
    <fieldset className="mb-3">
      <legend className="sr-only">{t("label")}</legend>
      <div className="flex gap-2">
        {(["place", "address"] as const).map((kind) => (
          <label
            key={kind}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-base font-medium has-[:checked]:border-accent has-[:checked]:bg-accent/10"
          >
            <input
              type="radio"
              name="searchKind"
              value={kind}
              checked={value === kind}
              onChange={() => onChange(kind)}
              className="accent-accent"
            />
            {t(kind)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/SearchKindToggle.tsx
git commit -m "feat(address): 검색 종류 토글(장소/주소) 컴포넌트"
```

---

### Task 9: AddressResultList 컴포넌트

**Files:**
- Create: `src/components/AddressResultList.tsx`

**Interfaces:**
- Consumes: `JusoAddress` (Task 2), i18n `address.*` (Task 7)
- Produces: `<AddressResultList addresses={JusoAddress[]} onSelect={(addr) => void} />`

- [ ] **Step 1: 컴포넌트 작성**

PlaceCard와 같은 카드/버튼 패턴. en이면 영문 주소를 메인·한글 도로명을 보조로(`lang="ko"`), ko면 도로명 메인. 지번·우편번호 보조 표시.

`src/components/AddressResultList.tsx` 생성:

```tsx
"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { JusoAddress } from "@/lib/types";

/**
 * juso 주소 검색 결과 목록. 항목 선택 → onSelect(addr) → 상위가 좌표 지오코딩 후
 * 상세로 진입한다. 영문 UI(en)는 공식 영문 주소를 메인, 한글 도로명을 보조로
 * 보인다(한글은 lang="ko"로 SR 음성 엔진 정합). 정보 정본은 텍스트.
 */
export function AddressResultList({
  addresses,
  onSelect,
}: {
  addresses: JusoAddress[];
  onSelect: (addr: JusoAddress) => void;
}) {
  const t = useTranslations("address");
  const locale = useLocale();
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {addresses.map((addr, i) => {
        const useEng = locale === "en" && Boolean(addr.engAddr);
        return (
          <li
            key={`${addr.roadAddr}-${i}`}
            className="rounded-lg border border-border bg-surface"
          >
            <button
              type="button"
              onClick={() => onSelect(addr)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <span>
                <span
                  className="block text-lg font-bold"
                  lang={useEng ? undefined : "ko"}
                >
                  {useEng ? addr.engAddr : addr.roadAddr}
                </span>
                {useEng && (
                  <span className="mt-0.5 block text-sm text-muted" lang="ko">
                    {addr.roadAddr}
                  </span>
                )}
                <span className="mt-0.5 block text-sm text-muted" lang="ko">
                  {t("jibun")} {addr.jibunAddr}
                </span>
                {addr.zipNo && (
                  <span className="mt-0.5 block text-sm text-muted">
                    {t("postalCode")} {addr.zipNo}
                  </span>
                )}
              </span>
              <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/AddressResultList.tsx
git commit -m "feat(address): 주소 검색 결과 목록 컴포넌트"
```

---

### Task 10: SearchBar에 label/placeholder 옵션 추가 + PlaceSearch 주소 모드 통합 + page 게이트

**Files:**
- Modify: `src/components/SearchBar.tsx` (optional `label`/`placeholder` props)
- Modify: `src/components/PlaceSearch.tsx` (searchKind 상태 + 주소 검색 머신 + 토글/결과 렌더 + 선택→좌표→상세)
- Modify: `src/app/[locale]/page.tsx` (`canSearchAddress` prop 주입)

**Interfaces:**
- Consumes: `SearchKindToggle` (Task 8), `AddressResultList` (Task 9), `jusoAddressToPlace` (Task 6), `JusoAddress`·`AddressMatch` 타입, `/api/address/search`(Task 5), 기존 `/api/geocode`, `hasJusoKey`(Task 1)
- Produces: PlaceSearch가 `canSearchAddress` prop을 받아 주소 검색 모드를 제공

- [ ] **Step 1: SearchBar에 optional label/placeholder props 추가**

`src/components/SearchBar.tsx`의 props 타입에 두 줄 추가하고, 본문에서 t() 기본값으로 폴백한다. props 구조 분해와 타입을 수정:

```tsx
export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
  onTranscribed,
  onVoiceError,
  label,
  placeholder,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onTranscribed: (text: string) => void;
  onVoiceError?: (code: VoiceRecorderErrorCode) => void;
  /** sr-only 라벨 오버라이드 (없으면 search.label) */
  label?: string;
  /** placeholder 오버라이드 (없으면 search.placeholder) */
  placeholder?: string;
}) {
```

그리고 `<label htmlFor="place-query" className="sr-only">{t("label")}</label>`를:

```tsx
      <label htmlFor="place-query" className="sr-only">
        {label ?? t("label")}
      </label>
```

`placeholder={t("placeholder")}`를:

```tsx
          placeholder={placeholder ?? t("placeholder")}
```

- [ ] **Step 2: PlaceSearch import·props 추가**

`src/components/PlaceSearch.tsx` 상단 import 블록에 추가:

```tsx
import type { AddressMatch, Coord, JusoAddress, Place, PlaceSearchResult } from "@/lib/types";
import { jusoAddressToPlace } from "@/lib/address-to-place";
import { SearchKindToggle } from "./SearchKindToggle";
import { AddressResultList } from "./AddressResultList";
```

(기존 `import type { Coord, Place, PlaceSearchResult } from "@/lib/types";` 줄을 위 첫 줄로 교체. 나머지 신규 import는 `ResultList` import 부근에 추가.)

props 타입(객체 구조 분해)에 `canSearchAddress = false` 추가 — 기존 `canShowTransit = false,` 다음에:

```tsx
  canSearchAddress = false,
```

그리고 props 타입 객체에 다음 줄 추가(`canShowTransit?: boolean;` 다음):

```tsx
  /** 행안부 juso 키가 있어 주소 검색 모드를 제공할 수 있는지 */
  canSearchAddress?: boolean;
```

- [ ] **Step 3: 주소 검색 상태·ref 추가**

`const [selected, setSelected] = useState<Place | null>(null);` 다음에 주소 모드 상태를 추가:

```tsx
  // 검색 종류 토글(장소/주소). 주소 모드는 juso 검색 → 좌표(카카오) → 상세.
  const [searchKind, setSearchKind] = useState<"place" | "address">("place");
  const [addrQuery, setAddrQuery] = useState("");
  const [addrStatus, setAddrStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "coordError" }
    | { kind: "done"; addresses: JusoAddress[] }
  >({ kind: "idle" });
  // 주소 검색 stale-result race 방지(place reqIdRef와 동형).
  const addrReqIdRef = useRef(0);
  // 좌표 변환 in-flight 가드(더블클릭 중복 진입 방지 — aria-disabled 보강 패턴).
  const addrResolveRef = useRef(false);
  const addrHeadingRef = useRef<HTMLHeadingElement>(null);
```

- [ ] **Step 4: popstate 핸들러가 모드별 헤딩으로 포커스하도록 ref 미러 추가**

`const statusRef = useRef(status);` 블록 다음(useEffect 포함)에 두 ref 미러를 추가:

```tsx
  // popstate(백버튼 복귀) 핸들러는 마운트 시점 클로저라, 복귀 시 현재 모드와
  // 주소 결과 상태를 최신값으로 읽기 위해 ref로 미러링한다(place statusRef 동형).
  const searchKindRef = useRef(searchKind);
  useEffect(() => {
    searchKindRef.current = searchKind;
  }, [searchKind]);
  const addrStatusRef = useRef(addrStatus);
  useEffect(() => {
    addrStatusRef.current = addrStatus;
  }, [addrStatus]);
```

그리고 기존 popstate effect의 `onPop`을 모드 분기로 교체:

```tsx
  useEffect(() => {
    function onPop() {
      setSelected(null);
      // 복귀 시 활성 모드의 결과 헤딩으로 포커스를 옮긴다(상세 언마운트로 포커스가
      // body로 유실되는 것 방지 — 접근성 1급).
      if (searchKindRef.current === "address") {
        if (addrStatusRef.current.kind === "done") {
          requestAnimationFrame(() => addrHeadingRef.current?.focus());
        }
      } else {
        focusResultsHeadingIfDone();
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
```

- [ ] **Step 5: 주소 검색 실행 + 좌표 변환 핸들러 추가**

`performSearch` useCallback 정의 다음에 주소 모드 핸들러들을 추가:

```tsx
  /**
   * 주소 검색 실행 — /api/address/search(juso) 호출, 결과/오류 상태 갱신.
   * place performSearch와 동형의 reqId stale 가드. 주소 모드는 URL ?q= 동기화를
   * 하지 않는다(첫 마운트 자동검색이 장소 모드를 가정 — V1 범위 결정).
   */
  const performAddressSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const myId = ++addrReqIdRef.current;
    setAddrStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/address/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { addresses: JusoAddress[] };
      if (addrReqIdRef.current !== myId) return;
      setAddrStatus({ kind: "done", addresses: data.addresses });
      requestAnimationFrame(() => addrHeadingRef.current?.focus());
    } catch {
      if (addrReqIdRef.current !== myId) return;
      setAddrStatus({ kind: "error" });
    }
  }, []);

  function runAddressSearch() {
    if (addrStatus.kind === "loading") return;
    void performAddressSearch(addrQuery);
  }

  /**
   * 주소 선택 → 카카오 지오코딩(/api/geocode)으로 좌표 확보 → Place 합성 → 상세.
   * juso=공식 주소/영문/우편번호, 카카오=좌표 정본의 역할 분리. 좌표 변환 실패는
   * coordError로 통지하고 상세를 열지 않는다(graceful). in-flight ref로 중복 방지.
   */
  async function onSelectAddress(addr: JusoAddress) {
    if (addrResolveRef.current) return;
    addrResolveRef.current = true;
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const res = await fetch(
        `/api/geocode?query=${encodeURIComponent(target)}&limit=1`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: AddressMatch[] };
      const coord = data.matches[0];
      if (!coord) {
        setAddrStatus({ kind: "coordError" });
        return;
      }
      openDetail(
        jusoAddressToPlace(
          addr,
          { lat: coord.lat, lng: coord.lng },
          locale === "en" ? "en" : "ko",
        ),
      );
    } catch {
      setAddrStatus({ kind: "coordError" });
    } finally {
      addrResolveRef.current = false;
    }
  }
```

- [ ] **Step 6: 주소 모드 live 메시지 + 렌더 분기 추가**

`liveMessage` 정의 다음에 주소 모드 live 메시지를 추가:

```tsx
  const addrLiveMessage =
    addrStatus.kind === "loading"
      ? t("search.addressSearching")
      : addrStatus.kind === "error"
        ? t("search.addressError")
        : addrStatus.kind === "coordError"
          ? t("search.addressCoordFailed")
          : addrStatus.kind === "done"
            ? t("search.addressResultsAnnouncement", {
                count: addrStatus.addresses.length,
              })
            : "";
```

그리고 최종 `return ( <section ...>` 안에서, `<SearchBar .../>` 바로 **위**에 토글을 추가(canSearchAddress일 때만):

```tsx
      {canSearchAddress && (
        <SearchKindToggle value={searchKind} onChange={setSearchKind} />
      )}
```

그 다음, 기존 `<SearchBar .../>`부터 place 결과 블록(`{status.kind === "done" && (...)}`)까지 **전체**를 `searchKind === "place"` 분기로 감싸고, 주소 모드 블록을 else로 추가한다. 구체적으로 mockNotice 다음, 토글 다음 위치를:

```tsx
      {searchKind === "place" ? (
        <>
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSubmit={runSearch}
            busy={status.kind === "loading"}
            onTranscribed={handleTranscribed}
          />

          <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
            {liveMessage}
          </p>

          {/* 내 주변 idle 섹션들 (기존 그대로) */}
          {canShowSubway && status.kind === "idle" && (
            <div className="mt-4">
              <SubwayArrivalsNearby />
            </div>
          )}
          {canShowBus && status.kind === "idle" && (
            <div className="mt-4">
              <BusArrivals mode="current" />
            </div>
          )}
          {canShowBike && status.kind === "idle" && (
            <div className="mt-4">
              <BikeStations mode="current" />
            </div>
          )}
          {canShowClinic && status.kind === "idle" && (
            <div className="mt-4">
              <NightClinicsNearby />
            </div>
          )}
          {canShowKids && status.kind === "idle" && (
            <div className="mt-4">
              <KidsPlacesNearby />
            </div>
          )}

          {status.kind === "done" && (
            <div className="mt-4">
              <h2
                ref={resultsHeadingRef}
                tabIndex={-1}
                className="text-xl font-semibold"
              >
                {t("search.resultsAnnouncement", {
                  count: status.result.places.length,
                })}
              </h2>
              {places.length === 0 ? (
                <p className="mt-2">{t("search.noResults")}</p>
              ) : (
                <>
                  <div className="mt-3 flex flex-col gap-2">
                    <ChipFilter
                      groupLabel={t("category.filterLabel")}
                      allLabel={t("category.all")}
                      items={bucketItems}
                      selected={bucket}
                      onSelect={setBucket}
                    />
                    <ChipFilter
                      groupLabel={t("region.filterLabel")}
                      allLabel={t("region.all")}
                      items={regionItems}
                      selected={region}
                      onSelect={setRegion}
                    />
                  </div>
                  {filtered.length === 0 ? (
                    <p className="mt-3">{t("search.noFilterResults")}</p>
                  ) : (
                    <ResultList groups={groups} onOpen={openDetail} />
                  )}
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <SearchBar
            query={addrQuery}
            onQueryChange={setAddrQuery}
            onSubmit={runAddressSearch}
            busy={addrStatus.kind === "loading"}
            onTranscribed={(text) => {
              setAddrQuery(text);
              void performAddressSearch(text);
            }}
            label={t("search.addressLabel")}
            placeholder={t("search.addressPlaceholder")}
          />

          <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
            {addrLiveMessage}
          </p>

          {addrStatus.kind === "done" && (
            <div className="mt-4">
              <h2
                ref={addrHeadingRef}
                tabIndex={-1}
                className="text-xl font-semibold"
              >
                {t("search.addressResultsAnnouncement", {
                  count: addrStatus.addresses.length,
                })}
              </h2>
              {addrStatus.addresses.length === 0 ? (
                <p className="mt-2">{t("search.addressNoResults")}</p>
              ) : (
                <AddressResultList
                  addresses={addrStatus.addresses}
                  onSelect={onSelectAddress}
                />
              )}
            </div>
          )}
        </>
      )}
```

(주의: 위 블록이 기존 mockNotice·SearchBar·live·idle·결과 블록을 **대체**한다. mockNotice는 place 모드에만 의미가 있으나 기존처럼 토글 위에 그대로 둔다 — `{isMockMode && (...)}` 블록은 토글보다 위, 변경 없음.)

- [ ] **Step 7: page.tsx에 canSearchAddress 주입**

`src/app/[locale]/page.tsx`의 env import에 `hasJusoKey` 추가:

```tsx
import {
  hasKakaoKey,
  hasDataGoKrKey,
  hasSeoulOpenDataKey,
  hasSeoulSubwayRealtimeKey,
  hasOdsayKey,
  hasJusoKey,
} from "@/lib/env";
```

그리고 `<PlaceSearch ...>`의 `canShowTransit={hasOdsayKey()}` 다음에 추가:

```tsx
      canSearchAddress={hasJusoKey()}
```

- [ ] **Step 8: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 모두 통과(빌드 성공)

- [ ] **Step 9: 전체 게이트 테스트**

Run: `npm run test:run`
Expected: 전체 PASS (기존 + juso 17 + address-to-place 6 + enrich 7)

- [ ] **Step 10: 커밋**

```bash
git add src/components/SearchBar.tsx src/components/PlaceSearch.tsx src/app/[locale]/page.tsx
git commit -m "feat(address): PlaceSearch 주소 검색 모드 통합 + 좌표 변환→상세 (C2-b)"
```

- [ ] **Step 11: 실호출 머지 게이트 (C2-b)**

`.env.local`에 `JUSO_CONFM_KEY`가 있는 상태로 dev 서버에서 라우트와 UI를 검증:

```bash
npm run dev
# 1) 라우트 단독 검증
curl -s "http://localhost:3000/api/address/search?query=세종대로 110" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.addresses?.slice(0,2).map(a=>({road:a.roadAddr,eng:a.engAddr,zip:a.zipNo})))})"
# 2) 무결과
curl -s "http://localhost:3000/api/address/search?query=존재하지않는주소xyz" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s))})"
```

Expected:
- 1) `roadAddr`·`engAddr`(국가명 없는 영문)·`zipNo`가 채워진 배열.
- 2) `{ addresses: [], query: "..." }` (200, 빈 배열 — throw 아님).
- 브라우저 `http://localhost:3000/ko`에서 "주소" 토글 → "세종대로 110" 검색 → 결과 선택 → 상세(PlaceDetail)에 도로명·길찾기 딥링크 표시. 키보드/스크린리더로 토글·결과·상세 흐름 완결 확인.

- [ ] **Step 12: a11y 점검**

`a11y-auditor` 서브에이전트로 SearchKindToggle·AddressResultList·PlaceSearch 주소 모드의 포커스 순서·라벨·live region·터치 타깃을 점검하고 지적 사항을 반영한다.

---

# 자기 검토 결과

**Spec 커버리지:**
- §2.1 juso provider → Task 2(정규화·추출·geocode) + Task 4(검색). ✅
- §2.2 영문주소 폴백 체인 + 게이트 → Task 3. ✅
- §2.3 주소 검색 진입점(토글·라우트·결과·좌표·Place 합성) → Task 5·6·8·9·10. ✅
- §3 게이트(C2-a 항상 동작, C2-b 토글 noexpose) → Task 3(체인) + Task 10(canSearchAddress). ✅
- §4 테스트(normalize·extract·체인 매트릭스·주소→Place·실호출) → Task 2·3·4·6 + 실호출 게이트 Step. ✅

**Placeholder 스캔:** 모든 코드 step에 완전한 코드 수록. "TBD"/"적절히"/"유사하게" 없음. ✅

**타입 정합:** `JusoAddress`(Task 2 정의) → Task 4·6·9·10에서 동일 필드명 사용. `jusoAddressToPlace(addr, coord, locale)` 시그니처 Task 6 정의 ↔ Task 10 호출 일치(`locale === "en" ? "en" : "ko"`로 string→union 좁힘). `searchJusoAddresses` Task 4 정의 ↔ Task 5 호출 일치. `AddressMatch`(기존 types.ts)는 `/api/geocode` 응답 `{matches}` 형태와 일치(Task 10 Step 5). ✅

**미결 한계(spec/메모리에 기록됨):** 프로덕션 `JUSO_CONFM_KEY` 미등록 — C2 배포 시 `vercel env add` + 재배포 필요(CLAUDE.md 키 표·spec §6에 명시). 주소 모드는 URL `?q=` 비동기화(V1 범위 결정 — Task 10 Step 5 주석).
