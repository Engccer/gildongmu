import type { BarrierFreePlace, BarrierFreeDetail, BarrierFreeFacility } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";
import { fetchDataGoKrJson, readItems, readResultCode } from "./datagokr-envelope";
import { romanNameOf } from "../romanize";

/**
 * 한국관광공사 무장애 여행 정보 provider — B551011/KorWithService2.
 *
 * 장애유형별 무장애 편의시설(휠체어·장애인화장실·점자블록·음성안내 등)을 제공.
 * tour-api.ts(KorService2)와 envelope·좌표 규약 동일(mapx=경도/mapy=위도, 빈결과
 * items:""). 인증은 형제 night-clinic.ts와 동일하게 data.go.kr 공용
 * serviceKey(env.DATA_GO_KR_API_KEY)를 쓴다 — 이 기능의 4계층 게이트가 전부
 * hasDataGoKrKey()라, 인증 변수도 같은 키로 일치시켜 split-brain(게이트 통과·
 * provider 빈결과 → 거짓 "없음" 음성)을 막는다.
 *
 * ⚠ 필드 철자는 활용신청 승인 후 실호출로 확정(Task 6) — 한국 공공 API는 철자가
 * 비표준(braile 단철자 등)이라, 화이트리스트 키 중 값이 비어있지 않은 것만 라벨링해
 * 철자 불확실성에 강건하게 둔다(틀린 키는 조용히 누락, 오정보 노출 없음).
 *
 * 3-state: 값 있음(노출)/빈 값(제외)/조회 실패(throw→502).
 */

const BASE = "https://apis.data.go.kr/B551011/KorWithService2";
const MAX_DISTANCE_METERS = 3000; // 관광지 — 도보권보다 넓게
/** 서버 반환 상한(numOfRows로도 전달) — 표시 절단은 클라이언트 몫(V1 동형). */
const SERVER_CAP = 50;
const MATCH_RADIUS_METERS = 50; // 장소 상세 매칭 — 좁게(false positive 차단)
/**
 * 이름으로 찾기(E88)의 거리 가드. 이름이 같은 등록 장소라도 이보다 멀면 다른 곳으로 본다(다른 도시의 같은 이름).
 * 넓은 부지는 카카오 좌표와 관광공사 좌표가 수백 m 어긋난다(경복궁 약 400m, 실호출 2026-11-14) — 50m로는 놓친다.
 */
export const NAME_MATCH_RADIUS_METERS = 1000;
/** 이름 검색(`searchKeyword2`)에서 받는 후보 수. */
const KEYWORD_ROWS = 20;
/** 이름이 꼭 같지 않은 근처 후보를 돌려주는 수. */
const SIMILAR_CAP = 3;

/** 무장애 편의시설 필드 화이트리스트 → 한글 라벨. ⚠ Task 6에서 실응답으로 교정. */
// ⚠ 키 철자는 detailWithTour2 실응답으로 확정(2026-06-30 서울도서관 130183·덕수궁
// 1605981 실호출). 응답은 무장애 필드 전체를 항상 포함(빈 값이라도 키 존재)하므로
// 화이트리스트는 그 키 중 "무장애 편의시설"만 골라 한글 라벨을 단다(contentid 등 제외).
export const BARRIER_FREE_FIELD_LABELS: Record<string, string> = {
  // 지체/공통
  wheelchair: "휠체어 대여",
  restroom: "장애인 화장실",
  elevator: "엘리베이터",
  parking: "장애인 주차장",
  route: "접근로",
  exit: "주출입구",
  publictransport: "대중교통·접근",
  ticketoffice: "매표소 장애인 편의",
  auditorium: "공연장·객석 장애인석",
  room: "객실 장애인 편의",
  handicapetc: "장애인 편의(기타)",
  // 시각
  braileblock: "점자블록",
  audioguide: "음성안내",
  brailepromotion: "점자 안내물",
  guidehuman: "안내요원",
  helpdog: "보조견 동반",
  bigprint: "큰글씨 자료",
  guidesystem: "음성유도기",
  blindhandicapetc: "시각장애 편의(기타)",
  // 청각
  signguide: "수어 안내",
  videoguide: "자막·영상 안내",
  hearingroom: "청각 보조 설비",
  hearinghandicapetc: "청각장애 편의(기타)",
  // 영유아·가족
  lactationroom: "수유실",
  stroller: "유모차 대여",
  babysparechair: "유아용 의자",
  infantsfamilyetc: "영유아·가족 편의(기타)",
};

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * 무장애 편의시설 값 정제 — detailWithTour2 실응답은 `<br/>` 태그와 `_무장애
 * 편의시설`류 분류 접미를 섞어 준다(2026-06-30 실측). 그대로 두면 스크린 리더가
 * "br" 태그·언더바를 낭독하므로 평문으로 정규화한다(정적 리뷰가 못 잡는 데이터 현실).
 */
export function cleanFacilityValue(v: unknown): string {
  return String(v ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/_(무장애|시각장애인|청각장애인|영유아가족|고령자)\s*편의시설/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 화이트리스트 키 중 값이 비어있지 않은 것만 → 라벨링된 편의시설 목록. */
export function labelFacilities(item: Record<string, unknown>): BarrierFreeFacility[] {
  const out: BarrierFreeFacility[] = [];
  for (const [key, label] of Object.entries(BARRIER_FREE_FIELD_LABELS)) {
    const value = cleanFacilityValue(item[key]);
    if (value) out.push({ key, label, value });
  }
  return out;
}

function normalizePlace(item: Record<string, unknown>, originLat: number, originLng: number): BarrierFreePlace | null {
  const lat = numF(item.mapy);
  const lng = numF(item.mapx);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = str(item.title);
  if (!name) return null;
  return {
    contentId: str(item.contentid),
    name,
    nameRoman: romanNameOf(name),
    category: "", // contenttypeid 라벨은 Task 1 비범위(빈 문자열) — 필요 시 후속
    address: [str(item.addr1), str(item.addr2)].filter(Boolean).join(" "),
    lat,
    lng,
    distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
  };
}

async function callKorWith(operation: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}/${operation}`);
  url.searchParams.set("serviceKey", env.DATA_GO_KR_API_KEY ?? "");
  url.searchParams.set("MobileOS", "WEB");
  url.searchParams.set("MobileApp", "gildongmu");
  url.searchParams.set("_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const raw = await fetchDataGoKrJson(url, "무장애 여행 정보", {
    next: { revalidate: 86_400 },
  });
  const code = readResultCode(raw);
  if (code !== "0000") throw new Error(`무장애 여행 정보 비정상 응답: resultCode ${code}`);
  return raw;
}

/** 좌표 → 반경 내 무장애 관광지 상위 N(거리순). 키 없으면 빈 배열. */
export async function searchBarrierFreeNearby(
  lat: number,
  lng: number,
  opts: { radiusMeters?: number; limit?: number } = {},
): Promise<BarrierFreePlace[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const radius = opts.radiusMeters ?? MAX_DISTANCE_METERS;
  const limit = opts.limit ?? SERVER_CAP;
  const raw = await callKorWith("locationBasedList2", {
    mapX: String(lng),
    mapY: String(lat),
    radius: String(radius),
    arrange: "E", // 거리순
    numOfRows: String(limit),
  });
  return readItems(raw)
    .map((it) => normalizePlace(it, lat, lng))
    .filter((p): p is BarrierFreePlace => p !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters) // dist 신뢰 대신 코드 정렬
    .slice(0, limit);
}

/** contentId → 무장애 편의시설 상세(값 있는 항목만). 항목 자체가 없으면 null. */
export async function getBarrierFreeDetail(contentId: string): Promise<BarrierFreeDetail | null> {
  if (!env.DATA_GO_KR_API_KEY || !contentId) return null;
  const raw = await callKorWith("detailWithTour2", { contentId });
  const items = readItems(raw);
  if (items.length === 0) return null;
  const item = items[0];
  return {
    contentId,
    name: str(item.title),
    nameRoman: romanNameOf(str(item.title)),
    facilities: labelFacilities(item),
  };
}

/** 좌표 50m ∩ 이름 일치 시에만 detail. false positive 차단. 매칭 실패 null. */
export async function matchBarrierFreePlace(args: {
  lat: number;
  lng: number;
  name: string;
}): Promise<BarrierFreeDetail | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const near = await searchBarrierFreeNearby(args.lat, args.lng, {
    radiusMeters: MATCH_RADIUS_METERS,
    limit: 10,
  });
  const target = normalizeName(args.name);
  // 이름 일치 + 코드 측 거리 가드(defense-in-depth). data.go.kr radius 필터가
  // 느슨해 반경 밖 동명 장소를 줘도 distanceMeters로 false positive를 차단.
  const matched = near.find(
    (p) => normalizeName(p.name) === target && p.distanceMeters <= MATCH_RADIUS_METERS,
  );
  if (!matched) return null;
  return getBarrierFreeDetail(matched.contentId);
}

/** 이름(키워드) → 등록 장소 후보(기준 좌표에서 가까운 순). 좌표 없는 항목은 뺀다. 키 없으면 빈 배열. */
export async function searchBarrierFreeByKeyword(
  keyword: string,
  origin: { lat: number; lng: number },
): Promise<BarrierFreePlace[]> {
  if (!env.DATA_GO_KR_API_KEY || !keyword.trim()) return [];
  const raw = await callKorWith("searchKeyword2", { keyword: keyword.trim(), numOfRows: String(KEYWORD_ROWS) });
  return readItems(raw)
    .map((it) => normalizePlace(it, origin.lat, origin.lng))
    .filter((p): p is BarrierFreePlace => p !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export interface BarrierFreeNameLookup {
  /** 이름이 맞은 등록 장소의 상세. 못 찾았으면 null. */
  detail: BarrierFreeDetail | null;
  /** 못 찾았을 때만: 이름 검색에 걸린 근처의 다른 등록 장소(이름이 꼭 같지는 않다). */
  // contentId를 싣지 않는다: 모델이 되묻지 않고 근처 다른 장소의 상세를 바로 조회해 묻지 않은 곳을 답할 수 있다(E88 리뷰).
  similar: { name: string; distanceMeters: number }[];
}

/**
 * 장소 이름과 좌표 → 무장애 편의시설 상세(E88 채팅 도구의 이름 인자).
 *
 * 1. 장소 상세 화면과 같은 판정(`matchBarrierFreePlace`, 좌표 50m ∩ 이름 일치)을 먼저 본다.
 * 2. 없으면 이름 검색(`searchKeyword2`)에서 이름이 같고 `NAME_MATCH_RADIUS_METERS` 안인 곳을 고른다.
 *    ⚠ 2가 있는 까닭: 좌표 목록(`locationBasedList2`)이 등록 장소 대부분을 돌려주지 않는 때가 있다(2026-11-14 실호출:
 *    덕수궁 좌표 3km 조회가 4건, 덕수궁 자신은 없음. 이름 검색은 덕수궁·경복궁을 준다). 1만 쓰면 등록된 곳을
 *    「정보 없음」으로 답한다.
 *
 * `names`는 같은 장소를 부르는 이름들이다(사용자가 말한 이름, 장소 검색이 준 이름). 첫 이름으로 검색하고 어느 이름과든 같으면 맞은 것이다.
 * 못 찾음은 `detail: null`, 조회 실패는 throw.
 */
export async function findBarrierFreeByName(args: {
  lat: number;
  lng: number;
  names: readonly string[];
}): Promise<BarrierFreeNameLookup> {
  const names = args.names.map((n) => n.trim()).filter(Boolean);
  if (!env.DATA_GO_KR_API_KEY || names.length === 0) return { detail: null, similar: [] };
  for (const name of names) {
    const strict = await matchBarrierFreePlace({ lat: args.lat, lng: args.lng, name });
    if (strict) return { detail: { ...strict, name: strict.name || name }, similar: [] };
  }
  const targets = new Set(names.map(normalizeName));
  const near = (await searchBarrierFreeByKeyword(names[0], args)).filter(
    (p) => p.distanceMeters <= NAME_MATCH_RADIUS_METERS,
  );
  const matched = near.find((p) => targets.has(normalizeName(p.name)));
  const similar = () =>
    near
      .filter((p) => p !== matched)
      .slice(0, SIMILAR_CAP)
      .map((p) => ({ name: p.name, distanceMeters: p.distanceMeters }));
  if (!matched) return { detail: null, similar: similar() };
  const detail = await getBarrierFreeDetail(matched.contentId);
  // 상세 응답에는 이름이 없다(detailWithTour2) — 검색이 준 등록 이름을 싣는다.
  if (!detail) return { detail: null, similar: similar() };
  return { detail: { ...detail, name: matched.name, ...(matched.nameRoman ? { nameRoman: matched.nameRoman } : {}) }, similar: [] };
}

/** 공백·괄호·흔한 지점 접미 제거 후 비교(보수적 동일성). */
export function normalizeName(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(본점|점|지점)$/u, "")
    .toLowerCase();
}
