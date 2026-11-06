import * as SQLite from 'expo-sqlite';

/**
 * Banco de dados local do ArenaIntinerante.
 *
 * Guarda participantes, check-ins e feedbacks no próprio aparelho.
 * Na fase 2 (Supabase), as mesmas tabelas serão espelhadas no servidor.
 */

const NOME_BANCO = 'arena.db';

/**
 * Versão do esquema (estrutura das tabelas).
 * Se no futuro alguma tabela mudar, aumente este número e adicione
 * uma migração em `migrar()` — sem apagar os dados existentes.
 */
const VERSAO_ESQUEMA = 1;

export type StatusCheckin = 'na_fila' | 'concluido';

/**
 * Promessa compartilhada da conexão.
 * Todas as chamadas a `obterBanco()` recebem a MESMA promessa, então o banco
 * é aberto e inicializado uma única vez, mesmo que várias telas peçam ao mesmo tempo.
 */
let conexao: Promise<SQLite.SQLiteDatabase> | null = null;

export function obterBanco(): Promise<SQLite.SQLiteDatabase> {
  if (!conexao) {
    conexao = abrirEInicializar().catch((erro) => {
      // Se falhar, limpa a promessa para que a próxima chamada tente de novo.
      conexao = null;
      throw erro;
    });
  }
  return conexao;
}

async function abrirEInicializar(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(NOME_BANCO);

  // WAL melhora leitura/escrita simultâneas; foreign_keys vale por conexão
  // e vem desligado por padrão no SQLite, por isso é ligado aqui.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  await migrar(db);
  return db;
}

async function migrar(db: SQLite.SQLiteDatabase): Promise<void> {
  const resultado = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const versaoAtual = resultado?.user_version ?? 0;

  if (versaoAtual >= VERSAO_ESQUEMA) return;

  // Tudo dentro de uma transação: ou cria tudo, ou nada.
  // CREATE TABLE IF NOT EXISTS nunca apaga dados de tabelas já existentes.
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS participantes (
        id            TEXT PRIMARY KEY NOT NULL,
        apelido       TEXT,
        cidade        TEXT,
        idade         INTEGER CHECK (idade IS NULL OR idade BETWEEN 0 AND 120),
        criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        atualizado_em TEXT
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id              TEXT PRIMARY KEY NOT NULL,
        participante_id TEXT NOT NULL
                        REFERENCES participantes (id) ON DELETE CASCADE,
        arena_id        TEXT NOT NULL,
        estacao         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'na_fila'
                        CHECK (status IN ('na_fila', 'concluido')),
        criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        concluido_em    TEXT,
        UNIQUE (participante_id, arena_id, estacao)
      );

      CREATE INDEX IF NOT EXISTS idx_checkins_arena_estacao
        ON checkins (arena_id, estacao);

      CREATE TABLE IF NOT EXISTS feedbacks (
        id              TEXT PRIMARY KEY NOT NULL,
        checkin_id      TEXT NOT NULL UNIQUE
                        REFERENCES checkins (id) ON DELETE CASCADE,
        participante_id TEXT NOT NULL
                        REFERENCES participantes (id) ON DELETE CASCADE,
        nota            INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
        comentario      TEXT CHECK (comentario IS NULL OR length(comentario) <= 300),
        criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        atualizado_em   TEXT
      );

      PRAGMA user_version = ${VERSAO_ESQUEMA};
    `);
  });
}
