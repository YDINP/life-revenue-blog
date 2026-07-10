// Pexels 이미지 반응형 srcset 헬퍼 (CWV: LCP/CLS 개선)
// heroImage 는 대부분 https://images.pexels.com/photos/ID/...jpeg?...&w=1200 형태.

/** 주어진 pexels URL 을 특정 width 로 정규화 (w/h/dpr 파라미터 제거 후 w 지정) */
export function pexelsUrl(url, w) {
  if (!url) return url;
  let u = url.replace(/&?(w|h|dpr)=\d+/g, '').replace(/\?&/, '?').replace(/[?&]$/, '');
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}w=${w}`;
}

/** pexels URL 이면 srcset 문자열 생성, 아니면 undefined */
export function pexelsSrcset(url, widths = [400, 600, 800, 1200]) {
  if (!url || !/images\.pexels\.com/.test(url)) return undefined;
  return widths.map((w) => `${pexelsUrl(url, w)} ${w}w`).join(', ');
}
