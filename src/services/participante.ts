import { salvarCadastroSupabase } from './identidadeSupabase';

/**
 * Cadastro do participante (apelido, cidade e idade).
 *
 * A identidade é o usuário anônimo do Supabase Auth: a sessão salva no
 * aparelho é reaproveitada, e o login anônimo só acontece se ainda não houver
 * sessão (ver identidadeSupabase.ts). Os dados ficam na tabela participantes.
 */

export type DadosParticipante = {
  apelido: string;
  cidade: string;
  idade: string | number;
};

/**
 * Registra ou atualiza apelido, cidade e idade do participante da sessão.
 * Lança um erro se os dados forem inválidos.
 */
export async function salvarDadosParticipante(dados: DadosParticipante): Promise<void> {
  const apelido = dados.apelido.trim();
  const cidade = dados.cidade.trim();
  const idade = converterIdade(dados.idade);

  if (!apelido) throw new Error('Informe o apelido.');
  if (!cidade) throw new Error('Informe a cidade.');

  // Sessão anônima sob demanda (reaproveita a existente) + cadastro no Supabase.
  await salvarCadastroSupabase({ apelido, cidade, idade });
}

function converterIdade(valor: string | number): number {
  const texto = String(valor).trim();
  if (!/^\d{1,3}$/.test(texto)) {
    throw new Error('Idade inválida: use apenas números.');
  }
  const idade = Number(texto);
  // Mesmo limite do CHECK da tabela participantes.
  if (idade < 0 || idade > 120) {
    throw new Error('Idade inválida: informe um valor entre 0 e 120.');
  }
  return idade;
}
