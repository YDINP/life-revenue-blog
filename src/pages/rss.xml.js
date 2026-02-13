import rss from '@astrojs/rss';

export async function GET(context) {
  const allPostModules = import.meta.glob('../blog/**/*.md', { eager: true });

  const items = Object.entries(allPostModules)
    .map(([path, post]) => {
      const slug = path
        .replace('../blog/', '')
        .replace('.md', '')
        .split('/')
        .slice(-1)[0];

      return {
        title: post.frontmatter.title,
        description: post.frontmatter.description,
        pubDate: new Date(post.frontmatter.pubDate),
        link: `/blog/${slug}/`,
        categories: [
          post.frontmatter.category,
          ...(post.frontmatter.tags || []),
        ],
      };
    })
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: 'LifeFlow - 더 나은 삶을 위한 인사이트',
    description: '라이프스타일, 금융, 건강, 교육, 여행 최신 정보',
    site: context.site || 'https://life-revenue-blog.vercel.app',
    items,
    customData: `<language>ko</language>`,
  });
}
