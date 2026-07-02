// Accept-Language 헤더에 지원 로케일이 하나라도 있는지 판정한다.
// false면 proxy.ts가 협상 실패로 보고 en 폴백을 적용한다(미지원 언어
// 브라우저가 defaultLocale ko로 떨어지는 것 방지 — 1급 사용자인
// "한국어를 모르는 외국인" 정합). 헤더 없음·와일드카드(*)는 언어 신호가
// 아니므로 true(기본 협상 경로 유지).
export function hasSupportedLanguage(
  header: string | null,
  locales: readonly string[],
): boolean {
  if (!header || !header.trim()) return true;

  for (const part of header.split(",")) {
    const [tag, ...params] = part.trim().split(";");
    const lang = tag.trim().toLowerCase();
    if (!lang) continue;

    // q=0은 명시적 거부(RFC 9110)
    const qParam = params
      .map((p) => p.trim())
      .find((p) => p.startsWith("q="));
    if (qParam && Number.parseFloat(qParam.slice(2)) === 0) continue;

    if (lang === "*") return true;
    if (locales.includes(lang.split("-")[0])) return true;
  }
  return false;
}
