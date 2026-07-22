// 생성된 .md를 mungge.com(WordPress)에 자동 발행 + 대표이미지 설정.
// generate-post.mjs 훅용. WP env(WP_URL/WP_USER/WP_APP_PASS) 없으면 조용히 스킵(Astro만).
// 차트=정적렌더(keepChartDivs), 대표이미지=frontmatter hero 사이드로드, IndexNow는 WP 플러그인이 자동 핑.
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { publishPost, envFromProcess } from './publish-wordpress.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

// TF(image:\n url:) / LF(heroImage:) 둘 다 지원. coupangLinks.url 오매칭 방지.
function heroOf(fm) {
  let m = fm.match(/^heroImage:\s*["']?([^"'\s]+)/m);
  if (m) return m[1].trim();
  m = fm.match(/^image:\s*\n\s+url:\s*["']?([^"'\s]+)/m) || fm.match(/^image:\s*\{[^}]*url:\s*["']?([^"',}]+)/m);
  return m ? m[1].trim() : '';
}

async function setFeatured(env, wpId, url, slug, publicBase) {
  const B = env.WP_URL.replace(/\/$/, '') + '/wp-json/wp/v2';
  const auth = 'Basic ' + Buffer.from(`${env.WP_USER}:${env.WP_APP_PASS}`).toString('base64');
  let buf, ct;
  if (/^https?:\/\//.test(url)) {
    // 원격(Pexels 등): node fetch는 403 → curl 사용
    const tmp = join(__dir, '..', '.tmp', `hero-${slug}.tmp`);
    try { execSync(`curl -s -L --max-time 25 -A "Mozilla/5.0" -o "${tmp}" "${url}"`, { stdio: 'ignore' }); } catch { return; }
    if (!existsSync(tmp)) return;
    buf = readFileSync(tmp);
    if (buf.length < 500) return;
    ct = /\.png(\?|$)/i.test(url) ? 'image/png' : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/jpeg';
  } else {
    const local = (publicBase || join(__dir, '..', 'public')) + (url.startsWith('/') ? url : '/' + url);
    if (!existsSync(local)) return;
    buf = readFileSync(local);
    ct = /\.png$/i.test(url) ? 'image/png' : /\.webp$/i.test(url) ? 'image/webp' : 'image/jpeg';
  }
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const up = await fetch(`${B}/media`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': ct, 'Content-Disposition': `attachment; filename="${slug}.${ext}"` }, body: buf });
  if (!up.ok) return;
  const media = await up.json();
  await fetch(`${B}/posts/${wpId}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ featured_media: media.id }) });
}

// mdFile → mungge.com 발행. silo: 'テ크·개발'(TF)/'생활·재테크'(LF). status 기본 publish.
export async function autoPublishToWP(mdFile, { silo = '', status = 'publish', publicBase = '' } = {}) {
  if (!process.env.WP_URL) { console.log('[WP] env 없음 → mungge 발행 스킵(Astro만)'); return null; }
  try {
    const env = envFromProcess();
    const r = await publishPost(mdFile, { status, env, keepChartDivs: true, silo });
    console.log(`[WP] mungge 발행 #${r.id}: ${r.link}`);
    const fm = (readFileSync(mdFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const hero = heroOf(fm);
    if (hero) { await setFeatured(env, r.id, hero, r.slug, publicBase); console.log('[WP] 대표이미지 설정 완료'); }
    return r;
  } catch (e) {
    console.error('[WP] mungge 발행 실패:', e.message);
    return null;
  }
}
