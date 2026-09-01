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
  output: { type: "string" as const, description: "text|json (기본: TTY면 text)" },
};

/**
 * 응답 언어 인자 — `sharedArgs`가 아니라 **서버가 실제로 `lang`을 받는 명령에만** spread한다.
 * 전 명령에 blanket으로 붙이면 `--help`가 따릉이·혼잡도에도 `--lang en`을 광고하는데
 * 그 라우트는 lang을 모르므로 조용히 한국어를 돌려준다(광고된 옵트인의 침묵 무시).
 *
 * 뜻은 **서버 응답 데이터·안내 문장의 언어**이지 CLI 자체 표기의 언어가 아니다 —
 * 산문 포매터의 라벨·조사는 한국어 고정이라 `--lang en`은 ①서버가 쓴 문장(도보·자동차
 * 안내)과 ②`*En` additive 필드(json)를 바꾼다. 텍스트 모드의 대중교통·역 조회 라벨은
 * 그대로다(포매터 i18n은 별개 마일스톤 — docs/BACKLOG.md E26 잔여).
 */
export const langArgs = {
  lang: { type: "string" as const, description: "ko|en (기본 ko) — 서버 응답 데이터·안내 문장의 언어. 그 외 값은 서버가 400으로 거절(chat은 지원 6로케일)" },
};

/** 카탈로그 이름 → 스펙 조회(없으면 throw) — 경로·파라미터 질의의 단일 진입점. */
function catalogSpec(name: string) {
  const spec = ENDPOINT_CATALOG.find((e) => e.name === name);
  if (!spec) throw new Error(`카탈로그에 없는 엔드포인트: ${name}`);
  return spec;
}

/** 카탈로그 이름 → REST 경로 조회 — runEndpoint와 합성 명령(station info)이 공유. */
export function catalogPath(name: string): string {
  return catalogSpec(name).path;
}

/**
 * 그 엔드포인트가 `lang`을 받는가 — 카탈로그가 정본이라 명령 쪽 하드코딩 목록이 없다.
 * 인자 선언(`langArgs` spread 여부)과 전달 판정이 같은 술어를 쓰므로 둘이 어긋날 수 없다.
 */
export function catalogSupportsLang(name: string): boolean {
  return catalogSpec(name).params.some((p) => p.key === "lang");
}

/**
 * 카탈로그 항목 하나를 실행해 출력까지 마친다 — 단순 명령(길찾기 제외)의 공통 경로.
 *
 * ⚠ `lang`은 **기본값 없는 필수 인자**다. 생략을 허용하면 `--lang en`을 받은 명령이
 * 인자 하나를 빠뜨린 채 조용히 컴파일되고, 사용자는 영어를 요청하고도 한국어 응답을
 * 받는다(오류도 빈 결과도 아니라 반증 채널이 없다). lang을 못 쓰는 명령은
 * `undefined`를 **명시**한다.
 *
 * 값은 정규화하지 않고 그대로 싣는다 — "EN"·"eng" 같은 오타는 라우트가 400으로 거절해야
 * 하고, CLI가 ko로 접으면 그 오타가 조용한 한국어 강등이 된다(`--accessible` 동형).
 */
export async function runEndpoint(
  name: string,
  query: Record<string, string | undefined>,
  outputFlag: string | undefined,
  lang: string | undefined,
): Promise<void> {
  const path = catalogPath(name);
  if (lang !== undefined && catalogSupportsLang(name)) query = { ...query, lang };
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
    emit(data, formatter ? formatter(data as never, { lang }) : [JSON.stringify(data)], mode);
  } catch (err) {
    if (err instanceof ApiError) fail(err.message, err.exitCode);
    fail(err instanceof Error ? err.message : String(err), ExitCode.Error);
  }
}
