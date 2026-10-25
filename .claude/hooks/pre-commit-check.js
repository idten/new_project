// PreToolUse 훅: Claude가 git commit을 실행하기 전에 lint → build → test를 돌리고, 하나라도 실패하면 커밋을 막는다.
// stdin으로 훅 입력(JSON)을 받고, 판단은 permissionDecision JSON으로 stdout에 내보낸다.
//
// 한계:
// - git 별칭(예: `git ci`)으로 실행한 커밋은 알아보지 못한다.
// - 검사는 작업 폴더 기준이다. 스테이징되지 않은 변경이 있으면 커밋될 내용과 다를 수 있어서 사용자에게 확인을 받는다.
const { spawnSync } = require('child_process');
const fs = require('fs');

// 옵션 값은 따옴표로 감싼 경로(`git -C "C:/My Projects/app" commit`)까지 건너뛰고,
// `git log --grep "fix commit"` 같은 다른 하위 명령은 거른다
const GIT_COMMIT = /\bgit\s+(?:-\S+\s+(?:(?:"[^"]*"|'[^']*'|\S+)\s+)?)*commit\b/;
// 같은 명령 안에서 작업 폴더 전체를 스테이징하면 검사 대상과 커밋 대상이 같아진다
const STAGES_ALL = /\bgit\s+add\s+(?:-A\b|--all\b|\.(?=\s|$))|\bcommit\b.*\s(?:--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/;
const STEPS = ['lint', 'build', 'test'];
const MAX_OUTPUT_LINES = 40;

const isGitCommit = command => GIT_COMMIT.test(command);
const stagesWorkTree = command => STAGES_ALL.test(command);

function decide(permissionDecision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function runStep(step, cwd) {
  // Windows에서 npm은 npm.cmd라 셸을 거쳐야 실행된다. 명령은 고정 문자열이라 주입 위험은 없다.
  const result = spawnSync(`npm run ${step}`, { cwd, encoding: 'utf8', shell: true });
  if (result.status === 0) return null;

  const output = [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim()
    .split(/\r?\n/)
    .slice(-MAX_OUTPUT_LINES)
    .join('\n');
  return [
    `커밋 전 검사 실패: npm run ${step} (exit ${result.status ?? '없음'})`,
    output || `출력이 없어요. \`npm run ${step}\`을 직접 실행해 원인을 확인하세요.`,
    '문제를 고친 뒤 다시 커밋하세요.',
  ].join('\n\n');
}

function hasUnstagedChanges(cwd) {
  // 0: 변경 없음, 1: 변경 있음, 그 밖(저장소 아님 등): 판단하지 않는다
  return spawnSync('git', ['diff', '--quiet'], { cwd }).status === 1;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    // 입력을 읽지 못하면 판단하지 않고 평소 권한 흐름에 맡긴다
    process.exit(0);
  }

  const command = payload.tool_input?.command ?? '';
  if (!isGitCommit(command)) process.exit(0);

  const cwd = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  for (const step of STEPS) {
    const failure = runStep(step, cwd);
    if (failure) decide('deny', failure);
  }

  if (!stagesWorkTree(command) && hasUnstagedChanges(cwd)) {
    decide('ask', '검사는 통과했지만 스테이징되지 않은 변경이 있어요. 검사는 작업 폴더 기준이라 실제로 커밋될 내용과 다를 수 있어요. 그래도 커밋할까요?');
  }

  process.exit(0);
}

if (require.main === module) main();

module.exports = { isGitCommit, stagesWorkTree };
