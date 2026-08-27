/**
 * 도구 출력 직렬화(spec §4.4·§4.5) — allowlist + 항목 단위 상한.
 *
 * 두 규칙이 이 파일의 존재 이유다:
 * 1. **표에 없는 키는 나가지 않는다.** 좌표(`lat`·`lng`·`coord`·`geometry`·`pathCoords`…)는
 *    어느 표에도 없으므로 이름과 무관하게 구조적으로 배제된다. 화면 상태 객체를 통째로
 *    돌려주면 언젠가 좌표가 섞인다 — 그래서 "빼는 목록"이 아니라 "넣는 목록"이다.
 * 2. **문자열은 어떤 경우에도 자르지 않는다.** 안내 문장은 뒷부분이 잘리면 뜻이 뒤집히고
 *    ("왼쪽으로 가지 말고 오른쪽으로"), 식별자·사유 코드가 잘리면 후속 호출이 죽는다.
 *    상한은 배열 항목을 통째로 빼서만 지킨다.
 */
import { failure, type ToolFailure } from "./types";

/** WebMCP 권장 상한(자). `JSON.stringify` 결과의 `length`(UTF-16 코드 유닛) 기준. */
export const OUTPUT_LIMIT = 1500;

/**
 * allowlist 모양. `true`는 원시값(string·number·boolean·null)만 통과, 객체는 중첩 표,
 * 배열은 `[항목 모양]` 한 원소짜리 튜플이다. 표가 `true`인데 값이 객체·배열이면 버린다 —
 * "primitive라고 적어 둔 자리에 좌표 객체가 흘러드는" 경로를 막는다.
 */
export type Shape = true | { [key: string]: Shape } | [Shape];

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** 표에 있는 키만 남긴 사본. `undefined` 값은 키째 빠진다(JSON에 남지 않는다). */
export function serialize(value: unknown, shape: Shape): unknown {
  if (shape === true) return isPrimitive(value) ? value : undefined;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return undefined;
    const inner = shape[0];
    return value.map((item) => serialize(item, inner)).filter((item) => item !== undefined);
  }
  // 객체 자리의 명시적 null은 보존한다(`plan: null`은 "계획 없음"이라는 정보다 — 키 부재와 다르다).
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const v = serialize((value as Record<string, unknown>)[key], shape[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function measure(value: unknown): number {
  return JSON.stringify(value).length;
}

/**
 * 상한 계획: 줄일 배열 필드를 **순서대로**(각 배열은 뒤 항목부터 뺀다). `path`는 루트 기준 점 경로.
 * - `count`: 잘리면 부모 객체에 `<key>ReturnedCount`·`<key>TotalCount`를 싣는다.
 * - `page`: 페이지형(최상위 `offset`이 있는 출력) — `returnedCount`·`nextOffset`을 갱신한다.
 */
export interface CapPlan {
  arrays: Array<{ path: string; mode: "count" | "page" }>;
}

function resolveParent(
  root: Record<string, unknown>,
  path: string,
): { parent: Record<string, unknown>; key: string } | null {
  const parts = path.split(".");
  const key = parts.pop();
  if (!key) return null;
  let cur: unknown = root;
  for (const p of parts) {
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return null;
  return { parent: cur as Record<string, unknown>, key };
}

/**
 * 항목 단위 상한. 상한 안이면 그대로, 넘으면 계획 순서대로 배열 끝에서 항목을 빼며
 * `truncated:true`와 카운트를 싣는다(메타 필드를 먼저 예약한 뒤 최종 문자열을 다시 잰다).
 * 배열을 다 비워도 넘기면 `unsupported`/`itemTooLarge` 실패 — 정상 데이터에서는 일어나지
 * 않아야 하고, 일어나면 fixture로 잡는다.
 *
 * 입력은 이미 `serialize`를 지난 사본이어야 한다(이 함수는 그 사본을 제자리에서 줄인다).
 */
export function capOutput(
  value: Record<string, unknown>,
  plan: CapPlan,
  limit: number = OUTPUT_LIMIT,
): Record<string, unknown> | ToolFailure {
  if (measure(value) <= limit) return value;
  // 원본 길이를 먼저 잰다(카운트의 분모).
  const totals = new Map<string, number>();
  for (const entry of plan.arrays) {
    const r = resolveParent(value, entry.path);
    if (!r) continue;
    const arr = r.parent[r.key];
    if (Array.isArray(arr)) totals.set(entry.path, arr.length);
  }
  const applyMeta = () => {
    value.truncated = true;
    for (const entry of plan.arrays) {
      const r = resolveParent(value, entry.path);
      if (!r) continue;
      const arr = r.parent[r.key];
      if (!Array.isArray(arr)) continue;
      const total = totals.get(entry.path) ?? arr.length;
      if (arr.length === total) continue;
      if (entry.mode === "page") {
        value.returnedCount = arr.length;
        const offset = typeof value.offset === "number" ? value.offset : 0;
        value.nextOffset = offset + arr.length;
      } else {
        r.parent[`${r.key}ReturnedCount`] = arr.length;
        r.parent[`${r.key}TotalCount`] = total;
      }
    }
  };
  // 메타 공간을 먼저 예약한다 — 예약 없이 항목만 빼면 마지막에 메타를 붙이는 순간 다시 넘는다.
  applyMeta();
  while (measure(value) > limit) {
    let removed = false;
    for (const entry of plan.arrays) {
      const r = resolveParent(value, entry.path);
      if (!r) continue;
      const arr = r.parent[r.key];
      if (Array.isArray(arr) && arr.length > 0) {
        arr.pop();
        removed = true;
        break;
      }
    }
    if (!removed) return failure("unsupported", { detail: "itemTooLarge" });
    applyMeta();
  }
  return value;
}

/**
 * 도구 출력 한 벌 — 직렬화 → 상한 → 문자열. `execute`의 마지막 줄이 이 함수다.
 * 실패 객체(`ok:false`)도 같은 길을 지난다(사유·플래그 키가 allowlist에 있어야 한다 —
 * `FAILURE_SHAPE`를 표에 합쳐 두는 이유).
 */
export function finish(value: unknown, shape: Shape, plan: CapPlan = { arrays: [] }): string {
  const serialized = serialize(value, shape);
  if (typeof serialized !== "object" || serialized === null) {
    return JSON.stringify(failure("unsupported", { detail: "unserializable" }));
  }
  const capped = capOutput(serialized as Record<string, unknown>, plan);
  return JSON.stringify(capped);
}

/** 실패 출력 공통 키(spec §3.0). 도구별 표에 이 표를 합쳐 쓴다. */
export const FAILURE_SHAPE: { [key: string]: Shape } = {
  ok: true,
  reason: true,
  retryable: true,
  userActionRequired: true,
  detail: true,
  retryAfterMs: true,
  field: true,
  candidates: [{ candidateId: true, label: true, address: true }],
  truncated: true,
  returnedCount: true,
  totalCount: true,
  nextOffset: true,
};

/** 도구별 성공 표에 실패 표를 합친다(키 충돌은 성공 표가 이긴다). */
export function withFailure(shape: { [key: string]: Shape }): { [key: string]: Shape } {
  return { ...FAILURE_SHAPE, ...shape };
}

const COORD_QUERY_RE = /[?&](lat|lng|lon|x|y)=/i;
const COORD_PAIR_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;
const COORD_ARRAY_RE = /\[\s*-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\s*\]/;
/** URL 경로 안의 좌표쌍(`/place/37.52,127.12`)은 소수 2자리부터 잡는다 — 지도 URL이 그 정밀도로 좌표를 싣는다. */
const COORD_PATH_RE = /\/-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}/;

/**
 * 직렬화된 도구 출력에 좌표가 섞였는지(테스트·개발 가드). 위반이면 설명, 아니면 null.
 * allowlist가 키 이름을 막는다면 이 함수는 **값 안**에 스민 좌표(URL·문장·숫자 배열)를 잡는다.
 * 소수 3자리 미만의 바탕 쌍·`[1,2]` 같은 순번 배열은 통과한다.
 */
export function assertNoCoordinates(serialized: string): string | null {
  if (COORD_QUERY_RE.test(serialized)) return "coordinate query parameter";
  if (COORD_PAIR_RE.test(serialized)) return "decimal coordinate pair";
  if (COORD_ARRAY_RE.test(serialized)) return "coordinate array";
  if (COORD_PATH_RE.test(serialized)) return "coordinate pair in URL path";
  return null;
}
