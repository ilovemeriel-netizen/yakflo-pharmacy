-- 0115_drug_caution_flags.sql
-- 목적: 약품에 **주의 표시 3종**(용량·모양·발음)을 켜고 끌 수 있게 칸을 더하고,
--       켜고 끈 기록을 **누가·언제**까지 감사표에 남긴다.
--
-- ★ 왜 — 원내의약품집 엑셀의 약품명 칸 배경색으로만 있던 주의 표시(73종)를
--   약플로가 가지고 있어야, 약품식별 라벨(85×45mm 컬러 인쇄)에서 바탕색을 고를 수 있다.
--   한 약에 주의가 여러 개일 수 있으므로 **참/거짓 칸 3개**로 둔다(2026-11-06 이정화 님 승인, 저장 구조 ⓐ).
--
-- ★ 범위 — **칸 3개 + 기록 트리거 1개만** 더한다.
--   · 기존 함수는 **한 글자도 바꾸지 않는다.** 특히 `log_drugs_usage()`(0112)·
--     `enforce_usage_edit_owner()`·`enforce_price_edit_role()` 는 건드리지 않는다.
--     → 주의 표시는 **자기 함수·자기 트리거**로 적는다. 사용량 기록과 섞지 않는다.
--   · 기존 트리거 배선도 다시 걸지 않는다. 새 트리거만 더한다.
--   · 기존 감사 줄(54줄)은 **그대로 둔다.** 소급해서 채우지 않는다.
--   · 73종 반영은 **이 파일에서 하지 않는다.** 미리보기·승인 뒤 별도 단계다.
--   · 금액·수량·마감값·계산식은 **무변경**. 이 파일은 `drugs` 의 값을 바꾸지 않는다.
--
-- ★ 왜 감사표를 새로 만들지 않나
--   `drug_usage_audit` 는 이름만 usage 일 뿐 실제로는
--   (drug_code, field, old_value, new_value, changed_at, changed_by) 형태의 **범용 변경 기록표**다.
--   `field` 에 걸린 허용 목록(CHECK)이 **없어** 새 종류를 그대로 받을 수 있고,
--   테넌트 격리(RLS SELECT 정책)도 이미 걸려 있다.
--   또 이 표를 읽는 화면이 아직 **하나도 없어** 새 종류가 들어가도 깨질 화면이 없다.
--   표를 새로 만들면 정책·권한·인덱스를 또 세워야 하므로 지금 규모(3칸)에는 과하다.
--
-- ★ 순서 주의 (CLAUDE.md 함정 #22)
--   칸을 더한 **뒤** 스키마 캐시를 갱신하고, API 에서 보이는 것을 확인한 **다음에** 화면 코드를 배포한다.
--   캐시가 낡은 동안에는 실재하는 칸에도 PGRST204 가 나고, 저장 폴백이 그 값을 조용히 버린다.
--   (권한 회수는 배포 **뒤**, 칸 추가는 배포 **앞** — 방향이 반대다.)

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 칸 3개 — 참/거짓, 기본 거짓, 빈값 불가 (is_high_alert 와 같은 모양)
--    ★ 기본값이 false 이므로 기존 1,133줄은 전부 「꺼짐」으로 채워진다. 값이 바뀌는 약은 없다.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.drugs add column if not exists caution_dose  boolean not null default false;
alter table public.drugs add column if not exists caution_shape boolean not null default false;
alter table public.drugs add column if not exists caution_sound boolean not null default false;

comment on column public.drugs.caution_dose  is
  '주의 표시 — 용량. 같은 이름에 함량만 다른 약(원내의약품집 2610 기준 14쌍 28종). 라벨 바탕 연파랑.';
comment on column public.drugs.caution_shape is
  '주의 표시 — 모양. 생김새가 비슷해 헷갈리는 약. 라벨 바탕 연빨강.';
comment on column public.drugs.caution_sound is
  '주의 표시 — 발음. 이름이 비슷해 헷갈리는 약. 라벨 바탕 노랑.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 켜고 끈 기록 — **새 함수**. 기존 기록 함수는 그대로 둔다.
--    ★ SECURITY DEFINER 인 이유: drug_usage_audit 에는 SELECT 정책만 있고 INSERT 정책이 없다.
--      표 주인(postgres)으로 적어야 기록이 들어간다. 0105·0112 와 같은 틀이다.
--    ★ old_source/new_source 는 **비운다.** 그 두 칸은 usage_source(사용량 출처)용이고
--      주의 표시와는 상관이 없다. 상관없는 값을 적으면 감사표가 거짓말을 하게 된다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.log_drugs_caution()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.caution_dose is distinct from old.caution_dose then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.drug_code, 'caution_dose',
            old.caution_dose::text, new.caution_dose::text, auth.uid());
  end if;
  if new.caution_shape is distinct from old.caution_shape then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.drug_code, 'caution_shape',
            old.caution_shape::text, new.caution_shape::text, auth.uid());
  end if;
  if new.caution_sound is distinct from old.caution_sound then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.drug_code, 'caution_sound',
            old.caution_sound::text, new.caution_sound::text, auth.uid());
  end if;
  return new;
end $function$;

comment on function public.log_drugs_caution() is
  '주의 표시 3칸(caution_dose/shape/sound)이 바뀌면 drug_usage_audit 에 누가·언제를 남긴다. 0115.';

-- ★ 새 트리거. 기존 트리거는 건드리지 않는다.
--   AFTER UPDATE OF <칸 3개> 이므로 **그 칸이 바뀔 때만** 깨어난다(다른 저장에는 영향 없음).
drop trigger if exists trg_log_drugs_caution on public.drugs;
create trigger trg_log_drugs_caution
  after update of caution_dose, caution_shape, caution_sound on public.drugs
  for each row execute function public.log_drugs_caution();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 스키마 캐시 갱신 — 칸을 더했으므로 **반드시** 한다 (함정 #22)
-- ─────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

commit;
