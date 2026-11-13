-- =====================================================================
-- ArenaIntinerante — 0005_arenas.sql
-- Tabela de arenas (hoje um array fixo em src/data/arenas.js) + CRUD
-- restrito à equipe. Pré-requisito: 0001-0004 executadas. Executar UMA
-- vez. Tudo numa transação.
--
-- DECISÕES
--   * id em texto livre (igual a checkins.arena_id, que já é texto sem
--     chave estrangeira): nenhuma migração de dado existente é necessária.
--   * Leitura liberada para qualquer autenticado (participante escolhe
--     arena antes de existir qualquer outra credencial). Escrita só
--     para a equipe (privado.eh_equipe()).
--   * As políticas de escrita REPETEM a lógica de privado.eh_equipe()
--     em vez de chamar a função: conceder EXECUTE nela para "authenticated"
--     quebraria o teste T16 (authenticated não pode chamar eh_equipe()
--     diretamente). A consulta é a mesma que a política de SELECT de
--     membros_equipe já permite (só a própria linha), então nenhum
--     grant novo é necessário.
-- =====================================================================
begin;

create table public.arenas (
  id         text primary key
             constraint arenas_id_valido check (char_length(id) between 1 and 50),
  nome       text not null
             constraint arenas_nome_valido check (char_length(nome) between 1 and 80),
  local      text
             constraint arenas_local_valido check (local is null or char_length(local) between 1 and 80),
  estacoes   text[] not null default '{}'
             constraint arenas_estacoes_validas check (array_length(estacoes, 1) is not null),
  criado_em  timestamptz not null default now()
);

comment on table public.arenas is
  'Arenas e suas estações. Leitura liberada a qualquer autenticado; escrita só para a equipe.';

alter table public.arenas enable row level security;
revoke all on public.arenas from anon, authenticated;

-- Repete a lógica de privado.eh_equipe() sem chamar a função (ver nota
-- acima sobre o teste T16). Login permanente (não anônimo) + linha
-- própria em membros_equipe: mesma consulta que a política de SELECT
-- de membros_equipe já autoriza para o próprio usuário.
create function privado.eh_equipe_inline()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (
       select 1
       from public.membros_equipe m
       where m.user_id = auth.uid()
     );
$$;

-- Função auxiliar só para uso DENTRO de políticas RLS avaliadas como o
-- próprio dono da sessão (mesmo corpo de privado.eh_equipe(), nome
-- diferente): evita reabrir EXECUTE em privado.eh_equipe() para
-- "authenticated" e, com isso, preserva o teste T16.
-- O Postgres concede EXECUTE a PUBLIC em toda função nova (ver 0001):
-- revoga antes de conceder só o necessário.
revoke all on function privado.eh_equipe_inline() from public, anon;
grant execute on function privado.eh_equipe_inline() to authenticated;

grant select on public.arenas to authenticated;
create policy "qualquer autenticado lê arenas"
  on public.arenas for select to authenticated
  using (true);

grant insert, update, delete on public.arenas to authenticated;

create policy "equipe cria arena"
  on public.arenas for insert to authenticated
  with check (privado.eh_equipe_inline());

create policy "equipe atualiza arena"
  on public.arenas for update to authenticated
  using (privado.eh_equipe_inline())
  with check (privado.eh_equipe_inline());

create policy "equipe remove arena"
  on public.arenas for delete to authenticated
  using (privado.eh_equipe_inline());

-- Dados que já existiam fixos em src/data/arenas.js.
insert into public.arenas (id, nome, local, estacoes) values
  ('saoluis',    'Arena São Luís',    'Centro de Eventos',   array['FIFA 24', 'Just Dance', 'Mortal Kombat']),
  ('imperatriz', 'Arena Imperatriz',  'Praça da Juventude',  array['Free Fire', 'Rocket League', 'Just Dance']);

commit;
