import * as Crypto from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import { obterBanco } from './db';

/**
 * Identificação persistente do participante.
 *
 * Cada aparelho recebe um UUID na primeira vez que o app é usado.
 * Esse UUID fica salvo no aparelho e é reutilizado nas próximas aberturas,
 * o que permite contar participantes únicos sem pedir login.
 */

const CHAVE_PARTICIPANTE_ID = 'arena.participanteId';

// Formato de um UUID: 8-4-4-4-12 caracteres hexadecimais.
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DadosParticipante = {
  apelido: string;
  cidade: string;
  idade: string | number;
};

/**
 * Promessa compartilhada do ID.
 * Se várias partes do app pedirem o ID ao mesmo tempo, todas recebem
 * a mesma promessa e, portanto, o mesmo UUID.
 */
let idEmAndamento: Promise<string> | null = null;

export function obterOuCriarParticipanteId(): Promise<string> {
  if (!idEmAndamento) {
    idEmAndamento = carregarOuCriarId().catch((erro) => {
      // Permite tentar de novo na próxima chamada, sem esconder o erro.
      idEmAndamento = null;
      throw erro;
    });
  }
  return idEmAndamento;
}

async function carregarOuCriarId(): Promise<string> {
  // A função de atualização roda de forma atômica no kv-store:
  // só gera um UUID novo se ainda não houver um válido salvo.
  await Storage.setItemAsync(CHAVE_PARTICIPANTE_ID, (valorAnterior) => {
    if (valorAnterior && FORMATO_UUID.test(valorAnterior)) {
      return valorAnterior;
    }
    if (valorAnterior) {
      console.warn('[participante] ID salvo em formato inválido; gerando um novo.');
    }
    return Crypto.randomUUID();
  });

  const id = await Storage.getItemAsync(CHAVE_PARTICIPANTE_ID);
  if (!id || !FORMATO_UUID.test(id)) {
    throw new Error('Não foi possível obter o identificador do participante.');
  }

  // Garante que o participante exista na tabela (necessário para as chaves estrangeiras).
  // INSERT OR IGNORE não altera uma linha que já existe.
  const db = await obterBanco();
  await db.runAsync('INSERT OR IGNORE INTO participantes (id) VALUES (?)', id);

  return id;
}

/**
 * Registra ou atualiza apelido, cidade e idade do participante deste aparelho.
 * Lança um erro se os dados forem inválidos.
 */
export async function salvarDadosParticipante(dados: DadosParticipante): Promise<void> {
  const apelido = dados.apelido.trim();
  const cidade = dados.cidade.trim();
  const idade = converterIdade(dados.idade);

  if (!apelido) throw new Error('Informe o apelido.');
  if (!cidade) throw new Error('Informe a cidade.');

  const id = await obterOuCriarParticipanteId();
  const db = await obterBanco();

  // Consulta parametrizada: os valores vão separados do SQL (os "?"),
  // então o texto digitado nunca é interpretado como comando (evita SQL Injection).
  await db.runAsync(
    `INSERT INTO participantes (id, apelido, cidade, idade)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       apelido       = excluded.apelido,
       cidade        = excluded.cidade,
       idade         = excluded.idade,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [id, apelido, cidade, idade]
  );
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
