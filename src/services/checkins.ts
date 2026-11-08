import * as Crypto from 'expo-crypto';
import type { SQLiteBindValue } from 'expo-sqlite';
import { usarSupabase } from '../lib/ambiente';
import { obterBanco, StatusCheckin } from './db';
import { ErroCheckin } from './erros';
import { obterOuCriarParticipanteId } from './participante';

/**
 * Check-ins do participante nas atividades (arena + estação).
 *
 * Regras:
 * - Um participante tem no máximo um check-in por arena + estação (UNIQUE no banco).
 * - Todo check-in começa como 'na_fila'.
 * - Só vira 'concluido' quando concluirCheckin() é chamado por uma ação explícita.
 */

export type Checkin = {
  id: string;
  participanteId: string;
  arenaId: string;
  estacao: string;
  status: StatusCheckin;
  criadoEm: string;
  concluidoEm: string | null;
};

export type ResultadoRegistro = {
  checkin: Checkin;
  /** true se o check-in acabou de ser criado; false se já existia. */
  novo: boolean;
};

export type FiltroCheckins = {
  arenaId?: string;
  estacao?: string;
  status?: StatusCheckin;
};

export type TotalPorAtividade = {
  arenaId: string;
  estacao: string;
  totalCheckins: number;
  participantesUnicos: number;
  concluidos: number;
};

// Classe de erro compartilhada (src/services/erros.ts), reexportada para que
// os imports existentes (telas e contexto) continuem funcionando.
export { ErroCheckin, type CodigoErroCheckin } from './erros';

type LinhaCheckin = {
  id: string;
  participante_id: string;
  arena_id: string;
  estacao: string;
  status: StatusCheckin;
  criado_em: string;
  concluido_em: string | null;
};

const COLUNAS = 'id, participante_id, arena_id, estacao, status, criado_em, concluido_em';
const AGORA_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function paraCheckin(linha: LinhaCheckin): Checkin {
  return {
    id: linha.id,
    participanteId: linha.participante_id,
    arenaId: linha.arena_id,
    estacao: linha.estacao,
    status: linha.status,
    criadoEm: linha.criado_em,
    concluidoEm: linha.concluido_em,
  };
}

function textoObrigatorio(valor: string, campo: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    throw new ErroCheckin('validacao', `Informe ${campo}.`);
  }
  return texto;
}

/** Executa uma operação no banco e converte falhas técnicas em ErroCheckin('banco'). */
async function noBanco<T>(descricao: string, operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro) {
    if (erro instanceof ErroCheckin) throw erro;
    throw new ErroCheckin('banco', `Falha ao ${descricao}.`, erro);
  }
}

function montarFiltro(filtro: FiltroCheckins = {}): { where: string; params: SQLiteBindValue[] } {
  const condicoes: string[] = [];
  const params: SQLiteBindValue[] = [];

  if (filtro.arenaId !== undefined) {
    condicoes.push('arena_id = ?');
    params.push(textoObrigatorio(filtro.arenaId, 'a arena'));
  }
  if (filtro.estacao !== undefined) {
    condicoes.push('estacao = ?');
    params.push(textoObrigatorio(filtro.estacao, 'a estação'));
  }
  if (filtro.status !== undefined) {
    if (filtro.status !== 'na_fila' && filtro.status !== 'concluido') {
      throw new ErroCheckin('validacao', 'Status de check-in inválido.');
    }
    condicoes.push('status = ?');
    params.push(filtro.status);
  }

  return { where: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '', params };
}

/**
 * Implementação remota (Supabase), carregada por import dinâmico SOMENTE no
 * modo supabase. No modo local, nada do Supabase é carregado e as funções
 * abaixo seguem o código SQLite original, sem alteração.
 */
const remoto = () => import('./checkinsSupabase');

/**
 * Registra o check-in do participante deste aparelho em uma arena + estação.
 * Se já existir check-in nessa mesma atividade, devolve o existente (sem duplicar
 * e sem alterar o status).
 */
export async function registrarCheckin(arenaId: string, estacao: string): Promise<ResultadoRegistro> {
  if (usarSupabase()) return (await remoto()).registrarCheckin(arenaId, estacao);
  const arena = textoObrigatorio(arenaId, 'a arena');
  const nomeEstacao = textoObrigatorio(estacao, 'a estação');
  const participanteId = await obterOuCriarParticipanteId();

  return noBanco('registrar o check-in', async () => {
    const db = await obterBanco();

    const resultado = await db.runAsync(
      `INSERT INTO checkins (id, participante_id, arena_id, estacao, status)
       VALUES (?, ?, ?, ?, 'na_fila')
       ON CONFLICT (participante_id, arena_id, estacao) DO NOTHING`,
      [Crypto.randomUUID(), participanteId, arena, nomeEstacao]
    );

    const linha = await db.getFirstAsync<LinhaCheckin>(
      `SELECT ${COLUNAS} FROM checkins
       WHERE participante_id = ? AND arena_id = ? AND estacao = ?`,
      [participanteId, arena, nomeEstacao]
    );
    if (!linha) {
      throw new ErroCheckin('banco', 'O check-in não foi encontrado após o registro.');
    }

    return { checkin: paraCheckin(linha), novo: resultado.changes > 0 };
  });
}

/**
 * Marca uma atividade do participante deste aparelho como concluída.
 * Só deve ser chamada por uma ação explícita (ex.: botão "Concluí a atividade").
 * Chamar de novo em um check-in já concluído não altera nada.
 */
export async function concluirCheckin(checkinId: string): Promise<Checkin> {
  if (usarSupabase()) return (await remoto()).concluirCheckin(checkinId);
  const id = textoObrigatorio(checkinId, 'o check-in');
  const participanteId = await obterOuCriarParticipanteId();

  return noBanco('concluir a atividade', async () => {
    const db = await obterBanco();

    await db.runAsync(
      `UPDATE checkins
       SET status = 'concluido', concluido_em = ${AGORA_SQL}
       WHERE id = ? AND participante_id = ? AND status = 'na_fila'`,
      [id, participanteId]
    );

    const linha = await db.getFirstAsync<LinhaCheckin>(
      `SELECT ${COLUNAS} FROM checkins WHERE id = ? AND participante_id = ?`,
      [id, participanteId]
    );
    if (!linha) {
      throw new ErroCheckin('nao_encontrado', 'Check-in não encontrado.');
    }
    return paraCheckin(linha);
  });
}

/** Busca um check-in pelo id (de qualquer participante deste aparelho). */
export async function obterCheckin(checkinId: string): Promise<Checkin | null> {
  if (usarSupabase()) return (await remoto()).obterCheckin(checkinId);
  const id = textoObrigatorio(checkinId, 'o check-in');
  return noBanco('consultar o check-in', async () => {
    const db = await obterBanco();
    const linha = await db.getFirstAsync<LinhaCheckin>(
      `SELECT ${COLUNAS} FROM checkins WHERE id = ?`,
      [id]
    );
    return linha ? paraCheckin(linha) : null;
  });
}

/** Check-ins do participante deste aparelho, do mais recente ao mais antigo. */
export async function listarMeusCheckins(): Promise<Checkin[]> {
  if (usarSupabase()) return (await remoto()).listarMeusCheckins();
  const participanteId = await obterOuCriarParticipanteId();
  return noBanco('listar seus check-ins', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<LinhaCheckin>(
      `SELECT ${COLUNAS} FROM checkins WHERE participante_id = ? ORDER BY criado_em DESC`,
      [participanteId]
    );
    return linhas.map(paraCheckin);
  });
}

/** Check-ins concluídos do participante que ainda não receberam feedback. */
export async function listarPendentesDeFeedback(): Promise<Checkin[]> {
  if (usarSupabase()) return (await remoto()).listarPendentesDeFeedback();
  const participanteId = await obterOuCriarParticipanteId();
  return noBanco('listar atividades para avaliar', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<LinhaCheckin>(
      `SELECT c.id, c.participante_id, c.arena_id, c.estacao, c.status, c.criado_em, c.concluido_em
       FROM checkins c
       LEFT JOIN feedbacks f ON f.checkin_id = c.id
       WHERE c.participante_id = ? AND c.status = 'concluido' AND f.id IS NULL
       ORDER BY c.concluido_em DESC`,
      [participanteId]
    );
    return linhas.map(paraCheckin);
  });
}

/** Lista check-ins registrados neste aparelho, com filtros opcionais. */
export async function listarCheckins(filtro?: FiltroCheckins): Promise<Checkin[]> {
  // Modo supabase: indicador geral bloqueado até a S3 (evita dados parciais).
  if (usarSupabase()) return (await remoto()).listarCheckins(filtro);
  const { where, params } = montarFiltro(filtro);
  return noBanco('listar os check-ins', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<LinhaCheckin>(
      `SELECT ${COLUNAS} FROM checkins ${where} ORDER BY criado_em DESC`,
      params
    );
    return linhas.map(paraCheckin);
  });
}

/**
 * Conta participantes ÚNICOS que fizeram check-in (cada pessoa conta uma vez,
 * mesmo com check-in em várias estações). Aceita filtrar por arena e/ou estação.
 */
export async function contarParticipantesUnicos(
  filtro?: Pick<FiltroCheckins, 'arenaId' | 'estacao'>
): Promise<number> {
  // Modo supabase: indicador geral bloqueado até a S3 (evita dados parciais).
  if (usarSupabase()) return (await remoto()).contarParticipantesUnicos(filtro);
  const { where, params } = montarFiltro(filtro);
  return noBanco('contar os participantes', async () => {
    const db = await obterBanco();
    const linha = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(DISTINCT participante_id) AS total FROM checkins ${where}`,
      params
    );
    return linha?.total ?? 0;
  });
}

/** Totais por arena + estação: check-ins, participantes únicos e concluídos. */
export async function totaisPorAtividade(): Promise<TotalPorAtividade[]> {
  // Modo supabase: indicador geral bloqueado até a S3 (evita dados parciais).
  if (usarSupabase()) return (await remoto()).totaisPorAtividade();
  return noBanco('calcular os totais por atividade', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<{
      arena_id: string;
      estacao: string;
      total_checkins: number;
      participantes_unicos: number;
      concluidos: number;
    }>(
      `SELECT arena_id,
              estacao,
              COUNT(*)                                   AS total_checkins,
              COUNT(DISTINCT participante_id)            AS participantes_unicos,
              SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) AS concluidos
       FROM checkins
       GROUP BY arena_id, estacao
       ORDER BY arena_id, estacao`
    );
    return linhas.map((linha) => ({
      arenaId: linha.arena_id,
      estacao: linha.estacao,
      totalCheckins: linha.total_checkins,
      participantesUnicos: linha.participantes_unicos,
      concluidos: linha.concluidos,
    }));
  });
}
