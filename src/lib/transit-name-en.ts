/**
 * ODsay `lang=1` 영문 정류소·역명의 표시 정규화(E27 §3.2, 순수).
 *
 * 위원장 판정: 구분자·약어만 손댄다. 음차·오타는 데이터 현실이라 건드리지 않는다.
 * 관측(2026-08-31, 636개 이름): 복합명 구분자가 `. `/` & `/`, ` 혼재, `Station`/`Stn.` 혼용,
 * `ㆍ` 잔존, 겹친 마침표(`Apt.. `).
 *
 * 규칙 순서가 계약이고 결과는 멱등이다. 불확실한 `. `(약어·이니셜·숫자 뒤)는 보기 좋은
 * 오답보다 원문 보존을 택한다(설계 리뷰 #13). 서버 투영 시 한 번만 적용한다 — 클라이언트는
 * 재정규화하지 않는다.
 */

/** `. `를 구분자로 읽지 않는 앞 토큰(약어). 마침표 없이 비교한다. */
const ABBREVIATIONS = new Set([
  "apt", "univ", "nat'l", "edu", "st", "mt", "jr", "sr", "dr", "co", "dept", "elem", "bldg",
  "ave", "rd", "blvd", "ctr", "hosp", "no", "gen", "bros", "inc", "ltd", "ii", "iii",
]);

/** 앞 토큰이 약어·대문자 이니셜·숫자면 `. `는 구분자가 아니다(원문 보존). */
function isAbbreviationToken(token: string): boolean {
  const t = token.toLowerCase();
  if (ABBREVIATIONS.has(t)) return true;
  if (/^[A-Z]$/.test(token) || token.includes(".")) return true; // J. Kim · U.S. Army(토큰 안 마침표)
  if (/^\d+$/.test(token)) return true; // Complex 3. 4
  return false;
}

export function normalizeTransitNameEn(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/[ㆍ·､]/g, ", ");
  s = s.replace(/\.{2,}/g, ".");
  s = s.replace(/\bStn\./g, "Station");
  // `. ` 구분자 — 앞 토큰(공백 없는 직전 낱말)이 약어류가 아닐 때만 쉼표.
  s = s.replace(/(\S+)\. (?=\S)/g, (whole, token: string) =>
    isAbbreviationToken(token) ? whole : `${token}, `,
  );
  s = s.replace(/\s+/g, " ");
  s = s.replace(/(?:,\s*){2,}/g, ", ");
  s = s.replace(/^,\s*|\s*,$/g, "");
  return s.trim();
}

/** 표시 가능한 영문인가 — 비어 있지 않고 한글이 없어야 `*En` 자격이 있다(설계 리뷰 #12). */
export function isDisplayableEnglish(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[가-힣]/.test(value);
}

/** 정규화 + 자격 검사 — 자격 미달은 undefined(필드 부재). */
export function toDisplayEnglish(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = normalizeTransitNameEn(raw);
  return isDisplayableEnglish(s) ? s : undefined;
}
