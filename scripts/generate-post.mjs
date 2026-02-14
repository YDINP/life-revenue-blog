import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return data.content[0].text;
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
      };
    }
    return { url: '', photographer: '' };
  } catch (err) {
    console.warn('Pexels fetch failed:', err.message);
    return { url: '', photographer: '' };
  }
}

function pickCoupangProducts(categoryName, count = 2) {
  const products = coupangLinks[categoryName] || [];
  const shuffled = [...products].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
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
async function generateOnePost(categoryName, keyword, searchTerm, blogDir, postIndex, totalCount, existingTitles) {
  console.log(`\n--- Post ${postIndex}/${totalCount}: ${categoryName} ---`);
  console.log(`[Info] Keyword: ${keyword}`);
  console.log(`[Info] Search term: ${searchTerm}`);
  if (existingTitles && existingTitles.length > 0) {
    console.log(`[Info] Existing ${categoryName} posts: ${existingTitles.length}개 (중복 방지)`);
  }

  const chartInstruction = `반드시 본문에 아래 5가지 차트 유형 중 주제에 맞는 것을 1~2개 선택하여 포함하세요:

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

선택 가이드: 비율/점유율→donut, 1:1 대결→versus, 개별 평점→progress, 수치 비교→bar, 다항목 제품 평가→radar.
주의: div 안에 자식 요소를 넣지 마세요. 항목 3~5개. chart-bar만 반복하지 말고 다양한 유형을 활용하세요.`;

  // 기존 포스트 중복 방지 지시
  const dupeGuard = existingTitles && existingTitles.length > 0
    ? `\n**중복 방지**: 아래는 이미 발행된 같은 카테고리 포스트입니다. 이들과 겹치지 않는 새로운 각도/주제로 작성하세요:\n${existingTitles.map(t => `- ${t}`).join('\n')}\n`
    : '';

  const prompt = `당신은 한국어 블로그 작성 전문가입니다.
"${keyword}" 주제로 SEO 최적화된 블로그 포스트를 작성해주세요.

카테고리: ${categoryName}
${dupeGuard}
**최우선 원칙 — 최신 데이터 기반 작성 (정보 신뢰도가 핵심)**:
- 2026년 2월 기준 실제 존재하는 제품, 서비스, 통계 수치만 사용
- 허구의 수치나 브랜드명을 만들어내지 말 것. 확실하지 않으면 "공식 발표 예정" 등으로 표기
- 가격, 효과, 수치 등은 반드시 실제 데이터를 근거로 작성
- 단순 일반론이 아닌 구체적인 시의성 있는 최신 내용 위주
- 제목에 "2026" 또는 구체적 시점을 포함
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

${chartInstruction}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "...",
  "slug": "english-slug-for-url (영문 소문자, 하이픈으로 연결, 예: time-management-tips-2026)",
  "description": "...",
  "tags": ["...", "..."],
  "content": "마크다운 본문..."
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
        const lastQuote = rawContent.lastIndexOf('"');
        if (lastQuote > 0) rawContent = rawContent.slice(0, lastQuote);
        rawContent = rawContent.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

        postData = {
          title: titleMatch[1],
          slug: slugMatch ? slugMatch[1] : null,
          description: descMatch ? descMatch[1] : titleMatch[1],
          tags,
          content: rawContent,
        };
      } else {
        throw new Error('Could not extract required fields');
      }
    } catch (e2) {
      throw new Error(`Failed to parse Claude response: ${rawResponse.slice(0, 200)}`);
    }
  }

  const { title: rawTitle, slug: postSlug, description: rawDesc, tags, content } = postData;
  // YAML frontmatter 안전: 내부 따옴표 제거
  const title = rawTitle.replace(/"/g, '');
  const description = rawDesc.replace(/"/g, '');
  console.log(`Title: ${title}`);

  // Fetch hero image from Pexels
  console.log(`Fetching Pexels image for: ${searchTerm}`);
  const heroImage = await fetchPexelsImage(searchTerm);

  // Pick coupang products
  const coupangProducts = pickCoupangProducts(categoryName, 2);

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
    .map(p => `  - title: "${p.title}"\n    url: "${p.url}"`)
    .join('\n');

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
---`;

  const fullContent = `${frontmatter}

${content}${coupangSection}
`;

  // Write file
  if (!existsSync(blogDir)) {
    mkdirSync(blogDir, { recursive: true });
  }

  const filePath = join(blogDir, fileName);
  writeFileSync(filePath, fullContent, 'utf-8');
  console.log(`Blog post written: src/blog/${fileName}`);
}

async function main() {
  const inputCategory = process.env.INPUT_CATEGORY || 'auto';
  const inputTopic = process.env.INPUT_TOPIC || '';
  const inputCount = parseInt(process.env.INPUT_COUNT || '3', 10);
  const count = Math.min(Math.max(inputCount, 1), 3);

  console.log('=== LifeFlow Blog Post Generator ===');
  console.log(`[Mode] category=${inputCategory}, topic="${inputTopic}", count=${count}\n`);
  console.log(`[Info] Date: ${dateStr}`);

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
      await generateOnePost(categoryName, keyword, searchTerm, blogDir, i + 1, count, existingTitles);
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
