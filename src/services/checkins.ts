/**
 * Check-ins do participante nas atividades (arena + estação).
 *
 * Interface pública do serviço: as telas e o contexto importam daqui.
 * A implementação é exclusivamente o Supabase (src/services/checkinsSupabase.ts).
 *
 * Regras (garantidas pelo banco: UNIQUE, RLS, permissões por coluna e triggers):
 * - Um participante tem no máximo um check-in por arena + estação.
 * - Todo check-in começa como 'na_fila'.
 * - Só vira 'concluido' quando concluirCheckin() é chamado por uma ação explícita.
 */

export type StatusCheckin = 'na_fila' | 'concluido';

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

// Funções públicas: mesmas assinaturas de sempre, implementadas no Supabase.
// checkinsSupabase.ts importa deste arquivo SOMENTE tipos (import type), que
// são removidos na compilação: não há dependência circular em tempo de execução.
// Indicadores gerais (listarCheckins, contarParticipantesUnicos e
// totaisPorAtividade) lançam ErroCheckin('banco') até a etapa S3.
export {
  concluirCheckin,
  contarParticipantesUnicos,
  listarCheckins,
  listarMeusCheckins,
  listarPendentesDeFeedback,
  obterCheckin,
  registrarCheckin,
  totaisPorAtividade,
} from './checkinsSupabase';
