import seed from "./providers/data/tago-cities.json";

/**
 * TAGO 버스 커버리지 판정(스펙 `2026-08-02-bus-uncovered-region-design.md` §5).
 *
 * ⚠ **이 판정은 정류소 조회가 0건일 때만 불러야 한다.** 좌표만 보고 미리 판정하면
 * 담양·화순처럼 자기 도시코드가 없어도 인접 광역시 버스가 넘어오는 지역에 거짓
 * "미제공"을 낭독한다(실측 10건·23건). 0건 뒤로 미루면 그런 지역은 애초에 이 함수에
 * 오지 않아 반례가 스스로 사라진다.
 *
 * 순수 함수 + 정적 seed라 React/Next 비의존(dodo 이식성).
 */
export type TagoCityCoverage = "covered" | "uncovered" | "unknown";

/**
 * 카카오 `region_1depth_name` → TAGO 도시코드 앞 2자리(도).
 *
 * ⚠ **행정구역 개편이 이 표를 낡게 만든다.** 2026-08-02 현재 광주광역시와 전라남도가
 * `전남광주통합특별시`로 통합됐고(카카오·행안부 juso 모두 그 표기, 반면 TAGO는 여전히
 * `광주광역시`라 부른다), 강원·전북은 이미 `특별자치도`로 바뀌었다. 구 표기도 함께
 * 남겨 두되, 표에 없는 이름은 `unknown`으로 떨어뜨려 **판정을 포기한다**(§fail-open).
 */
const PROVINCE_PREFIX: Record<string, number> = {
  경기도: 31,
  강원특별자치도: 32,
  강원도: 32,
  충청북도: 33,
  충청남도: 34,
  전북특별자치도: 35,
  전라북도: 35,
  전라남도: 36,
  전남광주통합특별시: 36,
  경상북도: 37,
  경상남도: 38,
};

/**
 * 시도 전체가 한 덩어리로 커버되는 곳: TAGO가 도시 단위 코드 하나로 두거나(광역시
 * 21~26·세종 12·제주 39) 서울처럼 TOPIS가 맡는다.
 *
 * ⚠ **자치구만 보고 판단하면 광역시 소속 "군"이 빠진다**: 인천 강화·옹진, 부산 기장,
 * 울산 울주, 대구 군위는 2depth가 `~군`이라 자치구 규칙에 안 걸린다. 시도로 먼저
 * 가르면 그 넷이 우연이 아니라 규칙으로 covered가 된다.
 * ⚠ 광주광역시는 전라남도와 통합돼 실제로는 이 이름으로 오지 않는다(아래 자치구 규칙이
 * 받는다). 되돌려질 가능성과 옛 데이터를 위해 남겨 둔다.
 */
const WHOLE_PROVINCE_COVERED = new Set([
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
]);

/** `${도 접두}:${시군명}` 집합. 등록 정류소가 0인 도시(양양군)는 미커버로 친다. */
const COVERED = new Set(
  seed.cities
    .filter((c) => c.stops > 0)
    .flatMap((c) => c.names.map((n) => `${Math.floor(c.code / 1000)}:${n}`)),
);

/**
 * 시군 단위 커버리지 판정. 입력은 카카오 역지오코딩의 시도·시군구 이름.
 *
 * `unknown`은 "모르겠다"이지 "미커버"가 아니다: 호출부는 covered와 같이 다뤄야 한다.
 */
export function judgeTagoCityCoverage(
  region1: string,
  region2: string,
): TagoCityCoverage {
  const si = region1.trim();
  const gun = region2.trim();
  if (si === "") return "unknown";

  // 시도 하나가 통째로 커버되는 곳(광역시·세종). 세종은 시군구 계층이 없어 2depth가
  // 빈 문자열로 오는데, 이 분기가 그것까지 함께 받는다.
  if (WHOLE_PROVINCE_COVERED.has(si)) return "covered";

  // TAGO는 섬 전체를 `제주도`(39) 하나로 두는데 카카오 2depth는 제주시/서귀포시다.
  if (si.includes("제주")) return "covered";

  // 통합 시도 안의 광주 자치구를 받는다. `수원시 영통구`처럼 공백이 있으면 특례시의
  // 일반구라 여기 해당하지 않는다(그쪽은 아래에서 시 이름으로 매칭한다).
  if (gun !== "" && !gun.includes(" ") && gun.endsWith("구")) return "covered";

  if (gun === "") return "unknown";

  const prefix = PROVINCE_PREFIX[si];
  if (prefix === undefined) return "unknown";

  // `청주시 상당구` → `청주시`. 특례시만 구가 붙는다.
  const city = gun.split(" ")[0];
  // ⚠ 시군명만으로 판단하지 말 것: 강원 고성군과 경남 고성군이 동명이고, 경남 쪽만
  // TAGO에 있다. 도 접두를 빼면 강원 고성군이 커버로 오판된다(조사 중 실제로 겪었다).
  return COVERED.has(`${prefix}:${city}`) ? "covered" : "uncovered";
}
