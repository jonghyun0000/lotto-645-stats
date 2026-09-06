#!/usr/bin/env node
// index.html의 사전계산 통계 P를 동행복권 공식 데이터에서 다시 만든다.
//
//   node tools/build-stats.mjs --dry-run   계산해서 보여주기만
//   node tools/build-stats.mjs             index.html의 P를 교체
//
// ── 방법론 ────────────────────────────────────────────────────────────
// 등수별 당첨자 수는 그 회차에 몇 장이 팔렸는지에 거의 비례한다. 판매량은
// 20여 년 사이 수십 배로 변했으므로 당첨자 수를 그대로 평균 내면 시간 추세가
// 섞인다. 그래서 회차마다
//
//     ratio = 실제 당첨자 수 / (판매 게임 수 x 등수별 당첨 확률)
//
// 를 만들어 쓴다. ratio가 1보다 크면 그 회차 당첨번호를 사람들이 평균보다
// 많이 고르고 있었다는 뜻이다. 우리가 알고 싶은 것이 정확히 그것이고,
// 판매량 효과가 분모에서 상쇄된다.
//
// 회귀는 ratio ~ (당첨번호 중 12 이하 개수) 단순 OLS. 유의성은 t값과 함께
// 순열검정으로도 확인한다(설명변수를 무작위로 섞어 기울기 분포를 만들고
// 실제 기울기의 위치를 본다). 표본을 앞뒤 절반으로 갈라 각각에서도 같은
// 방향이 나오는지 본다.
// ─────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const HTML = 'index.html';
const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://www.dhlottery.co.kr/lt645/result',
  'X-Requested-With': 'XMLHttpRequest',
};
const die = m => { console.error('✗ ' + m); process.exit(1); };

// 순열검정에 난수를 쓰므로 그냥 두면 돌릴 때마다 p값이 미세하게 흔들려
// 같은 데이터인데 커밋 diff가 생긴다. 고정 시드로 결정적으로 만든다.
let _seed = 20021207;                          // 1회 추첨일
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x80000000; };
const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); };
const TOTAL = C(45, 6);                       // 8,145,060
const PROB = {                                 // 등수별 조합 수 / 전체
  1: 1 / TOTAL,
  2: 6 / TOTAL,
  3: 228 / TOTAL,
  4: C(6, 4) * C(39, 2) / TOTAL,
  5: C(6, 3) * C(39, 3) / TOTAL,
};

// ---------- 데이터 ----------
const html = readFileSync(HTML, 'utf8');
const RAW = JSON.parse(html.match(/^const RAW=(\[.*\]);$/m)[1]);
const lastNo = RAW[RAW.length - 1][0];

const res = await fetch(`${API}?srchStrLtEpsd=1&srchEndLtEpsd=${lastNo}`, { headers: HEADERS });
if (!res.ok) die(`API 응답 ${res.status}`);
const list = (await res.json())?.data?.list ?? [];
if (list.length !== lastNo) die(`회차 수 불일치: ${list.length} vs ${lastNo}`);

const D = list.map(d => ({
  no: d.ltEpsd,
  nums: [d.tm1WnNo, d.tm2WnNo, d.tm3WnNo, d.tm4WnNo, d.tm5WnNo, d.tm6WnNo].sort((a, b) => a - b),
  r1: d.rnk1WnNope, r3: d.rnk3WnNope,
  r2: d.rnk2WnNope, a1: d.rnk1WnAmt, a2: d.rnk2WnAmt, a3: d.rnk3WnAmt,
  sales: d.wholEpsdSumNtslAmt,
})).sort((a, b) => a.no - b.no);

// RAW와 어긋나면 둘 중 하나가 잘못된 것이므로 멈춘다
D.forEach((d, i) => {
  const r = RAW[i];
  if (r[0] !== d.no || r[1].join() !== d.nums.join() || r[5] !== d.r1)
    die(`${d.no}회가 index.html의 RAW와 다릅니다.`);
});

const games = d => d.sales / 1000;             // 1게임 1,000원
const usable = D.filter(d => d.sales > 0);
const lowCnt = d => d.nums.filter(n => n <= 12).length;
const tail7 = d => d.nums.filter(n => n % 10 === 7).length;

// ---------- 통계 도구 ----------
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const ols = (x, y) => {                        // 기울기, 절편, t값
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - a - b * x[i]) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { b, a, t: b / se, n };
};
// |t|에 대한 양측 p값. 자유도가 1000을 넘으므로 t분포를 정규로 근사한다.
const erfc = x => {                            // Numerical Recipes 유리근사, 상대오차 1.2e-7
  const z = Math.abs(x), t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
};
const tP = t => erfc(Math.abs(t) / Math.SQRT2);

// 설명변수 두 개 OLS. 한 변수의 효과가 다른 변수를 통제한 뒤에도 남는지 보려고 쓴다.
const ols2 = (x1, x2, y) => {
  const n = y.length, m1 = mean(x1), m2 = mean(x2), my = mean(y);
  let S11 = 0, S22 = 0, S12 = 0, S1y = 0, S2y = 0;
  for (let i = 0; i < n; i++) {
    const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my;
    S11 += a * a; S22 += b * b; S12 += a * b; S1y += a * c; S2y += b * c;
  }
  const det = S11 * S22 - S12 * S12;
  const b1 = (S22 * S1y - S12 * S2y) / det, b2 = (S11 * S2y - S12 * S1y) / det;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - my - b1 * (x1[i] - m1) - b2 * (x2[i] - m2)) ** 2;
  const s2 = sse / (n - 3);
  return { b1, b2, t1: b1 / Math.sqrt(s2 * S22 / det), t2: b2 / Math.sqrt(s2 * S11 / det) };
};

const permP = (x, y, iter = 20000) => {        // 기울기 부호가 우연일 확률 (단측)
  const obs = ols(x, y).b;
  let ge = 0;
  const yy = y.slice();
  for (let k = 0; k < iter; k++) {
    for (let i = yy.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [yy[i], yy[j]] = [yy[j], yy[i]]; }
    if (Math.abs(ols(x, yy).b) >= Math.abs(obs)) ge++;
  }
  return (ge + 1) / (iter + 1);
};

// ---------- m1 / m5 : 인기 편향 ----------
function popularity(rank, key) {
  const S = usable.filter(d => d[key] > 0);
  const ratio = S.map(d => d[key] / (games(d) * PROB[rank]));
  const x = S.map(lowCnt);
  const fit = ols(x, ratio);
  const half = Math.floor(S.length / 2);
  const h1 = ols(x.slice(0, half), ratio.slice(0, half));
  const h2 = ols(x.slice(half), ratio.slice(half));
  const overall = mean(ratio);
  // 인기비율은 그대로 두면 1 근처의 무단위 값이라 읽기 어렵다.
  // 표본 평균 판매량에서 몇 명이 되는지로 환산해 "명" 단위로 보여준다.
  // 배수는 스케일에 무관하므로 table = overall/gm 이 정확히 성립한다.
  const base = mean(S.map(games)) * PROB[rank];
  const gm = {}, table = {};
  for (let k = 0; k <= 4; k++) {
    const sel = ratio.filter((_, i) => x[i] === k);
    gm[k] = sel.length ? +(mean(sel) * base).toFixed(1) : null;
    table[k] = sel.length ? +(overall / mean(sel)).toFixed(4) : null;
  }
  return {
    n: S.length, overall: +(overall * base).toFixed(1),
    coef: +fit.b.toFixed(4), t: +fit.t.toFixed(2),
    tHalf1: +h1.t.toFixed(2), tHalf2: +h2.t.toFixed(2),
    p: tP(fit.t).toExponential(2), permP: permP(x, ratio), gm, table,
  };
}

// ---------- m9 : 수령액 우선 (데이터로 고른 비인기 풀) ----------
// 번호별 인기도를 적합해 가장 덜 고르는 14개를 풀로 삼는다.
// 구간(32~45)으로 자르는 것보다 낫다는 것을 워크포워드로 확인하고, 그 결과를 함께 낸다.
// 인샘플 적합치는 효과를 과장하므로(학습->검증 기울기가 1이 아니라 0.5 수준),
// 화면에 내보내는 배수는 인샘플이 아니라 검증으로 measured 한 값을 쓴다.
function combined() {
  const S = usable.filter(d => d.r3 > 0);
  const ratio = S.map(d => d.r3 / (games(d) * PROB[3]));
  const tLow = ols(S.map(lowCnt), ratio).t;
  const tSeven = ols(S.map(tail7), ratio).t;
  const tHigh = ols(S.map(d => d.nums.filter(n => n >= 32).length), ratio).t;

  const full = numberWeights(S);
  const pool = leastPopular(full.w);
  const BAND = Array.from({ length: 14 }, (_, i) => i + 32);
  const multWith = (p, w, ov) => ov / (6 * mean(p.map(n => w[n - 1])));
  const band = (lo, hi) => mean(full.w.slice(lo - 1, hi));

  // 학습 구간만 보고 고른 풀을, 그 뒤 구간으로만 평가한다. 미래 정보는 쓰지 않는다.
  const cuts = [400, 500, 620, 700, 800, 900].filter(c => c < S.length - 200);
  const oosSel = [], oosBand = [];
  for (const c of cuts) {
    const sel = leastPopular(numberWeights(S.slice(0, c)).w);
    const ev = numberWeights(S.slice(c));
    oosSel.push(multWith(sel, ev.w, ev.overall));
    oosBand.push(multWith(BAND, ev.w, ev.overall));
  }

  // 워크포워드: 구간마다 앞쪽으로 고르고 그 구간에서 예측력(t)을 잰다.
  const STEP = 120;
  let wfT = 0, wfBandT = 0, wins = 0, segs = 0;
  for (let c = 400; c + STEP <= S.length; c += STEP) {
    const sel = leastPopular(numberWeights(S.slice(0, c)).w);
    const TE = S.slice(c, c + STEP), y = TE.map(d => d.r3 / (games(d) * PROB[3]));
    const tOf = p => ols(TE.map(d => d.nums.filter(n => p.includes(n)).length), y).t;
    const a = tOf(sel), b = tOf(BAND);
    wfT += a; wfBandT += b; if (a < b) wins++; segs++;
  }

  // 학습 가중치가 검증 구간으로 얼마나 이어지는가 (기울기 1이면 그대로 이어짐)
  const halfN = Math.floor(S.length / 2);
  const wTR = numberWeights(S.slice(0, halfN)).w;
  const TE2 = S.slice(halfN);
  const carry = ols(TE2.map(d => d.nums.reduce((a, n) => a + wTR[n - 1], 0)),
                    TE2.map(d => d.r3 / (games(d) * PROB[3])));

  // 앱과 같은 방식으로 묶음을 구성해 도달 확률을 전수 계산
  const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const buildPortfolio = k => {
    const out = [], cap = Math.floor(pool.length / 6), sp = shuffle(pool);
    for (let i = 0; i < Math.min(k, cap); i++) out.push(sp.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
    while (out.length < k) {
      let best = null, bo = 99;
      for (let t = 0; t < 3000; t++) {
        const c = shuffle(pool).slice(0, 6).sort((a, b) => a - b);
        const o = out.reduce((mx, x) => Math.max(mx, c.filter(n => x.includes(n)).length), 0);
        if (o < bo) { bo = o; best = c; if (bo <= 1) break; }
      }
      out.push(best);
    }
    return out;
  };
  const reach = {};
  for (let k = 1; k <= 10; k++) {
    let acc = 0; const R = 3;
    for (let i = 0; i < R; i++) acc += exactAtLeastOne(buildPortfolio(k));
    reach[k] = +(acc / R).toFixed(6);
  }

  const S1 = usable.filter(d => d.r1 > 0);
  const base1 = mean(S1.map(games)) * PROB[1];
  const all1 = mean(S1.map(d => d.r1 / (games(d) * PROB[1])));
  const mult = mean(oosSel);

  return {
    pool, poolSize: pool.length,
    mult: +mult.toFixed(4),                          // 검증으로 잰 값 — 화면에 쓰는 값
    multIn: +multWith(pool, full.w, full.overall).toFixed(4),  // 인샘플 적합치 (과장됨)
    multBand: +mean(oosBand).toFixed(4),             // 같은 방식으로 잰 32~45
    carrySlope: +carry.b.toFixed(3), carryT: +carry.t.toFixed(2),
    wfT: +(wfT / segs).toFixed(2), wfBandT: +(wfBandT / segs).toFixed(2),
    wfWins: wins, wfSegs: segs, oosCuts: cuts.length,
    maxDisjoint: Math.floor(pool.length / 6), reach,
    tLow: +tLow.toFixed(2), tSeven: +tSeven.toFixed(2), tHigh: +tHigh.toFixed(2),
    bandLow: +band(1, 12).toFixed(4), bandMid: +band(13, 31).toFixed(4), bandHigh: +band(32, 45).toFixed(4),
    r1All: +(all1 * base1).toFixed(1), r1Pool: +(all1 * base1 / mult).toFixed(1),
  };
}

// ---------- m3 : 조작 흔적 ----------
function tamper() {
  const N = D.length, sets = D.map(d => new Set(d.nums));
  // (1) 연속 회차 중복 개수의 직렬상관
  const ov = [];
  for (let i = 1; i < N; i++) ov.push([...sets[i]].filter(n => sets[i - 1].has(n)).length);
  const idx = ov.map((_, i) => i);
  const pSerial = permP(idx, ov, 20000);
  // (2) 쌍 동시출현 이상치
  const pair = Array.from({ length: 46 }, () => Array(46).fill(0));
  D.forEach(d => { for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) pair[d.nums[i]][d.nums[j]]++; });
  const exp = N * 15 / C(45, 2), sd = Math.sqrt(exp * (1 - 15 / C(45, 2)));
  let nOut = 0, maxZ = 0;
  for (let a = 1; a <= 45; a++) for (let b = a + 1; b <= 45; b++) {
    const z = Math.abs((pair[a][b] - exp) / sd);
    if (z > 3) nOut++;
    if (z > maxZ) maxZ = z;
  }
  // 정규근사에서 |z|>3이 나올 기대 개수
  const expOut = C(45, 2) * 2 * (1 - 0.9986501019683699);
  // (3) 재출현 간격
  const gaps = [];
  for (let n = 1; n <= 45; n++) {
    let prev = null;
    D.forEach((d, i) => { if (sets[i].has(n)) { if (prev !== null) gaps.push(i - prev); prev = i; } });
  }
  const gm = mean(gaps), gv = mean(gaps.map(g => (g - gm) ** 2));
  const p6 = 6 / 45;
  return {
    pSerial: +pSerial.toFixed(4),
    nOutlierPairs: nOut, expOutlierPairs: +expOut.toFixed(1), maxPairZ: +maxZ.toFixed(2),
    gapMean: +gm.toFixed(3), gapTheory: +(1 / p6).toFixed(2),
    gapVar: +gv.toFixed(2), gapVarTheory: +((1 - p6) / p6 ** 2).toFixed(2),
  };
}

// ---------- 번호별 인기도 ----------
// 회차별 인기비율을 "당첨번호 6개의 번호별 인기도 합"으로 보고 45개 지시변수 OLS로 푼다
// (6개가 항상 켜져 있어 절편은 넣지 않는다). 이렇게 하면 어떤 번호 풀이든
// 관측이 없어도 수령액 배수를 추정할 수 있다.
function numberWeights(S = usable.filter(d => d.r3 > 0)) {
  const y = S.map(d => d.r3 / (games(d) * PROB[3]));
  const X = S.map(d => { const r = new Float64Array(45); d.nums.forEach(n => (r[n - 1] = 1)); return r; });
  const A = Array.from({ length: 45 }, () => new Float64Array(46));
  for (let a = 0; a < 45; a++) {
    for (let b = 0; b < 45; b++) { let t = 0; for (let i = 0; i < X.length; i++) t += X[i][a] * X[i][b]; A[a][b] = t; }
    let t = 0; for (let i = 0; i < X.length; i++) t += X[i][a] * y[i]; A[a][45] = t;
  }
  for (let c = 0; c < 45; c++) {                 // 가우스-조던
    let piv = c;
    for (let r = c + 1; r < 45; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 45; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= 45; k++) A[r][k] -= f * A[c][k];
    }
  }
  const w = Array.from({ length: 45 }, (_, i) => A[i][45] / A[i][i]);
  return { w, overall: mean(y) };
}
const POOL_SIZE = 14;
const leastPopular = (w, k = POOL_SIZE) =>
  w.map((v, i) => ({ n: i + 1, v })).sort((a, b) => a.v - b.v).slice(0, k).map(x => x.n).sort((a, b) => a - b);

// 티켓 묶음이 "적어도 하나 5등 이상"일 확률. 근사가 아니라 전수 계산이다.
// 추첨결과 중 풀 바깥 번호는 어떤 티켓과도 맞지 않으므로 풀과의 교집합만 훑는다.
// JS 비트 시프트는 32비트라 풀이 32개를 넘으면 lo/hi 두 워드로 나눈다.
const popcnt = x => { x -= (x >> 1) & 0x55555555; x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
                      return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24; };
function exactAtLeastOne(tickets) {
  const pool = [...new Set(tickets.flat())].sort((a, b) => a - b);
  const m = pool.length, outside = 45 - m;
  const idx = new Map(pool.map((n, i) => [n, i]));
  const tlo = [], thi = [];
  for (const t of tickets) {
    let lo = 0, hi = 0;
    for (const n of t) { const i = idx.get(n); if (i < 32) lo |= 1 << i; else hi |= 1 << (i - 32); }
    tlo.push(lo); thi.push(hi);
  }
  let fav = 0;
  const walk = (start, depth, j, lo, hi) => {
    if (depth === j) {
      for (let a = 0; a < tlo.length; a++)
        if (popcnt(lo & tlo[a]) + popcnt(hi & thi[a]) >= 3) { fav += C(outside, 6 - j); return; }
      return;
    }
    for (let i = start; i <= m - (j - depth); i++)
      walk(i + 1, depth + 1, j, i < 32 ? lo | (1 << i) : lo, i < 32 ? hi : hi | (1 << (i - 32)));
  };
  for (let j = 3; j <= 6; j++) walk(0, 0, j, 0, 0);
  return fav / TOTAL;
}

// ---------- 기각된 가설들 ----------
// "사람들이 이렇게 고를 것이다"라는 흔한 통념 세 가지를 같은 인기비율 회귀로 검정한다.
// 12 이하 효과와 달리 이쪽은 신호가 없다는 것을 보이기 위한 대조군이다.
function rejected() {
  const S = usable.filter(d => d.r3 > 0);
  const ratio = S.map(d => d.r3 / (games(d) * PROB[3]));
  const test = f => { const t = ols(S.map(f), ratio).t; return { t: +t.toFixed(2), p: +tP(t).toFixed(2) }; };

  // (1) 생일 편향 — 날짜로 고르면 31 이하에 몰린다는 통념.
  // 31 이하를 그대로 넣으면 12 이하를 포함해 버려 t=+6.7이 나오지만, 그건 12 이하 효과를
  // 다시 세는 것이다. 12 이하를 통제하고 13~31 구간이 따로 기여하는지를 봐야 한다.
  const birthday = (() => {
    const r = ols2(S.map(lowCnt), S.map(d => d.nums.filter(n => n > 12 && n <= 31).length), ratio);
    return { t: +r.t2.toFixed(2), p: +tP(r.t2).toFixed(2) };
  })();

  // (2) OMR 격자 — 용지는 가로 7칸이라 위아래로 이어 찍으면 7 차이 쌍이 많아진다
  const omr = test(d => {
    let c = 0;
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const g = d.nums[j] - d.nums[i];
      if (g === 7 || (g === 1 && Math.floor((d.nums[i] - 1) / 7) === Math.floor((d.nums[j] - 1) / 7))) c++;
    }
    return c;
  });

  // (3) 직전회차 복사 — 지난주 번호를 그대로 쓰는 사람이 많다면
  const prevCopy = (() => {
    const idx = new Map(D.map((d, i) => [d.no, i]));
    const x = S.map(d => {
      const i = idx.get(d.no);
      if (i === 0) return 0;
      const prev = new Set(D[i - 1].nums);
      return d.nums.filter(n => prev.has(n)).length;
    });
    const r = ols2(S.map(lowCnt), x, ratio);   // 12 이하 효과를 통제하고 본다
    return { t: +r.t2.toFixed(2), p: +tP(r.t2).toFixed(2) };
  })();

  return { birthday, omr, prevCopy };
}

// ---------- m3 보강 : 주기성 ----------
// 번호마다 "그 회차에 나왔는가"를 0/1 시계열로 보고 주기도를 구한다.
// 백색잡음이라면 최대파워/평균파워의 기댓값이 대략 ln(주파수 개수)다.
// 특정 주기가 숨어 있으면 이 비율이 그보다 뚜렷하게 커진다.
function periodicity() {
  const N = D.length, M = Math.floor(N / 2), sets = D.map(d => new Set(d.nums));
  const ratios = [];
  for (let n = 1; n <= 45; n++) {
    const x = D.map((_, i) => (sets[i].has(n) ? 1 : 0));
    const mu = mean(x);
    const pw = [];
    for (let k = 1; k <= M; k++) {
      let re = 0, im = 0;
      const w = 2 * Math.PI * k / N;
      for (let i = 0; i < N; i++) { const v = x[i] - mu; re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
      pw.push((re * re + im * im) / N);
    }
    ratios.push(Math.max(...pw) / mean(pw));
  }
  // 주기도 파워는 지수분포를 따르므로 max/mean의 기댓값은 ln M 이 아니라 ln M + γ 이다.
  return { fftMean: +mean(ratios).toFixed(1), fftNoise: +(Math.log(M) + 0.5772156649).toFixed(1) };
}

// ---------- 등수별 평균 상금 (백테스트용) ----------
// 4등 5만원, 5등 5천원은 규정상 고정이고 1~3등은 회차마다 다르다.
// 최근 100회 평균을 쓴다. 20년 전 금액까지 섞으면 지금 체감과 크게 어긋난다.
function prizes() {
  const R = usable.slice(-100);
  const avg = (key, filt) => Math.round(mean(R.filter(filt).map(d => d[key])));
  return {
    1: avg('a1', d => d.r1 > 0),
    2: avg('a2', d => d.r2 > 0),
    3: avg('a3', d => d.r3 > 0),
    4: 50000, 5: 5000,
  };
}

// ---------- 실행 ----------
console.log(`데이터 1~${lastNo}회 (판매액 보유 ${usable.length}회차)\n`);
const m1 = popularity(1, 'r1');
const m5 = popularity(3, 'r3');
const m9 = combined();
const m3 = tamper();
const fft = periodicity();
const rej = rejected();
const prize = prizes();

const show = (nm, m) => {
  console.log(`${nm}  n=${m.n}  기울기 ${m.coef >= 0 ? '+' : ''}${m.coef}  t=${m.t}  p=${m.p}  순열 p<${m.permP.toExponential(1)}`);
  console.log(`     전후반 t = ${m.tHalf1} / ${m.tHalf2}`);
  console.log(`     12이하 개수별 인기비율: ` + [0, 1, 2, 3, 4].map(k => `${k}:${m.gm[k]}`).join('  '));
  console.log(`     수령액 배수:            ` + [0, 1, 2, 3, 4].map(k => `${k}:${m.table[k]}`).join('  '));
};
show('m1 (1등)', m1);
console.log();
show('m5 (3등)', m5);
console.log();
console.log(`m9  풀(${m9.poolSize}개) ${m9.pool.join(',')}`);
console.log(`    구간 인기도  1~12 ${m9.bandLow}  13~31 ${m9.bandMid}  32~45 ${m9.bandHigh}`);
console.log(`    수령액 배수  인샘플 x${m9.multIn}  →  검증 x${m9.mult}   (32~45 검증 x${m9.multBand})`);
console.log(`    워크포워드   t ${m9.wfT} vs 32~45 ${m9.wfBandT} · ${m9.wfWins}/${m9.wfSegs} 구간 우위 · 이어짐 기울기 ${m9.carrySlope}`);
console.log(`    완전분리 최대 ${m9.maxDisjoint}게임 · 5등이상 ` + [1,3,5,7,10].map(k=>k+'게임 '+(m9.reach[k]*100).toFixed(3)+'%').join('  '));
console.log('m3 ', JSON.stringify({ ...m3, ...fft }));
console.log('기각', JSON.stringify(rej));
console.log('상금', JSON.stringify(prize));

// ---------- P 조립 ----------
// m8은 C(45,6) 전수 계산에서 나오는 상수라 회차와 무관하다. 기존 값을 그대로 옮긴다.
const oldP = JSON.parse(html.match(/^const P=(\{.*\});$/m)[1]);
const P = {
  nDraws: lastNo,
  m1: { table: m1.table, gm: m1.gm, overall: m1.overall, coef: m1.coef,
        t: m1.t, tHalf1: m1.tHalf1, tHalf2: m1.tHalf2, p: m1.p, n: m1.n },
  m3: { ...m3, ...fft },
  m5: { single: 235 / TOTAL, gm: m5.gm, overall: m5.overall, table: m5.table,
        p: m5.p, t: m5.t, tHalf1: m5.tHalf1, tHalf2: m5.tHalf2, n: m5.n },
  m8: oldP.m8,
  m9: m9,
  rej,
  prize,
};

console.log('\n' + JSON.stringify(P, null, 1).split('\n').slice(0, 4).join('\n') + ' ...');
if (DRY) { console.log('\n--dry-run: 파일을 변경하지 않았습니다.'); process.exit(0); }

const out = html.replace(/^const P=\{.*\};$/m, 'const P=' + JSON.stringify(P) + ';');
if (out === html) die('index.html의 P를 교체하지 못했습니다.');
writeFileSync(HTML, out);
console.log(`\n✓ P 갱신 (nDraws ${oldP.nDraws} → ${lastNo})`);
