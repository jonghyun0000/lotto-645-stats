# GitHub 업로드 방법

이 폴더는 이미 git 저장소로 초기화되어 있고 첫 커밋까지 완료된 상태입니다.
GitHub에 빈 저장소를 만든 뒤 remote만 연결하면 바로 올라갑니다.

## 1. GitHub에서 빈 저장소 만들기

github.com/new 에서 저장소를 생성합니다.

- Repository name: `lotto-645-stats` (원하는 이름으로 변경 가능)
- Public / Private 선택
- **Add a README file, .gitignore, License 는 모두 체크 해제**
  (이미 포함되어 있어 중복되면 충돌이 납니다)

## 2. 터미널에서 push

이 폴더로 이동한 뒤 아래를 실행합니다. `lotto-645-stats` 부분만 실제 저장소 이름으로 바꿔주세요.

```bash
git remote add origin https://github.com/jonghyun0000/lotto-645-stats.git
git push -u origin main
```

비밀번호를 물으면 GitHub 계정 비밀번호가 아니라
**Personal Access Token**을 입력해야 합니다.
(github.com > Settings > Developer settings > Personal access tokens > Tokens (classic)
 > Generate new token > `repo` 권한 체크)

GitHub CLI가 설치되어 있다면 더 간단합니다.

```bash
gh repo create lotto-645-stats --public --source=. --push
```

## 3. (선택) GitHub Pages로 바로 배포

저장소 Settings > Pages > Source 를 `Deploy from a branch`,
Branch 를 `main` / `/ (root)` 로 지정하면 몇 분 뒤 주소가 생깁니다.

`https://jonghyun0000.github.io/lotto-645-stats/`

모든 경로가 상대 경로라 하위 디렉터리에서도 정상 동작하며,
HTTPS라 홈 화면 설치와 오프라인 기능도 그대로 작동합니다.

## 커밋 작성자 정보 변경

현재 커밋 작성자는 아래로 설정되어 있습니다.

- name: `jonghyun0000`
- email: `jonghyun0000@users.noreply.github.com`

다른 정보로 바꾸려면 push 전에 실행하세요.

```bash
git config user.name "원하는 이름"
git config user.email "원하는 이메일"
git commit --amend --reset-author --no-edit
```
