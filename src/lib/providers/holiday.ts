import { env } from "../env";

/**
 * 특일정보(공공데이터 15012690) — serviceDate 공휴일 판정.
 * 게이트형: 키 없음·미신청(403)·파싱 실패 전부 null(판정 불가 → 호출부 요일 폴백).
 * UI가 항상 기준 라벨을 명시하므로 폴백이 오도를 만들지 않는다(스펙 §1-A-3).
 */
export async function fetchIsHoliday(dateYYYYMMDD: string): Promise<boolean | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const year = dateYYYYMMDD.slice(0, 4);
  const month = dateYYYYMMDD.slice(4, 6);
  const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${month}&_type=json&numOfRows=50`;
  try {
    const res = await fetch(url, { next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    // HTTP 200이어도 에러 envelope(자격 미신청·파라미터 오류 등)일 수 있어
    // resultCode를 먼저 확인한다 — "00"(정상) 아니면 판정 불가(null → 요일 폴백).
    const header = (raw as { response?: { header?: { resultCode?: unknown } } })?.response?.header;
    const resultCode = header?.resultCode == null ? "" : String(header.resultCode);
    if (resultCode !== "00") return null;
    const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
    if (items == null || items === "") return false; // 그 달 공휴일 없음 — 정상 판정
    const item = (items as { item?: unknown }).item;
    const list = Array.isArray(item) ? item : item != null ? [item] : [];
    return list.some((it) => {
      const o = it as { locdate?: unknown; isHoliday?: unknown };
      return String(o.locdate ?? "") === dateYYYYMMDD && String(o.isHoliday ?? "") === "Y";
    });
  } catch {
    return null;
  }
}
