/**
 * next-intl 목 — 대중교통 폴 루프(`useTransitGuide`)를 마운트하는 컴포넌트 테스트 공용. 사용:
 *
 * ```ts
 * vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));
 * vi.mock("next-intl", async () => {
 *   const m = await import("./stable-intl-mock");
 *   return m.stableIntlMock("ko", m.keyOnly);
 * });
 * ```
 *
 * 기본 형식은 `"{ns}.{key}"`, 인자가 있으면 `"{ns}.{key}:{값,값}"`. 로케일은 테스트마다 바꿀 수 있게 게터도 받는다.
 * `t.rich`·`markup`·`raw`는 `t`와 같고 `t.has`는 참이다.
 *
 * ⚠ **`t`는 네임스페이스마다 안정 정체성이어야 한다**(실제 next-intl이 `useMemo`로 그렇게 한다). 렌더마다 새 `t`를
 * 주는 목에서는 `t`에 의존하는 콜백·effect가 매 렌더 다시 만들어져 프로덕션과 다른 타이밍으로 돈다 — 폴 루프가
 * 가짜 시계 1.5초에 1만 폴을 내며 "시계를 한꺼번에 넘기면 폴이 한 번만 풀린다"는 실제 시간 축을 가려, 틀린
 * 테스트가 초록으로 남았다. 폴 루프를 마운트하는 테스트가 이 목을 쓰는지는 `TransitGuidePanel.test.tsx`의 소스 가드가 본다.
 */
type Translator = (key: string, args?: Record<string, unknown>) => string;
type Format = (ns: string, key: string, args?: Record<string, unknown>) => string;

const nsKey: Format = (ns, key, args) =>
  args ? `${ns}.${key}:${Object.values(args).join(",")}` : `${ns}.${key}`;

/** 키만 돌려준다(네임스페이스 없음). */
export const keyOnly: Format = (_ns, key) => key;

/** 키만, `name` 인자가 있으면 `"{key}:{name}"` — 같은 키를 이름만 달리 쓰는 버튼을 구분한다. */
export const keyWithName: Format = (_ns, key, args) =>
  args && "name" in args ? `${key}:${String(args.name)}` : key;

export function stableIntlMock(locale: string | (() => string), format: Format = nsKey) {
  const byNamespace = new Map<string, Translator>();
  return {
    useTranslations: (ns: string): Translator => {
      let t = byNamespace.get(ns);
      if (!t) {
        const base: Translator = (key, args) => format(ns, key, args);
        t = Object.assign(base, { rich: base, markup: base, raw: base, has: () => true });
        byNamespace.set(ns, t);
      }
      return t;
    },
    useLocale: () => (typeof locale === "function" ? locale() : locale),
  };
}
