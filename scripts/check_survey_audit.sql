-- ════════════════════════════════════════════════════════════════════════════
-- 수요조사 감사 기록 확인 — Deploy Preview 에서 「엑셀 → PDF → 원문 보기」를 누른 뒤 실행한다.
-- ★ 읽기만 한다. 성명·사번은 출력하지 않는다(user_id 도 앞 8자만).
-- ★ 기대: export_xlsx 1 · export_pdf 1 · view_raw 1 = 3건 증가
-- ════════════════════════════════════════════════════════════════════════════

-- ① action 별 건수
select action,
       count(*)::int                     as rows,
       min(created_at)                   as first_at,
       max(created_at)                   as last_at,
       count(distinct user_id)::int      as users,
       sum(row_count)                    as row_count_sum
from public.vaccine_survey_audit
group by action
order by action;

-- ② 전체 건수와 「서버가 채운 값」이 맞는지
--    tenant_id 가 회차의 tenant_id 와 같고, user_id 가 비어 있지 않아야 한다(0095 트리거)
select count(*)::int                                            as total,
       count(*) filter (where a.user_id is null)::int            as user_id_null_must_be_0,
       count(*) filter (where a.tenant_id <> s.tenant_id)::int   as tenant_mismatch_must_be_0
from public.vaccine_survey_audit a
join public.vaccine_surveys s on s.id = a.survey_id;

-- ③ 시간순 목록 (user_id 는 앞 8자만)
select a.created_at,
       a.action,
       left(a.user_id::text, 8) || '…'                           as user_head,
       a.row_count,
       (a.response_id is not null)                               as has_response,
       s.title
from public.vaccine_survey_audit a
join public.vaccine_surveys s on s.id = a.survey_id
order by a.created_at;
