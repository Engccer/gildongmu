/**
 * 무장애 편의시설 화이트리스트 **키 27종**(KorWithService2 detailWithTour2 필드명, A26).
 * provider(`tour-barrier-free.ts`)의 한글 라벨 표와 클라이언트(웹 `place-lines/barrier-free.ts` ·
 * iOS `BarrierFreeInfoSection`)의 `barrierFreeInfo.facility.*` i18n 키가 같은 집합을 봐야 한다 —
 * 드리프트는 `barrier-free-labels-i18n.test.ts`가 잡는다. React/Next 비의존(클라이언트 import 가능).
 */
export const BARRIER_FREE_FIELD_KEYS = [
  // 지체/공통
  "wheelchair",
  "restroom",
  "elevator",
  "parking",
  "route",
  "exit",
  "publictransport",
  "ticketoffice",
  "auditorium",
  "room",
  "handicapetc",
  // 시각
  "braileblock",
  "audioguide",
  "brailepromotion",
  "guidehuman",
  "helpdog",
  "bigprint",
  "guidesystem",
  "blindhandicapetc",
  // 청각
  "signguide",
  "videoguide",
  "hearingroom",
  "hearinghandicapetc",
  // 영유아·가족
  "lactationroom",
  "stroller",
  "babysparechair",
  "infantsfamilyetc",
] as const;

export type BarrierFreeFieldKey = (typeof BARRIER_FREE_FIELD_KEYS)[number];

const KNOWN = new Set<string>(BARRIER_FREE_FIELD_KEYS);

export function isBarrierFreeFieldKey(key: string): key is BarrierFreeFieldKey {
  return KNOWN.has(key);
}
