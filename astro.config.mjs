import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkGfm from 'remark-gfm';

export default defineConfig({
  site: 'https://life-revenue-blog.vercel.app',
  integrations: [sitemap()],
  output: 'static',
  build: {
    format: 'directory',
  },
  markdown: {
    // Astro 기본 GFM 을 끄고 remark-gfm 을 직접 적용해 singleTilde 만 비활성화.
    // (기본값 singleTilde:true 는 "90,000~130,000" 의 단일 ~ 를 취소선으로 오인함)
    gfm: false,
    remarkPlugins: [[remarkGfm, { singleTilde: false }]],
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
