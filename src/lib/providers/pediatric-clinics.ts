import type { NightClinic } from "../types";
import { env } from "../env";
import { parseClinics } from "./night-clinic";
import {
  fetchDataGoKrJson,
  readItems,
  readResultCode,
  readTotalCount,
} from "./datagokr-envelope";

/**
 * 소아청소년과 진료과목 보유 병의원 provider — 응급의료정보 병의원 목록
 * `getHsptlMdcncListInfoInqire`(B552657, `DATA_GO_KR_API_KEY` 공유).
 *
 * 달빛어린이병원 명부(`night-clinic.ts`)의 **커버리지 보완재**다. 그 명부는 정부
 * 지정 153건뿐이라 미지정 동네 소아과가 일요일에 문을 열어도 부재한다(실측:
 * 강동 20km·6개 구에서 일요일 진료 소아청소년과 123곳 중 명부는 8곳뿐).
 *
 * - **`QD=D002`가 소아청소년과다.** 강남구에서 `D001~D016`을 전수 스캔해 역판정했다
 *   (D002는 대조 기관 적중, D009는 신경외과류로 소아 0건). ⚠ 설계 초안의
 *   "D009 추정"은 오류였으니 되돌리지 말 것.
 * - **⚠ `D002`는 "소아청소년과 전문"이 아니라 "진료과목 보유"다** — 이비인후과·
 *   내과·산부인과가 섞인다. 정밀도 대가는 UI가 밝혀야 하며 숨기면 안 된다.
 * - duty* 스키마가 달빛 명부와 같아 `parseClinics`를 그대로 재사용한다(좌표
 *   `wgs84Lat/Lon` + `dutyTime1s~8c` 8칸 동봉을 실호출로 확인).
 * - 시도 단위로 받는다(`Q1` 생략 가능). 반경 필터링은 호출부가 Haversine으로.
 */

const BASE =
  "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire";
/** 소아청소년과 진료과목 코드(실호출 역판정 확정). */
const PEDIATRICS_QD = "D002";
/** 1페이지 약 720KB — Next.js 데이터 캐시 항목 한도(2MB) 아래라 페이지 단위 캐시가 성립. */
const NUM_OF_ROWS = 1000;
/** 최대 시도(경기 3,929)의 3배 여유. 넘으면 계약이 바뀐 것이므로 throw. */
const MAX_PAGES = 12;

/** 시도 한 곳의 소아청소년과 전량(거리 미부여). 키 없으면 빈 배열. */
export async function fetchPediatricClinicsBySido(
  sido: string,
): Promise<NightClinic[]> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key || !sido) return [];

  const first = await fetchPage(key, sido, 1);
  const total = first.totalCount;
  const pageCount = Math.ceil(total / NUM_OF_ROWS);
  if (pageCount > MAX_PAGES) {
    throw new Error(
      `${sido} 소아청소년과 ${total}건 > 상한 ${MAX_PAGES}페이지 — 계약 변경 의심(부분집합 금지)`,
    );
  }

  // 2페이지부터는 병렬. 하나라도 실패하면 throw — 부분집합을 전량인 척 내보내면
  // "근처에 없음"과 구분되지 않는다(3-state 불변식).
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) =>
      fetchPage(key, sido, i + 2),
    ),
  );

  return [first, ...rest].flatMap((page) => page.clinics);
}

async function fetchPage(
  key: string,
  sido: string,
  pageNo: number,
): Promise<{ clinics: NightClinic[]; totalCount: number }> {
  const url =
    `${BASE}?serviceKey=${key}&Q0=${encodeURIComponent(sido)}` +
    `&QD=${PEDIATRICS_QD}&pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&_type=json`;
  // 명부는 분 단위 변동이 없다 — 하루 캐시로 쿼터를 아낀다(달빛 명부와 동형).
  const raw = await fetchDataGoKrJson(url, "소아청소년과 목록", {
    next: { revalidate: 86_400 },
  });
  const code = readResultCode(raw);
  if (code !== "00") {
    throw new Error(`소아청소년과 목록 비정상 응답: resultCode ${code}`);
  }
  const totalCount = readTotalCount(raw);
  const clinics = parseClinics(raw).map((c) => ({ ...c, designated: false }));
  // 좌표 누락 행은 거리 정렬이 불가해 버린다. 조용히 사라지면 "명부에 없다"와
  // 구분되지 않으므로 드롭 수를 관측만 남긴다(달빛 명부와 동형).
  const dropped = readItems(raw).length - clinics.length;
  if (dropped > 0) {
    console.warn(
      `[pediatric-clinics] ${sido} p${pageNo}: 좌표 누락 등으로 제외 ${dropped}건`,
    );
  }
  return { clinics, totalCount };
}
