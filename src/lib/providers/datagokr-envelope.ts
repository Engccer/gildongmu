/**
 * data.go.kr 표준 envelope 공용 파서 — **모양만** 다룬다.
 *
 * 설계 정본: `docs/superpowers/specs/2026-08-01-datagokr-envelope-design.md`
 *
 * 이 모듈이 흡수하는 것은 "응답이 어떤 모양으로 오는가"이고, 흡수하지 **않는**
 * 것은 "그 값을 어떻게 판정하는가"다. 정상 resultCode가 `"00"`인지 `"0"`인지
 * `"0000"`인지, NODATA를 통과시킬지, 비정상일 때 throw인지 null인지는 서비스마다
 * 진짜로 다른 **정책**이라 각 provider에 남는다. 정책까지 여기 모으면 인자가
 * `okCodes: string[]` 같은 분기 주머니로 자라고, 그러면 중복을 없앤 자리에 조건
 * 분기 더미가 들어설 뿐이다(스펙 §2).
 *
 * ⚠ 봉투가 다르면 파서도 다르다. TOPIS(`msgHeader`/`msgBody`)·서울 지하철 실시간
 *   (`errorMessage.code`)·서울 열린데이터(`<서비스명>.row`)는 `response` 래퍼가
 *   아예 없어 이 모듈의 대상이 아니다(스펙 §2-3). 여기에 넣지 말 것.
 */

type RawItem = Record<string, unknown>;

/** 배열·null을 제외한 순수 객체 판정. 항목은 레코드여야 한다. */
function isRecord(v: unknown): v is RawItem {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `response.body.items`에서 항목 배열을 안전 추출한다. 모양 5종을 흡수:
 *
 * | 입력 | 결과 |
 * |---|---|
 * | `items` 부재·null | `[]` |
 * | `items` 문자열(빈 결과 표기 `""`) | `[]` |
 * | `items` 자체가 배열 | 그 배열 (에어코리아 B552584 실측 2026-06-17) |
 * | `items.item` 배열 | 그 배열 (표준) |
 * | `items.item` 단일 객체 (1건 응답) | `[item]` |
 *
 * 레코드가 아닌 원소는 버린다. 하류 파서가 전부 `Record`로 읽으므로 원시값을
 * 감싸면 모든 필드가 `undefined`인 유령 항목이 되는데, 그건 화면에서 빈 칸이
 * 아니라 **이름 없는 항목**으로 낭독된다.
 */
export function readItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (items == null || typeof items === "string") return [];
  if (Array.isArray(items)) return items.filter(isRecord);
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item.filter(isRecord);
  return isRecord(item) ? [item] : [];
}

/** `response.header.resultCode`. 부재 시 null(= 표준 envelope가 아님). */
export function readResultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })?.response
    ?.header?.resultCode;
  return c == null ? null : String(c);
}

/** `response.header.resultMsg`. 오류 메시지에 사유를 싣는 용도. */
export function readResultMsg(raw: unknown): string | null {
  const m = (raw as { response?: { header?: { resultMsg?: unknown } } })?.response
    ?.header?.resultMsg;
  return m == null ? null : String(m);
}

/**
 * `response.body.totalCount`를 정수로 읽는다(없으면 0).
 *
 * ⚠ 추출 헬퍼일 뿐 신뢰 보증이 아니다. data.go.kr 계열엔 이 값이 전체 건수가
 *   아니라 "그 페이지 row 수"인 API가 있다(CLAUDE.md 횡단 함정). 페이지네이션
 *   종료 조건으로 쓸지는 각 provider가 실호출로 확인하고 정한다.
 */
export function readTotalCount(raw: unknown): number {
  const tc = (raw as { response?: { body?: { totalCount?: unknown } } })?.response
    ?.body?.totalCount;
  const n = Number(tc);
  return Number.isFinite(n) ? n : 0;
}

/**
 * data.go.kr 한 오퍼레이션을 호출해 파싱된 JSON을 돌려준다. **resultCode는 보지
 * 않는다** — 정책이라 호출부 몫이다(위 모듈 주석).
 *
 * 여기 있는 넷은 전 계열 공통이라 정책이 아니다:
 * 1. HTTP 실패 → throw. 본문 앞부분을 함께 실어 원인을 남긴다.
 * 2. `res.json()` 대신 `text()` + `JSON.parse` — **키 만료·미신청 시 `_type=json`
 *    이어도 HTTP 200 + XML 본문이 온다.** `res.json()`은 이걸 `Unexpected token '<'`
 *    라는 원인 없는 SyntaxError로 바꿔 버려, 키를 먼저 의심해야 할 상황에서
 *    코드를 뒤지게 만든다([[deepgram-prod-key-401]] 계열 사고).
 * 3. 게이트웨이 인증 에러 `OpenAPI_ServiceResponse` → throw. 서비스 응답이 아니라
 *    `response.header`가 없어, 미검출 시 "resultCode null"로 위장된다.
 * 4. 위 셋을 통과한 raw 반환.
 *
 * `init`은 호출부가 준다 — 캐시 정책(실시간 `no-store` vs 준정적 `revalidate`)은
 * 도메인 지식이라 공용화 대상이 아니다.
 */
export async function fetchDataGoKrJson(
  url: URL | string,
  label: string,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const tail = body ? ` ${body.slice(0, 200)}` : "";
    throw new Error(`${label} 조회 실패: HTTP ${res.status}${tail}`);
  }

  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${label} 비정상 응답(XML?): ${text.slice(0, 200)}`);
  }

  const gateway = (raw as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: RawItem } })
    ?.OpenAPI_ServiceResponse;
  if (gateway) {
    const h = gateway.cmmMsgHeader ?? {};
    const detail = h.returnAuthMsg ?? h.returnReasonCode ?? text.slice(0, 200);
    throw new Error(`${label} 서비스 에러(인증?): ${detail}`);
  }
  return raw;
}
