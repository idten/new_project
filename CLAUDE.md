# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
식단 룰렛: 끼니·카테고리로 거른 메뉴 중 하나를 룰렛으로 고르는 한국어 웹앱. `index.html` 한 파일에 CSS와 JS가 인라인으로 들어 있고, 런타임 의존성·번들러·외부 CDN이 없다. `devDependencies`는 검사 도구뿐이다.

## 명령
```bash
npm run lint    # ESLint: index.html의 인라인 <script>(브라우저, script), *.js(Node, CommonJS), *.mjs
npm run build   # html-validate index.html 후 dist/index.html로 복사(scripts/build.js). dist/는 git 무시 대상
npm test        # node --test: tests/*.test.js 전부
npm run check   # lint → build → test

# 테스트 하나만 (이름은 한국어 test() 제목의 일부)
node --test --test-name-pattern="회전각" tests/roulette.test.js
```
브라우저에서 확인할 때는 `index.html`을 그냥 열면 된다(서버 불필요).

## 구조

### index.html의 스크립트
- 상태는 최상위 `let` 변수(`menus`, `historyItems`, `meal`, `selectedCats`, `wheelItems`, `rotation`, `spinning`, `wheelStale`, `pendingUndo`)이고, 바뀔 때마다 `render*()` 함수가 해당 영역을 innerHTML로 다시 그린다. 이벤트는 컨테이너에 위임하고 `closest()`로 대상을 찾는다.
- 갱신 흐름: 필터·메뉴 변경 → `buildWheel()` → `renderInfo()` → `getCandidates()`. 후보는 끼니·카테고리로 거른 뒤 **오늘(로컬 날짜) 이미 나온 메뉴를 빼고**, 다 빠지면 다시 포함한다. 원판에는 섞어서 최대 `MAX_SLICES`(12)칸만 올린다.
- 회전: `spin()`이 당첨 칸을 먼저 뽑고, 칸 i의 중심이 12시 포인터에 오도록 `rotation ≡ -(i + 0.5) × 칸각도 (mod 360)`으로 CSS transform을 건다. 칸 0은 12시에서 시계 방향으로 시작한다(`drawWheel()`). 끝은 `transitionend` 또는 폴백 타이머(`duration + 300ms`) 중 먼저 오는 쪽이 한 번만 `finishSpin()`을 부른다. 도는 중에 필터가 바뀌면 원판은 그대로 두고 `wheelStale = true`로 표시해 다음 판에 다시 만든다.
- 저장: localStorage 키 `mealRoulette.menus`, `mealRoulette.history`. 모든 접근은 `store`(try/catch)로 감싸고, 읽은 값은 `isValidMenu`/`isValidHistory`로 걸러 쓴다(빈 배열 `[]`은 사용자가 다 지운 것으로 보고 유지). 다른 탭의 변경은 `storage` 이벤트로 다시 읽는다.
- 삭제·기록 지우기·초기화는 확인 창 대신 **되돌리기 토스트**(`showToast(message, undo, returnFocus)`)로 복구한다. 각 동작은 포커스가 어디로 갈지도 정한다.
- 끼니 탭과 카테고리 칩은 `renderFilters()`로 처음 한 번만 그리고, 이후엔 `syncPressed()`로 `aria-pressed`만 바꾼다. 다시 그리면 키보드 포커스가 사라지기 때문이다.

### 테스트 하네스 (tests/roulette.test.js)
브라우저 없이, `index.html`에서 정규식 `/<script>([\s\S]*?)<\/script>/`로 **첫 번째 속성 없는 `<script>`** 를 꺼내 `new Function`으로 가짜 `document`/`window`/`localStorage` 위에서 실행한다. 그래서 index.html을 바꿀 때:
- 인라인 `<script>`는 하나로 두고 속성(`type` 등)을 달지 않는다. 다른 `<script>`를 그 앞에 넣으면 하네스가 엉뚱한 코드를 실행한다.
- 하네스가 스크립트 끝에 붙인 `return { state: () => ({ menus, history: historyItems, wheelItems, rotation, spinning, wheelStale, meal }), consts: { SPIN_MS, REDUCED_SPIN_MS, MAX_HISTORY }, getCandidates }`가 이 이름들을 직접 참조한다. 이름을 바꾸면 테스트도 고친다.
- 가짜 DOM의 `querySelectorAll`은 쓰이는 선택자만 안다(`input:checked`, `input`, `.del`, `button[data-x]`, `button[data-x="y"]`). 새 선택자를 쓰면 `테스트 DOM이 모르는 선택자` 오류가 나므로 `makeEnv()`의 가짜 DOM을 함께 넓힌다.
- `DEFAULT_MENU_COUNT`(33)는 `DEFAULT_MENUS` 길이와 맞아야 한다.

### Claude Code 설정 (.claude/)
- `settings.json`의 PreToolUse 훅이 Bash/PowerShell 명령마다 `.claude/hooks/pre-commit-check.js`를 실행한다. `git commit`이면 `npm run lint` → `build` → `test`를 돌려 실패 시 커밋을 **deny**하고, 통과했어도 스테이징 안 된 변경이 있으면 **ask**한다(`git add -A`/`commit -a`처럼 전체를 스테이징하는 명령은 예외). 그래서 커밋 명령은 검사 시간만큼 오래 걸린다. 훅의 명령 판별 로직(`isGitCommit`, `stagesWorkTree`)은 `tests/pre-commit-check.test.js`가 검사한다.
- 코드 리뷰는 `code-reviewer` 에이전트(읽기 전용) 또는 `project-code-review` 스킬을 쓴다. 이 프로젝트에서 깨지기 쉬운 지점은 `.claude/skills/project-code-review/checklist.md`에 모여 있다.

## 관례
- UI 문구와 코드 주석은 한국어. 주석은 "무엇"보다 "왜"를 쓴다.
- innerHTML에 넣는 사용자·저장값은 속성 값(`aria-label`, `data-id`)까지 모두 `esc()`를 거친다.
- 브라우저 전역을 가리는 이름을 피한다(기록 배열이 `history`가 아니라 `historyItems`인 이유).
- 접근성·모바일 기준: 조작은 모두 `<button>`·키보드로 가능, 토글엔 `aria-pressed`, 터치 대상 약 44px, `prefers-reduced-motion` 존중(회전 대신 `REDUCED_SPIN_MS`로 짧게 이동), 375px 폭에서 가로 스크롤 없음.
