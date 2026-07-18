-- 0033: 고위험(High-Alert) 의약품 표시 컬럼 신설 (drugs)
-- 배경: 고농도 전해질 등 고위험 주사제 식별 플래그.
-- 성격: 컬럼 추가 + 지정 2품목 플래그 설정. RLS·tenant_id 등 기존 구조 무변경.
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici)에 붙여넣어 실행.

alter table public.drugs add column is_high_alert boolean not null default false;

update public.drugs set is_high_alert = true where drug_code = '7PTSMCLDH'; -- 대한염화칼륨-40
update public.drugs set is_high_alert = true where drug_code = '7NACLDH';   -- 대한염화나트륨-40주사액

-- 롤백: alter table public.drugs drop column if exists is_high_alert;