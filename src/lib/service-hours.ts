/**
 * 대중교통 노선 운행 시간 판정(순수).
 *
 * 시각을 인자로 받는 이유: 심야 결함은 시각 의존이라 실호출로 재현할 수 없다.
 * 판정을 순수 함수로 분리하면 주입 시각으로 결정적 테스트가 가능하다.
 * 설계 정본 docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md
 */

export type ServiceStatus = "running" | "outside" | "unknown";

/** 운행중 > 정보없음 > 운행밖. 조회 실패를 결함으로 단정하면 멀쩡한 경로가 강등된다. */
export const SERVICE_RANK: Record<ServiceStatus, number> = {
  running: 0,
  unknown: 1,
  outside: 2,
};

/**
 * 운행 시각 문자열 → 0시부터의 분.
 * TOPIS는 "YYYYMMDDHHMM"(12자리) 또는 "YYYYMMDDHHMMSS"(14자리),
 * TAGO는 "HHMM"(4자리)로 준다. 형식 위반·결측은 null(0으로 뭉개지 않는다).
 */
export function parseServiceTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return null;
  let hhmm: string;
  if (digits.length === 4) hhmm = digits;
  else if (digits.length === 12 || digits.length === 14) hhmm = digits.slice(8, 12);
  else return null;
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  // 운행 시각은 24시 표기를 넘지 않는다(25시류 표기는 관측되지 않아 형식 위반 취급)
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** KST 기준 0시부터의 분. 서버 타임존에 의존하지 않도록 UTC에서 +9h 한다. */
export function kstNowMinutes(now: Date): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * 현재 시각이 운행 구간 안인가.
 * 막차 < 첫차면 자정을 넘기는 심야 노선이라 구간이 두 토막이다(N30 23:10~03:50).
 *
 * ⚠ 알려진 한계(비대칭): 첫차·막차는 **차고지 출발 시각**이라 막차 직후에는
 *   이미 출발한 차가 중간 정류장으로 오는 중일 수 있는데 outside로 판정된다
 *   (03:58 실측에서 N30 막차 03:50이 지났지만 도착정보는 "[막차] 16분후"였다).
 *   첫차 전은 확실히 탈 수 없으므로 오판이 없고, 막차 후만 노선 길이만큼
 *   보수적으로 나온다. 강등일 뿐 제외가 아니라서 사용자는 여전히 그 경로를
 *   볼 수 있고, 정확히 하려면 노선별 소요시간이 필요해 이 단계에서는 수용한다.
 */
export function judgeServiceStatus(
  nowMinutes: number,
  firstMinutes: number | null,
  lastMinutes: number | null,
): ServiceStatus {
  if (firstMinutes == null || lastMinutes == null) return "unknown";
  const running =
    lastMinutes < firstMinutes
      ? nowMinutes >= firstMinutes || nowMinutes <= lastMinutes
      : nowMinutes >= firstMinutes && nowMinutes <= lastMinutes;
  return running ? "running" : "outside";
}
