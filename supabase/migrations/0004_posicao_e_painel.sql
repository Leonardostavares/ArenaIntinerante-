-- =====================================================================
-- ArenaIntinerante — 0004_posicao_e_painel.sql
-- Funções da etapa S3 (indicadores do painel) + posição na fila do
-- participante + fila pública (monitor). Pré-requisito: 0001-0003
-- executadas. Executar UMA vez. Tudo numa transação.
--
-- DECISÕES
--   * Segue a decisão já registrada na 0002: a equipe NÃO lê dados
--     pessoais diretamente, só agregados (contagens). As únicas exceções
--     são o PRÓPRIO apelido do participante (posicao_na_fila, já é dono)
--     e o apelido em fila_publica (monitor), que é dado que o próprio
--     participante aceita exibir publicamente ao entrar na fila.
--   * Todas as funções novas: SECURITY DEFINER, dona postgres, schema
--     public, set search_path = '' (nenhum schema implícito). Toda
--     referência a tabela é escrita como public.<tabela>.
--   * Funções de indicadores (prefixo resumo_/contar_): primeira
--     instrução sempre "se not privado.eh_equipe() -> raise 42501".
--   * revoke all ... from public, anon; grant execute ... to authenticated
--     em cada função nova (o Postgres concede EXECUTE a PUBLIC por padrão).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- posicao_na_fila: posição (1-based) do check-in na fila da própria
-- atividade (arena + estação), contando só quem está 'na_fila' e chegou
-- antes. SECURITY DEFINER só para poder contar OUTROS check-ins da
-- mesma atividade (RLS normal só deixaria ver os próprios); por isso
-- confere a posse do check-in antes de contar qualquer coisa.
-- ---------------------------------------------------------------------
create function public.posicao_na_fila(p_checkin_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono     uuid;
  v_arena    text;
  v_estacao  text;
  v_status   text;
  v_criado   timestamptz;
  v_posicao  integer;
begin
  select participante_id, arena_id, estacao, status, criado_em
    into v_dono, v_arena, v_estacao, v_status, v_criado
  from public.checkins
  where id = p_checkin_id;

  if v_dono is null then
    raise exception 'Check-in não encontrado.' using errcode = '42704';
  end if;

  if v_dono is distinct from auth.uid() then
    raise exception 'Operação não permitida para esta sessão.' using errcode = '42501';
  end if;

  if v_status <> 'na_fila' then
    return 0; -- já concluído: não há posição.
  end if;

  select count(*) + 1
    into v_posicao
  from public.checkins c
  where c.arena_id = v_arena
    and c.estacao  = v_estacao
    and c.status   = 'na_fila'
    and c.criado_em < v_criado;

  return v_posicao;
end;
$$;

revoke all on function public.posicao_na_fila(uuid) from public, anon;
grant execute on function public.posicao_na_fila(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- fila_publica: lista pública (monitor/TV) da fila de uma atividade.
-- Devolve só apelido + posição, nunca id do participante, idade ou
-- cidade. Exige sessão autenticada (participante ou equipe), mas não
-- exige ser dono de nada: é a mesma informação que apareceria num
-- painel físico de senhas no local do evento.
-- ---------------------------------------------------------------------
create function public.fila_publica(p_arena_id text, p_estacao text)
returns table (apelido text, posicao integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p.apelido, 'Participante'),
    row_number() over (order by c.criado_em)::integer
  from public.checkins c
  join public.participantes p on p.id = c.participante_id
  where c.arena_id = p_arena_id
    and c.estacao  = p_estacao
    and c.status   = 'na_fila'
  order by c.criado_em
  limit 20;
$$;

revoke all on function public.fila_publica(text, text) from public, anon;
grant execute on function public.fila_publica(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- resumo_geral: totais do evento inteiro. Equipe apenas.
-- ---------------------------------------------------------------------
create function public.resumo_geral()
returns table (
  total_participantes  bigint,
  total_checkins       bigint,
  checkins_na_fila     bigint,
  checkins_concluidos  bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not privado.eh_equipe() then
    raise exception 'Operação não permitida para esta sessão.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.participantes)::bigint,
    (select count(*) from public.checkins)::bigint,
    (select count(*) from public.checkins where status = 'na_fila')::bigint,
    (select count(*) from public.checkins where status = 'concluido')::bigint;
end;
$$;

revoke all on function public.resumo_geral() from public, anon, authenticated;
grant execute on function public.resumo_geral() to authenticated;

-- ---------------------------------------------------------------------
-- resumo_por_atividade: totais por arena + estação. Equipe apenas.
-- ---------------------------------------------------------------------
create function public.resumo_por_atividade()
returns table (
  arena_id             text,
  estacao              text,
  total_checkins       bigint,
  participantes_unicos bigint,
  concluidos           bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not privado.eh_equipe() then
    raise exception 'Operação não permitida para esta sessão.' using errcode = '42501';
  end if;

  return query
  select
    c.arena_id,
    c.estacao,
    count(*)::bigint,
    count(distinct c.participante_id)::bigint,
    count(*) filter (where c.status = 'concluido')::bigint
  from public.checkins c
  group by c.arena_id, c.estacao
  order by c.arena_id, c.estacao;
end;
$$;

revoke all on function public.resumo_por_atividade() from public, anon, authenticated;
grant execute on function public.resumo_por_atividade() to authenticated;

-- ---------------------------------------------------------------------
-- resumo_faixa_etaria: distribuição de idade dos participantes com ao
-- menos um check-in (participante só cadastrado, sem atividade, não
-- entra na contagem do evento). Equipe apenas.
-- ---------------------------------------------------------------------
create function public.resumo_faixa_etaria()
returns table (faixa text, total bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not privado.eh_equipe() then
    raise exception 'Operação não permitida para esta sessão.' using errcode = '42501';
  end if;

  return query
  select
    case
      when p.idade is null        then 'Não informado'
      when p.idade <= 14          then 'Até 14'
      when p.idade between 15 and 20 then '15-20'
      when p.idade between 21 and 25 then '21-25'
      when p.idade between 26 and 30 then '26-30'
      when p.idade between 31 and 40 then '31-40'
      else '41+'
    end as faixa,
    count(distinct p.id)::bigint as total
  from public.participantes p
  where exists (select 1 from public.checkins c where c.participante_id = p.id)
  group by 1;
end;
$$;

revoke all on function public.resumo_faixa_etaria() from public, anon, authenticated;
grant execute on function public.resumo_faixa_etaria() to authenticated;

commit;
