"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BarrierFreeDetail, BarrierFreePlace } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; places: BarrierFreePlace[]; at: string };

/** 캐시 값: 로딩 중 / 상세 객체 / 없음(에러 또는 contentId 미등록) */
type DetailEntry = "loading" | BarrierFreeDetail | null;

/**
 * 내 주변 무장애 관광지 — 홈 진입점 + 채팅 카드용(autoLoad).
 *
 * 한국관광공사 KorWithService2 locationBasedList2에서 가져온 무장애 여행지를
 * 거리순으로 나열하고, 항목마다 편의시설 상세를 disclosure(토글)로 lazy 제공한다.
 * 키 없음 / 403 → API가 {places:[]} 반환 → empty 상태로 graceful degrade.
 *
 * a11y 규칙:
 * - 항목 이름 <h4>, 섹션 헤더 <h3>.
 * - 편의시설 펼침은 버튼이 발견 경로라 <div>(자동 등장 region 아님).
 * - 편의시설 목록: 평문 <p> — definition list 금지(SR에서 "용어/정의" 낭독).
 * - 버튼 비활성은 aria-disabled, 토글은 aria-expanded.
 * - 단일 polite live region.
 * - UI 라벨 이모지 금지.
 *
 * autoLoad=true(채팅 카드): 마운트 시 자동 로드, 닫기 버튼 숨김,
 * 패널 스토어 dismissal 미참여(채팅 오버레이가 소유).
 */
export function BarrierFreeNearby({ autoLoad = false }: { autoLoad?: boolean }) {
  const t = useTranslations("barrierFreeNearby");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** contentId → 상세 캐시 (한 번 가져온 항목은 재요청 안 함) */
  const [detailCache, setDetailCache] = useState<Record<string, DetailEntry>>({});
  /** 현재 펼쳐진 contentId 집합 */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  /** 펼침 상세 fetch in-flight(contentId별) — 메인 load의 inFlightRef와 동형.
      detailCache 가드만으론 리렌더 전 더블클릭 두 클릭이 같은 구 스냅샷을 읽어
      둘 다 fetch를 시작(stale closure 경쟁)하므로 ref Set으로 즉시 차단한다. */
  const detailInFlightRef = useRef<Set<string>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    setOpenIds(new Set());
    setDetailCache({});
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  // autoLoad(채팅 카드)는 패널 스토어에 참여하지 않는다(Esc 경합 차단).
  const { claim } = useNearbyPanel({
    engaged: !autoLoad && status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/places/barrier-free?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const places = (body.places ?? []) as BarrierFreePlace[];
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

  function load(force = false) {
    const prevStatus = status;
    if (!autoLoad) claim();
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
        // 복원하고, 첫 조회 실패면 geoerror. 실내 등에서 정밀 재취득이 자주
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

  // autoLoad: 마운트 시 자동 로드(채팅 카드용). 의존성 배열 비움은 의도적 — 1회만.
  useEffect(() => {
    if (autoLoad) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 항목의 편의시설 펼침/접기 토글 — 펼칠 때 캐시 없으면 lazy fetch */
  async function toggleFacilities(contentId: string) {
    if (openIds.has(contentId)) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(contentId);
        return next;
      });
      return;
    }
    // 펼치기
    setOpenIds((prev) => new Set(prev).add(contentId));
    // 이미 캐시 있으면 재요청 안 함
    if (detailCache[contentId] !== undefined) return;
    // ref in-flight 가드 — 리렌더 전 더블클릭 중복 fetch 차단(stale closure 경쟁).
    if (detailInFlightRef.current.has(contentId)) return;
    detailInFlightRef.current.add(contentId);
    setDetailCache((prev) => ({ ...prev, [contentId]: "loading" }));
    try {
      const res = await fetch(
        `/api/places/barrier-free/detail?contentId=${encodeURIComponent(contentId)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setDetailCache((prev) => ({ ...prev, [contentId]: null }));
        return;
      }
      setDetailCache((prev) => ({
        ...prev,
        [contentId]: (body.detail as BarrierFreeDetail | null) ?? null,
      }));
    } catch {
      setDetailCache((prev) => ({ ...prev, [contentId]: null }));
    } finally {
      // 성공·실패 모두 해제 — 다음 펼침 시도가 막히지 않게.
      detailInFlightRef.current.delete(contentId);
    }
  }

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
      {!autoLoad && (
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
      )}

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <div className="mt-2 rounded-md border border-border p-3">
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

          {!autoLoad && (
            <button
              type="button"
              onClick={() => close()}
              className="mt-1 min-h-11 text-sm text-accent underline"
            >
              {tActions("close")}
            </button>
          )}

          <ul className="mt-2 space-y-4">
            {status.places.map((p) => {
              const isOpen = openIds.has(p.contentId);
              const cached = detailCache[p.contentId];
              return (
                <li key={p.contentId}>
                  <h4 className="font-medium">
                    <span lang="ko">{p.name}</span>{" "}
                    <span className="text-xs font-normal opacity-70">
                      {p.category ? (
                        <>
                          {p.category}
                          {" · "}
                        </>
                      ) : null}
                      {t("distance", {
                        distance: formatDistance(p.distanceMeters),
                      })}
                    </span>
                  </h4>

                  <p className="mt-1 text-sm" lang="ko">
                    {p.address}
                  </p>

                  {/* 편의시설 펼침 — 버튼이 발견 경로라 <div>(자동 등장 region 아님).
                      aria-expanded으로 펼침 상태 통지. */}
                  <p className="mt-1 text-sm">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => void toggleFacilities(p.contentId)}
                      className="min-h-11 text-accent underline"
                    >
                      {isOpen ? t("hideFacilities") : t("showFacilities")}
                    </button>
                  </p>

                  {isOpen && (
                    <div className="mt-1 pl-2">
                      {cached === "loading" ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesLoading")}
                        </p>
                      ) : cached === null ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesEmpty")}
                        </p>
                      ) : cached.facilities.length === 0 ? (
                        <p className="text-sm opacity-70">
                          {t("facilitiesEmpty")}
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {cached.facilities.map((f) => (
                            <li key={f.key}>
                              {/* 평문 <p> — definition list 금지(SR "용어/정의" 낭독 회피) */}
                              <p className="text-sm">
                                <span className="font-medium">{f.label}</span>{" "}
                                <span lang="ko">{f.value}</span>
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
