"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import type { SurroundingPlace } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { usePlaceChat } from "@/hooks/usePlaceChat";
import { surroundingPlaceToPlace } from "@/lib/nearby-place";
import { ChatOverlay } from "./chat/ChatOverlay";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; places: SurroundingPlace[]; at: string };

/**
 * 내 주변 둘러보기(기능 A) — 홈 진입점. KidsPlacesNearby 동형(geolocation 공유
 * 스토어 → 좌표 조회 → 자기완결 리스트). 차이: 각 항목에 **북 기준 8방위 방향**을
 * 거리와 함께 낭독("편의점 · 남동쪽 · 약 40m"). BlindSquare식 상시 인지.
 */
export function SurroundingsNearby({ canShowChat = false }: { canShowChat?: boolean }) {
  const t = useTranslations("surroundingsNearby");
  const tActions = useTranslations("actions");
  const tPlaceChat = useTranslations("placeChat");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { chatPlace, isChatOpen, openChat, closeChat } = usePlaceChat();

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/places/around?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const places = (body.places ?? []) as SurroundingPlace[];
      if (places.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", places, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
    claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    void awaitGeolocation().then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        setStatus({
          kind: "geoerror",
          reason: g.status === "unsupported" ? "unsupported" : "denied",
        });
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
              : status.kind === "done"
                ? t("ready")
                : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={load}
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
        <div
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
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

          <ul className="mt-2 space-y-4">
            {status.places.map((p) => (
              <li key={p.id}>
                <h4 className="font-medium">
                  <span lang="ko">{p.name}</span>{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("item", {
                      category: t(`category.${p.category}`),
                      direction: t(`direction.${p.bearing}`),
                      distance: formatDistance(p.distanceMeters),
                    })}
                  </span>
                </h4>

                {p.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${p.phone}`} className="text-accent underline">
                      {p.phone}
                      <span className="ml-1 opacity-70">{t("call")}</span>
                    </a>
                  </p>
                )}

                {p.link && (
                  <p className="mt-1 text-sm">
                    <a
                      href={p.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {t("mapLink")}
                    </a>
                  </p>
                )}

                {/* 이 장소에 관해 물어보기 — 장소명을 버튼 이름에 넣어 회전자 구분. */}
                {canShowChat && (
                  <p className="mt-1 text-sm">
                    <button
                      type="button"
                      onClick={(e) =>
                        openChat(surroundingPlaceToPlace(p), e.currentTarget)
                      }
                      className="inline-flex min-h-11 items-center gap-1 text-accent underline"
                    >
                      <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
                      {tPlaceChat.rich("launchFor", {
                        name: () => <span lang="ko">{p.name}</span>,
                      })}
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}

      {chatPlace && <ChatOverlay place={chatPlace} onClose={closeChat} />}
    </div>
  );
}
