"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDistanceBeacon } from "@/hooks/useDistanceBeacon";
import type { BeaconAnnounce } from "@/lib/beacon";

/**
 * 목적지 거리 비콘 UI — disclosure(헤더 버튼)로 접고 펴는 패널 안에
 * 시작/중지 토글 + 단일 polite live region.
 *
 * 펼침 패턴: 형제 컴포넌트(CarRouteBriefing·TransitRouteBriefing 등)와 동일하게
 * 평소엔 버튼 하나만 노출하고, 누르면 안내문·토글·피드백이 인라인으로 펼쳐진다.
 * `<h3>` 안의 `<button aria-expanded aria-controls>`(W3C APG disclosure+heading)로
 * heading 내비 진입점을 유지하면서 펼침 상태를 SR에 알린다 — 오버레이/포커스 트랩
 * 없이 시맨틱 HTML만으로 완결(First Rule of ARIA). 추적은 훅 상태라 패널을 접어도
 * 톤 피드백(useBeaconSound)은 계속된다.
 *
 * 접근성: 연속 피드백은 톤(useBeaconSound), 음성은 추세 flip·50m 마일스톤·도착·권한
 * 거부에서만 polite로 통지(장황한 낭독 회피). 화면 꺼짐·직선거리 한계는 정적 텍스트로
 * 펼친 패널에 노출. geolocation 미지원이면 렌더 안 함(graceful).
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
  const [open, setOpen] = useState(false);
  const { status, announce, supported, toggle } = useDistanceBeacon(
    dest.lat,
    dest.lng,
  );

  if (!supported) return null;

  const tracking = status === "tracking";

  // live region 텍스트: 발화 신호(speak)·권한 거부에서만 텍스트를 내고,
  // hold·비발화 추세는 빈 문자열(톤이 즉시 피드백을 준다).
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
      {/* disclosure 헤더 — 형제 트리거 버튼과 동급(border-accent). heading 안의
          버튼이라 SR 내비 진입점을 유지하면서 aria-expanded로 펼침 상태를 알린다.
          패널은 조건부 렌더라 aria-controls는 닫힘 시 dangling되므로 생략(형제 동형,
          aria-expanded만으로 disclosure 상태 전달 충분 — First Rule of ARIA). */}
      <h3 className="text-base font-semibold">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent"
        >
          {t("heading")}
        </button>
      </h3>

      {open && (
        <div className="mt-2">
          <p className="text-xs text-muted">{t("straightLineNote")}</p>
          <p className="mt-0.5 text-xs text-muted">{t("screenHint")}</p>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={tracking}
            className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            {tracking ? t("stop") : t("start")}
          </button>
          <p aria-live="polite" className="mt-2 min-h-5 text-sm">
            {live}
          </p>
        </div>
      )}
    </section>
  );
}
