#!/bin/bash
# Experimental 구성에서만 앱 표시 이름에 " 실험" 접미사를 붙인다.
#
# 왜 빌드 후처리인가: `InfoPlist.xcstrings`의 로컬라이제이션이 빌드 설정
# `INFOPLIST_KEY_*`를 **이긴다**(실측 2026-08-04). 그래서 구성별로 다른 값을 주려면
# 컴파일된 `*.lproj/InfoPlist.strings`를 고치는 수밖에 없다. 서명 전에 돈다.
#
# 표시 이름만 다루는 이유(2026-08-15 개정, spec 2026-08-15-walk-guidance-ship §4.2):
#  - 표시 이름: 아이콘 표식은 시각 구분이라 VoiceOver 사용자에겐 **이름이 유일한
#    구분 수단**이다. 공식판과 실험판이 홈 화면에서 같은 이름이면 못 고른다.
#  - 위치 권한 문구는 더 이상 여기서 만지지 않는다: 도보 안내 정식 출시로 거리 안내
#    절이 정식 문구(InfoPlist.xcstrings ko)에 들어갔다. 같은 값을 두 곳이 관리하면
#    다음 개정 때 갈린다(실험판 비한국어 문구가 한 절 부족한 것은 과소 설명이라
#    심사 위험이 아니다).
set -uo pipefail

[ "${CONFIGURATION:-}" = "Experimental" ] || exit 0

RES="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
SUFFIX=" 실험"

# 결과 검증 가드(설계 리뷰 #9): 종전 카운트는 파일 존재만 세서 추출 실패·replace
# 실패를 성공으로 계산했다. 접미사가 실제로 붙었는지 **다시 읽어** 확인하고, 한
# 로케일이라도 실패하면 빌드를 멈춘다.
verified=0
for f in "$RES"/*.lproj/InfoPlist.strings; do
  [ -f "$f" ] || continue
  lang=$(basename "$(dirname "$f")" .lproj)

  name=$(plutil -extract CFBundleDisplayName raw -o - "$f" 2>/dev/null) || name=""
  if [ -z "$name" ]; then
    echo "error: ${lang} InfoPlist.strings에서 CFBundleDisplayName을 읽지 못했습니다 ($f)" >&2
    exit 1
  fi
  # 증분 빌드에서 접미사가 겹치지 않게 한다(alwaysOutOfDate라 매 빌드 실행된다).
  case "$name" in
    *"$SUFFIX") : ;;
    *) plutil -replace CFBundleDisplayName -string "${name}${SUFFIX}" "$f" ;;
  esac

  final=$(plutil -extract CFBundleDisplayName raw -o - "$f" 2>/dev/null) || final=""
  case "$final" in
    *"$SUFFIX") verified=$((verified + 1)) ;;
    *)
      echo "error: ${lang} 표시 이름에 접미사가 붙지 않았습니다 (현재: ${final:-읽기 실패})" >&2
      exit 1
      ;;
  esac
done

# 리소스가 하나도 안 잡히면 조용히 통과하지 않는다. 경로 상수가 바뀌면 표시 이름이
# 공식판 값 그대로 나가는데, 빌드는 성공하므로 알아챌 방법이 없다.
if [ "$verified" -eq 0 ]; then
  echo "error: InfoPlist.strings를 찾지 못했습니다 ($RES)" >&2
  exit 1
fi

# ⚠ 메인 Info.plist는 여기서 후처리할 수 없다: `ProcessInfoPlistFile`이 이 스크립트
# **뒤에** 매 빌드 실행되어 덮어쓴다(실측 2026-08-06 — 스크립트가 만진 산출물이
# 다음 재처리를 유발해 영원히 진다). 구성별로 달라야 하는 **비로컬라이즈** plist
# 키(UIBackgroundModes 등)는 `Support/Info-Experimental.plist`(부분 plist 입력
# 분기)가 정본이고, 이 스크립트는 로컬라이즈 문자열(InfoPlist.strings) 전용이다.
echo "실험판 InfoPlist 후처리: ${verified}개 로케일 표시 이름 검증 통과"
