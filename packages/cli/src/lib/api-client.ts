import { readConfig } from "./config.js";
import { ExitCode, exitCodeForStatus } from "./exit-codes.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly exitCode: ExitCode,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const cfg = await readConfig();
  const url = new URL(path, cfg.apiUrl);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    throw new ApiError(`서버에 연결할 수 없습니다: ${msg}`, 0, ExitCode.Network);
  }

  const text = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed && typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `요청 실패 (HTTP ${response.status})`;
    throw new ApiError(message, response.status, exitCodeForStatus(response.status), parsed);
  }
  return parsed as T;
}

/** 서버 커버리지 마커 감지 — 한국 밖 좌표는 HTTP 200 + `{outOfCoverage:true}` 정상 응답이다(오류 아님). */
export function isOutOfCoverage(body: unknown): boolean {
  return typeof body === "object" && body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}

export const OUT_OF_COVERAGE_NOTICE =
  "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";

/**
 * 서비스 지역 미제공 마커 감지 — 한국 **안**이지만 그 도메인 데이터가 그 지역에
 * 없을 때(따릉이·문화행사 = 서울 전용). HTTP 200 정상 응답이고 오류가 아니다.
 *
 * ⚠ 빈 결과로 흡수하지 말 것: "지금 근처에 없다"와 "이 지역엔 서비스가 없다"는
 * 사용자의 다음 행동이 다르다.
 */
export function isUnavailableHere(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { unavailableHere?: unknown }).unavailableHere === "seoulOnly"
  );
}

/** 웹 `common.unavailableHere`와 같은 문구를 유지한다(같은 사실을 두 표현으로 말하지 않는다). */
export const UNAVAILABLE_HERE_NOTICE = "서울 지역에서만 제공됩니다.";
