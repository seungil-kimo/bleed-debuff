// 주기 계산 — 앱 화면(index.html)과 알림 보내는 스크립트(scripts/notify.mjs)가 같이 써요.
export const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const fd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const add = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };
export const diff = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const clampN = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d; };
// ── 배란·가임기 설정 (다음 생리 예정일 기준으로 며칠 전인지) ──
export const OV_FIRST = 14;   // 배란 예정일 첫날 = 예정일 14일 전 (해피문데이 배란일과 같음)
export const OV_LAST = 13;    // 배란 예정일 둘째 날 = 예정일 13일 전
export const FERT_BEFORE = 4; // 가임기 시작 = 배란 예정일 첫날 4일 전 (해피문데이와 같음)
export const FERT_AFTER = 4;  // 가임기 끝 = 배란 예정일 둘째 날 4일 후 → 가임기 총 10일

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

// 한국 시간 기준 오늘 날짜 (서버는 UTC라서 따로 계산)
export const todayKST = () => { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); };

export function model(periods, settings = {}, t) {
  const ps = periods.filter(p => isDate(p.start)).sort((a, b) => a.start < b.start ? -1 : 1);
  const defC = clampN(settings.cycle, 21, 45, 28), defL = clampN(settings.length, 2, 10, 5);
  const gaps = [];
  for (let i = 1; i < ps.length; i++) { const g = diff(ps[i - 1].start, ps[i].start); if (g >= 15 && g <= 60) gaps.push(g); }
  const lg = gaps.slice(-6), cycle = lg.length ? Math.round(avg(lg)) : defC;
  const lens = ps.filter(p => isDate(p.end) && p.end >= p.start).map(p => diff(p.start, p.end) + 1).filter(n => n <= 12).slice(-6);
  const len = lens.length ? Math.round(avg(lens)) : defL;
  const last = ps[ps.length - 1] || null, map = {}, R = { per: 5, pred: 4, ovu: 3, fert: 2 };
  const mark = (s, k) => { if (!map[s] || R[k] > R[map[s]]) map[s] = k; };
  const ongoing = !!(last && !isDate(last.end) && diff(last.start, t) >= 0 && diff(last.start, t) <= len + 1);
  ps.forEach(p => {
    const end = isDate(p.end) && p.end >= p.start ? p.end : add(p.start, len - 1);
    if (p === last && ongoing) {
      for (let s = p.start; s <= t; s = add(s, 1)) mark(s, 'per');
      for (let s = add(t, 1); s <= end; s = add(s, 1)) mark(s, 'pred');
      return;
    }
    for (let s = p.start; s <= end; s = add(s, 1)) mark(s, 'per');
  });
  const fertMark = ns => {
    const o1 = add(ns, -OV_FIRST), o2 = add(ns, -OV_LAST);
    for (let s = add(o1, -FERT_BEFORE); s <= add(o2, FERT_AFTER); s = add(s, 1)) mark(s, s >= o1 && s <= o2 ? 'ovu' : 'fert');
  };
  for (let i = 1; i < ps.length; i++) fertMark(ps[i].start);
  let next = null;
  if (last) {
    next = add(last.start, cycle);
    for (let k = 1; k <= 6; k++) {
      const s = add(last.start, cycle * k); fertMark(s);
      for (let i = 0; i < len; i++) { const d = add(s, i); if (d >= t) mark(d, 'pred'); }
    }
  }
  const M = { map, cycle, len, last, next, ongoing, count: ps.length, ps, phase: 'none', dNext: null, late: 0, dayN: 0, day: 0 };
  if (!last) return M;
  const inRec = ps.find(p => { const e = isDate(p.end) ? p.end : (p === last && ongoing ? t : add(p.start, len - 1)); return p.start <= t && t <= e; });
  M.day = diff(last.start, t) + 1;
  M.ov = add(next, -OV_FIRST); M.ov2 = add(next, -OV_LAST); M.fs = add(M.ov, -FERT_BEFORE); M.fe = add(M.ov2, FERT_AFTER);
  M.dNext = diff(t, next);
  if (inRec) { M.phase = 'period'; M.dayN = diff(inRec.start, t) + 1; }
  else if (M.dNext < 0) { M.phase = 'late'; M.late = -M.dNext; }
  else if (t >= M.ov && t <= M.ov2) M.phase = 'ovu';
  else if (t >= M.fs && t <= M.fe) M.phase = 'fertile';
  else if (t < M.fs) M.phase = 'follicular';
  else if (M.dNext <= 7) M.phase = 'pms';
  else M.phase = 'luteal';
  return M;
}

const kd = s => { const d = pd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

// 오늘 보낼(또는 보여줄) 알림 목록. key는 같은 알림을 두 번 보내지 않으려고 씀.
// role: 'me'(기록하는 사람) | 'partner'(함께 보는 사람)
export function events(M, t, role) {
  const P = role === 'partner', out = [];
  if (!M.last) return out;
  if (M.phase === 'period' && M.dayN <= 2 && M.last.start <= t && diff(M.last.start, t) <= 1)
    out.push({ kind: 'start', key: 'start-' + M.last.start, title: M.dayN === 1 ? '생리가 시작됐어요' : '어제 생리가 시작됐어요', body: P ? '오늘은 따뜻하게 챙겨주세요.' : '오늘은 무리하지 말고 쉬어가요.' });
  if (M.phase !== 'period' && [7, 3, 2, 1].includes(M.dNext))
    out.push({ kind: 'before', key: `before${M.dNext}-${M.next}`, title: M.dNext === 7 ? '일주일 뒤 생리 예정이에요' : `생리 예정일이 ${M.dNext}일 남았어요`, body: kd(M.next) + (P ? ' 예정 · 미리 챙겨줄 것들을 준비해요.' : ' 예정 · 생리대를 챙겨두세요.') });
  if (M.phase !== 'period' && M.dNext === 0)
    out.push({ kind: 'before', key: 'dday-' + M.next, title: '오늘이 생리 예정일이에요', body: P ? '컨디션을 물어봐 주세요.' : '시작하면 앱에 기록해 주세요.' });
  if (M.phase === 'late' && [1, 3, 7].includes(M.late))
    out.push({ kind: 'late', key: `late${M.late}-${M.next}`, title: `예정일보다 ${M.late}일 늦어지고 있어요`, body: '늦어질 수 있어요. 일주일 넘게 늦어지면 확인해 보세요.' });
  if (t === M.fs) out.push({ kind: 'fertile', key: 'fertile-' + M.fs, title: '오늘부터 가임기예요', body: `${kd(M.fs)} ~ ${kd(M.fe)} 예상` });
  if (t === M.ov) out.push({ kind: 'ovu', key: 'ovu-' + M.ov, title: '오늘부터 배란 예정일이에요', body: `${kd(M.ov)} ~ ${kd(M.ov2)} 예상 · 예측 날짜예요.` });
  return out;
}
