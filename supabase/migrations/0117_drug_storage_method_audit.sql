-- 0117_drug_storage_method_audit.sql
-- 목적: **보관방법(storage_method)이 바뀌면 누가·언제 바꿨는지 기록**을 남긴다.
--
-- ★ 왜 — 차광 뱃지의 자료를 `storage_light`(손으로 찍은 9종, 켜고 끌 화면이 없음)에서
--   `storage_method` 의 「차광」 포함 여부로 옮긴다(2026-11-07 이정화 님 승인).
--   옮기고 나면 보관방법 드롭다운 하나가 **ATC 카세트 칸 색·뱃지·인쇄물**을 바꾸게 된다.
--   그런데 지금 `storage_method` 는 **감사표에 전혀 남지 않는다**.
--   주의 표시 3종(`caution_*`, 0115)·보관위치(`storage_location`, 0104)는 남는데
--   보관방법만 안 남아서, 「차광이 언제 꺼졌는지」를 아무도 되짚을 수 없다.
--
-- ★ 범위 — **함수 1개 + 트리거 1개만** 더한다.
--   · 칸을 더하거나 지우지 않는다. `storage_light` 도 **그대로 둔다**(읽지만 않는다).
--   · 기존 함수는 **한 글자도 바꾸지 않는다.** 0115 와 같은 방식으로 **자기 함수**를 따로 만든다.
--     (log_drugs_usage · log_drugs_location · log_drugs_status · log_drugs_qty ·
--      log_drug_price_change · log_drugs_caution · enforce_* 전부 무변경)
--   · 기존 트리거 배선도 다시 걸지 않는다. 새 트리거만 더한다.
--   · 기존 감사 줄은 **그대로 둔다.** 소급해서 채우지 않는다 — 과거 변경은 기록이 없다.
--   · `drugs` 의 값을 바꾸지 않는다. 금액·수량·마감값·계산식 **무변경**.
--
-- ★ 왜 drug_usage_audit 에 적나 (0115 와 같은 이유)
--   이름만 usage 일 뿐 실제로는 (drug_code, field, old_value, new_value, changed_at, changed_by)
--   형태의 **범용 변경 기록표**다. `field` 에 허용 목록(CHECK)이 **없어** 새 종류를 그대로 받고,
--   테넌트 격리(RLS SELECT 정책)도 이미 걸려 있다. 2026-11-07 기준 제약은 PK 하나뿐이다.
--
-- ★ 칸을 더하지 않으므로 PostgREST 스키마 캐시 갱신은 **필요 없다**(함정 #22 는 칸 추가에만 해당).
--   트리거는 API 에 드러나지 않는다.
--
-- ★ 배포 순서 — 이 파일은 **권한을 좁히지 않고 넓히지도 않는다**(기록만 더한다).
--   그래서 화면 코드보다 **먼저** 적용해도 안전하다. 먼저 적용하면
--   화면이 배포되기 전의 수기 변경까지 기록에 남는다.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 보관방법 변경 기록 — **새 함수**. 기존 기록 함수는 그대로 둔다.
--    ★ SECURITY DEFINER 인 이유: drug_usage_audit 에는 SELECT 정책만 있고 INSERT 정책이 없다.
--      표 주인(postgres)으로 적어야 기록이 들어간다. 0105·0112·0115 와 같은 틀이다.
--    ★ old_source/new_source 는 **비운다.** 그 두 칸은 usage_source(사용량 출처)용이고
--      보관방법과는 상관이 없다. 상관없는 값을 적으면 감사표가 거짓말을 하게 된다.
--    ★ 값은 **보관방법 글자 그대로** 적는다('실온' → '실온/차광').
--      「차광 참/거짓」으로 줄여 적으면 냉장↔실온 변경이 사라져 기록이 반쪽이 된다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.log_drugs_storage_method()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.storage_method is distinct from old.storage_method then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.drug_code, 'storage_method',
            old.storage_method, new.storage_method, auth.uid());
  end if;
  return new;
end $function$;

comment on function public.log_drugs_storage_method() is
  '보관방법(storage_method)이 바뀌면 drug_usage_audit 에 누가·언제를 남긴다. 값은 글자 그대로. 0117.';

-- ★ 새 트리거. 기존 트리거는 건드리지 않는다.
--   AFTER UPDATE OF storage_method 이므로 **그 칸이 바뀔 때만** 깨어난다(다른 저장에는 영향 없음).
--   trg_log_drugs_location(0104) 과 같은 모양이다.
drop trigger if exists trg_log_drugs_storage_method on public.drugs;
create trigger trg_log_drugs_storage_method
  after update of storage_method on public.drugs
  for each row execute function public.log_drugs_storage_method();

commit;

-- 롤백(참고):
-- drop trigger if exists trg_log_drugs_storage_method on public.drugs;
-- drop function if exists public.log_drugs_storage_method();
