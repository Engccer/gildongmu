"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { KidsPlace } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "done"; kids: KidsPlace[]; at: string };

/** 초기 표시 수·"더 보기" 1회 공개 수 — V1(NightClinicsNearby)과 동일 값 유지. */
const INITIAL_VISIBLE = 10;
const REVEAL_STEP = 10;
/** 옵트인 확장 요청 — 라우트 기본 상한(8)은 limit 미지정 소비자(CLI/MCP·iOS)용,
    "더 보기" 재료는 웹이 NEARBY_LIMIT_MAX로 명시 확보한다. */

/**
 * 근처 아이 놀 곳(키즈카페·놀이터·어린이공원, B3) — 홈 진입점.
 *
 * 따릉이/지하철/소아진료 nearby와 동형: 버튼 → geolocation → 좌표 조회.
 * 카카오 로컬 좌표 근접이지만 **키워드 매칭 ≠ 키즈 장소**라 서버에서 카테고리
 * 화이트리스트로 거짓양성을 거른 결과만 받는다(시각장애인 정합). 실내/실외는
 * 3-state 라벨(놀이터 모호 시 "정보 없음") — 우천 시 사용자가 듣고 판단.
 * 자기완결 정보 리스트(상세 연동 비포함) — 길찾기는 카카오맵 링크로 위임.
 */
export function KidsPlacesNearby() {
  const t = useTranslations("kidsNearby");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
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

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/places/kids?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (isOutOfCoverageBody(body)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const kids = (body.kids ?? []) as KidsPlace[];
      if (kids.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setVisibleCount(INITIAL_VISIBLE);
      setStatus({ kind: "done", kids, at });
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
              : status.kind === "outOfCoverage"
                ? tCommon("outOfCoverage")
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
            {status.kids.slice(0, visibleCount).map((k, i) => (
              <li key={k.id}>
                {/* 한 줄 = 한 객체: 이름·분류·실내외·거리를 단일 텍스트로 합친다.
                    분류·실내외·거리는 번역(로케일 정합)이고 이름은 한국어 전용이라,
                    SubwayArrivalsNearby와 동형으로 lang 없이 페이지 로케일을 따른다. */}
                <h4
                  className="font-medium"
                  tabIndex={-1}
                  ref={(el) => {
                    itemHeadingRefs.current[i] = el;
                  }}
                >
                  {joinText(
                    k.name,
                    t(`kind.${k.kind}`),
                    t(`indoor.${k.indoorOutdoor}`),
                    t("distance", { distance: formatDistance(k.distanceMeters) }),
                  )}
                </h4>

                <p className="mt-1 text-sm" lang="ko">
                  {k.address}
                </p>

                {/* 전화번호가 있으면 1탭 통화(키즈카페 예약·운영 확인 — 시각장애인 정합,
                    NightClinicsNearby의 tel: 패턴 동형). 공원·놀이터는 대개 미제공. */}
                {k.phone && (
                  <p className="mt-1 text-sm">
                    <a href={`tel:${k.phone}`} className="text-accent underline">
                      {joinText(k.phone, t("call"))}
                    </a>
                  </p>
                )}

                {k.link && (
                  <p className="mt-1 text-sm">
                    <a
                      href={k.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {t("mapLink")}
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {status.kids.length > visibleCount && (
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
    </div>
  );
}
