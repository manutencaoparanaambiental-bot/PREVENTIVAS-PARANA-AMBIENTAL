-- =========================================================
-- Frota — Lubrificação & Calibragem
-- Rode este script inteiro em: Supabase → SQL Editor → New query
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- Tabelas ----------

create table if not exists caminhoes (
  id uuid primary key default gen_random_uuid(),
  placa text not null unique,
  reboque text,                          -- null = sem julieta (truck)
  tipo text not null check (tipo in ('truck','conjunto')),
  created_at timestamptz not null default now()
);

create table if not exists colunas (
  id uuid primary key default gen_random_uuid(),
  pagina text not null check (pagina in ('lubrificacao','calibragem')),
  posicao int not null,                  -- ordem de exibição (1,2,3,4...)
  rotulo text not null,                  -- texto exibido, editável pelo usuário
  unique (pagina, posicao)
);

create table if not exists posicoes (
  id uuid primary key default gen_random_uuid(),
  caminhao_id uuid not null references caminhoes(id) on delete cascade,
  pagina text not null check (pagina in ('lubrificacao','calibragem')),
  coluna_id uuid not null references colunas(id) on delete cascade,
  ordem bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (caminhao_id, pagina)           -- cada placa fica em 1 coluna por página
);

-- ---------- Segurança (RLS) ----------
-- Qualquer usuário autenticado (login feito no app) pode ler e editar.
-- Isso é suficiente para uso interno por uma equipe pequena.

alter table caminhoes enable row level security;
alter table colunas   enable row level security;
alter table posicoes  enable row level security;

drop policy if exists "select_caminhoes" on caminhoes;
create policy "select_caminhoes" on caminhoes for select using (auth.role() = 'authenticated');
drop policy if exists "write_caminhoes" on caminhoes;
create policy "write_caminhoes" on caminhoes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "select_colunas" on colunas;
create policy "select_colunas" on colunas for select using (auth.role() = 'authenticated');
drop policy if exists "write_colunas" on colunas;
create policy "write_colunas" on colunas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "select_posicoes" on posicoes;
create policy "select_posicoes" on posicoes for select using (auth.role() = 'authenticated');
drop policy if exists "write_posicoes" on posicoes;
create policy "write_posicoes" on posicoes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Habilita realtime (multi-usuário vendo a movimentação em tempo real)
-- Feito de forma segura: só adiciona a tabela se ela ainda não estiver na publicação.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posicoes'
  ) then
    alter publication supabase_realtime add table posicoes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'colunas'
  ) then
    alter publication supabase_realtime add table colunas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'caminhoes'
  ) then
    alter publication supabase_realtime add table caminhoes;
  end if;
end $$;

-- ---------- Colunas das duas páginas ----------
-- Lubrificação: 4 sábados do mês. Troque o rótulo pela data real quando quiser
-- (também dá pra editar direto na tela, clicando no título da coluna).

insert into colunas (pagina, posicao, rotulo) values
  ('lubrificacao', 1, 'Sábado 1'),
  ('lubrificacao', 2, 'Sábado 2'),
  ('lubrificacao', 3, 'Sábado 3'),
  ('lubrificacao', 4, 'Sábado 4'),
  ('calibragem',   1, 'Sábado 1'),
  ('calibragem',   2, 'Sábado 2')
on conflict (pagina, posicao) do nothing;

-- ---------- Frota (placas + reboque) ----------
-- reboque = null/"XXX" na planilha original => truck simples
-- reboque com placa preenchida => conjunto (truck + julieta)

insert into caminhoes (placa, reboque, tipo) values
 ('SEN8H08', 'RHR5J08', 'conjunto'),
 ('MIV9C67', null,      'truck'),
 ('FRD1H66', 'SEG8I38', 'conjunto'),
 ('FFW1E31', 'AVW3F30', 'conjunto'),
 ('AXQ6D90', null,      'truck'),
 ('AXI5E58', 'AXS4H27', 'conjunto'),
 ('AUT6C69', null,      'truck'),
 ('FFA6I06', 'BDZ8H28', 'conjunto'),
 ('QCO4C81', 'RHV5H82', 'conjunto'),
 ('FIM5A40', null,      'truck'),
 ('SES-9I28','SDY0F14', 'conjunto'),
 ('FYA-2D72',null,      'truck'),
 ('AVW5F73', 'MBM0H03', 'conjunto'),
 ('RHK1A48', 'MEU3B02', 'conjunto'),
 ('OPB6D07', null,      'truck'),
 ('OUM3B88', null,      'truck'),
 ('TBA-3B08','AXS4H28', 'conjunto'),
 ('AXF2C64', null,      'truck'),
 ('TAY-8B13','MAL4349', 'conjunto'),
 ('FFN6I77', null,      'truck'),
 ('RIE6G74', 'PLT4H72', 'conjunto'),
 ('GJG-2H57','RHV5H83', 'conjunto'),
 ('UBN7J93', null,      'truck'),   -- reboque não informado na planilha original
 ('AVW3F29', 'BAM2B62', 'conjunto'),
 ('FCO3A20', null,      'truck'),
 ('AXN1C48', 'AXF1433', 'conjunto'),
 ('EDI7F40', 'BDZ8H29', 'conjunto'),
 ('FVW4F76', 'SEG8I37', 'conjunto'),
 ('LRE5489', null,      'truck'),
 ('GJB-3A55','RHR5J07', 'conjunto'),
 ('BBQ5G95', null,      'truck')    -- reboque não informado na planilha original
on conflict (placa) do nothing;

-- ---------- Distribuição inicial (só na Lubrificação) ----------
-- 31 caminhões divididos o mais igual possível entre truck/conjunto
-- nas 4 colunas: 9 / 8 / 7 / 7 placas, cada uma misturando os dois tipos.
-- É só um ponto de partida — mova à vontade pelo app depois.
-- A Calibragem começa vazia (fica tudo em "Não escalado") até vocês
-- definirem o critério das duas colunas.

insert into posicoes (caminhao_id, pagina, coluna_id, ordem)
select c.id, 'lubrificacao', col.id, x.ordem
from (values
  ('SEN8H08', 1, 1), ('FFA6I06', 1, 2), ('RHK1A48', 1, 3), ('GJG-2H57', 1, 4),
  ('FVW4F76', 1, 5), ('MIV9C67', 1, 6), ('FYA-2D72', 1, 7), ('FFN6I77', 1, 8),
  ('BBQ5G95', 1, 9),
  ('FRD1H66', 2, 1), ('QCO4C81', 2, 2), ('TBA-3B08', 2, 3), ('AVW3F29', 2, 4),
  ('GJB-3A55', 2, 5), ('AXQ6D90', 2, 6), ('OPB6D07', 2, 7), ('UBN7J93', 2, 8),
  ('FFW1E31', 3, 1), ('SES-9I28', 3, 2), ('TAY-8B13', 3, 3), ('AXN1C48', 3, 4),
  ('AUT6C69', 3, 5), ('OUM3B88', 3, 6), ('FCO3A20', 3, 7),
  ('AXI5E58', 4, 1), ('AVW5F73', 4, 2), ('RIE6G74', 4, 3), ('EDI7F40', 4, 4),
  ('FIM5A40', 4, 5), ('AXF2C64', 4, 6), ('LRE5489', 4, 7)
) as x(placa, coluna_posicao, ordem)
join caminhoes c on c.placa = x.placa
join colunas col on col.pagina = 'lubrificacao' and col.posicao = x.coluna_posicao
on conflict (caminhao_id, pagina) do nothing;

-- =========================================================
-- Migração incremental — Data e Responsável por coluna
-- Adiciona 2 colunas nullable em "colunas". Não apaga nada,
-- não altera dados existentes, seguro para rodar novamente.
-- =========================================================

alter table colunas add column if not exists data_lubrificacao date;
alter table colunas add column if not exists responsavel text;

-- =========================================================
-- Migração incremental — Acesso visitante (somente leitura)
-- Mantém a leitura liberada para qualquer usuário autenticado
-- (inclusive visitante anônimo), mas passa a bloquear
-- inserir/alterar/excluir para sessões anônimas. Não apaga
-- nada, seguro rodar de novo.
-- =========================================================

drop policy if exists "write_caminhoes" on caminhoes;
create policy "write_caminhoes" on caminhoes for all
  using (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);

drop policy if exists "write_colunas" on colunas;
create policy "write_colunas" on colunas for all
  using (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);

drop policy if exists "write_posicoes" on posicoes;
create policy "write_posicoes" on posicoes for all
  using (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (auth.role() = 'authenticated' and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);
