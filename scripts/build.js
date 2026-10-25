// html-validate를 통과한 index.html을 배포용 dist/로 복사한다
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(outDir, 'index.html'));
console.log('build: dist/index.html 생성');
