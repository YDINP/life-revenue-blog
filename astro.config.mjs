import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkGfm from 'remark-gfm';
import { visit, SKIP } from 'unist-util-visit';

// 표를 .table-scroll 로 감싸 (1) 좁은 표는 컨테이너 폭을 꽉 채우고
// (2) 넓은 표만 가로 스크롤되게 한다. table 자체에 display:block+overflow-x
// 를 주면 좁은 표가 내용폭으로 줄어 왼쪽에 몰리는 문제가 생기므로 wrapper 로 분리.
function rehypeWrapTables() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || typeof index !== 'number') return;
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'] },
        children: [node],
      };
      return [SKIP, index + 1];
    });
  };
}

export default defineConfig({
  site: 'https://life-revenue-blog.vercel.app',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/dashboard'),
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        if (item.url.endsWith('.vercel.app/')) { item.priority = 1.0; item.changefreq = 'daily'; }
        else if (item.url.includes('/blog/') && !/\/blog\/(tags|[a-z]+)\/$/.test(item.url)) { item.priority = 0.8; }
        return item;
      },
    }),
  ],
  output: 'static',
  build: {
    format: 'directory',
  },
  markdown: {
    // Astro 기본 GFM 을 끄고 remark-gfm 을 직접 적용해 singleTilde 만 비활성화.
    // (기본값 singleTilde:true 는 "90,000~130,000" 의 단일 ~ 를 취소선으로 오인함)
    gfm: false,
    remarkPlugins: [[remarkGfm, { singleTilde: false }]],
    rehypePlugins: [rehypeWrapTables],
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
