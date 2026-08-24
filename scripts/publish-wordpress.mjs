#!/usr/bin/env node
// WordPress 자체호스팅 발행 포스터 (REST API + Application Password)
// ─────────────────────────────────────────────────────────────
// 단건 CLI:  node scripts/publish-wordpress.mjs <md파일> [--status draft|publish]
// 재사용:    import { publishPost, envFromProcess } from './publish-wordpress.mjs'
//
// env (사이트 준비 후 주입 — GitHub/Vercel Secret 권장, 파일 저장 금지):
//   WP_URL         예) https://wp.techflowkr.com  (HTTPS 필수)
//   WP_USER        WordPress 사용자명
//   WP_APP_PASS    Users→Profile→Application Passwords 값(공백 포함 그대로)
//   CANONICAL_BASE 예) https://wp.techflowkr.com   (WP가 메인이면 WP자신, 신디케이션이면 원본)
//
// 전략 메모: WordPress를 "메인"으로 쓰면 canonical=WP자신(자기표준) → 수익화 트래픽이 WP로.
//            보조 신디케이션이면 canonical=원본 도메인.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { renderCharts } from './chart-static.mjs';
import { createRequire } from 'module';
const __dir = dirname(fileURLToPath(import.meta.url));

// 코드 블록 구문 하이라이팅(Prism, 발행시점 서버사이드 → 인라인 class로 kses 통과, 클라JS 불필요)
const _require = createRequire(import.meta.url);
const Prism = _require('prismjs');
_require('prismjs/components/index.js')(['javascript', 'typescript', 'jsx', 'tsx', 'python', 'bash', 'json', 'css', 'markup', 'sql', 'yaml', 'go', 'rust', 'java', 'php', 'csharp', 'cpp', 'markdown', 'ini', 'docker']);
const LANG_ALIAS = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'markup', xml: 'markup', yml: 'yaml', py: 'python', 'c++': 'cpp', cs: 'csharp', dockerfile: 'docker' };
function renderCodeCard({ lang, code }) {
  const raw = (lang || '').toLowerCase();
  const language = LANG_ALIAS[raw] || raw;
  const grammar = Prism.languages[language];
  const body = grammar
    ? Prism.highlight(code, grammar, language)
    : code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const label = (language || 'code').toUpperCase();
  return `<div class="code-card"><div class="cc-head"><span class="cc-dots"><i></i><i></i><i></i></span><span class="cc-lang">${label}</span><button class="cc-copy" type="button" aria-label="코드 복사">복사</button></div><pre class="cc-pre"><code class="language-${language}">${body}</code></pre></div>`;
}

// 쿠팡 상품 카드 — frontmatter coupangLinks(title/url/imageUrl) → 이미지 카드 블록.
function parseCoupang(fm) {
  const m = fm.match(/coupangLinks:\s*\n([\s\S]*?)(?=\n[A-Za-z_]+:|\n---|$)/);
  if (!m) return [];
  const items = [];
  const re = /-\s*title:\s*"([^"]*)"\s*\n\s*url:\s*"([^"]*)"(?:\s*\n\s*imageUrl:\s*"([^"]*)")?/g;
  let x;
  while ((x = re.exec(m[1]))) items.push({ title: x[1], url: x[2], imageUrl: x[3] || '' });
  return items;
}
function buildCoupangCards(links) {
  if (!links.length) return '';
  const cards = links.map((l) => {
    const thumb = l.imageUrl
      ? `<span class="cpc-thumb"><img src="${l.imageUrl}" alt="${l.title}" loading="lazy"></span>`
      : '';
    return `<a class="cpc-item${l.imageUrl ? '' : ' cpc-noimg'}" href="${l.url}" target="_blank" rel="noopener sponsored nofollow" data-product="${l.title}">${thumb}<span class="cpc-body"><span class="cpc-title">${l.title}</span><span class="cpc-cta">최저가 확인 ›</span></span></a>`;
  }).join('');
  return `\n<div class="cpc-wrap"><div class="cpc-head"><span class="cpc-badge">쿠팡</span>관련 상품 추천</div><div class="cpc-grid">${cards}</div><p class="cpc-disc">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p></div>\n`;
}
// 쿠팡 카드를 본문 3번째 h2 앞(중간)에 삽입, h2가 부족하면 말미에.
function injectCoupang(content, cards) {
  if (!cards) return content;
  const idx = [];
  const re = /<h2/g; let x;
  while ((x = re.exec(content))) idx.push(x.index);
  if (idx.length >= 3) return content.slice(0, idx[2]) + cards + content.slice(idx[2]);
  return content + cards;
}

// 본문 상단 핵심요약(TL;DR) 박스 — frontmatter description을 직답형으로. 스캔성·AEO 추출성↑.
function buildTLDR(desc) {
  const d = (desc || '').replace(/"/g, '').trim();
  if (d.length < 10) return '';
  return `<div class="mg-tldr"><span class="mg-tldr-badge">📌 핵심 요약</span><span class="mg-tldr-text">${d}</span></div>\n`;
}

// frontmatter의 faq 블록 파싱. 형식:
//   faq:
//     - q: "질문"
//       a: "답변"
// 지금까지 이 필드는 mungge 발행에서 통째로 버려졌다(Astro만 렌더). 검색에서 FAQ는
// 스니펫·AEO 노출에 직접 쓰이는 자산이라 본문 하단 섹션 + FAQPage 스키마로 살린다.
// ⚠️ 정규식으로 블록을 자르지 않는다. JS에는 \Z가 없어서 (?=^\S|\Z)가 "리터럴 Z"로
//    해석되고, 답변에 'Zig' 같은 단어가 있으면 거기서 블록이 잘린다(실제로 겪음).
//    들여쓰기 기준의 라인 파서가 짧고 확실하다.
function parseFaq(fm) {
  const lines = fm.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^faq:\s*$/.test(l));
  if (start < 0) return [];

  const unq = (v) => {
    let s = (v || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
    return s.replace(/\\"/g, '"').trim();
  };

  const out = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;                       // 들여쓰기가 끝나면 faq 블록 끝

    const item = line.match(/^\s*-\s*q:\s*(.*)$/);
    if (item) {
      if (cur && cur.q && cur.a) out.push(cur);
      cur = { q: unq(item[1]), a: '' };
      continue;
    }
    const ans = line.match(/^\s*a:\s*(.*)$/);
    if (ans && cur) { cur.a = unq(ans[1]); continue; }
  }
  if (cur && cur.q && cur.a) out.push(cur);
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildFaq(items, canonicalUrl) {
  if (!items.length) return '';
  const rows = items.map((f) => `<div class="mg-faq-item"><h3 class="mg-faq-q">${esc(f.q)}</h3><p class="mg-faq-a">${esc(f.a)}</p></div>`).join('\n');
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return `\n<div class="mg-faq">\n<h2>자주 묻는 질문</h2>\n${rows}\n</div>\n`
    + `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n`;
}

export function envFromProcess() {
  const { WP_URL, WP_USER, WP_APP_PASS, CANONICAL_BASE } = process.env;
  for (const [k, v] of Object.entries({ WP_URL, WP_USER, WP_APP_PASS }))
    if (!v) throw new Error(`env 누락: ${k}`);
  return { WP_URL, WP_USER, WP_APP_PASS, CANONICAL_BASE: CANONICAL_BASE || WP_URL };
}

// 마크다운 표 한 블록 → <table>. 셀 내 **볼드**/링크는 이미 변환된 상태로 들어옴.
function mdTable(block) {
  const rows = block.split('\n').map((r) => r.trim()).filter((r) => r.startsWith('|'));
  if (rows.length < 2) return `<p>${block}</p>`;
  const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const isSep = rows[1].includes('-') && /^\|?[\s:|-]+\|?$/.test(rows[1]);
  const body = isSep ? rows.slice(2) : rows.slice(1);
  let h = '<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of body) h += '<tr>' + cells(r).map((c) => `<td>${c}</td>`).join('') + '</tr>';
  return h + '</tbody></table>';
}

// 차트/컴포넌트 자산 번들(<style>+<script>) — .tmp/build-wp-assets.mjs로 생성. 글당 1회 임베드.
let _assetBundle = null;
export function chartAssetBundle() {
  if (_assetBundle !== null) return _assetBundle;
  const p = join(__dir, 'wp-chart-assets.html');
  _assetBundle = existsSync(p) ? readFileSync(p, 'utf8') : '';
  return _assetBundle;
}

// 마크다운 → WP용 HTML. 컴포넌트 div(차트/콜아웃/쿠팡/seo-inlink)는 자산번들 CSS가
// 스타일링하므로 그대로 보존. keepChartDivs=false면 차트만 원문링크로 대체.
function mdToHtml(src, canonicalUrl, { keepChartDivs = false } = {}) {
  let s = src.replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '');                                        // HTML 주석 제거(seo-inlink 마커 등)
  s = s.replace(/(href=")\/blog\//g, '$1/').replace(/(\]\()\/blog\//g, '$1/');  // 내부링크 Astro /blog/x → WP /x
  if (keepChartDivs) {
    s = renderCharts(s);                                     // 차트 div → 정적 HTML(인라인 style, JS 불필요)
  } else {
    s = s.replace(/<div class="chart-[^"]*"[^>]*><\/div>/g,
      `<p><em>📊 그래프는 <a href="${canonicalUrl}">원문</a>에서 확인하세요.</em></p>`);
  }
  const fences = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => { fences.push({ lang, code: code.replace(/\n$/, '') }); return ` ${fences.length - 1} `; });
  // 인라인 백틱 → <code>. 이게 없으면 워드프레스 wptexturize 가 백틱 안의 `--` 를
  // en-dash(–) 로 바꿔 CLI 플래그가 통째로 망가진다(실측 2026-08-11: `--jinja` → `–jinja`).
  // 굵게·링크 치환보다 먼저 빼내야 코드 안의 *·[ ] 가 마크업으로 오인되지 않는다.
  const inlines = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => { inlines.push(code); return `${inlines.length - 1}`; });
  s = s
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/==(?!\s)(.+?)(?<!\s)==/g, '<mark>$1</mark>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^!\[[^\]]*\]\(([^)]+)\)/gm, '<figure><img src="$1" alt=""/></figure>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.split(/\n{2,}/).map((p) => {
    p = p.trim();
    if (!p) return '';
    if (/^ \d+ $/.test(p)) return p;              // 코드펜스 placeholder
    if (/^\|.*\|/.test(p) && p.includes('\n')) return mdTable(p);   // 마크다운 표
    if (/^</.test(p)) return p;                                       // 원시 HTML 블록 그대로
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  s = s.replace(/ (\d+) /g, (_x, i) => renderCodeCard(fences[i]));
  s = s.replace(/(\d+)/g, (_x, i) => `<code>${esc(inlines[i])}</code>`);
  return s;
}

// 카테고리 get-or-create (사일로: 부모=silo, 리프=frontmatter category). id 캐시.
const _catCache = new Map();
async function ensureCategory(env, auth, name, parentId = 0) {
  const key = `${parentId}/${name}`;
  if (_catCache.has(key)) return _catCache.get(key);
  const base = `${env.WP_URL.replace(/\/$/, '')}/wp-json/wp/v2/categories`;
  const q = await (await fetch(`${base}?search=${encodeURIComponent(name)}&per_page=100`, { headers: { Authorization: auth } })).json();
  let hit = Array.isArray(q) ? q.find((c) => c.name === name && (c.parent || 0) === parentId) : null;
  if (!hit) {
    const r = await fetch(base, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent: parentId }) });
    hit = await r.json();
    if (!r.ok) throw new Error(`카테고리 생성 실패(${name}): ${JSON.stringify(hit).slice(0, 200)}`);
  }
  _catCache.set(key, hit.id);
  return hit.id;
}

// 태그 get-or-create. 카테고리와 달리 계층이 없어 이름만 맞추면 된다.
// ⚠️ 순차 실행이다 — Promise.all 로 돌리면 같은 이름 태그가 동시에 없다고 판정돼
//    중복 생성된다(WP 는 이름 중복을 막지 않는다).
const _tagCache = new Map();
async function ensureTag(env, auth, name) {
  if (_tagCache.has(name)) return _tagCache.get(name);
  const base = `${env.WP_URL.replace(/\/$/, '')}/wp-json/wp/v2/tags`;
  const q = await (await fetch(`${base}?search=${encodeURIComponent(name)}&per_page=100`, { headers: { Authorization: auth } })).json();
  let hit = Array.isArray(q) ? q.find((t) => t.name === name) : null;
  if (!hit) {
    const r = await fetch(base, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    hit = await r.json();
    // 경합으로 이미 생겼으면 term_exists 에 기존 id 가 실려 온다
    if (!r.ok) {
      const existing = hit && hit.data && hit.data.term_id;
      if (!existing) throw new Error(`태그 생성 실패(${name}): ${JSON.stringify(hit).slice(0, 200)}`);
      hit = { id: existing };
    }
  }
  _tagCache.set(name, hit.id);
  return hit.id;
}

// frontmatter tags 파싱. 두 표기를 모두 받는다(생성기가 글마다 다르게 쓴다).
//   tags: ["a", "b"]        ← TF 인라인 배열
//   tags:\n  - a\n  - b     ← LF 블록 리스트
export function parseTags(fm) {
  const inline = fm.match(/^tags:\s*\[(.*?)\]\s*$/m);
  if (inline) {
    return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const block = fm.match(/^tags:\s*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)/m);
  if (block) {
    return block[1].split(/\r?\n/)
      .map((l) => (l.match(/^[ \t]*-[ \t]*(.+?)[ \t]*$/) || [])[1])
      .filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ''));
  }
  return [];
}

// 카테고리 파싱 — 한 글이 성격상 두 곳에 걸치는 경우가 흔하다(예: "AI 코딩 에이전트 보안"은
// Review 보다 AI·Dev 에 가깝다). 기존엔 category 1개만 읽어 한 곳에만 넣었다.
// 지원 형식(우선순위):
//   categories: [AI, Dev]        / categories:\n  - AI\n  - Dev
//   category: "AI, Dev"          (쉼표 구분)
//   category: "Review"           (기존 단일 — 그대로 동작)
export function parseCategories(fm) {
  const inline = fm.match(/^categories:\s*\[(.*?)\]\s*$/m);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const block = fm.match(/^categories:\s*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)/m);
  if (block) {
    return block[1].split(/\r?\n/)
      .map((l) => (l.match(/^[ \t]*-[ \t]*(.+?)[ \t]*$/) || [])[1])
      .filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ''));
  }
  const single = fm.match(/^category:\s*(.+?)\s*$/m);
  if (single) {
    return single[1].replace(/^["']|["']$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export async function publishPost(file, { status = 'draft', env, keepChartDivs = false, silo = '', updateId = null } = {}) {
  env = env || envFromProcess();
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error('frontmatter 파싱 실패: ' + file);
  const fm = m[1], body = m[2];
  const pick = (k) => (fm.match(new RegExp(`^${k}:\\s*"?(.+?)"?\\s*$`, 'm')) || [])[1] || '';
  const title = pick('title');
  const slug = file.split(/[\\/]/).pop().replace(/\.md$/, '');
  const canonical = `${env.CANONICAL_BASE.replace(/\/$/, '')}/${slug}/`;
  // 본문 상단 모바일 전용 광고(320x50). 데스크톱은 Ad Inserter 728(.code-block-1) 사용,
  // 모바일에선 CSS로 728 숨기고 이 320x50 노출(ba.min.js가 페이지 로드 시 자동 채움).
  const MO_INPOST_AD = '<div class="mg-inpost-mo" style="justify-content:center;margin:1.5rem 0;"><ins class="kakao_ad_area" style="display:none;" data-ad-unit="DAN-FxUxEhp2LCne6gT3" data-ad-width="320" data-ad-height="50"></ins></div>\n';
  const content = injectCoupang(MO_INPOST_AD + buildTLDR(pick('description')) + mdToHtml(body, canonical, { keepChartDivs }), buildCoupangCards(parseCoupang(fm)))
    + buildFaq(parseFaq(fm), canonical);
  const auth = 'Basic ' + Buffer.from(`${env.WP_USER}:${env.WP_APP_PASS}`).toString('base64');

  // 사일로 카테고리: 부모(silo) → 리프(frontmatter category). WordPress 카테고리 id 부여.
  let categories;
  if (silo) {
    const parentId = await ensureCategory(env, auth, silo);
    const leafNames = parseCategories(fm);
    if (!leafNames.length) leafNames.push(silo);
    categories = [];
    // 순차 — ensureCategory 는 get-or-create 라 병렬로 돌리면 같은 이름이 중복 생성된다(태그와 같은 함정).
    for (const n of leafNames) categories.push(await ensureCategory(env, auth, n, parentId));
    categories = [...new Set(categories)];
  }

  // 태그: frontmatter 의 tags 를 전부 붙인다(카테고리는 1개지만 태그는 여러 개 동시 부여).
  let tags;
  const tagNames = parseTags(fm);
  if (tagNames.length) {
    tags = [];
    for (const n of tagNames) tags.push(await ensureTag(env, auth, n)); // 순차 — 중복 생성 방지
  }

  const res = await fetch(`${env.WP_URL.replace(/\/$/, '')}/wp-json/wp/v2/posts${updateId ? '/' + updateId : ''}`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, status, slug, excerpt: pick('description'), ...(categories ? { categories } : {}), ...(tags ? { tags } : {}) }),
  });
  const post = await res.json();
  if (!res.ok) throw new Error(`WP ${res.status}: ${JSON.stringify(post).slice(0, 300)}`);
  return { id: post.id, link: post.link, slug };
}

// ── CLI
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('publish-wordpress.mjs')) {
  const file = process.argv[2];
  const status = process.argv.includes('--status') ? process.argv[process.argv.indexOf('--status') + 1] : 'draft';
  if (!file) { console.error('사용: node scripts/publish-wordpress.mjs <md파일> [--status draft|publish]'); process.exit(1); }
  publishPost(file, { status }).then((r) => console.log(`✅ WP(${status}) #${r.id}: ${r.link}`))
    .catch((e) => { console.error('❌', e.message); process.exit(1); });
}
