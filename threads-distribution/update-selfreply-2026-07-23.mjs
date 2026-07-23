// 2026-07-23 배치 draft #38/39/40 → '본문 --- 자답' 타래형으로 제자리 수정
// 크론 publishDraft가 THREAD_SEP 감지 → 본문 → 자답(체인 답글) → 링크(첫 댓글) 자동 발행.
// 실행: CRON_SECRET=<키> node update-selfreply-2026-07-23.mjs
const BASE = process.env.ADMIN_BASE || 'https://ai-revenue-blog.vercel.app';
const SECRET = process.env.CRON_SECRET;
if (!SECRET) { console.error('CRON_SECRET 필요'); process.exit(1); }

// 본문(링크 제외) + 자답. text = 본문 + '\n---\n' + 자답
const items = [
  {
    id: 38,
    body: `월급에서 주휴수당 빠지면 37만원 날아가.

2027 최저시급 10,700원 됐다고 좋아했지?
근데 실수령은 '주휴수당 209시간'이 들어갔는지가 진짜야.
이거 빠진 채 받는 스친들 생각보다 많더라.
(계산법에 함정 하나 있는데, 절반은 틀리게 알고 있어)

내 명세서 확인법이랑 정확한 금액 정리해놨어.
스친들 지난달 명세서에 '주휴수당' 항목 있었어? 나만 없나… 👇

「놓치면 손해」 매주 하나씩. 다음 편은 '근로장려금 안 받으면 버리는 돈'.`,
    self: `5인 미만 사업장이라 주휴수당 안 준다는 데 많은데, 주 15시간 이상이면 규모 상관없이 받는 거야. 사장님도 모르는 경우 많음ㅋ`,
  },
  {
    id: 39,
    body: `정부지원금, 둘 다 되는데 하나만 신청하더라.

"이거 받으면 저건 안 되겠지" 하고 지레 포기하는 스친들 많아.
근데 성격 다른 지원은 겹쳐 받는 경우가 꽤 돼.
청년 자산형성 + 근로장려금처럼.

2026 하반기 중복으로 받을 수 있는 조합, 놓치기 쉬운 것만 추렸어.
(이 중 하나는 8월 마감인데, 뭔지 알아?)
스친들 지금 정부지원금 몇 개나 받고 있어? 👇

「놓치면 손해」 시리즈. 다음 편은 '4대보험 실수령 계산'.`,
    self: `소득 살짝 넘었다고 포기하는 스친들 많은데, 구간형이면 조금 넘어도 감액만 되고 받아. 컷오프인지 구간인지부터 확인 ㄱ`,
  },
  {
    id: 40,
    body: `근로장려금 안 받으면 최대 330만원 버리는 거야.

"이거 자영업자만 받는 거 아냐?" 하고 넘기는 스친들 진짜 많아.
근데 나이·직업 아니라 '가구 소득'으로 판단해서
알바·프리랜서·직장인도 기준만 맞으면 받아.
맞벌이면 최대 330만원, 단독가구도 165만원.

내가 대상인지 30초에 확인하는 법이랑 5월 놓쳤을 때 방법까지 정리했어.
스친들 근로장려금 받아본 적 있어? 안내문 왔는데 그냥 버린 사람도 있을걸 👇

「놓치면 손해」 시리즈. 다음 편은 '4대보험 실수령'.`,
    self: `5월 정기 놓쳐도 기한 후 신청 돼(감액은 있음). 안내문 왔으면 거의 대상이니까 홈택스 '신청대상조회'부터 눌러봐`,
  },
];

const run = async () => {
  for (const it of items) {
    const text = `${it.body}\n---\n${it.self}`;
    try {
      const res = await fetch(`${BASE}/api/threads-admin?action=queue-update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, text }),
      });
      const j = await res.json().catch(() => ({}));
      console.log(res.ok ? `✅ #${it.id} → 자답 타래 반영 (status=${j.status})` : `❌ #${it.id} → ${res.status} ${JSON.stringify(j)}`);
    } catch (e) { console.log(`❌ #${it.id} → ${e.message}`); }
  }
};
run();
