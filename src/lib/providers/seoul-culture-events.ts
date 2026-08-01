import { unstable_cache } from "next/cache";
import type { CultureEvent } from "../types";
import { env } from "../env";
import { readSeoulOpenJson } from "./seoul-open-json";

/**
 * 서울 문화행사 provider — `culturalEventInfo`(OA-15486).
 *
 * envelope: `culturalEventInfo.RESULT.CODE` + `.row[]` + `list_total_count`.
 * `response` 래퍼가 없는 **서울 열린데이터형**이라 `datagokr-envelope` 공용
 * 파서를 쓰지 않는다(따릉이와 동형 — "봉투가 다르면 파서도 다르다").
 *
 * 설계상 중요한 실측 두 가지(스펙 §1):
 *
 * 1) **안전한 페이지 절단선이 없다.** 정렬이 시작일 내림차순이라 오늘 진행 중인
 *    행사가 183행부터 18,587행까지 흩어진다(2021-11 시작 장기 전시가 목록 깊숙이).
 *    상위 2,000행만 받으면 진행 중의 91%만 잡혀 **조용한 누락**이 된다.
 *    → 전수 수집 후 코드가 진행 여부를 판정한다.
 *
 * 2) **`DATE` 파라미터를 쓰면 안 된다.** 날짜 필터는 "그날 열리는 행사"가 아니라
 *    `DATE` 문자열 부분일치라, 7월에 시작해 8월에도 하는 행사가 탈락한다.
 *    → 판정은 `STRTDATE`/`END_DATE`로 한다.
 *
 * 좌표와 무관한 "오늘 진행 중" 목록만 캐시한다(거리 계산은 service 몫) —
 * provider가 거리를 계산하면 좌표마다 캐시가 갈라져 캐시가 무의미해진다.
 */

type RawRow = Record<string, unknown>;

/** 거리 이전 단계 — 좌표 의존 필드만 빠진 투영. service가 거리를 채운다. */
export type CultureEventBase = Omit<CultureEvent, "distanceMeters">;

const BASE = "http://openapi.seoul.go.kr:8088";
const PAGE = 1000; // 1회 요청 상한(초과 시 ERROR-336)
const MAX_PAGES = 30; // 안전상한(현재 전체 19,477 = 20페이지)
const CACHE_TTL_SECONDS = 21_600; // 6시간 — 원본은 일 1회 갱신

/** `culturalEventInfo.row[]` 안전 추출. 배열이 아니면 빈 배열. */
export function parseEventRows(raw: unknown): RawRow[] {
  const row = (raw as { culturalEventInfo?: { row?: unknown } })?.culturalEventInfo?.row;
  return Array.isArray(row) ? (row as RawRow[]) : [];
}

/**
 * RESULT.CODE 정책. `INFO-000`=정상, `INFO-200`="해당 데이터 없음"(범위 밖
 * 페이지의 정상 응답 — 실측). 그 외·envelope 부재는 throw해서 "조회 실패"와
 * "행사 없음"을 구분한다(3-state).
 */
function readResultCode(raw: unknown): string | null {
  const d = raw as {
    culturalEventInfo?: { RESULT?: { CODE?: unknown } };
    RESULT?: { CODE?: unknown };
  };
  // 정상 응답은 서비스명 아래, 오류 응답은 최상위에 RESULT가 온다(실측).
  const code = d?.culturalEventInfo?.RESULT?.CODE ?? d?.RESULT?.CODE;
  return code == null ? null : String(code);
}

/** KST 기준 오늘(YYYY-MM-DD). 순수 — nowMs 주입(night-clinic kstDateKey 동형). */
export function kstToday(nowMs: number): string {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${m}-${d}`;
}

/** `"2026-12-24 00:00:00.0"` → `"2026-12-24"`. 형식이 어긋나면 빈 문자열. */
function dateOnly(v: unknown): string {
  const s = v == null ? "" : String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/**
 * `today`(YYYY-MM-DD)에 진행 중인가. 시작일 ≤ 오늘 ≤ 종료일(양끝 포함).
 * 날짜가 결측·비정상이면 false — 판정 불가를 조용히 "진행 중"으로 넣지 않는다.
 */
export function isRunningOn(row: RawRow, today: string): boolean {
  const start = dateOnly(row.STRTDATE);
  const end = dateOnly(row.END_DATE);
  if (!start || !end) return false;
  return start <= today && today <= end;
}

/**
 * 안정 id. `HMPG_ADDR`의 `cultcode`가 정본(실측 244/244 추출·전량 고유),
 * 추출 실패 시 `제목|장소|시작일` 복합키로 폴백한다(이 역시 실측 전량 고유).
 */
export function eventId(row: RawRow): string {
  const home = row.HMPG_ADDR == null ? "" : String(row.HMPG_ADDR);
  const code = /[?&]cultcode=(\d+)/.exec(home)?.[1];
  if (code) return `seoul-${code}`;
  return `${str(row.TITLE)}|${str(row.PLACE)}|${dateOnly(row.STRTDATE)}`;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** 유한 실수 또는 NaN. */
function numF(v: unknown): number {
  const s = str(v);
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * row → 슬림 투영. 좌표가 비유한이거나 제목이 없으면 null(제외).
 * 좌표 없는 행사는 거리순 목록에 자리가 없고, 이름 없는 항목은 스크린 리더에
 * "이름 없는 항목"으로 낭독되므로 애초에 만들지 않는다.
 */
export function toCultureEvent(row: RawRow): CultureEventBase | null {
  const lat = numF(row.LAT);
  const lng = numF(row.LOT);
  const title = str(row.TITLE);
  if (!title || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const isFree = str(row.IS_FREE) === "무료";
  const fee = str(row.USE_FEE);
  const link = str(row.HMPG_ADDR);
  return {
    id: eventId(row),
    title,
    category: str(row.CODENAME),
    place: str(row.PLACE),
    district: str(row.GUNAME),
    dateText: str(row.DATE),
    timeText: str(row.PRO_TIME),
    isFree,
    // 무료면 요금 문구를 싣지 않는다(“무료”가 이미 전부 — 중복 낭독 금지).
    ...(!isFree && fee ? { fee } : {}),
    target: str(row.USE_TRGT),
    ...(link.startsWith("http") ? { link } : {}),
    lat,
    lng,
  };
}

/**
 * 한 페이지 호출 → row 배열 + `list_total_count`. INFO-200(범위 밖 페이지)은 빈 배열.
 *
 * 첫 페이지도 이 함수를 쓴다 — 봉투 정책(HTTP·INFO-200·그 외 코드)을 첫 페이지용으로
 * 한 벌 더 두면 그중 한 벌만 테스트에 걸려 나머지가 조용히 썩는다(변이 주입으로
 * 실제로 드러난 구멍이다).
 */
async function fetchPage(
  start: number,
  end: number,
): Promise<{ rows: RawRow[]; total: number }> {
  const key = env.SEOUL_OPEN_DATA_KEY!;
  // 가공 결과를 unstable_cache로 캐시하므로 원본 페이지는 캐시하지 않는다
  // (1,000행 페이지는 수 MB라 Next 데이터 캐시 한도를 넘겨 조용히 꺼진다).
  const res = await fetch(`${BASE}/${key}/json/culturalEventInfo/${start}/${end}/`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`culturalEventInfo HTTP ${res.status}`);
  // res.json() 직접 호출 금지 — 무효 키는 200 + XML로 와서 원인 없는 SyntaxError가 된다.
  const raw = await readSeoulOpenJson(res, "culturalEventInfo");
  const code = readResultCode(raw);
  if (code === "INFO-200") return { rows: [], total: 0 };
  if (code !== "INFO-000") {
    throw new Error(`culturalEventInfo ${code ?? "RESULT.CODE 없음"}`);
  }
  const total = Number(
    (raw as { culturalEventInfo?: { list_total_count?: unknown } })?.culturalEventInfo
      ?.list_total_count,
  );
  return { rows: parseEventRows(raw), total: Number.isFinite(total) ? total : NaN };
}

/**
 * 전수 수집 → `today` 진행 중만 슬림 투영.
 *
 * 종료 조건은 **받은 row 수 < 요청 크기**다(따릉이 규율). `list_total_count`가
 * 이 서비스에선 진짜 전체 수로 관측됐지만, 서비스마다 "그 페이지 row 수"를
 * 뜻하기도 해 계약으로 삼지 않는다 — 병렬 팬아웃 크기를 정하는 **힌트로만** 쓴다.
 */
export async function fetchRunningEvents(today: string): Promise<CultureEventBase[]> {
  const first = await fetchPage(1, PAGE);
  const rows = [...first.rows];
  // 힌트가 있으면 남은 페이지를 한 번에, 없으면 순차로 이어 받는다.
  const hinted = Number.isFinite(first.total)
    ? Math.min(Math.ceil(first.total / PAGE), MAX_PAGES)
    : 0;
  let page = 1; // 0-based, 0번은 위에서 받음
  let lastFull = first.rows.length === PAGE;
  if (hinted > 1 && lastFull) {
    const batch = await Promise.all(
      Array.from({ length: hinted - 1 }, (_, i) =>
        fetchPage((i + 1) * PAGE + 1, (i + 2) * PAGE),
      ),
    );
    batch.forEach((r) => rows.push(...r.rows));
    page = hinted;
    lastFull = batch[batch.length - 1]?.rows.length === PAGE;
  }
  // 힌트가 틀렸거나 없었으면 여기서 순차로 마저 받는다(계약은 받은 row 수).
  while (lastFull && page < MAX_PAGES) {
    const r = await fetchPage(page * PAGE + 1, (page + 1) * PAGE);
    rows.push(...r.rows);
    page += 1;
    lastFull = r.rows.length === PAGE;
  }
  if (lastFull) {
    // 안전상한에 걸려 뒤가 잘렸다 — 침묵 절단 금지(로그로 관측 가능하게).
    console.warn(`[culturalEventInfo] MAX_PAGES(${MAX_PAGES}) 도달 — 이후 행사 누락 가능`);
  }
  return rows
    .filter((r) => isRunningOn(r, today))
    .map(toCultureEvent)
    .filter((e): e is CultureEventBase => e !== null);
}

/**
 * 오늘(KST) 진행 중인 행사 — 일자별 6시간 캐시.
 *
 * 캐시 키에 날짜를 넣는 이유: 진행 여부는 날짜의 함수라 자정이 지나면 답이
 * 달라진다. revalidate만으로는 경계에서 어제 목록을 최대 6시간 낭독하게 된다.
 * unstable_cache는 예외를 캐시하지 않으므로 일시 장애가 굳지 않는다.
 */
export function loadRunningEvents(nowMs: number = Date.now()): Promise<CultureEventBase[]> {
  if (!env.SEOUL_OPEN_DATA_KEY) return Promise.resolve([]);
  const today = kstToday(nowMs);
  return unstable_cache(() => fetchRunningEvents(today), ["seoul-culture-events", today], {
    revalidate: CACHE_TTL_SECONDS,
  })();
}
