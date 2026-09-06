#!/usr/bin/env node
// 동행복권 공식 회차 데이터를 받아 index.html의 RAW 배열에 이어붙인다.
//
//   node tools/update-draws.mjs           실제로 반영
//   node tools/update-draws.mjs --dry-run  받아서 검증만 하고 파일은 건드리지 않음
//
// 검증을 통과하지 못하면 아무것도 쓰지 않고 종료 코드 1로 끝난다.
// 추첨 결과는 지어낼 수 없는 값이라, 의심스러우면 반영하지 않는 쪽이 옳다.

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'index.html';
const SW = 'sw.js';
const LOOKAHEAD = 12;          // 오래 방치돼도 한 번에 따라잡을 수 있도록
const DRY = process.argv.includes('--dry-run');

const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://www.dhlottery.co.kr/lt645/result',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
};

const die = m => { console.error('✗ ' + m); process.exit(1); };

// ---------- 현재 데이터 읽기 ----------
const html = readFileSync(HTML, 'utf8');
const rawMatch = html.match(/^const RAW=(\[.*\]);$/m);
if (!rawMatch) die('index.html에서 RAW 배열을 찾지 못했습니다.');
const RAW = JSON.parse(rawMatch[1]);
const last = RAW[RAW.length - 1][0];
console.log(`현재 데이터: 1회 ~ ${last}회 (${RAW.length}회차)`);

// ---------- 받아오기 ----------
const url = `${API}?srchStrLtEpsd=${last + 1}&srchEndLtEpsd=${last + LOOKAHEAD}`;
let json;
try {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) die(`API 응답 ${res.status}`);
  const text = await res.text();
  if (!text.trim().startsWith('{')) die('JSON이 아닌 응답을 받았습니다. 봇 차단이나 점검일 수 있습니다.');
  json = JSON.parse(text);
} catch (e) {
  die('조회 실패: ' + e.message);
}

const list = json?.data?.list ?? [];
if (!list.length) { console.log('새 회차가 없습니다. 이미 최신입니다.'); process.exit(0); }

// ---------- 검증 ----------
// 공식 응답이라도 그대로 믿지 않는다. 형식이 어긋나면 한 건이라도 반영하지 않는다.
const rows = list
  .map(d => {
    const nums = [d.tm1WnNo, d.tm2WnNo, d.tm3WnNo, d.tm4WnNo, d.tm5WnNo, d.tm6WnNo];
    const ymd = String(d.ltRflYmd ?? '');
    return {
      no: d.ltEpsd,
      nums: nums.slice().sort((a, b) => a - b),
      bonus: d.bnsWnNo,
      date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      prize1: d.rnk1WnAmt,
      win1: d.rnk1WnNope,
      raw: d,
    };
  })
  .sort((a, b) => a.no - b.no);

const isInt = v => Number.isInteger(v);
for (const r of rows) {
  const t = `${r.no}회`;
  if (!isInt(r.no) || r.no <= 0) die(`${t}: 회차 번호가 이상합니다.`);
  if (r.nums.length !== 6) die(`${t}: 번호가 6개가 아닙니다.`);
  if (!r.nums.every(n => isInt(n) && n >= 1 && n <= 45)) die(`${t}: 번호가 1~45 범위를 벗어났습니다.`);
  if (new Set(r.nums).size !== 6) die(`${t}: 번호가 중복됩니다.`);
  if (!isInt(r.bonus) || r.bonus < 1 || r.bonus > 45) die(`${t}: 보너스 번호가 이상합니다.`);
  if (r.nums.includes(r.bonus)) die(`${t}: 보너스 번호가 당첨번호와 겹칩니다.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) die(`${t}: 날짜 형식이 이상합니다 (${r.date}).`);
  if (!isInt(r.prize1) || r.prize1 < 0) die(`${t}: 1등 상금이 이상합니다.`);
  if (!isInt(r.win1) || r.win1 < 0) die(`${t}: 1등 당첨자 수가 이상합니다.`);
  // 1인당 상금 x 당첨자 수가 총액과 맞는지 (공식 응답 내부 정합성)
  if (r.win1 > 0 && Math.abs(r.prize1 * r.win1 - r.raw.rnk1SumWnAmt) > r.win1) {
    die(`${t}: 1등 총액이 1인당 상금 x 당첨자 수와 맞지 않습니다.`);
  }
}

// 회차가 끊기지 않고 이어지는지
rows.forEach((r, i) => {
  const expect = last + 1 + i;
  if (r.no !== expect) die(`회차가 연속하지 않습니다. ${expect}회를 기대했으나 ${r.no}회를 받았습니다.`);
});

// 추첨은 토요일이다. 아니면 데이터를 의심한다.
for (const r of rows) {
  const [y, m, d] = r.date.split('-').map(Number);
  if (new Date(y, m - 1, d).getDay() !== 6) die(`${r.no}회: 추첨일이 토요일이 아닙니다 (${r.date}).`);
}

// 앞 회차보다 날짜가 뒤인지
let prevDate = RAW[RAW.length - 1][3];
for (const r of rows) {
  if (r.date <= prevDate) die(`${r.no}회: 날짜가 앞 회차(${prevDate})보다 뒤가 아닙니다.`);
  prevDate = r.date;
}

console.log(`\n받은 회차 ${rows.length}건 — 검증 통과\n`);
for (const r of rows) {
  console.log(`  ${r.no}회  ${r.date}  [${r.nums.join(', ')}] + ${r.bonus}` +
              `   1등 ${r.win1}명 / 1인당 ${r.prize1.toLocaleString('ko-KR')}원`);
}

if (DRY) { console.log('\n--dry-run: 파일을 변경하지 않았습니다.'); process.exit(0); }

// ---------- 반영 ----------
const serialize = r =>
  `[${r.no},[${r.nums.join(',')}],${r.bonus},"${r.date}",${r.prize1},${r.win1}]`;
const appended = rawMatch[1].replace(/\]$/, ',' + rows.map(serialize).join(',') + ']');
let out = html.replace(rawMatch[0], `const RAW=${appended};`);

// 정적 리소스가 바뀌었으니 서비스워커 캐시를 무효화한다
const sw = readFileSync(SW, 'utf8');
const cacheMatch = sw.match(/const CACHE = 'lotto645-v(\d+)';/);
if (!cacheMatch) die('sw.js에서 CACHE 버전을 찾지 못했습니다.');
const nextV = Number(cacheMatch[1]) + 1;

// 다시 파싱해서 실제로 온전한지 확인한 뒤에만 기록한다
const check = JSON.parse(out.match(/^const RAW=(\[.*\]);$/m)[1]);
if (check.length !== RAW.length + rows.length) die('반영 후 회차 수가 맞지 않습니다.');
if (check[check.length - 1][0] !== rows[rows.length - 1].no) die('반영 후 마지막 회차가 맞지 않습니다.');

writeFileSync(HTML, out);
writeFileSync(SW, sw.replace(cacheMatch[0], `const CACHE = 'lotto645-v${nextV}';`));

console.log(`\n✓ ${RAW.length}회차 → ${check.length}회차 (${rows[0].no}~${rows[rows.length-1].no}회 추가)`);
console.log(`✓ sw.js CACHE v${cacheMatch[1]} → v${nextV}`);
