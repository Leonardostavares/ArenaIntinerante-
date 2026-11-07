-- =====================================================================
-- ArenaIntinerante — 0001_esquema.sql
-- Esquema inicial: participantes, checkins, feedbacks e membros_equipe.
-- Executar UMA vez. Tudo numa transação: ou cria tudo, ou nada.
-- Políticas RLS e permissões por coluna ficam na 0002_rls.sql.
--
-- PENDÊNCIAS REGISTRADAS PARA AS PRÓXIMAS ETAPAS
--
-- S2 (0002_rls.sql) — obrigações e testes:
--   1. Conceder ao participante SELECT nos PRÓPRIOS check-ins.
--      privado.proteger_feedback() roda como SECURITY INVOKER e lê
--      public.checkins; sem esse SELECT toda avaliação falha.
--   2. UPDATE por coluna: participantes (apelido, cidade, idade);
--      feedbacks (nota, comentario); checkins: nenhuma coluna
--      (conclusão via função concluir_checkin, etapa S3).
--   3. Nenhum DELETE para participantes.
--   4. Equipe identificada SOMENTE por public.membros_equipe;
--      usuário anônimo também tem o papel "authenticated".
--   5. Testes de permissão dos triggers (como "authenticated"):
--      a) INSERT/UPDATE nas tabelas DISPARA os triggers normalmente
--         (o EXECUTE não é verificado no disparo automático);
--      b) chamada direta, ex.: select privado.proteger_checkin();
--         deve falhar por falta de permissão;
--      c) check-in criado com status 'concluido' é recusado;
--      d) 'concluido' -> 'na_fila' é recusado;
--      e) avaliação de check-in 'na_fila' é recusada;
--      f) avaliação de check-in de outro participante é recusada;
--      g) com a chave pública (anon), SELECT em qualquer tabela é negado.
--
-- FUTURO (após S3) — relatórios e exclusão de dados:
--   * Criar tabela de RESUMO AGREGADO do evento (por arena/estação:
--     participantes únicos, check-ins, concluídas, média e distribuição
--     das notas), sem nenhum dado pessoal, gravada no fechamento do evento.
--   * Procedimento seguro de exclusão: gerar/exportar o resumo agregado
--     ANTES de qualquer limpeza. Como auth.users -> participantes usa
--     ON DELETE CASCADE, excluir um usuário apaga participante, check-ins
--     e avaliações. NÃO executar a limpeza de usuários anônimos sugerida
--     pela documentação do Supabase antes do resumo estar salvo.
--   * Excluir um usuário não encerra a sessão já aberta no aparelho;
--     o app deve tratar esse caso (etapa S5).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Esquema privado: funções internas, fora da API pública do Supabase.
-- ---------------------------------------------------------------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
-- Atenção: o PostgreSQL concede EXECUTE ao PUBLIC em toda função nova, e um
-- ALTER DEFAULT PRIVILEGES por esquema não consegue retirar esse padrão global.
-- Por isso, TODA função criada no esquema privado (aqui ou em migrações
-- futuras) precisa de um REVOKE EXECUTE explícito logo após ser criada,
-- na mesma transação. Nesta migração, ver o REVOKE no fim das funções.

-- ---------------------------------------------------------------------
-- participantes: um por usuário do Supabase Auth (login anônimo).
-- CASCADE (recomendação do Supabase): excluir o usuário apaga seus dados
-- pessoais e atividades (LGPD). Estatísticas do evento devem ser
-- preservadas em um resumo agregado ANTES de qualquer limpeza.
-- ---------------------------------------------------------------------
create table public.participantes (
  id            uuid primary key default auth.uid()
                references auth.users (id) on delete cascade,
  apelido       text
                constraint participantes_apelido_valido
                check (apelido is null
                       or (apelido = btrim(apelido) and char_length(apelido) between 1 and 20)),
  cidade        text
                constraint participantes_cidade_valida
                check (cidade is null
                       or (cidade = btrim(cidade) and char_length(cidade) between 1 and 40)),
  idade         smallint
                constraint participantes_idade_valida
                check (idade is null or idade between 0 and 120),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz
);

comment on table public.participantes is
  'Participante do evento. id = auth.users.id (login anônimo).';

-- ---------------------------------------------------------------------
-- checkins: participação em uma estação de uma arena.
-- ---------------------------------------------------------------------
create table public.checkins (
  id              uuid primary key default gen_random_uuid(),
  participante_id uuid not null default auth.uid()
                  references public.participantes (id) on delete cascade,
  arena_id        text not null
                  constraint checkins_arena_valida
                  check (char_length(arena_id) between 1 and 50),
  estacao         text not null
                  constraint checkins_estacao_valida
                  check (char_length(estacao) between 1 and 80),
  status          text not null default 'na_fila'
                  constraint checkins_status_valido
                  check (status in ('na_fila', 'concluido')),
  criado_em       timestamptz not null default now(),
  concluido_em    timestamptz,

  -- Um check-in por participante + arena + estação (igual ao SQLite).
  -- Também serve de índice para buscas por participante_id.
  constraint checkins_unico_por_atividade unique (participante_id, arena_id, estacao),
  -- Alvo da chave estrangeira composta de feedbacks.
  constraint checkins_id_participante_unico unique (id, participante_id),
  -- concluido_em preenchido se, e somente se, status = 'concluido'.
  constraint checkins_conclusao_coerente
    check ((status = 'concluido') = (concluido_em is not null))
);

-- Totais do painel por arena/estação.
create index checkins_arena_estacao_idx on public.checkins (arena_id, estacao);

-- ---------------------------------------------------------------------
-- feedbacks: no máximo uma avaliação por check-in, só do próprio dono.
-- ---------------------------------------------------------------------
create table public.feedbacks (
  id              uuid primary key default gen_random_uuid(),
  checkin_id      uuid not null,
  participante_id uuid not null default auth.uid(),
  nota            smallint not null
                  constraint feedbacks_nota_valida
                  check (nota between 1 and 5),
  comentario      text
                  constraint feedbacks_comentario_valido
                  check (comentario is null
                         or (comentario = btrim(comentario)
                             and char_length(comentario) between 1 and 300)),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz,

  constraint feedbacks_um_por_checkin unique (checkin_id),
  -- O banco garante que a avaliação é do MESMO participante do check-in.
  constraint feedbacks_checkin_do_participante
    foreign key (checkin_id, participante_id)
    references public.checkins (id, participante_id) on delete cascade
);

-- Usado pelas políticas RLS ("minhas avaliações").
create index feedbacks_participante_idx on public.feedbacks (participante_id);

-- ---------------------------------------------------------------------
-- membros_equipe: quem é da equipe. Preenchida só pelo painel do Supabase.
-- ---------------------------------------------------------------------
create table public.membros_equipe (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  papel     text not null default 'equipe'
            constraint membros_equipe_papel_valido
            check (papel in ('equipe', 'admin')),
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Triggers de integridade. Rodam com as permissões de quem chamou
-- (sem security definer), portanto sempre respeitam o RLS.
-- ---------------------------------------------------------------------

-- participantes: id imutável; datas sempre definidas pelo servidor.
create function privado.proteger_participante()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_em     := now();
    new.atualizado_em := null;
  else
    if new.id is distinct from old.id then
      raise exception 'O identificador do participante não pode ser alterado.'
        using errcode = 'P0001', hint = 'nao_permitido';
    end if;
    new.criado_em     := old.criado_em;
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

create trigger participantes_proteger
  before insert or update on public.participantes
  for each row execute function privado.proteger_participante();

-- checkins: sempre começa na fila; só pode ir de 'na_fila' para 'concluido';
-- concluido_em é definido pelo servidor; atividade e dono são imutáveis.
create function privado.proteger_checkin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'na_fila' then
      raise exception 'Todo check-in começa na fila.'
        using errcode = 'P0001', hint = 'validacao';
    end if;
    new.criado_em    := now();
    new.concluido_em := null;
    return new;
  end if;

  if new.participante_id is distinct from old.participante_id
     or new.arena_id     is distinct from old.arena_id
     or new.estacao      is distinct from old.estacao then
    raise exception 'A atividade do check-in não pode ser alterada.'
      using errcode = 'P0001', hint = 'nao_permitido';
  end if;

  if old.status = 'concluido' and new.status = 'na_fila' then
    raise exception 'Uma atividade concluída não pode voltar para a fila.'
      using errcode = 'P0001', hint = 'nao_permitido';
  end if;

  new.criado_em := old.criado_em;
  if old.status = 'na_fila' and new.status = 'concluido' then
    new.concluido_em := now();
  else
    new.concluido_em := old.concluido_em;
  end if;
  return new;
end;
$$;

create trigger checkins_proteger
  before insert or update on public.checkins
  for each row execute function privado.proteger_checkin();

-- feedbacks: só para check-in CONCLUÍDO do próprio participante;
-- check-in e dono imutáveis; datas definidas pelo servidor.
-- Atenção: depende de o participante poder LER os próprios check-ins (0002).
create function privado.proteger_feedback()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.checkins c
      where c.id = new.checkin_id
        and c.participante_id = new.participante_id
        and c.status = 'concluido'
    ) then
      raise exception 'Conclua a atividade antes de avaliá-la.'
        using errcode = 'P0001', hint = 'nao_permitido';
    end if;
    new.criado_em     := now();
    new.atualizado_em := null;
    return new;
  end if;

  if new.checkin_id is distinct from old.checkin_id
     or new.participante_id is distinct from old.participante_id then
    raise exception 'A atividade avaliada não pode ser alterada.'
      using errcode = 'P0001', hint = 'nao_permitido';
  end if;
  new.criado_em     := old.criado_em;
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger feedbacks_proteger
  before insert or update on public.feedbacks
  for each row execute function privado.proteger_feedback();

revoke all on all functions in schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Segurança: RLS ligado desde já e SEM políticas = ninguém acessa pela API.
-- A 0002_rls.sql cria as políticas e devolve só os acessos necessários.
-- ---------------------------------------------------------------------
alter table public.participantes  enable row level security;
alter table public.checkins       enable row level security;
alter table public.feedbacks      enable row level security;
alter table public.membros_equipe enable row level security;

revoke all on public.participantes, public.checkins,
              public.feedbacks, public.membros_equipe
  from anon, authenticated;

commit;
