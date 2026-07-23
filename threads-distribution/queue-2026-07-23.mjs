// 2026-07-23 LifeFlow 스레드 배치 → 큐(draft) 저장
// 실행: CRON_SECRET=<프로덕션키> node queue-2026-07-23.mjs
//   (선택) ADMIN_BASE=https://ai-revenue-blog.vercel.app 로 엔드포인트 override
// topic=life, status=draft 로만 저장됨(자동 발행 안 함, review 모드). 발행은 대시보드/봇에서.

const BASE = process.env.ADMIN_BASE || 'https://ai-revenue-blog.vercel.app';
const SECRET = process.env.CRON_SECRET;
if (!SECRET) { console.error('CRON_SECRET 환경변수 필요'); process.exit(1); }

const U = (slug) =>
  `https://life-revenue-blog.vercel.app/blog/${slug}/?utm_source=threads&utm_medium=social&utm_campaign=nochimyon`;

const posts = [
  {
    label: '① 최저임금/주휴수당',
    imageUrl: 'https://life-revenue-blog.vercel.app/images/minimum-wage-2027.webp',
    linkUrl: U('2026-07-20-finance-2027-minimum-wage-10700-real-pay'),
    text: `월급에서 주휴수당 빠지면 37만원 날아가.

2027 최저시급 10,700원 됐다고 좋아했지?
근데 실수령은 '주휴수당 209시간'이 들어갔는지가 진짜야.
이거 빠진 채 받는 스친들 생각보다 많더라.
(계산법에 함정 하나 있는데, 절반은 틀리게 알고 있어)

내 명세서 확인법이랑 정확한 금액 정리해놨어.
스친들 지난달 명세서에 '주휴수당' 항목 있었어? 나만 없나… 👇

「놓치면 손해」 매주 하나씩. 다음 편은 '근로장려금 안 받으면 버리는 돈'.`,
  },
  {
    label: '② 정부지원금/중복수급',
    imageUrl: 'https://images.pexels.com/photos/16055842/pexels-photo-16055842.jpeg?auto=compress&cs=tinysrgb&w=1200',
    linkUrl: U('2026-07-15-finance-government-subsidy-2026-h2'),
    text: `정부지원금, 둘 다 되는데 하나만 신청하더라.

"이거 받으면 저건 안 되겠지" 하고 지레 포기하는 스친들 많아.
근데 성격 다른 지원은 겹쳐 받는 경우가 꽤 돼.
청년 자산형성 + 근로장려금처럼.

2026 하반기 중복으로 받을 수 있는 조합, 놓치기 쉬운 것만 추렸어.
(이 중 하나는 8월 마감인데, 뭔지 알아?)
스친들 지금 정부지원금 몇 개나 받고 있어? 👇

「놓치면 손해」 시리즈. 다음 편은 '4대보험 실수령 계산'.`,
  },
  {
    label: '③ 근로장려금(신규)',
    imageUrl: 'https://images.pexels.com/photos/4386370/pexels-photo-4386370.jpeg?auto=compress&cs=tinysrgb&w=1200',
    linkUrl: U('2026-07-23-finance-labor-incentive-2026-guide'),
    text: `근로장려금 안 받으면 최대 330만원 버리는 거야.

"이거 자영업자만 받는 거 아냐?" 하고 넘기는 스친들 진짜 많아.
근데 나이·직업 아니라 '가구 소득'으로 판단해서
알바·프리랜서·직장인도 기준만 맞으면 받아.
맞벌이면 최대 330만원, 단독가구도 165만원.

내가 대상인지 30초에 확인하는 법이랑 5월 놓쳤을 때 방법까지 정리했어.
스친들 근로장려금 받아본 적 있어? 안내문 왔는데 그냥 버린 사람도 있을걸 👇

「놓치면 손해」 시리즈. 다음 편은 '4대보험 실수령'.`,
  },
];

const run = async () => {
  for (const p of posts) {
    try {
      const res = await fetch(`${BASE}/api/threads-admin?action=queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'life', text: p.text, linkUrl: p.linkUrl, imageUrl: p.imageUrl }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(res.ok ? `✅ ${p.label} → queued id=${j.id}` : `❌ ${p.label} → ${res.status} ${JSON.stringify(j)}`);
    } catch (e) {
      console.log(`❌ ${p.label} → ${e.message}`);
    }
  }
};
run();
