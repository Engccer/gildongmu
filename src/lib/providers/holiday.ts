import { env } from "../env";
import { fetchDataGoKrJson, readItems, readResultCode } from "./datagokr-envelope";

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
  // ⚠ https 필수: http는 연결만 되고 응답이 오지 않는다(read ETIMEDOUT hang,
  // 같은 요청이 https로는 0.07초. 실측 2026-08-04).
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${month}&_type=json&numOfRows=50`;
  try {
    // 게이트형이라 이 try가 모든 실패(HTTP·XML·게이트웨이)를 null로 흡수한다.
    const raw = await fetchDataGoKrJson(url, "특일정보", {
      next: { revalidate: 86_400 },
      // hang 이중 방어(https 전환과 별개). 게이트형이라 타임아웃도 null로 흡수되고
      // 호출부는 요일 폴백으로 내려간다.
      signal: AbortSignal.timeout(10_000),
    });
    // HTTP 200이어도 에러 envelope(자격 미신청·파라미터 오류 등)일 수 있어
    // resultCode를 먼저 확인한다 — "00"(정상) 아니면 판정 불가(null → 요일 폴백).
    if (readResultCode(raw) !== "00") return null;
    // 빈 목록은 "그 달 공휴일 없음"이라는 정상 판정이지 판정 불가가 아니다.
    return readItems(raw).some(
      (o) =>
        String(o.locdate ?? "") === dateYYYYMMDD && String(o.isHoliday ?? "") === "Y",
    );
  } catch {
    return null;
  }
}
