import { env } from "../env";

/**
 * ODsay HTTP 호출 한 곳(길찾기 `odsay.ts`·급행 정차역 `odsay-express-stops.ts` 공용).
 *
 * ⚠ apiKey는 이미 URL 인코딩된 값일 수 있어 재인코딩하면 깨진다 → URLSearchParams로 인코딩하지 말고
 *   raw로 쿼리에 붙인다.
 * ⚠ URI(도메인) 전용 키라 Referer가 인증이다 — 콘솔에 등록된 도메인과 일치해야 한다. Vercel 서버리스는
 *   egress IP가 가변이라 Server(IP) 방식이 프로덕션에서 인증 실패한다(dev/prod 동일 경로).
 * ⚠ 무효 키·쿼터 소진(429)도 HTTP 200 + `error` 봉투로 온다 — 상태 코드로 인증 실패를 가를 수 없다.
 *   봉투 판독은 호출자가 `readOdsayError`로 한다.
 */
export const ODSAY_REFERER = "https://gildongmu.vercel.app/";

export async function fetchOdsayJson<T>(
  endpoint: string,
  params: URLSearchParams,
  opts: { revalidate: number } | { revalidate: false; timeoutMs?: number },
): Promise<T> {
  const url = `https://api.odsay.com/v1/api/${endpoint}?${params.toString()}&apiKey=${env.ODSAY_API_KEY ?? ""}`;
  const res = await fetch(url, {
    headers: { Referer: ODSAY_REFERER },
    ...(opts.revalidate === false
      ? {
          cache: "no-store" as const,
          ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
        }
      : { next: { revalidate: opts.revalidate } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODsay ${endpoint} 실패: HTTP ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}
