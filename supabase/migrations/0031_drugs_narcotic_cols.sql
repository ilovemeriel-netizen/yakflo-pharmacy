-- 0031: 향정마약 화면용 컬럼(약품_정본.csv 매칭) — 첨가제·총수량·포장
-- 가산(기존 컬럼 무변경). 신규 컬럼이라 기존 라이브 값 덮어쓰기 없음.
-- 롤백: alter table public.drugs drop column if exists additive, drop column if exists total_qty, drop column if exists packaging;

alter table public.drugs add column if not exists additive  text;
alter table public.drugs add column if not exists total_qty integer;
alter table public.drugs add column if not exists packaging text;

comment on column public.drugs.additive  is '첨가제 — 약품_정본.csv 매칭(향정마약 화면)';
comment on column public.drugs.total_qty is '총수량 — 약품_정본.csv 매칭(화면 라벨 "단위")';
comment on column public.drugs.packaging is '포장 — 약품_정본.csv 매칭(향정마약 화면)';