-- =====================================================================
-- ArenaIntinerante — 0002_rls.sql
-- Permissões (GRANT por coluna) e políticas RLS.
-- Pré-requisito: 0001_esquema.sql executada. Executar UMA vez.
-- Tudo numa transação: ou aplica tudo, ou nada.
--
-- DECISÕES (modelo híbrido, opção A)
--   * O participante conclui o PRÓPRIO check-in: só a coluna "status",
--     só de 'na_fila' para 'concluido'. Isto substitui a nota do
--     cabeçalho da 0001 ("checkins: nenhuma coluna"); concluir_checkin
--     deixa de ser necessária.
--   * Sem tempo mínimo e sem limite de atividades simultâneas na fila.
--   * A equipe NÃO lê dados pessoais diretamente: o painel receberá só
--     estatísticas agregadas via public.resumo_painel() (etapa S3).
--   * Avaliação: o participante altera somente nota e comentario.
--   * privado.eh_equipe() é SECURITY INVOKER.
--
-- PERMISSÕES ESPERADAS POR OPERAÇÃO (a confirmar nos testes reais)
--   * INSERT: GRANT de INSERT nas colunas enviadas + WITH CHECK.
--   * UPDATE: GRANT de UPDATE nas colunas do SET + SELECT nas colunas lidas
--     no WHERE + USING (linha atual) + WITH CHECK (linha nova).
--   * UPSERT (INSERT ... ON CONFLICT):
--       - DO NOTHING: INSERT + SELECT nas colunas do conflito + WITH CHECK.
--       - DO UPDATE: além disso, UPDATE nas colunas do SET e políticas
--         de UPDATE e SELECT na linha existente.
--   * RETURNING (ex.: "return=representation" da API): exige SELECT e a
--     política de SELECT sobre a linha devolvida.
--   * Upsert de feedbacks pela API com conflito em checkin_id faria
--     SET checkin_id e DEVE falhar (sem GRANT): usar salvar_feedback() (S3)
--     ou "atualizar e, se não houver linha, inserir" (S7).
--   * Upsert de participantes NÃO deve enviar "id" no SET (sem GRANT).
--
-- DEPENDÊNCIAS DA S3
--   * public.resumo_painel(): SECURITY DEFINER, dona postgres, schema
--     public, set search_path = ''. PRIMEIRA instrução:
--     se not privado.eh_equipe() -> raise 42501. Retorna só agregados.
--     revoke all ... from public, anon; grant execute ... to authenticated.
--     (O Supabase concede EXECUTE automático em funções novas do public.)
--   * public.salvar_feedback(): SECURITY INVOKER; INSERT ...
--     ON CONFLICT (checkin_id) DO UPDATE SET nota, comentario.
--   * Toda função nova em privado: REVOKE EXECUTE explícito (ver 0001).
--   * Toda tabela nova em public: enable row level security + revoke.
--   * Futuro: confirmação pela equipe em colunas próprias
--     (confirmado_por / confirmado_em), separada da autodeclaração.
--
-- TESTES PENDENTES (em begin ... rollback, de preferência em projeto
-- Supabase de teste; usuários A e B anônimos, P permanente sem cadastro,
-- E permanente da equipe, X anônimo cadastrado por engano na equipe)
--   T1  anon: SELECT nas 4 tabelas -> permissão negada.
--   T2  A cria o próprio cadastro -> ok; com id de B -> negado (RLS).
--   T3  A lê participantes -> só a própria linha.
--   T4  A altera apelido -> ok; id ou criado_em -> permissão negada.
--   T5  A cria check-in -> ok; participante_id de B -> negado (RLS);
--       informando status -> permissão negada (coluna).
--   T6  A repete o mesmo check-in -> 23505 (ou ignorado no upsert).
--   T7  A conclui o próprio check-in -> ok e concluido_em preenchido.
--   T7b concluir de novo -> 0 linhas afetadas.
--   T7c status 'na_fila' num check-in em fila -> negado (WITH CHECK).
--   T7d A tenta concluir check-in de B -> 0 linhas afetadas.
--   T8  A avalia check-in na fila -> erro do trigger; concluído -> ok;
--       check-in de B -> erro do trigger (sem revelar o check-in).
--   T9  A altera nota/comentario -> ok; checkin_id -> permissão negada.
--   T9b upsert de feedback com SET checkin_id -> permissão negada.
--   T10 A executa DELETE em qualquer tabela -> permissão negada.
--   T11 B não vê nenhuma linha de A.
--   T12 A lê membros_equipe -> vazio; INSERT -> permissão negada.
--   T13 E lê membros_equipe -> só a própria linha.
--   T14 E lê participantes/checkins/feedbacks -> 0 linhas (só agregados na S3).
--   T15 eh_equipe() simulada como postgres: A, P, X e sessão sem login
--       -> false; E -> true; E removido da equipe -> false.
--   T16 authenticated: select privado.eh_equipe() e
--       select privado.proteger_checkin() -> permissão negada.
--   T17 os INSERT/UPDATE acima disparam os triggers da 0001.
--   T18 RETURNING após INSERT/UPDATE devolve só linhas próprias.
--   T19 conferência como postgres: pg_policies (10 políticas);
--       information_schema.column_privileges sem linhas para anon;
--       pg_proc: eh_equipe com prosecdef = false e dona postgres;
--       pg_class: membros_equipe com relforcerowsecurity = false.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- O usuário logado é membro da equipe?
-- * SECURITY INVOKER: sem privilégio extra. Chamada de dentro de uma
--   função SECURITY DEFINER (dona: postgres, dona de membros_equipe),
--   lê a tabela sem RLS. Chamada direta por um usuário, lê só a própria
--   linha (política abaixo) — exatamente a que precisa.
-- * Exige login PERMANENTE: anônimo nunca é equipe.
-- * PROIBIDO usar esta função em políticas de membros_equipe (recursão)
--   e ativar FORCE ROW LEVEL SECURITY em membros_equipe.
-- * EXECUTE revogado: no PostgreSQL toda função nova nasce com EXECUTE
--   para PUBLIC (ver 0001). Se uma política futura precisar chamá-la,
--   conceder USAGE no schema privado e EXECUTE nesta função.
-- ---------------------------------------------------------------------
create function privado.eh_equipe()
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

revoke all on function privado.eh_equipe() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- GRANTs mínimos (somente "authenticated"; "anon" não recebe nada).
-- Datas, ids gerados e campos controlados pelo servidor ficam de fora.
-- ---------------------------------------------------------------------

-- participantes
grant select                              on public.participantes to authenticated;
grant insert (id, apelido, cidade, idade) on public.participantes to authenticated;
grant update (apelido, cidade, idade)     on public.participantes to authenticated;

-- checkins
grant select                                      on public.checkins to authenticated;
grant insert (participante_id, arena_id, estacao) on public.checkins to authenticated;
grant update (status)                             on public.checkins to authenticated;

-- feedbacks
grant select                                                 on public.feedbacks to authenticated;
grant insert (checkin_id, participante_id, nota, comentario) on public.feedbacks to authenticated;
grant update (nota, comentario)                              on public.feedbacks to authenticated;

-- membros_equipe (a política limita à própria linha)
grant select on public.membros_equipe to authenticated;

-- ---------------------------------------------------------------------
-- participantes
-- ---------------------------------------------------------------------
create policy "participante lê o próprio cadastro"
  on public.participantes for select to authenticated
  using (id = (select auth.uid()));

create policy "participante cria o próprio cadastro"
  on public.participantes for insert to authenticated
  with check (id = (select auth.uid()));

create policy "participante atualiza o próprio cadastro"
  on public.participantes for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- checkins
-- ---------------------------------------------------------------------
create policy "participante lê os próprios check-ins"
  on public.checkins for select to authenticated
  using (participante_id = (select auth.uid()));

create policy "participante cria check-in para si"
  on public.checkins for insert to authenticated
  with check (participante_id = (select auth.uid()));

-- Único UPDATE possível: o próprio check-in, de 'na_fila' para 'concluido'.
-- (O trigger privado.proteger_checkin repete a regra e define concluido_em.)
create policy "participante conclui o próprio check-in"
  on public.checkins for update to authenticated
  using      (participante_id = (select auth.uid()) and status = 'na_fila')
  with check (participante_id = (select auth.uid()) and status = 'concluido');

-- ---------------------------------------------------------------------
-- feedbacks
-- (O SELECT de checkins acima atende a privado.proteger_feedback, que
--  lê public.checkins com as permissões de quem avalia.)
-- ---------------------------------------------------------------------
create policy "participante lê as próprias avaliações"
  on public.feedbacks for select to authenticated
  using (participante_id = (select auth.uid()));

create policy "participante cria avaliação para si"
  on public.feedbacks for insert to authenticated
  with check (participante_id = (select auth.uid()));

create policy "participante edita a própria avaliação"
  on public.feedbacks for update to authenticated
  using      (participante_id = (select auth.uid()))
  with check (participante_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- membros_equipe: só a própria linha. NÃO usa eh_equipe() (sem recursão).
-- Sem INSERT/UPDATE/DELETE: cadastro apenas pelo painel do Supabase.
-- ---------------------------------------------------------------------
create policy "usuário vê se ele mesmo é da equipe"
  on public.membros_equipe for select to authenticated
  using (user_id = (select auth.uid()));

commit;
