"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouteGuide, type GuideKind } from "@/hooks/useRouteGuide";
import { formatDistance, joinText } from "@/lib/format";

/** 화면 켜기 힌트 영구 해제(피드백 라운드1 13번, iOS UserDefaults 미러). */
const SCREEN_HINT_DISMISSED_KEY = "gildongmu:screen-hint-dismissed";

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
  kind = "walk",
  startOnOpen = false,
  focusTriggerOnMount = false,
  triggerLabel,
}: {
  dest: { lat: number; lng: number; name: string };
  /** 안내 수단(B1 §4.1 봉인 구성 키). 장소 상세는 walk 고정, 길찾기 뷰는 버튼별. */
  kind?: GuideKind;
  /**
   * 트리거를 누르는 순간 세션도 시작한다(길찾기 뷰 "OO 안내 시작" 버튼 계약 —
   * "시작"이라 쓰인 버튼이 패널만 여는 이중 행동은 라벨 거짓말이다). 장소 상세는
   * 기존 2단(열기 → 시작) 유지.
   */
  startOnOpen?: boolean;
  /**
   * 마운트 시 트리거로 포커스 선점(대중교통→도보 핸드오프, §14.2) — 직전 컨트롤
   * (다음 구간 버튼)이 사라진 전이에서 다음 행동으로 커서를 옮긴다(헌장 §5).
   */
  focusTriggerOnMount?: boolean;
  triggerLabel?: string;
}) {
  const t = useTranslations("beacon");
  const tGuide = useTranslations("guide");
  const [open, setOpen] = useState(false);
  // 학습되면 잉여인 안내가 매 세션 한 행을 차지했다(13번) — 첫 사용 안내 +
  // "다시 보지 않음". localStorage 불가 환경은 항상 표시로 수렴(편의 기능).
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return localStorage.getItem(SCREEN_HINT_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const guide = useRouteGuide(dest, kind);

  // 재조회 버튼은 성공(offRoute 해제)·경로 자동 복귀 순간 언마운트된다. 포커스를 쥔
  // 요소가 사라지면 커서가 body로 떨어져 걷는 중 맥락을 통째로 잃으므로(헌장 §5),
  // 그 버튼에 포커스가 있었다면 페인트 전에 항상 존재하는 시작/중지 토글로 선점
  // 이동한다(useRevealMore의 useLayoutEffect 재포커스 선례). 플래그는 onFocus로
  // 세운다 — 노드 제거 시 blur가 오지 않는 경로까지 덮는다(a11y 감사 HIGH).
  const stopToggleRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rerouteFocusedRef = useRef(false);
  useLayoutEffect(() => {
    if (!guide.offRoute && rerouteFocusedRef.current) {
      rerouteFocusedRef.current = false;
      // startOnOpen 패널은 안쪽 토글이 없으므로(잉여 — 트리거가 시작/중지 겸임)
      // 항상 존재하는 트리거로 선점 이동한다.
      (stopToggleRef.current ?? triggerRef.current)?.focus();
    }
  }, [guide.offRoute]);

  // 핸드오프 마운트 포커스(§14.2) — 페인트 전 선점(레이아웃 이펙트, 재실행 없음).
  useLayoutEffect(() => {
    if (focusTriggerOnMount) triggerRef.current?.focus();
    // 마운트 1회 계약 — prop은 마운트 시점에만 의미가 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!guide.supported) return null;

  const tracking = guide.status === "tracking";

  const togglePanel = () => {
    if (open) {
      guide.stop();
    } else if (startOnOpen) {
      guide.start();
    }
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
        ref={triggerRef}
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent"
      >
        {/* startOnOpen 트리거는 시작/중지를 겸하므로 추적 중엔 라벨이 곧 상태 신호다
            — "시작"이라 읽히는데 누르면 세션이 끝나는 라벨 거짓말 금지(a11y 감사). */}
        {startOnOpen && tracking ? t("stop") : (triggerLabel ?? t("walkHeading"))}
      </button>

      {open && (
        <div className="mt-2">
          {/* 직선거리 주석은 간략 안내로 추적 중일 때만 — 시작 전엔 상세로 열릴 수
              있어 거짓 예고가 된다(iOS 시트 조건과 동조, 위원장 판정 2026-08-03). */}
          {tracking && guide.mode === "brief" && (
            <p className="text-xs text-muted">{t("straightLineNote")}</p>
          )}
          {!hintDismissed && (
            <>
              <p className="mt-0.5 text-xs text-muted">{t("screenHint")}</p>
              {/* 해제 버튼 자신이 사라지는 전이 — 포커스를 상시 존재하는 토글로 먼저
                  옮긴 뒤 상태를 바꾼다(헌장 §5, 재조회 성공 경로와 동형). */}
              <button
                type="button"
                onClick={() => {
                  (stopToggleRef.current ?? triggerRef.current)?.focus();
                  try {
                    localStorage.setItem(SCREEN_HINT_DISMISSED_KEY, "1");
                  } catch {
                    // 저장 불가면 이번 패널에서만 숨김 — 편의 기능
                  }
                  setHintDismissed(true);
                }}
                className={controlClass}
              >
                {t("screenHintDismiss")}
              </button>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {/* 상태 신호는 라벨 교체가 전부다 — aria-pressed 병기는 "안내 중지,
                선택됨"처럼 모호한 이중 상태를 만든다(W3C APG, a11y 감사).
                startOnOpen 패널에선 트리거가 시작/중지를 겸해 이 토글이 잉여다. */}
            {!startOnOpen && (
              <button
                ref={stopToggleRef}
                type="button"
                onClick={() => (tracking ? guide.stop() : guide.start())}
                className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
              >
                {tracking ? t("stop") : t("start")}
              </button>
            )}
            {tracking && (
              <>
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
                    onFocus={() => {
                      rerouteFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      rerouteFocusedRef.current = false;
                    }}
                    // 조회 중 비활성은 aria-disabled + 핸들러 가드 — disabled는 포커스를
                    // 떨궈 SR 사용자가 맥락을 잃는다. 진행 신호는 라벨 교체가 정본
                    // (DirectionsView "현재 위치 사용" 관례 — 별도 announce 중복 금지).
                    aria-disabled={guide.rerouting}
                    aria-busy={guide.rerouting}
                    className={controlClass}
                  >
                    {guide.rerouting ? tGuide("rerouteBusy") : tGuide("rerouteButton")}
                  </button>
                )}
              </>
            )}
          </div>
          {/* 경로 기준 잔여 거리·예상 시간 상시 표시(위원장 실측 판정 2026-08-03 —
              직선거리는 상시 표시 가치가 없고 경로 기준이어야 한다). 매 fix 갱신되는
              값이라 live region 밖 일반 텍스트로만 둔다(polite에 태우면 통지 스팸).
              이탈 중엔 경로 잔여가 거짓이므로 숨긴다(3-state 정직). */}
          {tracking && guide.mode === "detail" && !guide.offRoute && guide.progress && (
            <p className="mt-2 text-sm">
              {joinText(
                tGuide("remainingDistance", {
                  distance: formatDistance(guide.progress.remainingMeters),
                }),
                guide.progress.etaSeconds !== null &&
                  tGuide("remainingTime", {
                    minutes: Math.max(1, Math.round(guide.progress.etaSeconds / 60)),
                  }),
              )}
            </p>
          )}
        </div>
      )}
      {/* 단일 polite live region — 패널 열림과 무관하게 상시 마운트한다. region이
          내용과 함께 삽입되면 대부분의 AT가 첫 통지를 발화하지 않는다(startOnOpen의
          동기 시작 통지가 en 로케일에서 무발화되던 결함 — a11y 감사 반영). */}
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {guide.liveText}
      </p>
    </section>
  );
}
