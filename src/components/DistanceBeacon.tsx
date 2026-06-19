"use client";

import { useTranslations } from "next-intl";
import { useDistanceBeacon } from "@/hooks/useDistanceBeacon";
import type { BeaconAnnounce } from "@/lib/beacon";

/**
 * 목적지 거리 비콘 UI — 시작/중지 토글 + 단일 polite live region.
 *
 * 접근성: 연속 피드백은 톤(useBeaconSound), 음성은 추세 flip·50m 마일스톤·도착·권한
 * 거부에서만 polite로 통지(장황한 낭독 회피). 화면 꺼짐·직선거리 한계는 정적 텍스트로
 * 항상 노출. geolocation 미지원이면 렌더 안 함(graceful).
 *
 * live region: set-state-in-effect 회피를 위해 렌더 중 status·announce에서
 * 직접 파생한다. speak=true·denied·weak에서만 텍스트를 내고 나머지(hold·비발화)는
 * 빈 문자열 — 톤이 즉시 피드백을 주므로 음성 통지 없어도 무방하다.
 */

/** announce에서 live region 텍스트를 파생하는 순수 함수. */
function buildLiveText(
  kind: BeaconAnnounce["kind"],
  meters: number,
  t: ReturnType<typeof useTranslations<"beacon">>,
): string {
  if (kind === "first") return t("first", { meters });
  if (kind === "closer") return t("closer", { meters });
  if (kind === "farther") return t("farther", { meters });
  if (kind === "nearby") return t("nearby", { meters });
  if (kind === "weak") return t("weak");
  return "";
}

export function DistanceBeacon({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("beacon");
  const { status, announce, supported, toggle } = useDistanceBeacon(
    dest.lat,
    dest.lng,
  );

  if (!supported) return null;

  const tracking = status === "tracking";

  // live region 텍스트: 발화 신호(speak)·권한 거부에서만 텍스트를 내고,
  // hold·비발화 추세는 빈 문자열(tonick이 즉시 피드백을 준다).
  let live = "";
  if (status === "denied") {
    live = t("denied");
  } else if (announce?.speak) {
    const meters = Math.round(
      announce.kind === "nearby" ? announce.accuracy : announce.distance,
    );
    live = buildLiveText(announce.kind, meters, t);
  } else if (announce?.kind === "weak") {
    live = t("weak");
  }

  return (
    <section className="mt-4">
      <h3 className="text-base font-semibold">{t("heading")}</h3>
      <p className="mt-1 text-xs text-muted">{t("straightLineNote")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("screenHint")}</p>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={tracking}
        className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-white"
      >
        {tracking ? t("stop") : t("start")}
      </button>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {live}
      </p>
    </section>
  );
}
