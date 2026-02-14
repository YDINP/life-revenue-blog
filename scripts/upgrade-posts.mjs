#!/usr/bin/env node
/**
 * upgrade-posts.mjs — 기존 블로그 포스트에 누락된 기능 소급 적용
 * 1. 콜아웃 박스 (callout-tip, callout-warning, callout-info) 2~3개 삽입
 * 2. 내부 링크 (관련 포스트 2~3개) 삽입
 * 3. 참고 자료 섹션 추가
 *
 * 사용법: node scripts/upgrade-posts.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, "..", "src", "blog");

// ─── 모든 포스트 메타데이터 로드 ───────────────────────────────────────
function loadAllPosts() {
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
  return files
    .map((filename) => {
      const filepath = path.join(BLOG_DIR, filename);
      const raw = fs.readFileSync(filepath, "utf8");

      // frontmatter 분리
      const fmEnd = raw.indexOf("\n---", 4);
      if (fmEnd === -1) return null;
      const fmBlock = raw.slice(4, fmEnd);
      const bodyStart = fmEnd + 4;
      const body = raw.slice(bodyStart).trimStart();

      // 메타데이터 파싱
      const title =
        (fmBlock.match(/^title:\s*["'](.+?)["']\s*$/m) ||
          fmBlock.match(/^title:\s*(.+?)\s*$/m) ||
          [])[1] || "";
      const slug =
        (fmBlock.match(/^slug:\s*["']?(.+?)["']?\s*$/m) || [])[1] || "";
      const category =
        (fmBlock.match(/^category:\s*["']?(.+?)["']?\s*$/m) || [])[1] || "";
      const tagsMatch = fmBlock.match(/^tags:\s*\[(.*?)\]/m);
      const tags = tagsMatch
        ? tagsMatch[1]
            .split(",")
            .map((t) => t.trim().replace(/["']/g, ""))
            .filter(Boolean)
        : [];

      return {
        filename,
        filepath,
        raw,
        fmBlock,
        bodyStart,
        body,
        title,
        slug,
        category,
        tags,
      };
    })
    .filter(Boolean);
}

// ─── 콜아웃 박스 삽입 ──────────────────────────────────────────────────
function addCallouts(body) {
  if (
    body.includes("callout-tip") ||
    body.includes("callout-warning") ||
    body.includes("callout-info")
  ) {
    return body;
  }

  const h2Pattern = /\n(## [^\n]+)/g;
  const h2Matches = [...body.matchAll(h2Pattern)];
  if (h2Matches.length < 2) return body;

  function extractKeyPhrase(sectionText) {
    const lines = sectionText.split("\n");
    for (const line of lines) {
      const boldMatch = line.match(/\*\*([^*]{5,60})\*\*/);
      if (boldMatch && !line.startsWith("#") && !line.startsWith("|")) {
        return boldMatch[1];
      }
    }
    for (const line of lines) {
      if (
        line.length > 30 &&
        !line.startsWith("#") &&
        !line.startsWith("|") &&
        !line.startsWith("<") &&
        !line.startsWith("-") &&
        !line.startsWith(">") &&
        !line.startsWith("```")
      ) {
        return line.slice(0, 100).replace(/\*\*/g, "").trim();
      }
    }
    return null;
  }

  function getSectionText(startIdx, endIdx) {
    const start = h2Matches[startIdx].index;
    const end =
      endIdx < h2Matches.length ? h2Matches[endIdx].index : body.length;
    return body.slice(start, end);
  }

  let result = body;
  let offset = 0;

  // 1) 첫 H2 섹션 끝에 callout-tip
  if (h2Matches.length >= 2) {
    const section = getSectionText(0, 1);
    const phrase = extractKeyPhrase(section);
    if (phrase) {
      const insertPos = h2Matches[1].index + offset;
      const callout = `\n<div class="callout-tip">💡 <strong>핵심 포인트</strong>: ${phrase}</div>\n`;
      result =
        result.slice(0, insertPos) + callout + result.slice(insertPos);
      offset += callout.length;
    }
  }

  // 2) 중간 섹션 끝에 callout-warning
  const midIdx = Math.floor(h2Matches.length / 2);
  if (midIdx >= 1 && midIdx + 1 < h2Matches.length) {
    const section = getSectionText(midIdx, midIdx + 1);
    const phrase = extractKeyPhrase(section);
    if (phrase) {
      const insertPos = h2Matches[midIdx + 1].index + offset;
      const callout = `\n<div class="callout-warning">⚠️ <strong>주의사항</strong>: ${phrase}</div>\n`;
      result =
        result.slice(0, insertPos) + callout + result.slice(insertPos);
      offset += callout.length;
    }
  }

  // 3) 마지막 H2 앞에 callout-info
  let lastContentH2 = h2Matches.length - 1;
  for (let i = h2Matches.length - 1; i >= 0; i--) {
    const heading = h2Matches[i][1];
    if (
      heading.includes("자주 묻는 질문") ||
      heading.includes("참고 자료") ||
      heading.includes("관련 글")
    ) {
      lastContentH2 = i - 1;
    } else {
      break;
    }
  }
  if (lastContentH2 >= 2) {
    const section = getSectionText(
      lastContentH2,
      lastContentH2 + 1 < h2Matches.length ? lastContentH2 + 1 : h2Matches.length
    );
    const phrase = extractKeyPhrase(section);
    if (phrase) {
      const insertPos =
        lastContentH2 + 1 < h2Matches.length
          ? h2Matches[lastContentH2 + 1].index + offset
          : result.length;
      const callout = `\n<div class="callout-info">ℹ️ <strong>참고</strong>: ${phrase}</div>\n`;
      result =
        result.slice(0, insertPos) + callout + result.slice(insertPos);
    }
  }

  return result;
}

// ─── 내부 링크 삽입 ───────────────────────────────────────────────────
function addInternalLinks(post, allPosts) {
  let body = post.body;

  const existingLinks = (body.match(/\]\(\/blog\/[^)]+\)/g) || []).length;
  if (existingLinks >= 2) return body;

  const related = allPosts
    .filter((p) => p.slug !== post.slug && p.filename !== post.filename)
    .map((p) => {
      let score = 0;
      if (p.category === post.category) score += 3;
      const tagOverlap = p.tags.filter((t) => post.tags.includes(t)).length;
      score += tagOverlap * 2;
      return { title: p.title, slug: p.slug, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (related.length === 0) return body;

  const linksBlock = `\n---\n\n### 함께 읽으면 좋은 글\n\n${related
    .map((r) => `- [${r.title}](/blog/${r.slug}/)`)
    .join("\n")}\n`;

  const faqIdx = body.indexOf("## 자주 묻는 질문");
  if (faqIdx > -1) {
    body = body.slice(0, faqIdx) + linksBlock + "\n" + body.slice(faqIdx);
  } else {
    body = body + linksBlock;
  }

  return body;
}

// ─── 참고 자료 섹션 추가 ──────────────────────────────────────────────
function addReferenceSection(body, category) {
  if (body.includes("## 참고 자료")) return body;

  const refs = {
    Lifestyle: [
      "- [라이프해커 코리아](https://lifehacker.com/)",
      "- [브런치스토리](https://brunch.co.kr/)",
      "- [핀터레스트 라이프스타일](https://www.pinterest.com/)",
    ],
    Finance: [
      "- [한국은행 경제통계](https://ecos.bok.or.kr/)",
      "- [금융감독원 금융꿀팁](https://www.fss.or.kr/)",
      "- [인베스토피디아](https://www.investopedia.com/)",
    ],
    Health: [
      "- [대한체육회](https://www.sports.or.kr/)",
      "- [하버드 헬스](https://www.health.harvard.edu/)",
      "- [질병관리청](https://www.kdca.go.kr/)",
    ],
    Education: [
      "- [코세라 (Coursera)](https://www.coursera.org/)",
      "- [K-MOOC](https://www.kmooc.kr/)",
      "- [에듀테크 매거진](https://edtechmagazine.com/)",
    ],
    Travel: [
      "- [한국관광공사](https://korean.visitkorea.or.kr/)",
      "- [트립어드바이저](https://www.tripadvisor.co.kr/)",
      "- [론리플래닛](https://www.lonelyplanet.com/)",
    ],
  };

  const refList = refs[category] || refs["Lifestyle"];
  return body + `\n\n## 참고 자료\n\n${refList.join("\n")}\n`;
}

// ─── Main ─────────────────────────────────────────────────────────────
function main() {
  const posts = loadAllPosts();
  console.log(`📂 ${posts.length}개 포스트 발견\n`);

  let upgraded = 0;
  const stats = { callouts: 0, links: 0, refs: 0 };

  for (const post of posts) {
    let body = post.body;
    let changes = [];

    const afterCallouts = addCallouts(body);
    if (afterCallouts !== body) {
      body = afterCallouts;
      changes.push("콜아웃");
      stats.callouts++;
    }

    const afterLinks = addInternalLinks({ ...post, body }, posts);
    if (afterLinks !== body) {
      body = afterLinks;
      changes.push("내부링크");
      stats.links++;
    }

    const afterRefs = addReferenceSection(body, post.category);
    if (afterRefs !== body) {
      body = afterRefs;
      changes.push("참고자료");
      stats.refs++;
    }

    if (changes.length > 0) {
      const header = post.raw.slice(0, post.bodyStart);
      const updated = header + "\n" + body;
      fs.writeFileSync(post.filepath, updated, "utf8");
      upgraded++;
      console.log(`✅ ${post.filename} → [${changes.join(", ")}]`);
    } else {
      console.log(`⏭️  ${post.filename} (이미 적용됨)`);
    }
  }

  console.log(`\n━━━ 완료 ━━━`);
  console.log(`총 ${upgraded}/${posts.length}개 포스트 업그레이드`);
  console.log(`  콜아웃: ${stats.callouts}개`);
  console.log(`  내부링크: ${stats.links}개`);
  console.log(`  참고자료: ${stats.refs}개`);
}

main();
