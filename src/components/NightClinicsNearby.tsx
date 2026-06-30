"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import type { ClinicOpenStatus, NightClinic } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { usePlaceChat } from "@/hooks/usePlaceChat";
import { nightClinicToPlace } from "@/lib/nearby-place";
import { ChatOverlay } from "./chat/ChatOverlay";

/** API 응답 항목 — NightClinic + 서버 계산 진료 상태. */
type ClinicWithStatus = NightClinic & { openStatus: ClinicOpenStatus };

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; clinics: ClinicWithStatus[]; at: string };

/** HHMM 정수(1800, 2400) → "18:00"/"24:00". null/비정상은 빈 문자열. */
function formatTime(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = String(Math.trunc(n)).padStart(4, "0");
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

/**
 * 내 주변 소아 야간·휴일 진료(달빛어린이병원·소아전문센터, B1) — 홈 진입점.
 *
 * 따릉이/지하철 nearby(mode current)와 동형: 버튼 → geolocation → 좌표 조회.
 * 의료 안전망이라 가짜 데이터 없음(키 없으면 섹션 자체가 미노출). 진료 상태는
 * open/closed/unknown 3-state로 "마감"과 "정보 없음"을 구분(시각장애인 정합).
 * 전화는 tel: 링크로 바로 연결(야간 응급 시 1탭 통화).
 */
export function NightClinicsNearby({ canShowChat = false }: { canShowChat?: boolean }) {
  const t = useTranslations("clinicNearby");
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
      const res = await fetch(`/api/clinic/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const clinics = (body.clinics ?? []) as ClinicWithStatus[];
      if (clinics.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", clinics, at });
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
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
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
            {status.clinics.map((c) => {
              const holiday = c.hours[7];
              return (
                <li key={c.id || `${c.name}-${c.distanceMeters}`}>
                  {/* 한 줄 = 한 객체: 이름·분류(한국어)·거리를 단일 텍스트로 합친다.
                      이름·분류가 한국어 전용 데이터라 lang="ko"를 줄 전체로 옮긴다. */}
                  <h4 className="font-medium" lang="ko">
                    {joinText(
                      c.name,
                      c.kind,
                      t("distance", { distance: formatDistance(c.distanceMeters) }),
                    )}
                  </h4>

                  {/* 진료 상태 3-state — 마감과 정보없음을 구분(분기 유지, 부가 운영시간만 흡수) */}
                  <p className="mt-1 text-sm">
                    {joinText(
                      c.openStatus.state === "open"
                        ? t("open")
                        : c.openStatus.state === "closed"
                          ? t("closed")
                          : t("unknown"),
                      c.openStatus.start != null &&
                        c.openStatus.end != null &&
                        t("todayHours", {
                          start: formatTime(c.openStatus.start),
                          end: formatTime(c.openStatus.end),
                        }),
                    )}
                  </p>

                  {holiday && holiday.start != null && holiday.end != null && (
                    <p className="text-sm opacity-70">
                      {t("holidayHours", {
                        start: formatTime(holiday.start),
                        end: formatTime(holiday.end),
                      })}
                    </p>
                  )}

                  {c.phone && (
                    <p className="mt-1 text-sm">
                      <a
                        href={`tel:${c.phone}`}
                        className="text-accent underline"
                        aria-label={t("callAction", { name: c.name })}
                      >
                        {c.phone}
                      </a>
                    </p>
                  )}

                  <p className="mt-1 text-sm" lang="ko">
                    {c.address}
                  </p>

                  {c.directions && (
                    <p className="text-xs opacity-70" lang="ko">
                      {t("directions", { text: c.directions })}
                    </p>
                  )}

                  {/* 이 장소에 관해 물어보기 — 장소명을 버튼 이름에 넣어 회전자 구분. */}
                  {canShowChat && (
                    <p className="mt-1 text-sm">
                      <button
                        type="button"
                        onClick={(e) =>
                          openChat(nightClinicToPlace(c), e.currentTarget)
                        }
                        className="inline-flex min-h-11 items-center gap-1 text-accent underline"
                      >
                        <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
                        {tPlaceChat.rich("launchFor", {
                          name: () => <span lang="ko">{c.name}</span>,
                        })}
                      </button>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}

      {chatPlace && <ChatOverlay place={chatPlace} onClose={closeChat} />}
    </div>
  );
}
