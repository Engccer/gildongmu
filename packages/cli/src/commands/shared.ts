import {
  apiRequest,
  ApiError,
  isOutOfCoverage,
  unavailableHereReason,
  OUT_OF_COVERAGE_NOTICE,
  unavailableHereNotice,
} from "../lib/api-client.js";
import { readConfig } from "../lib/config.js";
import { ENDPOINT_CATALOG } from "../lib/endpoint-catalog-shared.js";
import { FORMATTERS } from "../lib/formatters.js";
import { emit, fail, resolveOutputMode } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";

/** 모든 명령이 공유하는 위치·출력 citty 인자 정의(필요분만 spread해 쓴다). */
export const sharedArgs = {
  near: { type: "string" as const, description: "기준 위치(장소명·주소, 지오코딩됨)" },
  lat: { type: "string" as const, description: "위도(WGS84)" },
  lng: { type: "string" as const, description: "경도(WGS84)" },
  lang: { type: "string" as const, description: "ko|en (기본 ko)" },
  output: { type: "string" as const, description: "text|json (기본: TTY면 text)" },
};

/** 카탈로그 이름 → REST 경로 조회(없으면 throw) — runEndpoint와 합성 명령(station info)이 공유. */
export function catalogPath(name: string): string {
  const spec = ENDPOINT_CATALOG.find((e) => e.name === name);
  if (!spec) throw new Error(`카탈로그에 없는 엔드포인트: ${name}`);
  return spec.path;
}

/** 카탈로그 항목 하나를 실행해 출력까지 마친다 — 단순 명령(길찾기 제외)의 공통 경로. */
export async function runEndpoint(
  name: string,
  query: Record<string, string | undefined>,
  outputFlag?: string,
): Promise<void> {
  const path = catalogPath(name);
  const cfg = await readConfig();
  try {
    const data = await apiRequest<Record<string, unknown>>(path, { query });
    const mode = resolveOutputMode(outputFlag, cfg);
    if (isOutOfCoverage(data)) {
      emit(data, [OUT_OF_COVERAGE_NOTICE], mode);
      return;
    }
    // 서비스 지역 미제공(서울 전용 도메인) — 포매터로 내려보내면 빈 목록이 되어
    // "근처에 없음"과 구분이 사라진다.
    const unavailable = unavailableHereReason(data);
    if (unavailable) {
      emit(data, [unavailableHereNotice(unavailable)], mode);
      return;
    }
    const formatter = FORMATTERS[name];
    emit(data, formatter ? formatter(data as never) : [JSON.stringify(data)], mode);
  } catch (err) {
    if (err instanceof ApiError) fail(err.message, err.exitCode);
    fail(err instanceof Error ? err.message : String(err), ExitCode.Error);
  }
}
