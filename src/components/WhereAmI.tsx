"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WhereAmI as WhereAmIData } from "@/lib/types";
import { buildLocationNarrative } from "@/lib/where-am-i";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "done"; data: WhereAmIData; at: string };

/**
 * "현재 위치" 정위 카드 — 홈 "내 주변" 묶음 맨 위 별도 버튼. SurroundingsNearby
 * 동형(공유 geolocation·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).
 * 차이: 카테고리 리스트가 아니라 도로명·행정동·근접역·기준점을 결정론 산문 두세
 * 단락으로 제시(buildLocationNarrative).
 */
export function WhereAmI() {
  const t = useTranslations("whereAmI");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/where-am-i?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (isOutOfCoverageBody(body)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
      if (!res.ok || !body.data) {
        setStatus({ kind: res.ok ? "empty" : "error" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", data: body.data, at });
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load(force = false) {
    const prevStatus = status;
    claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    void awaitGeolocation({ force }).then((g) => {
      if (g.status === "ready") {
        if (!isInKorea(g.coords.lat, g.coords.lng)) {
          setStatus({ kind: "outOfCoverage" });
          done();
          return;
        }
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        // 새로고침(force) 실패 시 보던 데이터를 잃지 않는다 — done이면 직전 결과를
        // 복원하고, 첫 조회 실패면 geoerror. 실내 등에서 정밀 재취득(GPS)이 자주
        // 실패할 수 있어 데이터 소멸을 막는다.
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        done();
      }
    });
  }

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  // done 진입 시 결과 헤딩으로 포커스 이동(접근성 1급). fetch 완료 직후 rAF로
  // 옮기면 React 커밋과 인과관계가 없어 레이스가 생긴다(헤딩이 아직 DOM에
  // 없을 수 있음) — useEffect는 커밋 이후 실행이 보장되므로 안전하다
  // (PlaceDetail·PlaceSearch의 결과 헤딩 포커스와 동형).
  useEffect(() => {
    if (status.kind === "done") {
      if (!focusedRef.current) {
        focusedRef.current = true;
        headingRef.current?.focus();
      }
    } else {
      focusedRef.current = false;
    }
  }, [status.kind]);

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel = status.kind === "done" ? t("refresh") : t("button");

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "empty"
          ? t("empty")
          : status.kind === "error"
            ? t("error")
            : status.kind === "geoerror"
              ? status.reason === "denied"
                ? t("geoDenied")
                : t("geoUnsupported")
              : status.kind === "outOfCoverage"
                ? tCommon("outOfCoverage")
                : "";

  const narrative =
    status.kind === "done" ? buildLocationNarrative(status.data) : null;

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => load(status.kind === "done")}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && narrative && (
        <div className="mt-2 rounded-md border border-border p-3">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {`${t("ready")} ${t("asOf", { time: status.at })}`}
          </h3>

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          {/* 단락 1 — 위치 + 가장 가까운 역. 결정론 산문 한 단락을 한 텍스트 런으로:
              장소·역명·노선을 <span>으로 감싸지 않고 문자열로 보간해 VoiceOver가
              문장을 끊지 않고 한 번에 낭독한다(산문 템플릿 자체는 불변). */}
          <p className="mt-2 text-sm leading-relaxed">
            {narrative.place &&
              t.rich("narrative.here", {
                place: () => narrative.place,
              })}
            {narrative.station && (
              <>
                {" "}
                {t.rich("narrative.station", {
                  name: () => narrative.station!.name,
                  line: () =>
                    narrative.station!.line
                      ? ` (${narrative.station!.line})`
                      : "",
                  direction: t(`direction.${narrative.station.bearing}`),
                  distance: formatDistance(narrative.station.distanceMeters),
                })}
              </>
            )}
          </p>

          {/* 단락 2 — 주변 기준점(거리순 상위 6) */}
          {narrative.landmarks.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed">
              {t("narrative.landmarksLead")}
              {narrative.landmarks.map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 && ", "}
                  {t.rich("narrative.landmarkItem", {
                    name: () => l.name,
                    category: t(`category.${l.category}`),
                    direction: t(`direction.${l.bearing}`),
                    distance: formatDistance(l.distanceMeters),
                  })}
                </Fragment>
              ))}
              {t("narrative.landmarksTail")}
            </p>
          )}

          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
