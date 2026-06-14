/**
 * 언어 전환 링크용 — next-intl usePathname()(로케일 프리픽스 제거된 경로)에
 * 현재 location.search를 결합한다. Link의 locale prop이 프리픽스를 붙이므로
 * 여기서는 경로+쿼리만 만든다.
 */
export function withQuery(pathname: string, search: string): string {
  if (!search) return pathname;
  const normalized = search.startsWith("?") ? search : `?${search}`;
  return `${pathname}${normalized}`;
}
