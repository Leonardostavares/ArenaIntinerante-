/**
 * Avaliações (feedback) das atividades.
 *
 * Interface pública do serviço: as telas importam daqui.
 * A implementação é exclusivamente o Supabase (src/services/feedbackSupabase.ts).
 *
 * Regras (validadas no app e garantidas pelo banco: CHECKs, UNIQUE, RLS e trigger):
 * - Só é possível avaliar um check-in CONCLUÍDO do próprio participante.
 * - Nota inteira de 1 a 5 (estrelas); comentário opcional de até 300 caracteres.
 * - Cada check-in tem no máximo uma avaliação: avaliar de novo ATUALIZA a existente.
 */

// Limites usados pelas telas. feedbackSupabase.ts mantém uma cópia própria
// (mesmos valores, iguais aos CHECKs da 0001) para não depender deste arquivo
// em tempo de execução. Se mudar aqui, mude lá e na migração.
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

// Classe de erro compartilhada (src/services/erros.ts), reexportada para que
// os imports existentes (telas) continuem funcionando.
export { ErroFeedback, type CodigoErroFeedback } from './erros';

// Funções públicas: mesmas assinaturas de sempre, implementadas no Supabase.
// feedbackSupabase.ts importa deste arquivo SOMENTE tipos (import type), que
// são removidos na compilação: não há dependência circular em tempo de execução.
// Indicadores gerais (listarFeedbacks e resumoFeedbacks) lançam
// ErroFeedback('banco') até a etapa S3.
export {
  listarFeedbacks,
  listarMeusFeedbacks,
  obterFeedbackDoCheckin,
  resumoFeedbacks,
  salvarFeedback,
} from './feedbackSupabase';
