"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { WalkInfrastructure, WalkFeature } from "@/lib/walk-infra";
import { formatDistance, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; walk: WalkInfrastructure; at: string };

/**
 * 내 주변 보행 인프라: 7번째 nearby(음향신호기+OSM 횡단보도·점자블록).
 *
 * 게이트 없음(음향신호기=무인증 seed, OSM=무키 공개 인스턴스)이라 항상 노출한다.
 * spec §2-F 상태×산문 매트릭스: audioSignals(ok>0/ok=0/unsupported/error)와
 * osm(ok>0/ok=0/error)을 서로 독립적으로 판정해 각자의 문구를 낭독한다(소스별
 * 강등이 다른 소스를 오염시키지 않음). render 카드 없음(채팅 도구는 별도).
 *
 * a11y: 패널은 버튼이 발견 경로라 <div>(region 금지). 그룹 헤더 <h4> 3개
 * (음향신호기/횡단보도/점자블록)는 항상 렌더한다. 헤딩 내비로 어느 그룹에 먼저
 * 도달해도 그 자리에서 상태를 알 수 있어야 한다. 항목 자체는 이름 없는
 * 인프라 점이라 heading 미부여(joinText 한 줄=한 객체). 방위는 기존
 * surroundingsNearby.direction.* 키를 재사용(신규 중복 정의 금지).
 */
export function WalkInfraNearby() {
  const t = useTranslations("walkInfra");
  const tDir = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const focusedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/walk/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const body = await res.json();
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", walk: body.walk as WalkInfrastructure, at });
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
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
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

  // done 진입 시 결과 헤딩으로 포커스 이동(다른 nearby 패널과 동형).
  // useEffect는 React 커밋 이후 실행이 보장돼 rAF 레이스가 없다.
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

  // 단일 polite 통지(§2-F): ok 소스의 수치만 낭독, error/unsupported는 실패·미제공
  // 문구로("0기" 합성 금지). 두 소스는 서로 독립적으로 강등된다.
  function buildLive(walk: WalkInfrastructure): string {
    const audio =
      walk.audioSignals.status === "ok"
        ? walk.audioSignals.data.deviceCount > 0
          ? t("audioSummary", { count: walk.audioSignals.data.deviceCount })
          : t("audioNone")
        : walk.audioSignals.status === "unsupported"
          ? t("audioUnsupported")
          : t("audioError");
    const osm =
      walk.osm.status === "ok"
        ? walk.osm.data.listedCount > 0
          ? t("osmSummary", { count: walk.osm.data.listedCount })
          : t("osmEmpty")
        : t("osmError");
    return joinText(audio, osm);
  }

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "error"
          ? t("error")
          : status.kind === "geoerror"
            ? status.reason === "denied"
              ? t("geoDenied")
              : t("geoUnsupported")
            : status.kind === "done"
              ? buildLive(status.walk)
              : "";

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

      {status.kind === "done" && (
        <WalkInfraPanel
          walk={status.walk}
          at={status.at}
          headingRef={headingRef}
          onClose={() => close()}
          closeLabel={tActions("close")}
          t={t}
          tDir={tDir}
        />
      )}
    </div>
  );
}

function WalkInfraPanel({
  walk,
  at,
  headingRef,
  onClose,
  closeLabel,
  t,
  tDir,
}: {
  walk: WalkInfrastructure;
  at: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  closeLabel: string;
  t: ReturnType<typeof useTranslations<"walkInfra">>;
  tDir: ReturnType<typeof useTranslations<"surroundingsNearby">>;
}) {
  const dirLabel = (bearing: WalkFeature["bearing"]) => tDir(`direction.${bearing}`);
  const crossing = walk.osm.status === "ok" ? walk.osm.data.features.filter((f) => f.crossing) : [];
  const tactile =
    walk.osm.status === "ok" ? walk.osm.data.features.filter((f) => !f.crossing && f.tactilePaving) : [];
  // 출처는 실제로 데이터를 보여준 소스만 인용한다(성공한 소스만, 실패한 소스는
  // 인용하지 않는다).
  const showFootnote = walk.audioSignals.status === "ok" || walk.osm.status === "ok";

  return (
    <div className="mt-2 rounded-md border border-border p-3">
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        {`${t("ready")} ${t("asOf", { time: at })}`}
      </h3>

      <button type="button" onClick={onClose} className="mt-1 min-h-11 text-sm text-accent underline">
        {closeLabel}
      </button>

      <div className="mt-3">
        <h4 className="font-medium">{t("groupAudio")}</h4>
        {walk.audioSignals.status === "ok" ? (
          walk.audioSignals.data.deviceCount > 0 ? (
            <>
              <p className="mt-1 text-sm">
                {t("audioSummary", { count: walk.audioSignals.data.deviceCount })}
              </p>
              <ul className="mt-1 space-y-1">
                {walk.audioSignals.data.sites.map((site, i) => (
                  <li key={i} className="text-sm">
                    {t("audioSite", {
                      direction: dirLabel(site.bearing),
                      distance: formatDistance(site.distanceMeters),
                      count: site.deviceCount,
                    })}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("audioNone")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {walk.audioSignals.status === "unsupported" ? t("audioUnsupported") : t("audioError")}
          </p>
        )}
      </div>

      <div className="mt-3">
        <h4 className="font-medium">
          {walk.osm.status === "ok" && walk.osm.data.crossingTotal > 0
            ? walk.osm.data.crossingTotal > crossing.length
              ? t("groupCrossingTruncated", { total: walk.osm.data.crossingTotal, listed: crossing.length })
              : t("groupCrossingCount", { count: walk.osm.data.crossingTotal })
            : t("groupCrossing")}
        </h4>
        {walk.osm.status === "ok" ? (
          crossing.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {crossing.map((f) => (
                <li key={f.osmId} className="text-sm">
                  {joinText(
                    t("itemLocation", { direction: dirLabel(f.bearing), distance: formatDistance(f.distanceMeters) }),
                    f.crossingSignal === "yes" && t("hasSignal"),
                    f.tactilePaving && t("hasTactile"),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("crossingEmpty")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {t("crossingError")}
          </p>
        )}
      </div>

      <div className="mt-3">
        <h4 className="font-medium">
          {walk.osm.status === "ok" && walk.osm.data.tactileTotal > 0
            ? walk.osm.data.tactileTotal > tactile.length
              ? t("groupTactileTruncated", { total: walk.osm.data.tactileTotal, listed: tactile.length })
              : t("groupTactileCount", { count: walk.osm.data.tactileTotal })
            : t("groupTactile")}
        </h4>
        {walk.osm.status === "ok" ? (
          tactile.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {tactile.map((f) => (
                <li key={f.osmId} className="text-sm">
                  {joinText(
                    t("itemLocation", { direction: dirLabel(f.bearing), distance: formatDistance(f.distanceMeters) }),
                    f.hostFeature === "busStop" && t("hostBusStop"),
                    f.hostFeature === "subwayEntrance" && t("hostSubwayEntrance"),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm opacity-70">
              {t("tactileEmpty")}
            </p>
          )
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {t("tactileError")}
          </p>
        )}
      </div>

      {showFootnote && (
        <>
          <p className="mt-2 text-xs opacity-70">
            {t("footnote")}
          </p>
          <p className="mt-1 text-xs opacity-70">
            {joinText(
              walk.osm.status === "ok" && t("sourceOsm"),
              walk.audioSignals.status === "ok" && t("sourceAudio", { baseDate: walk.audioSignals.data.baseDate }),
            )}
          </p>
        </>
      )}
    </div>
  );
}
