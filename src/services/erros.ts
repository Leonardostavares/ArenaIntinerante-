/**
 * Classes de erro compartilhadas pelos serviços de dados.
 *
 * Usadas pelos serviços Supabase (e convertidas a partir dos erros da API
 * em errosSupabase.ts), para que as telas tratem os erros de forma única.
 * Este arquivo não importa nenhum outro módulo do app, o que evita
 * dependências circulares.
 *
 * checkins.ts e feedback.ts reexportam estas classes, então os imports
 * existentes nas telas continuam funcionando sem alteração.
 */

export type CodigoErroCheckin = 'validacao' | 'nao_encontrado' | 'banco';

/**
 * Erro dos serviços de check-in. O `codigo` permite que as telas diferenciem
 * erros esperados (validação, não encontrado) de falhas técnicas (banco).
 */
export class ErroCheckin extends Error {
  readonly codigo: CodigoErroCheckin;
  readonly causa?: unknown;

  constructor(codigo: CodigoErroCheckin, mensagem: string, causa?: unknown) {
    super(mensagem);
    this.name = 'ErroCheckin';
    this.codigo = codigo;
    this.causa = causa;
  }
}

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
