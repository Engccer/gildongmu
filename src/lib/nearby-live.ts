/**
 * nearby 계열 단일 polite live region 문자열 — 8종에 반복되던 삼항 사다리의 정본.
 * React 비의존 순수 함수(node 단위 테스트 대상). done 문구만 도메인이 주입한다:
 * 기본은 t("ready"), BusArrivals·WhereAmI는 () => ""(헤딩 포커스가 통지 담당),
 * WalkInfra는 두 소스 독립 강등 합성.
 */
type Translator = (key: string, params?: Record<string, string | number | Date>) => string;

export type NearbyLiveStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "unavailableHere" }
  | { kind: "done" };

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
    // 도메인별 문구를 두지 않는다(자명한 것을 다시 설명하지 않는다).
    case "unavailableHere":
      return tCommon("unavailableHere");
    case "done":
      return doneMessage ? doneMessage() : t("ready");
    default:
      return "";
  }
}
