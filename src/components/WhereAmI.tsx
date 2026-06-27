"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import type { Coord, WhereAmI as WhereAmIData } from "@/lib/types";
import { buildLocationNarrative } from "@/lib/where-am-i";
import { whereAmIToPlace } from "@/lib/where-am-i-place";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { usePlaceChat } from "@/hooks/usePlaceChat";
import { ChatOverlay } from "./chat/ChatOverlay";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; data: WhereAmIData; coord: Coord; at: string };

/**
 * "현재 위치" 정위 카드 — 홈 "내 주변" 묶음 맨 위 별도 버튼. SurroundingsNearby
 * 동형(공유 geolocation·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).
 * 차이: 카테고리 리스트가 아니라 도로명·행정동·근접역·기준점을 결정론 산문 두세
 * 단락으로 제시(buildLocationNarrative). 채팅 버튼은 현재 위치를 Place로 합성해
 * 같은 ChatOverlay(Perplexity 포함)를 연다.
 */
export function WhereAmI({ canShowChat = false }: { canShowChat?: boolean }) {
  const t = useTranslations("whereAmI");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { chatPlace, isChatOpen, openChat, closeChat } = usePlaceChat();

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/where-am-i?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok || !body.data) {
        setStatus({ kind: res.ok ? "empty" : "error" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", data: body.data, coord: { lat, lng }, at });
      requestAnimationFrame(() => headingRef.current?.focus());
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
    // 채팅이 열린 동안엔 패널 Esc·자동닫힘을 비활성(Esc 경합 차단).
    engaged: status.kind !== "idle" && !isChatOpen,
    onDismiss,
    onEscape,
  });

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
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
          </h3>

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          {/* 단락 1 — 위치 + 가장 가까운 역 */}
          <p className="mt-2 text-sm leading-relaxed">
            {narrative.place &&
              t.rich("narrative.here", {
                place: () => <span lang="ko">{narrative.place}</span>,
              })}
            {narrative.station && (
              <>
                {" "}
                {t.rich("narrative.station", {
                  name: () => <span lang="ko">{narrative.station!.name}</span>,
                  line: () =>
                    narrative.station!.line ? (
                      <span lang="ko">{` (${narrative.station!.line})`}</span>
                    ) : (
                      ""
                    ),
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
                    name: () => <span lang="ko">{l.name}</span>,
                    category: t(`category.${l.category}`),
                    direction: t(`direction.${l.bearing}`),
                    distance: formatDistance(l.distanceMeters),
                  })}
                </Fragment>
              ))}
              {t("narrative.landmarksTail")}
            </p>
          )}

          {canShowChat && (
            <p className="mt-3 text-sm">
              <button
                type="button"
                onClick={(e) =>
                  openChat(whereAmIToPlace(status.data, status.coord), e.currentTarget)
                }
                className="inline-flex min-h-11 items-center gap-1 text-accent underline"
              >
                <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t("chatButton")}
              </button>
            </p>
          )}

          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}

      {chatPlace && <ChatOverlay place={chatPlace} onClose={closeChat} />}
    </div>
  );
}
