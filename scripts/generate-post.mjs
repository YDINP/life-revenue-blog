import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { autoPublishToWP } from './wp-autopublish.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const AUTHOR = 'LifeFlow';
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set');
  process.exit(1);
}

// ── Load seed data ──────────────────────────────────────────────────
const seeds = JSON.parse(readFileSync(join(__dirname, 'category-seeds.json'), 'utf-8'));
const coupangLinks = JSON.parse(readFileSync(join(__dirname, 'coupang-links.json'), 'utf-8'));

// ── Date & Category selection ───────────────────────────────────────
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const dateStr = `${yyyy}-${mm}-${dd}`;

const CATEGORY_ORDER = ["lifestyle", "finance", "health", "education", "travel"];

/**
 * 3개의 서로 다른 카테고리를 날짜 기반으로 선택
 */
function selectCategories(count = 3) {
  const dayOfMonth = today.getDate();
  const categories = [];
  for (let i = 0; i < count; i++) {
    const index = (dayOfMonth + i) % CATEGORY_ORDER.length;
    categories.push(CATEGORY_ORDER[index]);
  }
  return categories;
}

console.log(`[${dateStr}] Generating 3 posts...`);

// ── Helpers ─────────────────────────────────────────────────────────
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

// SSE(stream:true) 응답에서 텍스트 델타만 이어붙여 반환.
// 왜 스트리밍인가: 본문 생성은 max_tokens 8192짜리 장시간 요청이라, 논스트리밍으로 보내면
// 게이트웨이(nginx)가 첫 바이트를 못 받고 504 Gateway Time-out을 낸다(2026-07-28 발행 실패).
async function readClaudeStream(res) {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.text) text += ev.delta.text;
      if (ev.type === 'error') throw new Error(`Claude stream error: ${JSON.stringify(ev.error)}`);
    }
  }
  return text;
}

async function callClaude(prompt) {
  // 기본 경로는 Claude Code CLI(사용자 구독 세션). 게이트웨이 크레딧 소진(403)이나
  // 장시간 요청 504를 타지 않는다. CLI를 못 쓰면 아래 HTTP 경로로 폴백하고,
  // BLOG_LLM=http 면 처음부터 HTTP를 쓴다(GitHub Actions 등 CLI 없는 환경).
  if (process.env.BLOG_LLM !== 'http') {
    try {
      const cli = await import('../../automation/llm-cli.mjs');
      if (cli.claudeCliAvailable()) {
        console.log('[LLM] Claude Code CLI');
        return await cli.callClaudeCli(prompt, { model: process.env.BLOG_CLAUDE_CLI_MODEL || '' });
      }
      console.warn('[LLM] CLI 없음 → HTTP 폴백');
    } catch (e) {
      console.warn(`[LLM] CLI 경로 실패(${e.message}) → HTTP 폴백`);
    }
  }

  console.log('[LLM] HTTP API');
  // 게이트웨이 호환: ANTHROPIC_BASE_URL/BLOG_CLAUDE_MODEL 있으면 우선(로컬), 없으면 공식 API(GH Actions)
  const CLAUDE_API_URL = `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`;
  const CLAUDE_MODEL = process.env.BLOG_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API ${res.status}: ${errBody}`);
  }

  return await readClaudeStream(res);
}

// Pexels 는 **영문 스톡사진 API** 다. 한국어 주제 문자열을 그대로 던지면 토큰 일부만 걸려
// 엉뚱한 사진이 온다(실측 2026-07-31: "모두의카드 2026 출시일…" → 졸업 가운 사진.
// 'card'도 'transit'도 아닌 "2026"에 매칭됐다). 영문 장면 검색어로 바꿔서 던진다.
// ⚠️ 같은 로직이 ai-revenue-blog 에는 deriveImageQueries 로 이미 있었다 — LF 에만 없어서 생긴 차이다.
async function deriveImageQueries(searchTerm) {
  if (!/[가-힣]/.test(searchTerm)) return [searchTerm];
  try {
    const raw = await callLLM(
      `다음 한국어 블로그 주제에 어울리는 **영문 스톡사진 검색어** 3개를 만들어줘.\n` +
      `- 각 2~4단어, 사진으로 찍힐 수 있는 구체적 장면일 것(추상 개념 금지)\n` +
      `- 주제의 핵심 대상이 화면에 보여야 함\n` +
      `- JSON 배열만 출력: ["...","...","..."]\n\n주제: ${searchTerm}`
    );
    const m = raw.match(/\[[\s\S]*?\]/);
    const arr = m ? JSON.parse(m[0]) : null;
    if (Array.isArray(arr) && arr.length) return arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3);
  } catch (e) {
    console.log(`[Pexels] 영문 검색어 생성 실패(${e.message.slice(0, 60)})`);
  }
  // ⚠️ 실패해도 **한국어 원문을 Pexels 로 보내지 않는다.** Pexels 는 한국어를 이해하지 못하고
  //    문자열 안의 숫자 같은 토큰에 걸려 엉뚱한 사진을 준다 — 제목에 "2026" 이 들어간 LF 주제가
  //    연속 사흘(08-04 노란우산공제 / 08-05 청년월세지원 / 08-06 디딤돌대출) 전부 **같은 졸업식
  //    사진**(pexels 38651881, "class of 2026")을 받아 갔다. 주제와 무관한 히어로가 라이브로 나간다.
  //    한국어가 섞여 있으면 카테고리 기준의 영문 폴백을 쓴다.
  const CATEGORY_FALLBACK = {
    finance: ['korean money and calculator', 'person reviewing bank documents', 'apartment building exterior'],
    lifestyle: ['korean street daily life', 'cozy home interior', 'person walking city street'],
  };
  const cat = (process.env.INPUT_CATEGORY || 'finance').toLowerCase();
  return CATEGORY_FALLBACK[cat] || CATEGORY_FALLBACK.finance;
}

// 후보 검색어를 순서대로 시도해 첫 성공을 쓴다(첫 검색어가 너무 좁아 0건인 경우가 잦다).
async function fetchHeroImage(searchTerm) {
  const queries = await deriveImageQueries(searchTerm);
  for (const q of queries) {
    // 한국어가 섞인 질의는 아예 보내지 않는다(위 주석의 졸업식 사진 사고).
    if (/[가-힣]/.test(q)) {
      console.log(`[Pexels] 한국어 질의 차단: ${q}`);
      continue;
    }
    console.log(`[Pexels] 검색: ${q}`);
    const img = await fetchPexelsImage(q);
    if (img.url) {
      console.log(`[Pexels] 채택: id=${img.id ?? '?'} alt="${(img.alt || '').slice(0, 60)}"`);
      return img;
    }
  }
  return { url: '', photographer: '' };
}

async function fetchPexelsImage(query) {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
    });

    if (!res.ok) {
      console.warn(`Pexels API error ${res.status}, using fallback image`);
      return { url: '', photographer: '' };
    }

    const data = await res.json();
    if (data.photos && data.photos.length > 0) {
      const photo = data.photos[0];
      return {
        url: photo.src.large2x || photo.src.large || photo.src.original,
        photographer: photo.photographer,
        id: photo.id,
        alt: photo.alt,
      };
    }
    return { url: '', photographer: '' };
  } catch (err) {
    console.warn('Pexels fetch failed:', err.message);
    return { url: '', photographer: '' };
  }
}

// 차트 div의 data-labels/title에 LLM이 넣은 \\n·따옴표·중복콤마 정리(HTML 속성 깨짐 방지)
function fixChartLabels(md) {
  return md.replace(/<div class="chart-[^"]*"[^>]*><\/div>/g, (tag) =>
    tag
      .replace(/data-labels="([\s\S]*?)"(?=\s+data-|\s*>)/g, (m, v) =>
        `data-labels="${v.replace(/\\n|\n/g, ' ').replace(/"/g, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()}"`)
      .replace(/data-title="([\s\S]*?)"(?=\s+data-|\s*>)/g, (m, v) =>
        `data-title="${v.replace(/\\n|\n/g, ' ').replace(/"/g, '').trim()}"`)
  );
}

function pickCoupangProducts(categoryName, count = 2) {
  const products = coupangLinks[categoryName] || [];
  const shuffled = [...products].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * 기존 블로그 포스트 슬러그+제목 로드 (내부 링크용)
 */
function loadExistingPostSlugs() {
  const blogDir = join(ROOT, 'src', 'blog');
  if (!existsSync(blogDir)) return [];
  const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(blogDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const titleMatch = fm.match(/^title:\s*"?(.+?)"?\s*$/m);
      if (!titleMatch) continue;
      const slug = file.replace('.md', '');
      posts.push({ title: titleMatch[1], slug });
    } catch { /* skip */ }
  }
  return posts;
}

/**
 * 기존 블로그 포스트 제목 로드 (중복 방지용)
 */
function loadExistingPostTitles(blogDir, category) {
  if (!existsSync(blogDir)) return [];
  const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(blogDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const titleMatch = fm.match(/^title:\s*"?(.+?)"?\s*$/m);
      const catMatch = fm.match(/^category:\s*"?(.+?)"?\s*$/m);
      if (!titleMatch) continue;
      const postCat = catMatch ? catMatch[1] : '';
      if (postCat === category) {
        posts.push(`[${postCat}] ${titleMatch[1]}`);
      }
    } catch { /* skip */ }
  }
  return posts;
}

// ── Main ────────────────────────────────────────────────────────────
async function generateOnePost(categoryName, keyword, searchTerm, blogDir, postIndex, totalCount, existingTitles, engaging = false, revenue = false, allPosts = []) {
  console.log(`\n--- Post ${postIndex}/${totalCount}: ${categoryName} ---`);
  console.log(`[Info] Keyword: ${keyword}`);
  console.log(`[Info] Search term: ${searchTerm}`);
  if (existingTitles && existingTitles.length > 0) {
    console.log(`[Info] Existing ${categoryName} posts: ${existingTitles.length}개 (중복 방지)`);
  }

  // 오케스트레이터(automation/post-research.mjs)가 생성 직전에 모아 넘긴 근거.
  // 이게 없던 시절엔 모델이 자료 없이 인용해 제도 날짜가 정반대인 글이 나갔다(2026-07-31 모두의카드 사고).
  // ⚠️ 뉴스 헤드라인 묶음은 링크가 news.google.com 리다이렉트라 **참고자료로 인용 불가**다.
  const evidenceRaw = (process.env.INPUT_EVIDENCE || '').trim();
  let citableSources = [];
  try { citableSources = JSON.parse(process.env.INPUT_SOURCES || '[]'); } catch { citableSources = []; }

  const evidenceInstruction = evidenceRaw ? `
━━━ 근거 자료(이 글을 쓰기 직전에 수집한 실제 자료) ━━━
${evidenceRaw}
━━━ 근거 자료 끝 ━━━

⛔ **근거 사용 규칙(최우선)**:
- 본문의 **모든 수치·날짜·제도명은 위 근거 자료에 있는 것만** 쓰세요. 근거에 없으면 쓰지 마세요.
  기억에 있는 요율·한도라도, 위 자료가 뒷받침하지 않으면 **그 문장을 빼는 쪽**을 택하세요.
  (제도는 자주 개정됩니다. 기억 속 요율은 이미 낡았을 가능성이 높습니다.)
- 근거가 서로 어긋나면(예: 매체마다 종료 시점이 다름) **단정하지 말고 양쪽을 병기**하고
  "공식 공지 확인 필요"라고 밝히세요. 하나를 골라 단정하는 것이 가장 큰 사고입니다.
- 시행 전인 제도는 시제를 지키세요("오늘 마감" 같은 표현은 근거에 날짜가 있을 때만).
- **매체명도 근거에 있는 것만** 쓰세요. 위 헤드라인 목록에 없는 매체("연합뉴스가 보도했다" 등)를
  끌어오지 마세요 — 있을 법한 매체를 적는 것도 날조입니다. 헤드라인에 적힌 매체·보도일 그대로만 인용하세요.
- 근거에서 **추론한 것**을 사실처럼 쓰지 마세요. 출시일과 종료일이 겹친다고 "병행 사용 가능",
  종료 보도가 있다고 "충전은 이미 끝났다"로 단정하는 식은 금지입니다.
  추론이면 "~로 보인다", "공식 안내 확인 필요"로 명확히 낮추세요.
${citableSources.length ? `- "## 참고 자료" 섹션에는 **아래 URL만** 쓰세요. 목록에 없는 URL을 지어내지 마세요.
${citableSources.map((s) => `  - [${s.title}](${s.url})`).join('\n')}` : `- 인용 가능한 URL이 확보되지 않았습니다. **URL을 지어내지 마세요.**
  "## 참고 자료" 섹션에는 링크 대신 근거로 삼은 **매체명과 보도일**을 텍스트로 적으세요
  (예: "- 동아일보 2026-07-30 보도"). 없는 링크를 만드는 것보다 링크가 없는 편이 낫습니다.`}
` : `
⚠️ 이번 글은 수집된 근거 자료가 없습니다. 확실하지 않은 요율·한도·날짜는 아예 쓰지 말고,
   차트는 만들지 마세요. 출처 URL을 지어내는 것은 절대 금지입니다.
`;

  const chartInstruction = `시각자료 배치 규칙(필수):

⛔⛔ **최우선 규칙 — 차트 수치의 출처**: 차트에 넣는 모든 숫자는 아래 셋을 **전부** 만족해야 합니다.
  (1) 본문에 그 숫자가 출처와 함께 서술돼 있을 것 — 차트에만 등장하는 숫자는 금지입니다.
  (2) 그 출처가 이 글의 "참고 자료" 목록에 **구체적 링크**로 들어 있을 것
      (기관 홈페이지 링크는 출처가 아닙니다. 그 수치가 실제로 실린 고시·조항·보도자료 페이지여야 합니다.)
  (3) 제공된 근거 자료에 실제로 있는 값일 것 — 근거의 모호한 표현을 구체적 숫자로 좁히지 마세요.
  하나라도 못 채우면 **그 차트는 만들지 마세요.**

  ⚠️ 제도·지원금 글에서 특히 위험합니다. 요율·한도·연령 기준은 기관 홈페이지 첫 화면에는 거의 없고
  하위 안내 페이지나 고시에 있습니다. 홈 링크만 걸고 요율을 차트로 그리면 검증에서 전량 반려됩니다.
  또 제도는 자주 개정되므로, 근거의 **시점**이 지금과 맞는지 확인하고 본문에 기준 시점을 밝히세요.

- 차트는 **최대 4~6개까지** 넣을 수 있습니다. 이것은 **상한이지 할당량이 아닙니다** —
  출처 있는 수치가 2개 섹션에만 있으면 차트도 2개입니다. 개수를 채우려고 숫자를 만들지 마세요.
  (도입부·마무리/FAQ 섹션은 제외)
- **유형을 반드시 분산**: 한 글에서 같은 유형은 **최대 2개까지**, 서로 다른 유형을 **3종 이상** 쓰세요.
  단, 위 출처 규칙이 항상 우선입니다 — 유형을 분산하려고 없는 데이터를 만들지 마세요.
  (유형 분산은 차트가 3개 이상일 때만 적용되는 규칙입니다.)
- ⛔ **데이터가 없으면 차트를 만들지 마세요.** 근거가 없는 섹션은 표·목록·문장으로 대체하세요.
  (실제 사고: 체크리스트 섹션에 없는 값 95를 만들고 단위를 "필수"로 붙여 "95필수"가 렌더됨)
- 계산으로 만든 파생 수치(환급액·손익분기·연 환산 등)를 차트에 넣을 때는, 그 계산의 **입력값이
  위 출처 규칙을 통과한 것**이어야 하고 본문에 계산 근거를 밝히세요. 미검증 요율에서 뽑은
  금액 차트는 요율이 틀리면 통째로 틀립니다.

아래 5가지 차트 유형 중 각 섹션의 데이터 성격에 맞는 것을 고르세요:

1) chart-bar (막대 차트) - 항목별 수치 비교:
<div class="chart-bar" data-title="차트 제목" data-labels="항목1,항목2,항목3" data-values="85,72,90" data-colors="#10b981,#3b82f6,#f59e0b" data-unit="점"></div>

2) chart-radar (카드형 점수 비교) - 제품/서비스 다항목 평가:
<div class="chart-radar" data-title="종합 비교" data-items='[{"name":"제품A","scores":[{"label":"성능","value":9,"color":"#10b981"},{"label":"가격","value":7,"color":"#3b82f6"}]},{"name":"제품B","scores":[{"label":"성능","value":8,"color":"#f59e0b"},{"label":"가격","value":9,"color":"#ef4444"}]}]'></div>

3) chart-donut (도넛 차트) - 비율/점유율/구성비 시각화:
<div class="chart-donut" data-title="시장 점유율" data-labels="항목1,항목2,항목3" data-values="60,25,15" data-colors="#3b82f6,#10b981,#f59e0b" data-unit="%"></div>

4) chart-versus (VS 비교) - 두 대상 1:1 대결 비교:
<div class="chart-versus" data-title="A vs B" data-name-a="제품A" data-name-b="제품B" data-color-a="#3b82f6" data-color-b="#10b981" data-items='[{"label":"성능","a":85,"b":90},{"label":"가격","a":70,"b":80}]'></div>

5) chart-progress (원형 게이지) - 개별 점수/달성률:
<div class="chart-progress" data-title="평가 점수" data-labels="항목1,항목2,항목3" data-values="85,72,90" data-colors="#10b981,#3b82f6,#f59e0b" data-max="100" data-unit="점"></div>

선택 가이드: 비율/점유율→donut, 1:1 대결→versus, 개별 평점·달성률→progress, 수치 비교→bar, 다항목 제품 평가→radar.
섹션 역할별 권장 배치(예): 제도 현황·구성비 섹션→donut, 상품·제도 비교 섹션→versus 또는 radar,
금액·요율 수치 섹션→bar, 단계별 달성·자격 충족도 섹션→progress(단, 실제 점수 데이터가 있을 때만).

주의:
- div 안에 자식 요소를 넣지 마세요.
- **항목은 반드시 2개 이상(권장 3~5개).** 1항목 차트는 비교 정보가 0이라 자리만 차지합니다.
- data-labels는 쉼표로 구분한 하나의 문자열입니다. \`data-labels="A","B"\`처럼 항목마다
  따옴표를 씌우면 첫 항목만 인식됩니다. 반드시 \`data-labels="A,B,C"\` 형식으로.
- data-labels 개수와 data-values 개수가 정확히 일치해야 합니다.
- data-unit에는 실제 단위(%, 원, 만원, 점, 시간 등)만. "필수"·"권장" 같은 낱말을 넣으면
  값과 붙어 "95필수"처럼 렌더됩니다.
- 같은 제목의 차트를 두 번 넣지 마세요.

**강조 포인트 — 콜아웃 박스 사용 금지**:
- 콜아웃 박스(callout-tip/warning/info)를 사용하지 마세요.
- 강조할 내용은 마크다운 **bold** 또는 > blockquote로 충분합니다.
- 본문에서 이미 설명한 내용을 별도 박스로 반복하는 것은 가독성을 해칩니다.`;

  // 기존 포스트 중복 방지 지시
  const dupeGuard = existingTitles && existingTitles.length > 0
    ? `\n**중복 방지**: 아래는 이미 발행된 같은 카테고리 포스트입니다. 이들과 겹치지 않는 새로운 각도/주제로 작성하세요:\n${existingTitles.map(t => `- ${t}`).join('\n')}\n`
    : '';

  // 독자 유입 극대화 모드: 호기심 자극 + 클릭 유도 스타일
  const engagingInstruction = engaging ? `
**독자 유입 극대화 스타일 (필수 적용)**:
- 제목: 호기심을 자극하되 정중한 표현 사용 ("혹시 알고 계셨나요?", "직접 비교해보았습니다", "이것만 알아두시면 됩니다", "의외의 차이점", "놓치기 쉬운 핵심 포인트")
- 제목에 숫자 활용 ("TOP 5", "3가지 핵심", "꼭 알아야 할 7가지")
- 첫 문단(도입부): 독자의 고민에 공감하는 존댓말로 시작 ("~하고 계신 분들 많으시죠?", "~이 궁금하셨던 분들께 도움이 될 것 같습니다")
- 중간중간 흥미 유발 문장 배치 ("여기서 주목할 점이 있습니다", "하지만 가장 중요한 부분은 따로 있었습니다")
- 비교 구도는 객관적 톤 유지 ("A와 B, 어떤 선택이 좋을까요?", "가성비를 따져보았습니다")
- 경험 공유 톤 ("직접 사용해본 결과", "저도 처음에는 몰랐는데요", "실제로 경험해보니")
- 결론부에 부드러운 행동 유도 ("한번 시도해보시는 건 어떨까요?", "참고하시면 도움이 되실 겁니다")
- 전체적으로 존댓말(~합니다, ~하세요, ~드립니다) 톤 유지
- 단, 허위/과장 금지 — 팩트 기반으로 친근하고 신뢰감 있게 작성
` : '';

  // 수익 극대화 모드
  const revenueInstruction = revenue ? `
**수익 극대화 모드 (필수 적용)**:
- 본문 중간에 자연스럽게 상품/서비스 추천을 삽입 ("이 작업에는 **[상품명]**이 가장 효과적이었습니다")
- "추천 이유", "실사용 후기" 톤으로 제품 언급 (자연스러운 네이티브 광고 스타일)
- 비교표에 "구매 포인트" 또는 "추천도" 컬럼 추가
- 결론부에 "가장 추천하는 제품/서비스" 명시
- 단, 지나친 광고 톤 금지 — 정보성 콘텐츠 안에 자연스러운 추천 삽입
` : '';

  // 내부 링크 지시
  const internalLinkInstruction = allPosts.length > 0 ? `
**내부 링크 삽입 (SEO 필수)**:
아래는 기존 발행된 포스트 목록입니다. 본문에서 관련 주제가 나올 때 자연스럽게 1~2개를 링크하세요:
${allPosts.slice(-20).map(p => `- "${p.title}" → /blog/${p.slug}/`).join('\n')}
` : '';

  const prompt = `당신은 한국어 블로그 작성 전문가입니다.
"${keyword}" 주제로 SEO 최적화된 블로그 포스트를 작성해주세요.

카테고리: ${categoryName}
${dupeGuard}${engagingInstruction}${revenueInstruction}${internalLinkInstruction}
**최우선 원칙 — 최신 데이터 기반 작성 (정보 신뢰도가 핵심)**:
- 오늘은 ${dateStr}입니다. 이 시점 기준 실제 존재하는 제품, 서비스, 통계 수치만 사용
- 허구의 수치나 브랜드명을 만들어내지 말 것. 확실하지 않으면 "공식 발표 예정" 등으로 표기
- 가격, 효과, 수치 등은 반드시 실제 데이터를 근거로 작성
- 단순 일반론이 아닌 구체적인 시의성 있는 최신 내용 위주
- 제목에 "${yyyy}년" 또는 구체적 시점을 포함
- 기존 포스트와 제목이나 핵심 내용이 유사하면 안 됩니다
- 출처가 불분명한 통계나 수치는 사용하지 말 것

요구사항:
- 제목(title): 매력적이고 클릭을 유도하는 한국어 제목
- 설명(description): 150자 이내 메타 설명
- 태그(tags): 5-7개 관련 태그 (한국어)
- 본문(content): 마크다운 형식, 1500-2500자
  - H2(##), H3(###) 소제목 활용
  - 실용적인 정보, 팁, 가이드 포함
  - 표(table)를 1개 이상 포함
  - 자연스러운 SEO 키워드 배치
  - 본문 마지막에 "## 참고 자료" 섹션을 추가하고, 글에서 참고한 공식 사이트·문서·통계 등 2~4개의 출처를 하이퍼링크로 제공하세요. 형식: "- [출처 이름](https://실제URL)"
${evidenceInstruction}

${chartInstruction}

**메타 설명(description) 작성 규칙**:
- 반드시 숫자 포함 ("TOP 5", "3가지", "7단계")
- 행동 유도 문구 포함 ("지금 확인하세요", "바로 비교해보세요")
- 궁금증 유발 ("이것만 알면 충분합니다", "모르면 손해")
- 120~160자 범위 엄수

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "...",
  "slug": "english-slug-for-url (영문 소문자, 하이픈으로 연결, 예: time-management-tips-2026)",
  "description": "...",
  "tags": ["...", "..."],
  "content": "마크다운 본문...",
  "faq": [
    {"q": "자주 묻는 질문 1", "a": "답변 1 (2~3문장)"},
    {"q": "자주 묻는 질문 2", "a": "답변 2 (2~3문장)"},
    {"q": "자주 묻는 질문 3", "a": "답변 3 (2~3문장)"}
  ]
}`;

  console.log('Calling Claude API...');
  const rawResponse = await callClaude(prompt);

  // Parse JSON from Claude response (코드블록 + 잘림 대응)
  let postData;
  let jsonStr = rawResponse.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, '');
  try {
    postData = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.warn('[WARN] Direct JSON parse failed, attempting recovery...');
    try {
      const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]+)"/);
      const slugMatch = jsonStr.match(/"slug"\s*:\s*"([^"]+)"/);
      const descMatch = jsonStr.match(/"description"\s*:\s*"([^"]+)"/);
      const tagsMatch = jsonStr.match(/"tags"\s*:\s*\[([^\]]+)\]/);
      const contentMatch = jsonStr.match(/"content"\s*:\s*"([\s\S]+)/);

      if (titleMatch && contentMatch) {
        const tags = tagsMatch
          ? tagsMatch[1].match(/"([^"]+)"/g).map(t => t.replace(/"/g, ''))
          : ['자동생성'];
        let rawContent = contentMatch[1];
        // ⚠️ lastIndexOf('"') 로 자르면 content 뒤에 오는 "faq": [...] 가 통째로 본문에
        //    딸려 들어간다. 발행글 끝에 원시 JSON 이 노출되고 frontmatter faq 는 비어
        //    FAQ 위젯·FAQPage 스키마가 통째로 빠졌다(2026-08-05 TF, 08-06 LF 연속 발생).
        //    content 문자열의 진짜 끝 = 닫는 따옴표 뒤에 쉼표 + 다음 키가 오는 지점이다.
        const endAt = rawContent.search(/"\s*,\s*"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/);
        if (endAt > 0) rawContent = rawContent.slice(0, endAt);
        else {
          const lastQuote = rawContent.lastIndexOf('"');
          if (lastQuote > 0) rawContent = rawContent.slice(0, lastQuote);
        }
        rawContent = rawContent.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

        // 잘린 JSON 에서라도 faq 를 살려낸다. 못 살리면 빈 배열 → 위젯만 안 뜨고
        // 본문에 원시 JSON 이 새는 일은 없다.
        const recoveredFaq = [];
        {
          const src = (jsonStr.split(/"faq"\s*:\s*\[/)[1] || '');
          const re = /"q"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"a"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
          let mm;
          while ((mm = re.exec(src))) {
            recoveredFaq.push({
              q: mm[1].replace(/\\"/g, '"').replace(/\\n/g, ' '),
              a: mm[2].replace(/\\"/g, '"').replace(/\\n/g, ' '),
            });
          }
        }

        postData = {
          title: titleMatch[1],
          slug: slugMatch ? slugMatch[1] : null,
          description: descMatch ? descMatch[1] : titleMatch[1],
          tags,
          content: rawContent,
          faq: recoveredFaq,
        };
      } else {
        throw new Error('Could not extract required fields');
      }
    } catch (e2) {
      throw new Error(`Failed to parse Claude response: ${rawResponse.slice(0, 200)}`);
    }
  }

  // ⚠️ FAQ 를 본문 하단에 마크다운 섹션으로 덧붙이지 않는다(2026-08-05 제거).
  //    publish-wordpress.mjs 가 frontmatter 의 faq 로 `<div class="mg-faq"><h2>자주 묻는 질문</h2>…`
  //    위젯을 이미 렌더한다. 둘 다 넣으면 발행글에 "자주 묻는 질문" H2 가 2개 생기고
  //    ez-toc 목차에도 `자주_묻는_질문`, `자주_묻는_질문-2` 로 중복 등재된다.
  //    ⚠️ 08-04 에 ai-revenue-blog 쪽(b0e537a)만 고쳐서 LF 는 하루 더 중복 발행됐다.
  //    두 레포에 같은 블록이 각각 있으니 한쪽만 고치면 반쪽짜리다.
  //    FAQ 는 frontmatter 의 faq 가 SSOT — 위젯과 FAQPage JSON-LD 둘 다 거기서 나온다.

  const { title: rawTitle, slug: postSlug, description: rawDesc, tags, content } = postData;
  // YAML frontmatter 안전: 내부 따옴표 제거
  const title = rawTitle.replace(/"/g, '');
  const description = rawDesc.replace(/"/g, '');
  console.log(`Title: ${title}`);

  // Fetch hero image from Pexels
  console.log(`Fetching Pexels image for: ${searchTerm}`);
  const heroImage = await fetchHeroImage(searchTerm);

  // Pick coupang products
  const coupangProducts = revenue ? pickCoupangProducts(categoryName, 2) : [];

  // Build coupang section
  let coupangSection = '';
  if (coupangProducts.length > 0) {
    coupangSection = `\n\n---\n\n## 추천 상품\n\n> 이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n\n`;
    for (const product of coupangProducts) {
      coupangSection += `- [${product.title}](${product.url})\n`;
    }
  }

  // Build frontmatter + full markdown
  const slug = postSlug || slugify(title);
  const fileName = `${dateStr}-${categoryName}-${slug}.md`;

  const tagsYaml = tags.map(t => `  - "${t}"`).join('\n');
  const coupangYaml = coupangProducts
    .map(p => `  - title: "${p.title}"\n    url: "${p.url}"\n    imageUrl: "${p.imageUrl || ''}"`)
    .join('\n');

  // FAQ YAML
  let faqYaml = '';
  if (postData.faq && Array.isArray(postData.faq) && postData.faq.length > 0) {
    faqYaml = 'faq:\n';
    for (const item of postData.faq) {
      faqYaml += `  - q: "${item.q.replace(/"/g, '\\"')}"\n    a: "${item.a.replace(/"/g, '\\"')}"\n`;
    }
  }

  const frontmatter = `---
title: "${title}"
description: "${description}"
pubDate: ${dateStr}
author: "${AUTHOR}"
category: "${categoryName}"
tags:
${tagsYaml}
heroImage: "${heroImage.url}"
coupangLinks:
${coupangYaml}
${faqYaml}---`;

  const fullContent = `${frontmatter}

${content}${coupangSection}
`;

  // Write file
  if (!existsSync(blogDir)) {
    mkdirSync(blogDir, { recursive: true });
  }

  const filePath = join(blogDir, fileName);
  writeFileSync(filePath, fixChartLabels(fullContent), 'utf-8');
  console.log(`Blog post written: src/blog/${fileName}`);
  // mungge.com(WordPress) 자동 발행 — WP env 있을 때만(없으면 Astro만)
  // INPUT_WP_STATUS=draft 면 라이브 대신 초안으로 올린다(사람이 검토 후 수동 공개).
  // 기본은 publish — 기존 자동발행 동작을 바꾸지 않는다.
  await autoPublishToWP(filePath, { silo: '생활·재테크', status: process.env.INPUT_WP_STATUS || 'publish' });
}

async function main() {
  const inputCategory = process.env.INPUT_CATEGORY || 'auto';
  const inputTopic = process.env.INPUT_TOPIC || '';
  const inputCount = parseInt(process.env.INPUT_COUNT || '3', 10);
  const inputEngaging = process.env.INPUT_ENGAGING === 'true';
  const inputRevenue = process.env.INPUT_REVENUE === 'true';
  const count = Math.min(Math.max(inputCount, 1), 3);

  console.log('=== LifeFlow Blog Post Generator ===');
  console.log(`[Mode] category=${inputCategory}, topic="${inputTopic}", count=${count}\n`);
  console.log(`[Info] Date: ${dateStr}`);
  const allPostSlugs = loadExistingPostSlugs();
  console.log(`[Info] Existing posts for internal linking: ${allPostSlugs.length}개`);
  if (inputEngaging) console.log(`[Info] Engaging mode: ON (독자 유입 극대화)`);
  if (inputRevenue) console.log(`[Info] Revenue mode: ON (수익 극대화)`);

  // 0. 스케줄 실행 시 중복 확인 (수동 트리거는 항상 실행)
  const isManual = inputCategory !== 'auto' || inputTopic.trim() !== '';
  const blogDir = join(ROOT, 'src', 'blog');
  if (!isManual && existsSync(blogDir)) {
    const existing = readdirSync(blogDir).filter(f => f.startsWith(dateStr));
    if (existing.length >= 3) {
      console.log(`[Skip] Today's 3 posts already exist: ${existing.join(', ')}`);
      console.log('Done (skipped)');
      process.exit(0);
    }
  }

  // 1. 카테고리 결정
  let categoryNames;
  if (inputCategory !== 'auto') {
    categoryNames = Array(count).fill(inputCategory);
  } else {
    categoryNames = selectCategories(count);
  }
  const customTopic = inputTopic.trim();
  console.log(`[Info] Categories: ${categoryNames.join(', ')} (${count}편)`);
  if (customTopic) console.log(`[Info] Custom topic: "${customTopic}"`);

  // 2. Generate posts sequentially
  let generated = 0;
  for (let i = 0; i < categoryNames.length; i++) {
    const categoryName = categoryNames[i];
    const categoryData = seeds.categories.find(c => c.name === categoryName);
    if (!categoryData) {
      console.error(`[ERROR] Category "${categoryName}" not found in seeds`);
      continue;
    }

    // 수동 주제가 있으면 첫 번째 포스트에 적용
    let keyword, searchTerm;
    if (customTopic && i === 0) {
      keyword = customTopic;
      searchTerm = customTopic;
    } else {
      const keywordIndex = Math.floor(Math.random() * categoryData.keywords.length);
      keyword = categoryData.keywords[keywordIndex];
      searchTerm = categoryData.searchTerms[keywordIndex];
    }

    // 기존 포스트 제목 로드 (중복 방지)
    const existingTitles = loadExistingPostTitles(blogDir, categoryName);

    try {
      await generateOnePost(categoryName, keyword, searchTerm, blogDir, i + 1, count, existingTitles, inputEngaging, inputRevenue, allPostSlugs);
      generated++;
    } catch (err) {
      console.error(`[ERROR] Post ${i + 1}/${count} (${categoryName}) failed: ${err.message}`);
      console.log(`[Info] Continuing to next post...`);
      continue;
    }
  }

  console.log(`\n=== Done! (${generated}/${count} posts generated) ===`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
