/**
 * 접근 가능한 이름 근사(spec §3.2 — 프로브 `activeElementLabel` 승격).
 *
 * 계산 순서는 `aria-label` → `aria-labelledby`가 가리키는 요소들의 텍스트 → `textContent`.
 * 정식 접근성 이름 계산(accname 사양)의 축약판이다 — 도구가 돌려주는 라벨은 에이전트의
 * 확인용이지 스크린 리더 낭독의 정본이 아니다(낭독은 요소 자신이 한다, spec §6.4).
 *
 * ⚠ 이것은 **키보드 포커스**의 이름이지 VoiceOver 탐색 커서가 아니다(spec §6.7). 페이지는
 * VO 커서 위치를 읽을 수 없다.
 */
export function accessibleName(el: Element | null): string | null {
  if (!el) return null;
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  // `<input>`은 textContent가 비어 있다 — 연결된 `<label for>`가 이름이다.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const labels = el.labels;
    if (labels && labels.length > 0) {
      const text = Array.from(labels)
        .map((l) => l.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
  }
  const text = el.textContent?.trim();
  return text || null;
}

/** 현재 키보드 포커스 요소의 이름. body/documentElement/없음이면 null. */
export function activeElementLabel(doc: Document = document): string | null {
  const active = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) return null;
  return accessibleName(active);
}
