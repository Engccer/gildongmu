/**
 * nearby 계열 단일 polite live region 문자열 — 8종에 반복되던 삼항 사다리의 정본.
 * React 비의존 순수 함수(node 단위 테스트 대상). done 문구만 도메인이 주입한다:
 * 기본은 t("ready"), BusArrivals·WhereAmI는 () => ""(헤딩 포커스가 통지 담당),
 * WalkInfra는 두 소스 독립 강등 합성.
 */
import type { UnavailableHereReason } from "./out-of-coverage";

type Translator = (key: string, params?: Record<string, string | number | Date>) => string;

export type NearbyLiveStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "unavailableHere"; reason: UnavailableHereReason }
  | { kind: "done" };

/**
 * 이 함수가 **도메인 네임스페이스에서** 읽는 키 전수(`t(...)` 인자).
 *
 * 문구 게이트(`manual-location-copy.test.ts`)가 이 목록을 쓴다. 키가 `t`를 인자로
 * 받는 이 함수 안에 살기 때문에 소비 컴포넌트에는 **리터럴이 하나도 없고**, 리터럴만
 * 훑는 스캔은 `subwayNearby.locating` 계열 30여 키를 통째로 놓친다 — 지금 새는 것이
 * 없더라도 **커버리지가 실제보다 넓어 보이는** 것이 문제다(백로그 D20①).
 *
 * ⚠ 분기를 추가하면 여기에도 적는다. 목록이 낡으면 가드가 조용히 좁아진다.
 */
export const NEARBY_LIVE_DOMAIN_KEYS = [
  "locating",
  "loading",
  "empty",
  "error",
  "geoDenied",
  "geoUnsupported",
  "ready",
] as const;

export function nearbyLiveMessage(
  status: NearbyLiveStatus,
  t: Translator,
  tCommon: Translator,
  doneMessage?: () => string,
): string {
  switch (status.kind) {
    case "locating":
      return t("locating");
    case "loading":
      return t("loading");
    case "empty":
      return t("empty");
    case "error":
      return t("error");
    case "geoerror":
      return status.reason === "denied" ? t("geoDenied") : t("geoUnsupported");
    case "outOfCoverage":
      return tCommon("outOfCoverage");
    // 서비스 지역 미제공. 어느 서비스인지는 사용자가 방금 누른 버튼이 이미 말하므로
    // 도메인 이름을 문구에 넣지 않는다(자명한 것을 다시 설명하지 않는다). 다만 **사유는
    // 도메인이 아니라 사실이 다르다**: "서울에만 있는 서비스"와 "이 지역 데이터 없음"은
    // 사용자가 할 수 있는 일이 다르므로 한 문장으로 뭉개지 않는다.
    case "unavailableHere":
      return tCommon(`unavailableHere.${status.reason}`);
    case "done":
      return doneMessage ? doneMessage() : t("ready");
    default:
      return "";
  }
}
