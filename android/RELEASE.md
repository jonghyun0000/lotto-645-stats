# 안드로이드 앱 출시 안내

이 폴더는 배포된 웹앱을 그대로 감싸는 **TWA(Trusted Web Activity)** 프로젝트입니다.
앱 화면은 `https://jonghyun0000.github.io/lotto-645-stats/` 를 주소창 없이 전체화면으로 띄웁니다.

매주 일요일 워크플로가 새 회차를 반영하면 **앱도 자동으로 최신이 됩니다.**
새 회차 때문에 앱 업데이트를 올릴 필요가 없습니다.

## 구성

| | |
|---|---|
| 패키지명 | `io.github.jonghyun0000.lotto645` |
| 도메인 | `jonghyun0000.github.io` |
| 시작 경로 | `/lotto-645-stats/?source=twa` |
| compileSdk / targetSdk | 36 (플레이 요구치 35 이상 충족) |
| minSdk | 23 (Android 6.0) |

## 서명 키 — 가장 중요

```
키스토어  ~/.keystores/lotto645-upload.jks
비밀번호  ~/.keystores/lotto645-upload.pass
별칭      lotto645
```

**이 키를 잃으면 같은 앱으로 업데이트를 올릴 수 없습니다.** 반드시 별도 매체에 백업하세요.
저장소에는 절대 커밋하지 않습니다(`.gitignore`로 차단해 두었습니다).

## 빌드

```bash
cd android
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat ~/.keystores/lotto645-upload.pass)"
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
bubblewrap build --skipPwaValidation
```

`app-release-bundle.aab`(플레이 업로드용)와 `app-release-signed.apk`(직접 설치용)가 나옵니다.

버전을 올릴 때는 `twa-manifest.json`의 `appVersionCode`와 `appVersionName`을 수정한 뒤
`bubblewrap update` → `bubblewrap build` 순으로 실행합니다.

## ⚠️ 업로드 직후 반드시 할 일 — assetlinks 갱신

플레이 앱 서명(Play App Signing)을 쓰면 구글이 **다른 키로 앱을 다시 서명**합니다.
지금 `assetlinks.json`에는 업로드 키 지문만 있어서, 그대로 두면 **출시된 앱에서 주소창이 보입니다.**

1. AAB를 처음 업로드한 뒤 플레이 콘솔 → **설정 → 앱 서명**으로 이동
2. **앱 서명 키 인증서**의 SHA-256 지문을 복사
3. `jonghyun0000.github.io` 저장소의 `.well-known/assetlinks.json`에서
   `sha256_cert_fingerprints` 배열에 그 값을 **추가**(업로드 키 지문은 남겨둘 것 — 로컬 테스트용)
4. 커밋·푸시 후 아래로 확인

```bash
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://jonghyun0000.github.io&\
relation=delegate_permission/common.handle_all_urls"
```

## 플레이 콘솔 제출 항목

- **개인정보처리방침 URL** — `https://jonghyun0000.github.io/lotto-645-stats/privacy.html`
- **데이터 보안(Data safety)** — 수집·공유 없음, 계정 없음, 광고 없음
- **콘텐츠 등급(IARC)** — 복권 소재이므로 설문에서 도박/시뮬레이션 도박 관련 문항에 사실대로 답할 것.
  한국은 만 19세 이상 등급이 됩니다.
- **앱 카테고리** — 도구 또는 라이프스타일
- **광고 포함 여부** — 없음
- **타깃 API 수준** — 36 (충족)

### 스토어 설명 작성 시 주의

당첨을 예측·보장한다는 표현은 정책 위반 소지가 있고 사실도 아닙니다.
앱 자체가 "어떤 번호 선택도 확률을 바꾸지 못한다"를 근거표로 보여주므로, 설명도 같은 톤으로 쓰세요.

> 동행복권 로또 6/45 역대 전 회차를 분석하는 통계 도구입니다.
> 당첨을 예측하지 않으며, 오히려 흔한 통념들이 데이터에서 성립하지 않는다는 것을 검정 결과와 함께 보여줍니다.
> 복권을 판매하거나 구매를 중개하지 않습니다.

## 로컬 설치 테스트

```bash
~/Library/Android/sdk/platform-tools/adb install -r android/app-release-signed.apk
```

주소창이 보이지 않으면 도메인 검증이 정상입니다. 보인다면 assetlinks 지문을 확인하세요.
