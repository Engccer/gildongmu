#!/bin/bash
# Experimental 구성에서만 앱 표시 이름과 위치 권한 문구를 실험판 값으로 바꾼다.
#
# 왜 빌드 후처리인가: `InfoPlist.xcstrings`의 로컬라이제이션이 빌드 설정
# `INFOPLIST_KEY_*`를 **이긴다**(실측 2026-08-04). 그래서 구성별로 다른 값을 주려면
# 컴파일된 `*.lproj/InfoPlist.strings`를 고치는 수밖에 없다. 서명 전에 돈다.
#
# 두 값을 함께 바꾸는 이유:
#  - 표시 이름: 아이콘 표식은 시각 구분이라 VoiceOver 사용자에겐 **이름이 유일한
#    구분 수단**이다. 공식판과 실험판이 홈 화면에서 같은 이름이면 못 고른다.
#  - 위치 권한 문구: 실험판에는 거리 추적이 있으므로 그 목적을 명시해야 한다
#    (심사 5.1.1). 반대로 공식판은 없는 기능을 설명하면 안 된다. 종전에는 이 짝을
#    사람이 손으로 맞췄고, 한쪽만 되돌리는 사고가 실제로 가능했다.
set -uo pipefail

[ "${CONFIGURATION:-}" = "Experimental" ] || exit 0

RES="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
SUFFIX=" 실험"

# 거리 추적을 포함한 위치 권한 문구(6로케일). 공식판 문구 + 거리 안내 절.
location_purpose() {
  case "$1" in
    ko) echo "현재 위치에서 가까운 교통, 장소와 생활 정보를 찾고, 목적지까지 남은 거리를 소리로 안내하기 위해 위치를 사용합니다." ;;
    en) echo "Your location is used to find nearby transit, places, and local information, and to announce your remaining distance to a destination with sound." ;;
    es) echo "Tu ubicación se usa para encontrar transporte, lugares e información local cercanos, y para indicar con sonido la distancia restante hasta un destino." ;;
    fr) echo "Votre position sert à trouver les transports, lieux et informations locales à proximité, et à indiquer par des sons la distance restante jusqu'à une destination." ;;
    it) echo "La tua posizione è usata per trovare trasporti, luoghi e informazioni locali nelle vicinanze e per segnalare con un suono la distanza rimanente verso una destinazione." ;;
    ja) echo "現在地の近くの交通・場所・生活情報を探すため、および目的地までの残り距離を音で知らせるために位置情報を使用します。" ;;
    *) echo "" ;;
  esac
}

changed=0
for f in "$RES"/*.lproj/InfoPlist.strings; do
  [ -f "$f" ] || continue
  lang=$(basename "$(dirname "$f")" .lproj)

  name=$(plutil -extract CFBundleDisplayName raw -o - "$f" 2>/dev/null) || name=""
  if [ -n "$name" ]; then
    # 증분 빌드에서 접미사가 겹치지 않게 한다(alwaysOutOfDate라 매 빌드 실행된다).
    case "$name" in
      *"$SUFFIX") : ;;
      *) plutil -replace CFBundleDisplayName -string "${name}${SUFFIX}" "$f" ;;
    esac
  fi

  purpose=$(location_purpose "$lang")
  if [ -n "$purpose" ]; then
    plutil -replace NSLocationWhenInUseUsageDescription -string "$purpose" "$f"
  fi
  changed=$((changed + 1))
done

# 리소스가 하나도 안 잡히면 조용히 통과하지 않는다. 경로 상수가 바뀌면 표시 이름과
# 권한 문구가 공식판 값 그대로 나가는데, 빌드는 성공하므로 알아챌 방법이 없다.
if [ "$changed" -eq 0 ]; then
  echo "error: InfoPlist.strings를 찾지 못했습니다 ($RES)" >&2
  exit 1
fi
echo "실험판 InfoPlist 후처리: ${changed}개 로케일"
