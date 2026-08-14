/**
 * A/B 하네스 전용 next/cache 스텁 — 실호출 A/B는 Next 런타임 밖에서 돈다.
 * 캐시를 통과시키기만 하므로 provider는 매번 실호출한다(모델 비교에 캐시 은닉 금지).
 */
export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  _keys?: string[],
  _opts?: { revalidate?: number },
): T {
  return fn;
}
