"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouteGuide } from "@/hooks/useRouteGuide";

/**
 * 실시간 길 안내 UI — disclosure(헤더 버튼)로 접고 펴는 패널 안에 시작/중지 토글 +
 * 안내 컨트롤 + 단일 polite live region.
 *
 * 안내 방식은 두 가지다(스펙 2026-08-03 §3): 간략 안내(직선거리·추세 톤, 전 수단에서
 * 참)와 상세 안내(도보 경로 추종, 경로 위에서만 참). 시작하면 상세 적격이면 상세로,
 * 아니면 간략으로 열리고 통지가 어느 쪽인지 말한다. 판정·조립은 전부 useRouteGuide에
 * 있고 여기는 렌더와 컨트롤 배치만 한다.
 *
 * 펼침 패턴: 형제 컴포넌트(CarRouteBriefing·TransitRouteBriefing 등)와 동일하게
 * 평소엔 버튼 하나만 노출하고, 누르면 안내문·토글·피드백이 인라인으로 펼쳐진다.
 * 트리거는 `<button aria-expanded>`(W3C APG disclosure) — 형제 패널과 동일하게
 * heading 래퍼 없이 버튼만 둔다(버튼 자체가 발견 경로라 heading 진입점 불필요,
 * 형제와의 일관성·First Rule of ARIA). 오버레이/포커스 트랩 없이 시맨틱 HTML만으로
 * 완결한다.
 *
 * 접근성: 연속 피드백은 톤(useBeaconSound), 음성 통지는 단일 polite live region
 * 하나로만 나간다(컨트롤 응답·상태 변화·안내 전부 같은 채널). 컨트롤은 죽은 것을
 * 두지 않는다 — 전환은 상세 경로를 쥔 세션에만, 재조회는 이탈 상태에만 나온다.
 * geolocation 미지원이면 렌더 안 함(graceful).
 *
 * 생명주기(스펙 §9): 패널을 접으면 추적을 중지하고 경로를 폐기한다(탭 숨김·언마운트도
 * 훅이 같은 처리를 한다). 복귀 후 자동 재개는 없다 — 다시 시작한다.
 */
export function DistanceBeacon({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("beacon");
  const tGuide = useTranslations("guide");
  const [open, setOpen] = useState(false);
  const guide = useRouteGuide(dest);

  if (!guide.supported) return null;

  const tracking = guide.status === "tracking";

  const togglePanel = () => {
    if (open) guide.stop();
    setOpen(!open);
  };

  const controlClass =
    "mt-2 inline-flex min-h-11 items-center rounded-md border border-accent px-4 text-sm font-medium text-accent";

  return (
    <section className="mt-4">
      {/* disclosure 트리거 — 형제 트리거 버튼과 동급(border-accent). 패널은 조건부
          렌더라 aria-controls는 닫힘 시 dangling되므로 생략(형제 동형, aria-expanded
          만으로 disclosure 상태 전달 충분 — First Rule of ARIA). */}
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent"
      >
        {t("heading")}
      </button>

      {open && (
        <div className="mt-2">
          {/* 직선거리 주석은 간략 안내에서만 참이다 — 상세는 경로 기반 거리를 쓴다. */}
          {guide.mode === "brief" && (
            <p className="text-xs text-muted">{t("straightLineNote")}</p>
          )}
          <p className="mt-0.5 text-xs text-muted">{t("screenHint")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => (tracking ? guide.stop() : guide.start())}
              aria-pressed={tracking}
              className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
            >
              {tracking ? t("stop") : t("start")}
            </button>
            {tracking && (
              <>
                <button
                  type="button"
                  onClick={guide.repeatGuidance}
                  className={controlClass}
                >
                  {tGuide("repeatButton")}
                </button>
                <button
                  type="button"
                  onClick={guide.announceProgress}
                  className={controlClass}
                >
                  {tGuide("progressButton")}
                </button>
                {guide.canOfferDetail && (
                  <button
                    type="button"
                    onClick={guide.toggleMode}
                    className={controlClass}
                  >
                    {guide.mode === "detail"
                      ? tGuide("toBriefButton")
                      : tGuide("toDetailButton")}
                  </button>
                )}
                {guide.offRoute && (
                  <button
                    type="button"
                    onClick={guide.requestReroute}
                    // 조회 중 비활성은 aria-disabled + 핸들러 가드 — disabled는 포커스를
                    // 떨궈 SR 사용자가 맥락을 잃는다.
                    aria-disabled={guide.rerouting}
                    className={controlClass}
                  >
                    {tGuide("rerouteButton")}
                  </button>
                )}
              </>
            )}
          </div>
          <p aria-live="polite" className="mt-2 min-h-5 text-sm">
            {guide.liveText}
          </p>
        </div>
      )}
    </section>
  );
}
