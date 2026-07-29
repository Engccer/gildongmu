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
