// 후속글 2편(4대보험·주휴수당) 스레드 포스트 → 자답 포함 타래형 draft 큐 저장
// 실행: CRON_SECRET=<키> node queue-followups-2026-07-23.mjs
const BASE = process.env.ADMIN_BASE || 'https://ai-revenue-blog.vercel.app';
const SECRET = process.env.CRON_SECRET;
if (!SECRET) { console.error('CRON_SECRET 필요'); process.exit(1); }
const U = (slug) => `https://life-revenue-blog.vercel.app/blog/${slug}/?utm_source=threads&utm_medium=social&utm_campaign=nochimyon`;

const posts = [
  {
    label: '④ 4대보험 실수령',
    imageUrl: 'https://images.pexels.com/photos/4386289/pexels-photo-4386289.jpeg?auto=compress&cs=tinysrgb&w=1200',
    linkUrl: U('2026-07-23-finance-4-insurance-real-pay-2026'),
    body: `월급 250인데 손에 210만 들어오는 이유.

세전이랑 실수령 40만 차이, 어디로 샜나 싶지?
4대보험이랑 소득세로 빠지는 건데
같은 월급이어도 실수령은 사람마다 달라.
(하나는 아예 니 월급에서 빠지면 안 되는 항목인데, 잘못 떼가는 데도 있어)

명세서에서 확인할 3가지랑 계산법 정리했어.
스친들 세전 대비 몇 % 빠지는지 봤어? 👇

「놓치면 손해」 시리즈. 다음 편은 '주휴수당 안 주면 대처법'.`,
    self: `산재보험은 전액 사장 부담이라 니 월급에서 빠지면 안 되는 거야. 명세서에 산재 공제 있으면 회사에 물어봐`,
  },
  {
    label: '⑤ 주휴수당 단독',
    imageUrl: 'https://images.pexels.com/photos/6693661/pexels-photo-6693661.jpeg?auto=compress&cs=tinysrgb&w=1200',
    linkUrl: U('2026-07-23-finance-weekly-holiday-allowance-2026'),
    body: `알바 주휴수당, 5인 미만이어도 받는 거 알아?

"우리 작은 가게라 그런 거 없어" — 이거 그냥 틀린 말이야.
주 15시간 이상 일하고 개근하면
가게 크기랑 상관없이 주휴수당 받는 게 법이거든.
알바도, 파트타임도 똑같이.

내가 받을 수 있는지 조건이랑 계산법, 못 받았을 때 대처까지 정리했어.
스친들 알바하면서 주휴수당 받아봤어? 못 받은 사람 꽤 있을걸 👇

「놓치면 손해」 시리즈.`,
    self: `주 15시간 미만으로 쪼개서 주휴수당 피하는 데도 있어. 니 근로계약서 소정근로시간부터 확인해봐`,
  },
];

const run = async () => {
  for (const p of posts) {
    const text = `${p.body}\n---\n${p.self}`;
    try {
      const res = await fetch(`${BASE}/api/threads-admin?action=queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'life', text, linkUrl: p.linkUrl, imageUrl: p.imageUrl }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(res.ok ? `✅ ${p.label} → queued id=${j.id}` : `❌ ${p.label} → ${res.status} ${JSON.stringify(j)}`);
    } catch (e) { console.log(`❌ ${p.label} → ${e.message}`); }
  }
};
run();
