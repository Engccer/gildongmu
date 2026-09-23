/**
 * 대중교통 안내 패널 테스트용 next-intl 목. 사용:
 *
 * ```ts
 * vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));
 * ```
 *
 * `t`는 `"{ns}.{key}"`, 인자가 있으면 `"{ns}.{key}:{값,값}"`을 돌려준다.
 *
 * ⚠ **`t`는 네임스페이스마다 안정 정체성이어야 한다**(실제 next-intl이 `useMemo`로 그렇게 한다).
 * `useTransitGuide`의 폴 예약은 `useEffect(…, [pollTick, pollOnce])`이고 `pollOnce`는 `t`에 의존한다 —
 * 렌더마다 새 `t`를 돌려주는 목이면 렌더마다 폴이 다시 나가 가짜 시계 1.5초에 1만 폴이 넘게 폭주한다.
 * 그 폭주가 "시계를 한꺼번에 넘기면 폴이 한 번만 풀린다"는 실제 시간 축을 가려, 틀린 테스트가
 * 초록으로 남았다. 인라인 목은 `TransitGuidePanel.test.tsx`의 소스 가드가 막는다.
 */
type Translator = (key: string, args?: Record<string, unknown>) => string;

export function stableIntlMock(locale: string) {
  const byNamespace = new Map<string, Translator>();
  return {
    useTranslations: (ns: string): Translator => {
      let t = byNamespace.get(ns);
      if (!t) {
        t = (key, args) => (args ? `${ns}.${key}:${Object.values(args).join(",")}` : `${ns}.${key}`);
        byNamespace.set(ns, t);
      }
      return t;
    },
    useLocale: () => locale,
  };
}
