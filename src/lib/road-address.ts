/**
 * 도로명주소 파싱 — M1 좌표계의 입력.
 *
 * 건물번호는 **주된 출입구가 접하는 도로구간의 기초번호**이고(도로명주소법
 * 시행령 제23조①), 홀수는 도로 진행 왼쪽·짝수는 오른쪽이다(제7조④). 그래서
 * 이 파싱 하나가 "입구가 어느 도로 어느 편을 향하는가"를 준다.
 */
export interface RoadAddress {
  road: string;
  /** 본번. 기초번호이자 도로 진행거리의 함수(번호 1당 실측 8~10m). */
  main: number;
  /** 부번. 같은 기초번호를 나눠 쓰므로 축 추정·홀짝 판정에서 제외한다. */
  sub: number | null;
}

/** "지하"·"신관" 같은 수식어가 도로명과 번호 사이에 낀다. */
const ROAD_ADDRESS =
  /(^|\s)([^\s]*(?:대로|로|길))\s+(?:[가-힣]+\s+)?(\d+)(?:-(\d+))?\s*$/;

export function parseRoadAddress(addr: string): RoadAddress | null {
  const m = String(addr ?? "").trim().match(ROAD_ADDRESS);
  if (!m) return null;
  return { road: m[2], main: Number(m[3]), sub: m[4] ? Number(m[4]) : null };
}

/** 홀수 본번 = 도로 진행 방향 왼쪽(시행령 제7조④). */
export function isOddSide(a: RoadAddress): boolean {
  return a.main % 2 === 1;
}
