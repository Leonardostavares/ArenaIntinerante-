import type { PostgrestError } from '@supabase/supabase-js';
import { ErroCheckin, ErroFeedback, ErroPainel } from './erros';

/**
 * Conversão de erros do Supabase (PostgREST) para os tipos compartilhados.
 *
 * - Funções puras: NÃO fazem chamadas de rede.
 * - Importa do Supabase apenas TIPOS (removidos na compilação), então não
 *   carrega o cliente Supabase.
 * - Não importa checkins.ts nem feedback.ts (sem dependência circular).
 *
 * Códigos considerados (PostgreSQL / PostgREST):
 *   42501  permissão negada ou linha barrada pelo RLS
 *   23503  chave estrangeira (ex.: cadastro do participante inexistente)
 *   23505  registro duplicado (o chamador costuma tratar antes)
 *   23514, 23502, 22P02  dados inválidos (CHECK, NOT NULL, tipo)
 *   P0001  regra dos triggers da 0001 (hint: 'validacao' ou 'nao_permitido')
 *   PGRST116  nenhuma linha quando se esperava exatamente uma
 */

const MENSAGEM_SEM_CONEXAO = 'Sem conexão com a internet. Verifique e tente novamente.';
const MENSAGEM_DADOS_INVALIDOS = 'Dados inválidos. Confira e tente novamente.';
const MENSAGEM_SEM_CADASTRO = 'Faça seu cadastro antes de continuar.';
const MENSAGEM_NAO_PERMITIDO = 'Operação não permitida.';

/** Formato mínimo de um erro do PostgREST (compatível com PostgrestError). */
export type ErroPostgrest = Pick<PostgrestError, 'code' | 'message' | 'hint'>;

/** Falha de rede (sem código do banco e mensagem típica de fetch). */
export function ehFalhaDeRede(erro: Pick<ErroPostgrest, 'code' | 'message'>): boolean {
  return !erro.code && /network request failed|failed to fetch|network/i.test(erro.message ?? '');
}

/** Mensagem dos triggers da 0001 (em português e segura para exibir). */
function mensagemDoTrigger(erro: ErroPostgrest, padrao: string): string {
  return erro.message?.trim() ? erro.message : padrao;
}

/** Converte um erro do PostgREST para ErroCheckin. */
export function converterErroCheckin(
  erro: ErroPostgrest,
  mensagemPadrao = 'Não foi possível concluir a operação. Tente novamente.'
): ErroCheckin {
  if (ehFalhaDeRede(erro)) return new ErroCheckin('banco', MENSAGEM_SEM_CONEXAO, erro);

  switch (erro.code) {
    case 'P0001':
      // ErroCheckin não tem 'nao_permitido': as regras dos triggers são
      // apresentadas como validação, com a mensagem do próprio trigger.
      return new ErroCheckin('validacao', mensagemDoTrigger(erro, MENSAGEM_DADOS_INVALIDOS), erro);
    case '23503':
      return new ErroCheckin('validacao', MENSAGEM_SEM_CADASTRO, erro);
    case '23514':
    case '23502':
    case '22P02':
      return new ErroCheckin('validacao', MENSAGEM_DADOS_INVALIDOS, erro);
    case 'PGRST116':
      return new ErroCheckin('nao_encontrado', 'Check-in não encontrado.', erro);
    case '42501':
      // Operação legítima recusada indica configuração inesperada: falha técnica.
      return new ErroCheckin('banco', MENSAGEM_NAO_PERMITIDO, erro);
    default:
      return new ErroCheckin('banco', mensagemPadrao, erro);
  }
}

/** Converte um erro do PostgREST para ErroFeedback. */
export function converterErroFeedback(
  erro: ErroPostgrest,
  mensagemPadrao = 'Não foi possível salvar sua avaliação. Tente novamente.'
): ErroFeedback {
  if (ehFalhaDeRede(erro)) return new ErroFeedback('banco', MENSAGEM_SEM_CONEXAO, erro);

  switch (erro.code) {
    case 'P0001':
      return new ErroFeedback(
        erro.hint === 'validacao' ? 'validacao' : 'nao_permitido',
        mensagemDoTrigger(erro, MENSAGEM_NAO_PERMITIDO),
        erro
      );
    case '23503':
      return new ErroFeedback('nao_encontrado', 'Atividade não encontrada.', erro);
    case '23514':
    case '23502':
    case '22P02':
      return new ErroFeedback('validacao', MENSAGEM_DADOS_INVALIDOS, erro);
    case 'PGRST116':
      return new ErroFeedback('nao_encontrado', 'Avaliação não encontrada.', erro);
    case '42501':
      return new ErroFeedback('nao_permitido', MENSAGEM_NAO_PERMITIDO, erro);
    default:
      return new ErroFeedback('banco', mensagemPadrao, erro);
  }
}

/** Converte um erro do PostgREST para ErroPainel (funções da equipe). */
export function converterErroPainel(
  erro: ErroPostgrest,
  mensagemPadrao = 'Não foi possível carregar os indicadores. Tente novamente.'
): ErroPainel {
  if (ehFalhaDeRede(erro)) return new ErroPainel('banco', MENSAGEM_SEM_CONEXAO, erro);

  switch (erro.code) {
    case '42501':
      return new ErroPainel('nao_permitido', 'Esta área é exclusiva da equipe.', erro);
    case '23514':
    case '23502':
    case '22P02':
      return new ErroPainel('banco', MENSAGEM_DADOS_INVALIDOS, erro);
    default:
      return new ErroPainel('banco', mensagemPadrao, erro);
  }
}
