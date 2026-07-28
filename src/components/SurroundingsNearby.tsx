"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import type { SurroundingPlace } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { usePlaceChat } from "@/hooks/usePlaceChat";
import { surroundingPlaceToPlace } from "@/lib/nearby-place";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { ChatOverlay } from "./chat/ChatOverlay";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; places: SurroundingPlace[]; at: string };

/** 초기 표시 수·"더 보기" 1회 공개 수 — V1(NightClinicsNearby)과 동일 값 유지. */
const INITIAL_VISIBLE = 10;
const REVEAL_STEP = 10;
/** 옵트인 확장 요청 — 라우트 기본 상한(12)은 limit 미지정 소비자(CLI/MCP·iOS)용,
    "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다. */

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
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  /** 공개된 항목 헤딩 참조 — "더 보기" 후 첫 새 항목으로 포커스 이동(헌장 §1). */
  const itemHeadingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  const { chatPlace, isChatOpen, openChat, closeChat } = usePlaceChat();

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/places/around?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
        { cache: "no-store" },
      );
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
      setVisibleCount(INITIAL_VISIBLE);
      setStatus({ kind: "done", places, at });
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

  // "더 보기"로 공개된 첫 새 항목으로 포커스 이동 — 새 항목의 라벨이 곧 통지라
  // 별도 live region은 두지 않는다(중복 낭독). 마지막 배치로 버튼이 같은 커밋에서
  // 사라져도 useLayoutEffect는 페인트 전에 실행되어 이탈 창이 없다(V1 동형).
  useLayoutEffect(() => {
    const i = pendingFocusIndex.current;
    if (i == null) return;
    pendingFocusIndex.current = null;
    itemHeadingRefs.current[i]?.focus();
  }, [visibleCount]);

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
        <div
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {`${t("ready")} ${t("asOf", { time: status.at })}`}
          </h3>

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-4">
            {status.places.slice(0, visibleCount).map((p, i) => (
              <li key={p.id}>
                <h4
                  className="font-medium"
                  tabIndex={-1}
                  ref={(el) => {
                    itemHeadingRefs.current[i] = el;
                  }}
                >
                  {joinText(
                    p.name,
                    t("item", {
                      category: t(`category.${p.category}`),
                      direction: t(`direction.${p.bearing}`),
                      distance: formatDistance(p.distanceMeters),
                    }),
                  )}
                </h4>

                {p.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${p.phone}`} className="text-accent underline">
                      {`${p.phone} ${t("call")}`}
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
          {status.places.length > visibleCount && (
            <button
              type="button"
              onClick={() => {
                pendingFocusIndex.current = visibleCount;
                setVisibleCount((v) => v + REVEAL_STEP);
              }}
              className="mt-2 min-h-11 text-sm text-accent underline"
            >
              {tActions("showMore")}
            </button>
          )}
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}

      {chatPlace && <ChatOverlay place={chatPlace} onClose={closeChat} />}
    </div>
  );
}
