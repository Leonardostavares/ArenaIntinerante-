import * as Crypto from 'expo-crypto';
import type { SQLiteBindValue } from 'expo-sqlite';
import { obterBanco } from './db';
import { obterOuCriarParticipanteId } from './participante';

/**
 * Avaliações (feedback) das atividades.
 *
 * Regras:
 * - Só é possível avaliar um check-in CONCLUÍDO do participante deste aparelho.
 * - Nota inteira de 1 a 5 (estrelas); comentário opcional de até 300 caracteres.
 * - Cada check-in tem no máximo uma avaliação: avaliar de novo ATUALIZA a existente.
 */

export const NOTA_MINIMA = 1;
export const NOTA_MAXIMA = 5;
export const COMENTARIO_MAXIMO = 300;

export type Feedback = {
  id: string;
  checkinId: string;
  participanteId: string;
  nota: number;
  comentario: string | null;
  criadoEm: string;
  atualizadoEm: string | null;
};

/** Feedback com os dados da atividade avaliada. */
export type FeedbackDetalhado = Feedback & {
  arenaId: string;
  estacao: string;
};

export type DadosFeedback = {
  checkinId: string;
  nota: number;
  comentario?: string | null;
};

export type ResultadoFeedback = {
  feedback: Feedback;
  /** true se a avaliação foi criada agora; false se uma existente foi atualizada. */
  novo: boolean;
};

export type FiltroFeedbacks = {
  arenaId?: string;
  estacao?: string;
};

export type ResumoFeedbacks = {
  total: number;
  /** Média das notas com 1 casa decimal; null se não houver avaliações. */
  media: number | null;
  /** Quantidade de avaliações por nota (1 a 5). */
  porNota: Record<1 | 2 | 3 | 4 | 5, number>;
};

export type CodigoErroFeedback = 'validacao' | 'nao_encontrado' | 'nao_permitido' | 'banco';

/**
 * Erro dos serviços de feedback. O `codigo` permite que as telas diferenciem
 * erros esperados (validação, não encontrado, não permitido) de falhas técnicas (banco).
 */
export class ErroFeedback extends Error {
  readonly codigo: CodigoErroFeedback;
  readonly causa?: unknown;

  constructor(codigo: CodigoErroFeedback, mensagem: string, causa?: unknown) {
    super(mensagem);
    this.name = 'ErroFeedback';
    this.codigo = codigo;
    this.causa = causa;
  }
}

type LinhaFeedback = {
  id: string;
  checkin_id: string;
  participante_id: string;
  nota: number;
  comentario: string | null;
  criado_em: string;
  atualizado_em: string | null;
};

type LinhaFeedbackDetalhado = LinhaFeedback & {
  arena_id: string;
  estacao: string;
};

const COLUNAS = 'f.id, f.checkin_id, f.participante_id, f.nota, f.comentario, f.criado_em, f.atualizado_em';
const AGORA_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function paraFeedback(linha: LinhaFeedback): Feedback {
  return {
    id: linha.id,
    checkinId: linha.checkin_id,
    participanteId: linha.participante_id,
    nota: linha.nota,
    comentario: linha.comentario,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

function paraFeedbackDetalhado(linha: LinhaFeedbackDetalhado): FeedbackDetalhado {
  return { ...paraFeedback(linha), arenaId: linha.arena_id, estacao: linha.estacao };
}

function textoObrigatorio(valor: string, campo: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    throw new ErroFeedback('validacao', `Informe ${campo}.`);
  }
  return texto;
}

function validarNota(nota: number): number {
  if (!Number.isInteger(nota) || nota < NOTA_MINIMA || nota > NOTA_MAXIMA) {
    throw new ErroFeedback(
      'validacao',
      `Escolha uma nota de ${NOTA_MINIMA} a ${NOTA_MAXIMA} estrelas.`
    );
  }
  return nota;
}

/** Comentário vazio vira null; conta caracteres reais (emojis contam como 1). */
function validarComentario(comentario: string | null | undefined): string | null {
  if (comentario === null || comentario === undefined) return null;
  if (typeof comentario !== 'string') {
    throw new ErroFeedback('validacao', 'Comentário inválido.');
  }
  const texto = comentario.trim();
  if (!texto) return null;
  if ([...texto].length > COMENTARIO_MAXIMO) {
    throw new ErroFeedback(
      'validacao',
      `O comentário pode ter no máximo ${COMENTARIO_MAXIMO} caracteres.`
    );
  }
  return texto;
}

/** Executa uma operação no banco e converte falhas técnicas em ErroFeedback('banco'). */
async function noBanco<T>(descricao: string, operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro) {
    if (erro instanceof ErroFeedback) throw erro;
    throw new ErroFeedback('banco', `Falha ao ${descricao}.`, erro);
  }
}

function montarFiltro(filtro: FiltroFeedbacks = {}): { where: string; params: SQLiteBindValue[] } {
  const condicoes: string[] = [];
  const params: SQLiteBindValue[] = [];
  if (filtro.arenaId !== undefined) {
    condicoes.push('c.arena_id = ?');
    params.push(textoObrigatorio(filtro.arenaId, 'a arena'));
  }
  if (filtro.estacao !== undefined) {
    condicoes.push('c.estacao = ?');
    params.push(textoObrigatorio(filtro.estacao, 'a estação'));
  }
  return { where: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '', params };
}

/**
 * Salva a avaliação de uma atividade concluída do participante deste aparelho.
 * Se já existir avaliação para o check-in, ela é atualizada (sem duplicar).
 */
export async function salvarFeedback(dados: DadosFeedback): Promise<ResultadoFeedback> {
  const checkinId = textoObrigatorio(dados.checkinId, 'a atividade');
  const nota = validarNota(dados.nota);
  const comentario = validarComentario(dados.comentario);
  const participanteId = await obterOuCriarParticipanteId();

  return noBanco('salvar a avaliação', async () => {
    const db = await obterBanco();

    // Permissões: o check-in precisa existir, ser deste participante e estar concluído.
    const checkin = await db.getFirstAsync<{ participante_id: string; status: string }>(
      'SELECT participante_id, status FROM checkins WHERE id = ?',
      [checkinId]
    );
    if (!checkin) {
      throw new ErroFeedback('nao_encontrado', 'Atividade não encontrada.');
    }
    if (checkin.participante_id !== participanteId) {
      throw new ErroFeedback('nao_permitido', 'Você só pode avaliar as suas atividades.');
    }
    if (checkin.status !== 'concluido') {
      throw new ErroFeedback(
        'nao_permitido',
        'Conclua a atividade antes de avaliá-la.'
      );
    }

    const existente = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM feedbacks WHERE checkin_id = ?',
      [checkinId]
    );

    // Upsert pela restrição UNIQUE(checkin_id): cria ou atualiza, nunca duplica.
    // O WHERE impede alterar uma avaliação de outro participante.
    await db.runAsync(
      `INSERT INTO feedbacks (id, checkin_id, participante_id, nota, comentario)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (checkin_id) DO UPDATE SET
         nota          = excluded.nota,
         comentario    = excluded.comentario,
         atualizado_em = ${AGORA_SQL}
       WHERE feedbacks.participante_id = excluded.participante_id`,
      [Crypto.randomUUID(), checkinId, participanteId, nota, comentario]
    );

    const linha = await db.getFirstAsync<LinhaFeedback>(
      `SELECT ${COLUNAS} FROM feedbacks f WHERE f.checkin_id = ? AND f.participante_id = ?`,
      [checkinId, participanteId]
    );
    if (!linha) {
      throw new ErroFeedback('banco', 'A avaliação não foi encontrada após salvar.');
    }

    return { feedback: paraFeedback(linha), novo: !existente };
  });
}

/** Avaliação de um check-in do participante deste aparelho (null se ainda não avaliou). */
export async function obterFeedbackDoCheckin(checkinId: string): Promise<Feedback | null> {
  const id = textoObrigatorio(checkinId, 'a atividade');
  const participanteId = await obterOuCriarParticipanteId();
  return noBanco('consultar a avaliação', async () => {
    const db = await obterBanco();
    const linha = await db.getFirstAsync<LinhaFeedback>(
      `SELECT ${COLUNAS} FROM feedbacks f WHERE f.checkin_id = ? AND f.participante_id = ?`,
      [id, participanteId]
    );
    return linha ? paraFeedback(linha) : null;
  });
}

/** Avaliações do participante deste aparelho, da mais recente à mais antiga. */
export async function listarMeusFeedbacks(): Promise<FeedbackDetalhado[]> {
  const participanteId = await obterOuCriarParticipanteId();
  return noBanco('listar suas avaliações', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<LinhaFeedbackDetalhado>(
      `SELECT ${COLUNAS}, c.arena_id, c.estacao
       FROM feedbacks f
       JOIN checkins c ON c.id = f.checkin_id
       WHERE f.participante_id = ?
       ORDER BY COALESCE(f.atualizado_em, f.criado_em) DESC`,
      [participanteId]
    );
    return linhas.map(paraFeedbackDetalhado);
  });
}

/** Lista as avaliações registradas neste aparelho, com filtro opcional por arena/estação. */
export async function listarFeedbacks(filtro?: FiltroFeedbacks): Promise<FeedbackDetalhado[]> {
  const { where, params } = montarFiltro(filtro);
  return noBanco('listar as avaliações', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<LinhaFeedbackDetalhado>(
      `SELECT ${COLUNAS}, c.arena_id, c.estacao
       FROM feedbacks f
       JOIN checkins c ON c.id = f.checkin_id
       ${where}
       ORDER BY COALESCE(f.atualizado_em, f.criado_em) DESC`,
      params
    );
    return linhas.map(paraFeedbackDetalhado);
  });
}

/** Total, média e distribuição das notas, com filtro opcional por arena/estação. */
export async function resumoFeedbacks(filtro?: FiltroFeedbacks): Promise<ResumoFeedbacks> {
  const { where, params } = montarFiltro(filtro);
  return noBanco('calcular o resumo das avaliações', async () => {
    const db = await obterBanco();
    const linhas = await db.getAllAsync<{ nota: number; quantidade: number }>(
      `SELECT f.nota AS nota, COUNT(*) AS quantidade
       FROM feedbacks f
       JOIN checkins c ON c.id = f.checkin_id
       ${where}
       GROUP BY f.nota`,
      params
    );

    const porNota: ResumoFeedbacks['porNota'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let soma = 0;
    for (const { nota, quantidade } of linhas) {
      if (nota >= NOTA_MINIMA && nota <= NOTA_MAXIMA) {
        porNota[nota as 1 | 2 | 3 | 4 | 5] = quantidade;
        total += quantidade;
        soma += nota * quantidade;
      }
    }

    return {
      total,
      media: total > 0 ? Math.round((soma / total) * 10) / 10 : null,
      porNota,
    };
  });
}
