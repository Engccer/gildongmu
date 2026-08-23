import { unstable_cache } from "next/cache";
import { env } from "../env";

/**
 * 도로명(ko) → 로마자 표기. 행안부 juso `addrLinkApi`의 `engAddr`에서 뽑는다
 * (E16 축3, spec `2026-08-23-non-ko-walk-guidance-design.md` §4.4).
 *
 * ⚠ **번역이 아니라 로마자 표기다.** 한국 도로 표지판이 같은 표기를 달고 있으므로 외국인
 * 사용자가 실제로 대조할 수 있는 유일한 형태다.
 *
 * ⚠ **지역 제약을 걸지 않는다**(설계 리뷰 #6 기각). 로마자 표기는 한글 문자열의 함수라 동명
 * 도로는 지역이 달라도 같은 표기다("천호대로" → Cheonho-daero, 어디서든). 지역 키를 넣으면
 * 역지오코딩 의존과 캐시 폭증만 얻고 정확도는 얻지 못한다.
 *
 * ⚠ **조회 실패는 throw, "도로명 아님"만 null**(설계 리뷰 #7). 둘을 합치면 일시 장애가
 * `unstable_cache`에 "도로명 없음"으로 30일 눌러앉는다. Tmap의 일반명("보행자도로")은 juso가
 * 0건으로 걸러 주므로 차단 목록을 코드에 박을 필요가 없다(실측 40개 중 39개 성공, 실패 1건이
 * 정확히 그 일반명이다).
 */
const ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

/** 조회 상한(ms). 안내 시작 경로에 직렬로 끼므로 상한이 필수다. */
const LOOKUP_TIMEOUT_MS = 1500;

/** 도로명은 정적이라 길게 캐시한다(30일). */
const CACHE_SECONDS = 2592000;

interface JusoRow {
  rn?: string;
  engAddr?: string;
}

/**
 * `engAddr` 첫 쉼표 앞 조각에서 **선행 번호 토큰 하나만** 벗긴다.
 * ⚠ 첫 토큰만이다 — `11 Seongnae-ro 6-gil`의 `6-gil`은 이름의 일부다.
 * ⚠ 번호 토큰이 순수 숫자가 아닐 수 있다(실측 `B102 Bongeunsa-ro`).
 */
export function parseRoadNameEn(engAddr: string): string | null {
  const head = engAddr.split(",")[0]?.trim();
  if (!head) return null;
  const parts = head.split(/\s+/);
  // 로마자 도로명은 숫자로 시작하지 않으므로 "숫자를 포함한 첫 토큰"은 건물번호다.
  const rest = /\d/.test(parts[0]) ? parts.slice(1) : parts;
  const name = rest.join(" ").trim();
  return name || null;
}

async function fetchRoadNameEn(ko: string): Promise<string | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("confmKey", env.JUSO_CONFM_KEY ?? "");
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "5");
  url.searchParams.set("keyword", ko);
  url.searchParams.set("resultType", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`juso 도로명 조회 실패: HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { juso?: JusoRow[] | null } };
  const rows = json.results?.juso ?? [];
  // 부분 일치가 다른 도로를 물어오는 것을 막는다 — 정확 일치만 채택.
  for (const row of rows) {
    if (row.rn !== ko) continue;
    const name = parseRoadNameEn(row.engAddr ?? "");
    if (name) return name;
  }
  return null;
}

const cached = unstable_cache(fetchRoadNameEn, ["juso-road-name"], { revalidate: CACHE_SECONDS });

export function roadNameEn(ko: string): Promise<string | null> {
  return cached(ko);
}

/**
 * 여러 도로명을 병렬 조회. 실패·미발견은 Map에서 **누락**된다 — 도로명은 비블로킹 부가 정보라
 * 조회가 안 되면 그 스텝 문장에서 도로 절만 빠진다(경로는 살아 있다).
 */
export async function roadNamesEn(kos: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(kos.filter(Boolean))];
  const settled = await Promise.allSettled(unique.map((ko) => roadNameEn(ko)));
  const out = new Map<string, string>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out.set(unique[i], r.value);
  });
  return out;
}
