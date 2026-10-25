// index.html의 <script>를 가짜 DOM 위에서 실행해 핵심 동작을 검사한다
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const DEFAULT_MENU_COUNT = 33;
const KEYS = { menus: 'mealRoulette.menus', history: 'mealRoulette.history' };

function makeEnv(storage = new Map(), { reduceMotion = false } = {}) {
  const els = {};
  const winListeners = {};
  let focused = null;
  const ctx = new Proxy({}, {
    get: (t, k) => k === 'measureText' ? s => ({ width: s.length * 16 })
      : k in t ? t[k] : () => {},
    set: (t, k, v) => { t[k] = v; return true; },
  });

  // innerHTML의 <button>을 가짜 요소로 바꿔 준다. innerHTML이 그대로면 같은 객체를 돌려주므로
  // "다시 그리지 않았는지(포커스가 유지되는지)"를 확인할 수 있다.
  const parseButtons = el => {
    if (el.parsedFrom !== el.innerHTML) {
      el.parsedFrom = el.innerHTML;
      el.buttons = [...el.innerHTML.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => {
        const btn = makeEl(null);
        for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
          btn.attrs[k] = v;
          if (k.startsWith('data-')) btn.dataset[k.slice(5)] = v;
        }
        return btn;
      });
    }
    return el.buttons;
  };

  const makeEl = id => {
    const listeners = {};
    const classes = new Set();
    return {
      id, innerHTML: '', textContent: '', value: '', disabled: false,
      clientWidth: 340, width: 0, height: 0, offsetWidth: 0, style: {}, dataset: {}, attrs: {},
      checked: [],
      listeners,
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
        has: c => classes.has(c),
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
      removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
      focus() { focused = this; },
      querySelectorAll(selector) {
        if (selector === 'input:checked') return this.checked.map(value => ({ value }));
        if (selector === 'input') return [makeEl(`${this.id} input`)];
        if (selector === '.del') return parseButtons(this).filter(b => (b.attrs.class || '').split(' ').includes('del'));
        const m = selector.match(/^button\[data-([\w-]+)(?:="([^"]*)")?\]$/);
        if (m) return parseButtons(this).filter(b => m[1] in b.dataset && (m[2] === undefined || b.dataset[m[1]] === m[2]));
        throw new Error(`테스트 DOM이 모르는 선택자: ${selector}`);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      getContext: () => ctx,
    };
  };
  const document = { getElementById: id => (els[id] ||= makeEl(id)) };
  // 페이지가 아직 조회하지 않은 요소도 테스트에서 바로 만질 수 있게 한다
  const $ = new Proxy(els, { get: (t, k) => document.getElementById(k) });
  const window = {
    devicePixelRatio: 2,
    matchMedia: query => ({ matches: reduceMotion && query.includes('reduce') }),
    addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
  };
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
  };

  const api = new Function('document', 'window', 'localStorage', `${script}
    return {
      state: () => ({ menus, history: historyItems, wheelItems, rotation, spinning, wheelStale, meal }),
      consts: { SPIN_MS, REDUCED_SPIN_MS, MAX_HISTORY },
      getCandidates,
    };`)(document, window, localStorage);

  const fire = (id, type, e = {}) => ($[id].listeners[type] || []).forEach(fn => fn(e));
  const fireWindow = (type, e = {}) => (winListeners[type] || []).forEach(fn => fn(e));
  // closest()가 돌려줄 대상: dataset만 주거나, 가짜 DOM이 만든 버튼 객체를 그대로 준다
  const click = (id, target) => fire(id, 'click', { target: { closest: () => target.attrs ? target : { dataset: target } } });
  const endSpin = () => fire('wheel', 'transitionend', { propertyName: 'transform' });
  const spinOnce = () => {
    fire('spinBtn', 'click');
    const before = api.state();
    endSpin();
    return before;
  };
  const addMenu = (name, category, meals) => {
    $.menuName.value = name;
    $.menuCategory.value = category;
    $.mealChecks.checked = meals;
    fire('addForm', 'submit', { preventDefault() {} });
  };

  return { api, els: $, fire, fireWindow, click, endSpin, spinOnce, addMenu, focused: () => focused };
}

// 포인터(12시)가 가리키는 칸: 캔버스를 R도 돌리면 원래 각도 -R 지점이 12시에 온다
const pointerIndex = (rotation, n) => Math.floor(((((-rotation) % 360) + 360) % 360) / (360 / n));

test('초기 렌더링: 원판은 12칸 이하, 후보 안내 문구가 있다', () => {
  const { api, els } = makeEnv();
  const s = api.state();
  assert.ok(s.wheelItems.length > 0 && s.wheelItems.length <= 12);
  assert.match(els.info.textContent, /후보 \d+개/);
  assert.strictEqual(els.menuCount.textContent, `${DEFAULT_MENU_COUNT}개`);
});

test('점심은 후보가 12개를 넘으므로 12칸만 표시한다', () => {
  const { api, els, click } = makeEnv();
  click('mealTabs', { meal: 'lunch' });
  const { pool } = api.getCandidates();
  assert.ok(pool.length > 12, `점심 후보 ${pool.length}개`);
  assert.strictEqual(api.state().wheelItems.length, 12);
  assert.match(els.info.textContent, new RegExp(`후보 ${pool.length}개 중 12개 표시`));
});

test('회전각 공식: 2000번 돌려도 포인터 아래 칸이 항상 당첨 메뉴와 같다', () => {
  for (const reduceMotion of [false, true]) {
    const { api, click, spinOnce } = makeEnv(new Map(), { reduceMotion });
    click('mealTabs', { meal: 'lunch' });
    for (let t = 0; t < 1000; t++) {
      const s = spinOnce();
      const shown = s.wheelItems[pointerIndex(s.rotation, s.wheelItems.length)];
      const after = api.state();
      assert.strictEqual(shown.id, after.history[0].menuId, `n=${s.wheelItems.length}, rotation=${s.rotation}`);
      assert.strictEqual(after.spinning, false);
    }
  }
});

test('동작 줄이기 설정이면 바퀴를 돌리지 않고 짧게 움직인다', () => {
  const normal = makeEnv();
  normal.fire('spinBtn', 'click');
  assert.strictEqual(normal.els.wheel.style.transitionDuration, `${normal.api.consts.SPIN_MS}ms`);
  assert.ok(normal.api.state().rotation >= 5 * 360);
  normal.endSpin();

  const reduced = makeEnv(new Map(), { reduceMotion: true });
  reduced.fire('spinBtn', 'click');
  assert.strictEqual(reduced.els.wheel.style.transitionDuration, `${reduced.api.consts.REDUCED_SPIN_MS}ms`);
  assert.ok(reduced.api.state().rotation < 360);
  reduced.endSpin();
});

test('돌리기를 연타해도 한 번만 돌고 한 번만 기록된다', () => {
  const { api, fire, endSpin } = makeEnv();
  fire('spinBtn', 'click');
  const firstRotation = api.state().rotation;
  fire('spinBtn', 'click');
  assert.strictEqual(api.state().rotation, firstRotation);
  endSpin();
  assert.strictEqual(api.state().history.length, 1);
});

test('transitionend가 오지 않아도 폴백 타이머로 끝나고, 늦게 온 이벤트는 무시한다', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, fire, endSpin } = makeEnv();
  fire('spinBtn', 'click');
  t.mock.timers.tick(api.consts.SPIN_MS + 299);
  assert.strictEqual(api.state().spinning, true);
  t.mock.timers.tick(1);
  assert.strictEqual(api.state().spinning, false);
  assert.strictEqual(api.state().history.length, 1);
  endSpin();
  assert.strictEqual(api.state().history.length, 1);
});

test('도는 중에 필터를 바꾸면 원판은 그대로 두고 다음 판에 반영한다', () => {
  const { api, els, click, fire, endSpin } = makeEnv();
  click('mealTabs', { meal: 'dinner' });
  fire('spinBtn', 'click');
  const during = api.state().wheelItems;
  click('chips', { cat: '중식' });
  assert.strictEqual(els.spinBtn.disabled, true);
  assert.strictEqual(api.state().wheelItems, during);
  assert.strictEqual(api.state().wheelStale, true);
  endSpin();
  assert.strictEqual(api.state().history.length, 1);
  assert.strictEqual(els.spinBtn.disabled, false);

  fire('spinBtn', 'click');
  assert.ok(api.state().wheelItems.every(m => m.category === '중식'));
  endSpin();
});

test('오늘 나온 메뉴 제외: 후보를 다 돌 때까지 중복이 없고, 다 떨어지면 다시 포함한다', () => {
  const { api, els, click, spinOnce } = makeEnv();
  click('mealTabs', { meal: 'breakfast' });
  const total = api.getCandidates().pool.length;
  const seen = new Set();
  for (let i = 0; i < total; i++) {
    spinOnce();
    const id = api.state().history[0].menuId;
    assert.ok(!seen.has(id), `중복 당첨: ${id}`);
    seen.add(id);
  }
  assert.strictEqual(seen.size, total);
  assert.match(els.notice.textContent, /다시 포함했어요/);
  assert.strictEqual(els.spinBtn.disabled, false);
});

test('카테고리 필터: 중식만 고르면 원판에 중식만 올라간다', () => {
  const { api, click } = makeEnv();
  click('mealTabs', { meal: 'dinner' });
  click('chips', { cat: '중식' });
  const s = api.state();
  assert.ok(s.wheelItems.length > 0);
  assert.ok(s.wheelItems.every(m => m.category === '중식'));
});

test('조건에 맞는 메뉴가 없으면 돌리기 버튼이 꺼진다', () => {
  const { els, click } = makeEnv();
  click('mealTabs', { meal: 'breakfast' });
  click('chips', { cat: '중식' });
  assert.strictEqual(els.spinBtn.disabled, true);
  assert.match(els.info.textContent, /조건에 맞는 메뉴가 없어요/);
  click('chips', { cat: '' });
  assert.strictEqual(els.spinBtn.disabled, false);
});

test('끼니 탭과 칩은 다시 그리지 않고 눌림 상태만 바꿔 포커스를 지킨다', () => {
  const { els, click } = makeEnv();
  const chipsBefore = els.chips.querySelectorAll('button[data-cat]');
  const tabsBefore = els.mealTabs.querySelectorAll('button[data-meal]');
  const pressed = (buttons, key, value) => buttons.find(b => b.dataset[key] === value).attrs['aria-pressed'];

  click('chips', { cat: '중식' });
  click('mealTabs', { meal: 'dinner' });

  const chipsAfter = els.chips.querySelectorAll('button[data-cat]');
  const tabsAfter = els.mealTabs.querySelectorAll('button[data-meal]');
  assert.strictEqual(chipsAfter, chipsBefore, '칩 버튼이 다시 만들어졌다');
  assert.strictEqual(tabsAfter, tabsBefore, '끼니 버튼이 다시 만들어졌다');
  assert.strictEqual(pressed(chipsAfter, 'cat', '중식'), 'true');
  assert.strictEqual(pressed(chipsAfter, 'cat', ''), 'false');
  assert.strictEqual(pressed(tabsAfter, 'meal', 'dinner'), 'true');
  assert.strictEqual(tabsAfter.filter(b => b.attrs['aria-pressed'] === 'true').length, 1);
});

test('메뉴 추가: 검증 후 추가되고, 오류는 입력창에 표시되며 이름은 HTML 이스케이프된다', () => {
  const { api, els, fire, addMenu, focused } = makeEnv();
  addMenu('  ', '기타', ['lunch']);
  assert.match(els.formMsg.textContent, /이름을 입력/);
  assert.strictEqual(els.menuName.attrs['aria-invalid'], 'true');
  assert.strictEqual(focused(), els.menuName);
  fire('menuName', 'input');
  assert.strictEqual(els.menuName.attrs['aria-invalid'], undefined);

  addMenu('<b>테스트</b>', '기타', []);
  assert.match(els.formMsg.textContent, /끼니를 하나 이상/);
  assert.strictEqual(focused().id, 'mealChecks input');

  addMenu('<b>테스트</b>', '기타', ['breakfast']);
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT + 1);
  assert.ok(els.menuList.innerHTML.includes('&lt;b&gt;테스트&lt;/b&gt;'));
  assert.ok(!els.menuList.innerHTML.includes('<b>테스트'));

  addMenu('<b>테스트</b>', '기타', ['breakfast']);
  assert.match(els.formMsg.textContent, /이미 있는 메뉴/);
  assert.strictEqual(els.menuName.attrs['aria-invalid'], 'true');
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT + 1);
});

test('메뉴 삭제: 다음 삭제 버튼으로 포커스가 가고, 되돌리면 같은 자리로 돌아온다', () => {
  const { api, els, click, focused } = makeEnv();
  const dels = els.menuList.querySelectorAll('.del');
  const [, target, next] = dels;
  const originalIndex = api.state().menus.findIndex(m => m.id === target.dataset.id);

  click('menuList', target);
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT - 1);
  assert.strictEqual(focused().dataset.id, next.dataset.id);
  assert.match(els.toast.innerHTML, /삭제했어요/);

  click('toast', { action: 'undo' });
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT);
  assert.strictEqual(api.state().menus[originalIndex].id, target.dataset.id);
  assert.strictEqual(focused().dataset.id, target.dataset.id);
  assert.strictEqual(els.toast.innerHTML, '');
});

test('마지막 메뉴를 지우면 이전 삭제 버튼, 모두 지우면 이름 입력창으로 포커스가 간다', () => {
  const storage = new Map([[KEYS.menus, JSON.stringify([
    { id: 'a', name: '김밥', category: '분식', meals: ['lunch'] },
    { id: 'b', name: '라면', category: '분식', meals: ['lunch'] },
  ])]]);
  const { api, els, click, focused } = makeEnv(storage);
  const [first, last] = els.menuList.querySelectorAll('.del');
  click('menuList', last);
  assert.strictEqual(focused().dataset.id, first.dataset.id);
  click('menuList', els.menuList.querySelectorAll('.del')[0]);
  assert.strictEqual(api.state().menus.length, 0);
  assert.strictEqual(focused(), els.menuName);
});

test('되돌리기 알림을 닫으면 삭제가 유지되고 포커스는 입력창으로 간다', () => {
  const { api, els, click, focused } = makeEnv();
  click('menuList', els.menuList.querySelectorAll('.del')[0]);
  click('toast', { action: 'close' });
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT - 1);
  assert.strictEqual(els.toast.innerHTML, '');
  assert.strictEqual(focused(), els.menuName);
});

test('기록 지우기: 되돌리기 버튼으로 포커스가 가고, 되돌리면 그 사이 새 기록이 앞에 온다', () => {
  const { api, els, click, spinOnce, focused } = makeEnv();
  spinOnce();
  spinOnce();
  const old = api.state().history.map(h => h.at);

  click('clearHistory', {});
  assert.strictEqual(api.state().history.length, 0);
  assert.strictEqual(focused().dataset.action, 'undo');

  spinOnce();
  const newest = api.state().history[0].at;
  click('toast', { action: 'undo' });
  assert.deepStrictEqual(api.state().history.map(h => h.at), [newest, ...old]);
  assert.strictEqual(focused(), els.clearHistory);
});

test('기본 목록으로 초기화도 되돌릴 수 있다', () => {
  const { api, click, addMenu } = makeEnv();
  addMenu('마라샹궈', '중식', ['dinner']);
  click('resetMenus', {});
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT);
  click('toast', { action: 'undo' });
  assert.ok(api.state().menus.some(m => m.name === '마라샹궈'));
});

test('새로고침 시뮬레이션: 저장된 메뉴와 기록이 그대로 복원된다', () => {
  const storage = new Map();
  const first = makeEnv(storage);
  first.addMenu('마라샹궈', '중식', ['dinner']);
  first.spinOnce();
  const before = first.api.state();

  const reloaded = makeEnv(storage);
  const after = reloaded.api.state();
  assert.strictEqual(after.menus.length, before.menus.length);
  assert.ok(after.menus.some(m => m.name === '마라샹궈'));
  assert.strictEqual(after.history.length, 1);
  assert.ok(reloaded.els.history.innerHTML.includes('<ul class="history">'));
});

test('손상된 저장값이 있어도 기본 목록으로 시작한다', () => {
  const broken = new Map([[KEYS.menus, '{not json'], [KEYS.history, '"oops"']]);
  const s = makeEnv(broken).api.state();
  assert.strictEqual(s.menus.length, DEFAULT_MENU_COUNT);
  assert.deepStrictEqual(s.history, []);
});

test('깨진 기록 항목은 걸러내고 앱이 정상으로 시작한다', () => {
  const at = new Date().toISOString();
  const storage = new Map([[KEYS.history, JSON.stringify([
    null,
    '김치찌개',
    { menuId: 'd1', name: '김치찌개', meal: '__proto__', at },
    { menuId: 'd2', name: '된장찌개', meal: 'lunch', at: 'not a date' },
    { menuId: 'd3', name: '비빔밥', meal: 'lunch', at },
  ])]]);
  const { api, els } = makeEnv(storage);
  assert.deepStrictEqual(api.state().history.map(h => h.menuId), ['d3']);
  assert.ok(els.history.innerHTML.includes('비빔밥'));
  assert.ok(api.state().wheelItems.length > 0);
});

test('메뉴 저장값: 전부 형식 오류면 기본 목록, 빈 배열이면 그대로, 일부만 오류면 유효한 것만', () => {
  const load = saved => makeEnv(new Map([[KEYS.menus, JSON.stringify(saved)]])).api.state().menus;
  assert.strictEqual(load([{ id: '1', name: '김치찌개', category: 'korean', meals: ['lunch'] }]).length, DEFAULT_MENU_COUNT);
  assert.deepStrictEqual(load([]), []);
  const mixed = load([
    { id: 'a', name: '김치찌개', category: '한식', meals: ['lunch'] },
    { id: 'b', name: '이상한 끼니', category: '한식', meals: ['__proto__'] },
    { id: 'c', name: '  ', category: '한식', meals: ['lunch'] },
  ]);
  assert.deepStrictEqual(mixed.map(m => m.id), ['a']);
});

test('다른 탭에서 저장한 값을 storage 이벤트로 다시 읽는다', () => {
  const storage = new Map();
  const { api, els, fireWindow } = makeEnv(storage);
  storage.set(KEYS.menus, JSON.stringify([{ id: 'x', name: '탕후루', category: '기타', meals: ['lunch'] }]));

  fireWindow('storage', { key: 'other.key' });
  assert.strictEqual(api.state().menus.length, DEFAULT_MENU_COUNT);

  fireWindow('storage', { key: KEYS.menus });
  assert.deepStrictEqual(api.state().menus.map(m => m.name), ['탕후루']);
  assert.strictEqual(els.menuCount.textContent, '1개');
});
