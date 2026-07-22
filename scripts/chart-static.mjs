// 차트 div(빈 <div class="chart-*" data-*>)를 이전 시점에 정적 HTML로 렌더.
// blog-post.js 렌더러와 동일 innerHTML 생성(애니메이션 .animated 클래스만 생략 →
// 인라인 style의 최종 width/height로 즉시 표시). JS 불필요 → kses가 안 지움.
// CSS는 테마 "추가 CSS"에 1회 붙여넣기(scripts/wp-chart-css.css).

function rgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const num = (s) => (s || '').split(',').map(Number);
const arr = (s) => (s || '').split(',');

function bar(a) {
  const labels = arr(a.labels), values = num(a.values);
  const colors = arr(a.colors || '#3b82f6,#f59e0b,#009e73,#d55e00,#8b5cf6');
  const title = a.title || '', unit = a.unit || '', max = Math.max(...values) * 1.15;
  const vertical = a.orient === 'vertical', vMax = Math.max(...values);
  let hlIdx = -1; const hl = a.highlight;
  if (hl === 'max') hlIdx = values.indexOf(Math.max(...values));
  else if (hl === 'min') hlIdx = values.indexOf(Math.min(...values));
  else if (hl != null && hl !== '') hlIdx = parseInt(hl, 10);
  const ACCENT = a.accent || '#3b82f6', MUTE = '#94a3b8';
  const VPAL = ['#3b82f6', '#009e73', '#f59e0b', '#d55e00', '#8b5cf6', '#ec4899', '#14b8a6'];
  let h = title ? `<div class="chart-title">${title}</div>` : '';
  if (vertical) {
    // 세로막대: 바별 색 구분(팔레트) + 우측 범례(항목·점수). 값/라벨은 막대 안이 아닌 범례에.
    h += '<div class="chart-vbar-wrap"><div class="chart-columns">';
    labels.forEach((label, i) => {
      const pct = max > 0 ? (values[i] / max) * 100 : 0;
      const color = VPAL[i % VPAL.length];
      const gradV = `linear-gradient(180deg, ${color}, ${rgba(color, 0.72)})`;
      h += `<div class="chart-col"><div class="chart-col-track"><div class="chart-col-fill" style="height:${pct}%;background:${gradV}"></div></div></div>`;
    });
    h += '</div><ol class="chart-vlegend">';
    labels.forEach((label, i) => {
      const color = VPAL[i % VPAL.length];
      h += `<li class="chart-vlegend-item"><span class="chart-vlegend-dot" style="background:${color}"></span><span class="chart-vlegend-name">${label.trim()}</span><span class="chart-vlegend-score">${values[i]}${unit}</span></li>`;
    });
    return h + '</ol></div>';
  }
  h += '<div class="chart-bars">';
  labels.forEach((label, i) => {
    const pct = max > 0 ? (values[i] / max) * 100 : 0;
    const color = hlIdx >= 0 ? (i === hlIdx ? ACCENT : MUTE) : colors[i % colors.length].trim();
    const grad = `linear-gradient(90deg, ${color}, ${rgba(color, 0.7)})`;
    h += `<div class="chart-row"><span class="chart-label">${label.trim()}</span><div class="chart-track"><div class="chart-fill" style="width:${pct}%;background:${grad}"></div></div><span class="chart-value">${values[i]}${unit}</span></div>`;
  });
  return h + '</div>';
}

function radar(a) {
  const items = JSON.parse(a.items || '[]'), title = a.title || '';
  let h = title ? `<div class="chart-title">${title}</div>` : '';
  h += '<div class="chart-radar-grid">';
  const allVals = items.flatMap((it) => (it.scores || []).map((s) => Number(s.value) || 0));
  const rawMax = Math.max(...allVals, 1);
  const scaleMax = rawMax <= 10 ? 10 : (rawMax <= 100 ? 100 : Math.ceil(rawMax / 50) * 50);
  items.forEach((item) => {
    const scores = item.scores || [];
    const avg = scores.length ? (scores.reduce((x, s) => x + s.value, 0) / scores.length).toFixed(1) : '0';
    const mc = (scores[0] && scores[0].color) || '#3b82f6';
    h += `<div class="radar-item"><div class="radar-item-accent" style="background:${mc}"></div><div class="radar-name" style="color:${mc}">${item.name}</div><div class="radar-avg"><span class="radar-avg-badge" style="background:${rgba(mc, 0.12)};color:${mc}">평균 ${avg}/${scaleMax}</span></div><div class="radar-scores">`;
    scores.forEach((s) => {
      const pct = Math.min((s.value / scaleMax) * 100, 100), col = s.color || '#3b82f6';
      h += `<div class="radar-score-row"><span class="radar-score-label">${s.label}</span><div class="radar-score-track"><div class="radar-score-fill" style="width:${pct}%;background:linear-gradient(90deg, ${col}, ${rgba(col, 0.6)})"></div></div><span class="radar-score-val" style="color:${col}">${s.value}</span></div>`;
    });
    h += '</div></div>';
  });
  return h + '</div>';
}

function donut(a) {
  const labels = arr(a.labels), values = num(a.values);
  const colors = arr(a.colors || '#3b82f6,#009e73,#f59e0b,#d55e00,#8b5cf6');
  const title = a.title || '', unit = a.unit || '', total = values.reduce((x, v) => x + v, 0);
  let gradient = '', cum = 0;
  values.forEach((v, i) => { const pct = total > 0 ? (v / total) * 100 : 0; gradient += `${colors[i % colors.length].trim()} ${cum}% ${cum + pct}%`; cum += pct; if (i < values.length - 1) gradient += ', '; });
  const percentOnly = a.valueMode === 'percent'; let topIdx = 0;
  values.forEach((v, i) => { if (v > values[topIdx]) topIdx = i; });
  const topPct = total > 0 ? ((values[topIdx] / total) * 100).toFixed(1) : '0';
  let h = title ? `<div class="chart-title">${title}</div>` : '';
  h += `<div class="chart-donut-container"><div class="donut-ring" style="background:conic-gradient(${gradient})">`;
  h += percentOnly
    ? `<div class="donut-hole"><span class="donut-total">${topPct}%</span><span class="donut-total-label">${labels[topIdx].trim()}</span></div>`
    : `<div class="donut-hole"><span class="donut-total">${total}${unit}</span><span class="donut-total-label">합계</span></div>`;
  h += '</div><div class="donut-legend">';
  labels.forEach((label, i) => {
    const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0';
    const valText = percentOnly ? `${pct}%` : `${values[i]}${unit} (${pct}%)`;
    h += `<div class="donut-legend-item"><span class="donut-legend-dot" style="background:${colors[i % colors.length].trim()}"></span><span class="donut-legend-label">${label.trim()}</span><span class="donut-legend-value">${valText}</span></div>`;
  });
  return h + '</div></div>';
}

function versus(a) {
  const items = JSON.parse(a.items || '[]'), title = a.title || '';
  const nameA = a.nameA || 'A', nameB = a.nameB || 'B', colorA = a.colorA || '#3b82f6', colorB = a.colorB || '#009e73';
  const maxVal = Math.max(...items.flatMap((i) => [i.a, i.b])) * 1.1;
  let h = title ? `<div class="chart-title">${title}</div>` : '';
  h += `<div class="versus-header"><span class="versus-name" style="color:${colorA}">${nameA}</span><span class="versus-vs">VS</span><span class="versus-name" style="color:${colorB}">${nameB}</span></div><div class="versus-rows">`;
  items.forEach((item) => {
    const pctA = maxVal > 0 ? (item.a / maxVal) * 100 : 0, pctB = maxVal > 0 ? (item.b / maxVal) * 100 : 0;
    const aWin = item.a > item.b, bWin = item.b > item.a;
    h += `<div class="versus-row"><div class="versus-bar-left"><span class="versus-val${aWin ? ' versus-win' : ''}">${item.a}</span><div class="versus-track versus-track-left"><div class="versus-fill${aWin ? ' win' : ''}" style="width:${pctA}%;background:linear-gradient(270deg, ${colorA}, ${rgba(colorA, 0.6)})"></div></div></div><div class="versus-label">${item.label}</div><div class="versus-bar-right"><div class="versus-track"><div class="versus-fill${bWin ? ' win' : ''}" style="width:${pctB}%;background:linear-gradient(90deg, ${colorB}, ${rgba(colorB, 0.6)})"></div></div><span class="versus-val${bWin ? ' versus-win' : ''}">${item.b}</span></div></div>`;
  });
  return h + '</div>';
}

function progress(a) {
  const labels = arr(a.labels), values = num(a.values);
  const colors = arr(a.colors || '#3b82f6,#009e73,#f59e0b,#d55e00,#8b5cf6');
  const title = a.title || '', max = Number(a.max || '100'), unit = a.unit || '', circ = 2 * Math.PI * 45;
  let h = title ? `<div class="chart-title">${title}</div>` : '';
  h += '<div class="progress-grid">';
  labels.forEach((label, i) => {
    const pct = Math.min(values[i] / max, 1), offset = circ - (circ * pct), color = colors[i % colors.length].trim();
    h += `<div class="progress-item"><div class="progress-circle"><svg viewBox="0 0 100 100"><circle class="progress-bg" cx="50" cy="50" r="45" /><circle class="progress-ring" cx="50" cy="50" r="45" style="stroke:${color};stroke-dasharray:${circ};stroke-dashoffset:${offset}" /></svg><div class="progress-value" style="color:${color}">${values[i]}${unit}</div></div><div class="progress-label">${label.trim()}</div></div>`;
  });
  return h + '</div>';
}

const RENDER = { 'chart-bar': bar, 'chart-radar': radar, 'chart-donut': donut, 'chart-versus': versus, 'chart-progress': progress };

// data-* 속성 파싱(", ' 양쪽 지원). kebab → camel.
function parseAttrs(tag) {
  const a = {};
  const re = /data-([\w-]+)=(["'])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(tag))) {
    const key = m[1].replace(/-([a-z])/g, (_x, c) => c.toUpperCase());
    a[key] = m[3];
  }
  return a;
}

// 본문 HTML에서 빈 chart-* div를 정적 HTML로 치환.
export function renderCharts(html) {
  return html.replace(/<div class="(chart-bar|chart-radar|chart-donut|chart-versus|chart-progress)"([^>]*)><\/div>/g,
    (full, type, rest) => {
      try {
        const inner = RENDER[type](parseAttrs('<div ' + rest + '>'));
        return `<div class="${type}">${inner}</div>`;
      } catch (e) {
        return full; // 파싱 실패 시 원본 유지
      }
    });
}
