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
if (!PEXELS_API_KEY) {
  console.error('ERROR: PEXELS_API_KEY is not set');
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

const categoryIndex = today.getDate() % seeds.categories.length;
const category = seeds.categories[categoryIndex];
const keywordIndex = Math.floor(Math.random() * category.keywords.length);
const keyword = category.keywords[keywordIndex];
const searchTerm = category.searchTerms[keywordIndex];

console.log(`[${dateStr}] Category: ${category.name}, Keyword: ${keyword}`);

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
    throw new Error(`Claude API error ${res.status}: ${errBody}`);
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

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // 0. 중복 확인 - 같은 날짜 파일이 이미 있으면 스킵
  const blogDir = join(ROOT, 'src', 'blog');
  if (existsSync(blogDir)) {
    const existing = readdirSync(blogDir).filter(f => f.startsWith(dateStr));
    if (existing.length > 0) {
      console.log(`[Skip] Today's post already exists: ${existing[0]}`);
      console.log('Done (skipped)');
      process.exit(0);
    }
  }

  // 1. Generate blog post via Claude
  const isComparisonKeyword = keyword.includes('비교') || keyword.includes('TOP') ||
    keyword.includes('추천') || keyword.includes('전략') || keyword.includes('가이드');

  const chartInstruction = isComparisonKeyword
    ? `반드시 본문에 chart-bar 또는 chart-radar HTML을 포함해주세요.
chart-bar 예시:
<div class="chart-bar">
  <div class="chart-bar-item" style="--value: 85; --color: ${CHART_COLORS[0]}"><span class="label">항목1</span><div class="bar"><div class="fill"></div></div><span class="value">85점</span></div>
  <div class="chart-bar-item" style="--value: 72; --color: ${CHART_COLORS[1]}"><span class="label">항목2</span><div class="bar"><div class="fill"></div></div><span class="value">72점</span></div>
</div>

chart-radar 예시:
<div class="chart-radar" data-items='[{"label":"항목1","value":85},{"label":"항목2","value":72}]' data-colors='["${CHART_COLORS[0]}","${CHART_COLORS[1]}"]'></div>`
    : '비교/리뷰 성격의 내용이 있다면 chart-bar 또는 chart-radar HTML을 포함해도 좋습니다.';

  const prompt = `당신은 한국어 블로그 작성 전문가입니다.
"${keyword}" 주제로 SEO 최적화된 블로그 포스트를 작성해주세요.

카테고리: ${category.name}

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
      // content 필드에서 잘린 JSON 복구 시도
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
      console.error('Failed to parse Claude response:', parseErr.message);
      console.error('Raw response:', rawResponse.slice(0, 500));
      process.exit(1);
    }
  }

  const { title, slug: postSlug, description, tags, content } = postData;
  console.log(`Title: ${title}`);

  // 2. Fetch hero image from Pexels
  console.log(`Fetching Pexels image for: ${searchTerm}`);
  const heroImage = await fetchPexelsImage(searchTerm);

  // 3. Pick coupang products
  const coupangProducts = pickCoupangProducts(category.name, 2);

  // 4. Build coupang section
  let coupangSection = '';
  if (coupangProducts.length > 0) {
    coupangSection = `\n\n---\n\n## 추천 상품\n\n> 이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n\n`;
    for (const product of coupangProducts) {
      coupangSection += `- [${product.title}](${product.url})\n`;
    }
  }

  // 5. Build frontmatter + full markdown
  const slug = postSlug || slugify(title);
  const fileName = `${dateStr}-${slug}.md`;

  const tagsYaml = tags.map(t => `  - "${t}"`).join('\n');
  const coupangYaml = coupangProducts
    .map(p => `  - title: "${p.title}"\n    url: "${p.url}"`)
    .join('\n');

  const frontmatter = `---
title: "${title}"
description: "${description}"
pubDate: "${dateStr}"
author: "${AUTHOR}"
category: "${category.name}"
tags:
${tagsYaml}
heroImage: "${heroImage.url}"
coupangLinks:
${coupangYaml}
---`;

  const fullContent = `${frontmatter}

${content}${coupangSection}
`;

  // 6. Write file
  const blogDir = join(ROOT, 'src', 'blog');
  if (!existsSync(blogDir)) {
    mkdirSync(blogDir, { recursive: true });
  }

  const filePath = join(blogDir, fileName);
  writeFileSync(filePath, fullContent, 'utf-8');
  console.log(`Blog post written: src/blog/${fileName}`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
