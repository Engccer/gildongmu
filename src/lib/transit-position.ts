import { subwayIdForOdsayLine } from "./transit-guide";
import { parseRecptnDt } from "./transit-track";
import { subwayLineNameForId } from "./providers/seoul-subway-arrival";
import { fetchSubwayLinePositions } from "./providers/seoul-subway-position";

/**
 * 승차 중 잠근 열차의 현재역(E35, spec `2026-09-23-riding-current-station-design.md` §3.2).
 * `/api/transit/position` 판별 union — 3-state를 응답에서 뭉개지 않는다:
 * found(있다) · notFound(목록은 받았는데 그 열차가 없다 = 정보 없음) · unsupported(노선 매핑 밖·키 없음
 * — 이 구간에선 다시 묻지 않는다) · throw(조회 실패 → 라우트 502).
 *
 * ⚠ **표시 전용**: 이 결과는 승차 상태 머신의 입력이 아니다. 판정(도착·승격·하차·neverSeen)은
 * 도착 API가 한다(판정서 2026-08-23 §3).
 */
export type TransitPositionResult =
  | {
      status: "found";
      /** 현재역 원문(부역명 포함) — 조인 키로만 쓴다. 화면 라벨은 leg 경유역 표시 투영이 정본. */
      station: string;
      /** 0 진입 · 1 도착 · 2 출발 · 3 전역 출발. 결측은 null. */
      trainStatus: string | null;
      dataStamp: string | null;
      /** 데이터 나이(초). 미래값은 0으로 클램프, 파싱 불가·결측은 null. */
      dataAgeSeconds: number | null;
    }
  | { status: "notFound"; total: number }
  | { status: "unsupported" };

export async function trackSubwayPosition(params: {
  lineName: string;
  trainNo: string;
  now?: number;
}): Promise<TransitPositionResult> {
  const subwayId = subwayIdForOdsayLine(params.lineName);
  const line = subwayId ? subwayLineNameForId(subwayId) : undefined;
  if (!line) return { status: "unsupported" };
  const now = params.now ?? Date.now();
  const positions = await fetchSubwayLinePositions(line, now);
  if (!positions) return { status: "unsupported" };
  const train = positions.trains.find((t) => t.trainNo === params.trainNo);
  if (!train) return { status: "notFound", total: positions.total };
  const received = train.receivedAt ? parseRecptnDt(train.receivedAt) : null;
  return {
    status: "found",
    station: train.station,
    trainStatus: train.trainStatus ?? null,
    dataStamp: train.receivedAt ?? null,
    dataAgeSeconds: received == null ? null : Math.max(0, Math.round((now - received) / 1000)),
  };
}
