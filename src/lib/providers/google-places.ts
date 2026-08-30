import { unstable_cache } from "next/cache";
import { env } from "../env";
import {
  matchGoogleCandidate,
  todayHours,
  type GoogleCandidate,
  type GoogleOpeningHours,
  type MatchTarget,
  type PlaceHoursToday,
} from "../place-hours";

/**
 * Google Places API (New) provider — 장소 상세 영업시간 한 줄(E24) 전용.
 * spec `docs/superpowers/specs/2026-08-30-place-hours-google-design.md` §2.
 *
 * 호출이 둘로 갈리고 캐시 정책이 정반대다:
 * - `resolvePlaceId`(Text Search, Pro SKU): **place_id만** 무기한 캐시가 허용된다(Maps Service
 *   Specific Terms §3). 365일 `unstable_cache`. 불일치(null)도 30일 캐시 — 부재는 Google
 *   콘텐츠가 아니고 매번 Pro 1콜을 태우는 것은 낭비다.
 * - `fetchTodayHours`(Place Details, Enterprise SKU): 영업시간은 **캐시 금지**(Terms §3.2.3(b)),
 *   `no-store`.
 *
 * ⚠ 과금 등급은 요청 파라미터가 아니라 `X-Goog-FieldMask`가 정한다("highest SKU applicable") —
 * 필드를 늘리면 SKU가 오른다. 예산 상한은 코드가 아니라 GCP 소비자 쿼터(일 단위)가 강제하고
 * 초과는 429 → 여기서 null → 소비자 침묵(spec §3).
 *
 * ⚠ 이 함수들의 출력은 VoiceOver만 읽는다. `TtsPlayer`·`speakGuidance`·채팅 산문으로
 * 흘러가면 약관 §3.2.3(a)(iv) TTS 금지 위반 — `place-hours-tts-drift.test.ts`가 파일 allowlist로 막는다.
 */

const TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const DETAILS = "https://places.googleapis.com/v1/places/";
const FETCH_TIMEOUT_MS = 3000;
const BIAS_RADIUS_METERS = 300;

type TextSearchResponse = {
  places?: {
    id: string;
    displayName?: { text?: string };
    location?: { latitude: number; longitude: number };
    formattedAddress?: string;
  }[];
};

type DetailsResponse = {
  currentOpeningHours?: GoogleOpeningHours;
  regularOpeningHours?: GoogleOpeningHours;
};

async function googleFetch<T>(url: string, init: RequestInit, fieldMask: string): Promise<T | null> {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 429(쿼터 소진)·403·5xx 전부 "정보 없음" — 매칭 보조는 실패를 구분해 알릴 소비자가 없다.
  if (!res.ok) {
    if (res.status !== 429) console.warn(`[google-places] HTTP ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

async function searchCandidates(target: MatchTarget): Promise<GoogleCandidate[]> {
  const body = {
    textQuery: target.name,
    languageCode: "ko",
    regionCode: "KR",
    maxResultCount: 5,
    locationBias: {
      circle: { center: { latitude: target.lat, longitude: target.lng }, radius: BIAS_RADIUS_METERS },
    },
  };
  const json = await googleFetch<TextSearchResponse>(
    TEXT_SEARCH,
    { method: "POST", body: JSON.stringify(body) },
    "places.id,places.displayName,places.location,places.formattedAddress",
  );
  return (json?.places ?? [])
    .filter((p) => p.id && p.location)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? "",
      lat: p.location!.latitude,
      lng: p.location!.longitude,
      formattedAddress: p.formattedAddress,
    }));
}

const PLACE_ID_TTL_SECONDS = 365 * 86400;
const MISS_TTL_SECONDS = 30 * 86400;

/** 캐시 키는 카카오 정체성(이름+좌표 4자리+도로명) — 같은 장소는 한 번만 Pro 콜을 쓴다. */
function cacheKeyOf(t: MatchTarget): string {
  return `${t.name}|${t.lat.toFixed(4)}|${t.lng.toFixed(4)}|${t.roadAddress ?? ""}`;
}

async function resolveUncached(target: MatchTarget): Promise<string | null> {
  const candidates = await searchCandidates(target);
  return matchGoogleCandidate(target, candidates)?.id ?? null;
}

/**
 * 카카오 장소 → Google place_id(캐시 무기한 허용). 히트·미스를 TTL이 다른 두 캐시로 나눈다 —
 * 하나에 넣으면 미스가 365일 굳거나 히트가 30일마다 Pro 콜을 다시 쓴다.
 *
 * 중첩 순서가 계약이다: **바깥 = 미스 캐시(30일, null 저장 가능), 안쪽 = 히트 캐시(365일, 미스면
 * throw → 안쪽엔 안 굳음)**. 첫 미스는 안쪽 1콜 → throw → 바깥이 null을 30일 저장(총 1콜, 이후
 * 0콜). 히트는 둘 다 채워지고 30일 뒤 바깥이 재실행돼도 안쪽이 365일 히트라 0콜. ⚠ 순서를
 * 뒤집으면 미스 장소가 **매 상세 열람마다 Pro 1콜**을 쓴다(리뷰 검출 2026-08-30 — 예외를
 * 캐시하지 않는 unstable_cache 성질 때문에 안쪽이 매번 재실행된다).
 */
export async function resolvePlaceId(target: MatchTarget): Promise<string | null> {
  const key = cacheKeyOf(target);
  const hitCache = unstable_cache(
    async () => {
      const id = await resolveUncached(target);
      if (id === null) throw new MissSignal();
      return id;
    },
    ["google-place-id", key],
    { revalidate: PLACE_ID_TTL_SECONDS },
  );
  const missCache = unstable_cache(
    async (): Promise<string | null> => {
      try {
        return await hitCache();
      } catch (e) {
        if (e instanceof MissSignal) return null;
        throw e;
      }
    },
    ["google-place-miss", key],
    { revalidate: MISS_TTL_SECONDS },
  );
  return missCache();
}

class MissSignal extends Error {}

/** place_id → 오늘 구간. 캐시 없음(약관). 영업시간 없는 장소는 null. */
export async function fetchTodayHours(placeId: string, nowMs: number = Date.now()): Promise<PlaceHoursToday | null> {
  const json = await googleFetch<DetailsResponse>(
    `${DETAILS}${encodeURIComponent(placeId)}?languageCode=ko&regionCode=KR`,
    { method: "GET", cache: "no-store" },
    "currentOpeningHours,regularOpeningHours",
  );
  if (!json) return null;
  return todayHours(json.currentOpeningHours, json.regularOpeningHours, nowMs);
}

/** 라우트 진입점: 매칭 → 영업시간. 어떤 실패도 null. */
export async function getPlaceHoursToday(target: MatchTarget): Promise<PlaceHoursToday | null> {
  if (!env.GOOGLE_PLACES_API_KEY) return null;
  const id = await resolvePlaceId(target);
  if (!id) return null;
  return fetchTodayHours(id);
}
