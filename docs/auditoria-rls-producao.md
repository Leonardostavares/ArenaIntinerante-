# Auditoria de permissões e RLS — Supabase de produção

| Item | Valor |
|---|---|
| Projeto | ArenaIntinerante (produção) |
| Project ID | `gdvshuohrfqyzeublxmz` |
| `system_identifier` do banco | `770375969810729904` |
| Data | 08/11/2026 |
| Tipo | Auditoria **somente leitura** do catálogo do PostgreSQL (consultas `SELECT`) |
| Execução | Manual, pelo SQL Editor do projeto, com o papel `postgres` |
| Referência do modelo | `supabase/migrations/0002_rls.sql` e `supabase/migrations/0003_privilegios.sql` (commit `8799025`) |

> Esta auditoria **não substitui testes funcionais de segurança**. Ela confirma como as permissões e políticas estão **configuradas** no banco; não prova o **comportamento** real pela API (ver seção 5).

## 1. Contexto

No projeto de teste (ArenaIntinerante-Testes), os testes RLS encontraram permissões de **tabela inteira** em excesso para o papel `authenticated` (INSERT, UPDATE e DELETE em `participantes`, `checkins` e `feedbacks`). A correção foi a migração `0003_privilegios.sql`, aplicada **somente** no projeto de teste.

Como a produção recebeu as mesmas migrações `0001` e `0002`, esta auditoria verificou se o mesmo excesso existia nela.

## 2. Escopo

- **Tabelas:** `public.participantes`, `public.checkins`, `public.feedbacks`, `public.membros_equipe`.
- **Papéis avaliados:** `anon`, `authenticated` e `PUBLIC`.
- **Fora do escopo:** permissões de `postgres` e `service_role` (papéis administrativos), funções, permissões padrão para objetos futuros, configurações de autenticação.

**Modelo autorizado** (igual ao da 0003):

| Tabela | `authenticated` | `anon` |
|---|---|---|
| participantes | SELECT; INSERT (id, apelido, cidade, idade); UPDATE (apelido, cidade, idade) | nada |
| checkins | SELECT; INSERT (participante_id, arena_id, estacao); UPDATE (status) | nada |
| feedbacks | SELECT; INSERT (checkin_id, participante_id, nota, comentario); UPDATE (nota, comentario) | nada |
| membros_equipe | SELECT | nada |
| todas | sem DELETE, TRUNCATE, REFERENCES, TRIGGER ou MAINTAIN; nada com direito de repasse (GRANT OPTION) | — |

## 3. Resultados

| Consulta | O que verifica | Resultado |
|---|---|---|
| A | Identificação do banco e existência das tabelas | Banco identificado; `system_identifier` diferente do projeto de teste; 4 tabelas existentes |
| B | Permissões **efetivas** de tabela (incluem herança e `PUBLIC`) | **64/64 corretas** |
| C | Permissões **efetivas** por coluna | **40/40 corretas** |
| D | Concessões **diretas** (tabela e coluna), com quem concedeu e direito de repasse | **21/21 corretas** |
| E | RLS e políticas | RLS ativo nas 4 tabelas; **10 políticas** |
| F | Herança de papéis de `anon`/`authenticated` | Nenhuma associação direta encontrada |
| Análise das políticas | Definições das políticas RLS × modelo esperado | **10/10 compatíveis** |
| Esquema das tabelas | Colunas existentes × `0001_esquema.sql` (nome e tipo) | **23/23 colunas corretas**; nenhuma adicional, ausente ou com tipo diferente |

**Classificação:**

| Situação | Quantidade |
|---|---|
| CORRETO | todas as verificações |
| EXCEDENTE | 0 |
| AUSENTE | 0 |

### Conclusão

**Nenhuma divergência foi identificada nas verificações realizadas.** As permissões de `anon` e `authenticated` na produção correspondem ao modelo autorizado. **Não há indicação atual de necessidade de executar a migração `0003_privilegios.sql` na produção.**

Observação: a `0003` do repositório contém uma trava que aceita apenas o banco do projeto de teste; executada na produção, ela se recusaria a rodar sem alterar nada.

## 4. Limitações

1. **Execução manual:** as consultas foram executadas manualmente no SQL Editor e os resultados foram relatados; não houve reexecução independente nem registro automatizado das saídas.
2. **Retrato de um momento:** os resultados valem para 08/11/2026. Qualquer ação posterior no painel, nova migração ou nova tabela pode alterar as permissões.
3. **Somente catálogo:** a auditoria lê a configuração do banco (permissões, RLS, políticas). Ela não executa operações como os usuários reais, não passa pela API (PostgREST) e não exercita os triggers.
4. **Análise das políticas:** a compatibilidade das 10 políticas foi avaliada pela leitura das definições, não por testes com usuários diferentes.
5. **Escopo limitado às quatro tabelas** e aos papéis `anon`, `authenticated` e `PUBLIC`.
6. **Origem do excesso no projeto de teste não esclarecida:** a produção não apresentou o problema. A causa mais provável é uma concessão feita no projeto de teste depois das migrações, mas isso não foi confirmado.

## 5. Verificações pendentes

| # | Verificação | Motivo |
|---|---|---|
| 1 | ~~Esclarecer a contagem da consulta C~~ — **ENCERRADA** | A consulta C retornou **40** registros (não 41), todos corretos: SELECT nas 23 colunas + 17 permissões de INSERT/UPDATE por coluna. A verificação do esquema confirmou **23/23 colunas** iguais à `0001` (nome e tipo), sem colunas adicionais ou ausentes |
| 2 | Testes **funcionais** de segurança na produção | A auditoria não comprova o comportamento pela API. Testes que gravam dados não devem rodar na produção; uma alternativa segura seria apenas a verificação de leitura negada para quem não tem login (T1), com autorização e adaptação explícita do script, que hoje bloqueia a produção |
| 3 | Permissões das funções do esquema `privado` | `eh_equipe()` e as funções dos triggers não foram auditadas na produção (esperado: sem EXECUTE para `PUBLIC`, `anon` e `authenticated`) |
| 4 | Permissões padrão para objetos futuros (`pg_default_acl`) | Tabelas novas podem receber acesso automático de `anon`/`authenticated`; toda migração futura precisa de `enable row level security` e `revoke` |
| 5 | Configurações de autenticação | Login anônimo, CAPTCHA e limite de logins anônimos por IP (importante para o evento) |
| 6 | Reauditoria periódica | Repetir as consultas A–F após cada nova migração ou mudança no painel |

## 6. Recomendações

1. Não executar a `0003` na produção enquanto as verificações continuarem sem divergência.
2. Tratar as pendências 2 a 6 antes de considerar a segurança da produção totalmente verificada (a pendência 1 foi encerrada).
3. Incluir a conferência de permissões de `authenticated` no T19 dos testes SQL, para detectar excessos automaticamente no projeto de teste.
4. Manter a separação entre projeto de teste e produção: testes que gravam dados somente no projeto de teste.
