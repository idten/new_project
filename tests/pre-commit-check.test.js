// 커밋 전 검사 훅(.claude/hooks/pre-commit-check.js)의 명령 판별과 결정(deny/ask)을 검사한다
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'pre-commit-check.js');
const { isGitCommit, stagesWorkTree } = require(HOOK);

test('커밋 명령을 알아본다', () => {
  for (const command of [
    'git commit -m x',
    'git add . && git commit -m "wip"',
    'git -C . commit',
    'git -C "C:/My Projects/app" commit -m x',
    "git -c user.name='A B' commit -m x",
    'git --no-pager commit -m x',
    'cd app; git commit',
  ]) {
    assert.ok(isGitCommit(command), command);
  }
});

test('커밋이 아닌 명령은 거른다', () => {
  for (const command of ['ls', 'git status', 'git log --grep commit', 'git log --grep "fix commit"', 'npm test']) {
    assert.ok(!isGitCommit(command), command);
  }
});

test('아주 긴 명령도 정규식이 오래 걸리지 않는다', () => {
  const command = `git ${'-a '.repeat(20000)}x`;
  const started = Date.now();
  assert.ok(!isGitCommit(command));
  assert.ok(Date.now() - started < 500, `${Date.now() - started}ms`);
});

test('작업 폴더 전체를 스테이징하는 커밋인지 알아본다', () => {
  for (const command of [
    'git add . && git commit -m x',
    'git add -A && git commit -m x',
    'git add --all; git commit',
    'git commit -am "x"',
    'git commit -a -m x',
    'git commit --all -m x',
  ]) {
    assert.ok(stagesWorkTree(command), command);
  }
  for (const command of [
    'git commit -m x',
    'git commit --amend -m x',
    'git add index.html && git commit -m x',
    'git add ./src && git commit -m x',
    'git commit -m "fix" --author=alice',
  ]) {
    assert.ok(!stagesWorkTree(command), command);
  }
});

test('실제 저장소에서: 검사 실패는 deny, 스테이징 안 된 변경은 ask, 전체 스테이징 커밋은 통과', t => {
  // 검사 스크립트가 가볍고 결과를 정할 수 있는 임시 저장소를 만든다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'hook-test',
    private: true,
    scripts: {
      lint: 'node -e ""',
      build: 'node -e ""',
      test: 'node -e "process.exit(Number(process.env.HOOK_TEST_FAIL || 0))"',
    },
  }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'staged\n');
  git('add', 'a.txt');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed after staging\n');

  const runHook = (command, env = {}) => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
  };

  const denied = runHook('git commit -m x', { HOOK_TEST_FAIL: '1' });
  assert.strictEqual(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /npm run test \(exit 1\)/);

  const asked = runHook('git commit -m x');
  assert.strictEqual(asked.permissionDecision, 'ask');

  assert.strictEqual(runHook('git commit -am x'), null);
  assert.strictEqual(runHook('ls'), null);
});
