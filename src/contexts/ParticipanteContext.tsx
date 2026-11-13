import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ErroCheckin, registrarCheckin } from '../services/checkins';
import { obterIdDaSessaoAtual, observarIdentidade } from '../services/identidadeSupabase';

type CheckinData = {
  nickname: string;
  cidade: string;
  idade: string;
};

type RetomadaDeFila = {
  checkinId: string;
  arenaId: string;
  estacao: string;
  apelido: string;
};

/**
 * Senha de exibição (A-20 a A-99) derivada do id do check-in: estável, então
 * é a mesma ao retomar a fila. Não é a posição; a posição vem do servidor.
 */
function senhaDoCheckin(checkinId: string): string {
  let soma = 0;
  for (let i = 0; i < checkinId.length; i += 1) soma += checkinId.charCodeAt(i) * (i + 1);
  return `A-${(soma % 80) + 20}`;
}

type ParticipanteContextValue = {
  // Identificação: ID do usuário anônimo do Supabase Auth (sessão salva no
  // aparelho), ou null enquanto o participante ainda não fez o cadastro.
  participanteId: string | null;
  carregandoParticipante: boolean;
  erroParticipante: Error | null;
  recarregarParticipanteId: () => void;
  /**
   * true quando o formulário de cadastro pode ser enviado: inicialização
   * concluída sem erro (a identidade é criada só ao confirmar o cadastro).
   */
  prontoParaCadastro: boolean;

  // Dados da sessão atual (somem ao voltar ao início).
  nickname: string;
  cidade: string;
  idade: string;
  arenaId: string | null;
  station: string | null;
  queueNumber: string | null;
  /** Id (no Supabase) do check-in da atividade atual; null fora da fila. */
  checkinAtualId: string | null;
  checkin: (arenaId: string, dados: CheckinData) => void;
  /** Registra o check-in no Supabase e, só depois, atualiza a fila. Rejeita se falhar. */
  joinQueue: (station: string) => Promise<void>;
  /** Reabre a fila de um check-in ainda ativo (sem gravar nada). */
  retomarFila: (dados: RetomadaDeFila) => void;
  resetParticipante: () => void;

  // Acesso da equipe ao painel. Fica SÓ em memória: some ao fechar o app.
  /** true quando a equipe foi autorizada a ver o painel nesta sessão. */
  acessoEquipe: boolean;
  /** Libera o painel. Deve ser chamada apenas após uma autenticação válida da equipe. */
  liberarAcessoEquipe: () => void;
  /** Bloqueia o painel novamente. */
  encerrarAcessoEquipe: () => void;
};

const ParticipanteContext = createContext<ParticipanteContextValue | null>(null);

export function ParticipanteProvider({ children }: { children: ReactNode }) {
  const [participanteId, setParticipanteId] = useState<string | null>(null);
  const [carregandoParticipante, setCarregandoParticipante] = useState(true);
  const [erroParticipante, setErroParticipante] = useState<Error | null>(null);
  // Incrementar este número dispara uma nova tentativa de carregar o ID.
  const [tentativa, setTentativa] = useState(0);

  const [nickname, setNickname] = useState('');
  const [cidade, setCidade] = useState('');
  const [idade, setIdade] = useState('');
  const [arenaId, setArenaId] = useState<string | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [queueNumber, setQueueNumber] = useState<string | null>(null);
  const [checkinAtualId, setCheckinAtualId] = useState<string | null>(null);
  // Nunca é salvo no aparelho e não é alterado por resetParticipante().
  const [acessoEquipe, setAcessoEquipe] = useState(false);

  // Ao abrir o app (e de novo só se pedirem nova tentativa): só CONSULTA a
  // sessão já salva no aparelho (sem login anônimo) e passa a acompanhar
  // mudanças de autenticação. O login anônimo acontece só no cadastro.
  useEffect(() => {
    let ativo = true;
    let encerrarObservacao: (() => void) | null = null;

    // Promessa: qualquer falha (inclusive de configuração) vira erroParticipante.
    Promise.resolve()
      .then(async () => {
        if (!ativo) return;
        encerrarObservacao = observarIdentidade((id) => {
          if (ativo) setParticipanteId(id);
        });
        const id = await obterIdDaSessaoAtual();
        if (ativo) setParticipanteId(id);
      })
      .catch((erro: unknown) => {
        console.error('[ParticipanteContext] Falha ao consultar a sessão:', erro);
        if (ativo) {
          setErroParticipante(erro instanceof Error ? erro : new Error(String(erro)));
        }
      })
      .finally(() => {
        if (ativo) setCarregandoParticipante(false);
      });

    return () => {
      ativo = false;
      // Remove o listener de autenticação e para a renovação da sessão.
      encerrarObservacao?.();
      encerrarObservacao = null;
    };
  }, [tentativa]);

  const prontoParaCadastro = !carregandoParticipante && !erroParticipante;

  // Nova tentativa após um erro: volta ao estado de carregamento e dispara o efeito de novo.
  const recarregarParticipanteId = useCallback(() => {
    setCarregandoParticipante(true);
    setErroParticipante(null);
    setTentativa((valor) => valor + 1);
  }, []);

  const checkin = useCallback((id: string, dados: CheckinData) => {
    setArenaId(id);
    setNickname(dados.nickname);
    setCidade(dados.cidade);
    setIdade(dados.idade);
  }, []);

  // Grava o check-in (status 'na_fila') antes de mudar o estado da tela.
  // Se já existir check-in nessa arena + estação, reaproveita o mesmo registro.
  // Nunca conclui a atividade: isso só acontece por ação explícita do participante.
  const joinQueue = useCallback(
    async (stationName: string) => {
      if (!arenaId) {
        throw new ErroCheckin('validacao', 'Escolha uma arena antes de entrar na fila.');
      }
      const { checkin: registro } = await registrarCheckin(arenaId, stationName);
      setCheckinAtualId(registro.id);
      setStation(stationName);
      setQueueNumber(senhaDoCheckin(registro.id));
    },
    [arenaId]
  );

  // Reabre a fila de um check-in que continua ativo no Supabase (ex.: o
  // participante saiu da tela). Só preenche o estado da tela; não grava nada.
  const retomarFila = useCallback((dados: RetomadaDeFila) => {
    setNickname(dados.apelido);
    setArenaId(dados.arenaId);
    setStation(dados.estacao);
    setCheckinAtualId(dados.checkinId);
    setQueueNumber(senhaDoCheckin(dados.checkinId));
  }, []);

  // Limpa só os dados da tela. O participanteId e a sessão NÃO são apagados:
  // identificam o participante e precisam continuar os mesmos.
  // Os check-ins gravados no Supabase também permanecem.
  const resetParticipante = useCallback(() => {
    setNickname('');
    setCidade('');
    setIdade('');
    setArenaId(null);
    setStation(null);
    setQueueNumber(null);
    setCheckinAtualId(null);
  }, []);

  const liberarAcessoEquipe = useCallback(() => {
    setAcessoEquipe(true);
  }, []);

  const encerrarAcessoEquipe = useCallback(() => {
    setAcessoEquipe(false);
  }, []);

  const value = useMemo<ParticipanteContextValue>(
    () => ({
      participanteId,
      carregandoParticipante,
      erroParticipante,
      recarregarParticipanteId,
      prontoParaCadastro,
      nickname,
      cidade,
      idade,
      arenaId,
      station,
      queueNumber,
      checkinAtualId,
      checkin,
      joinQueue,
      retomarFila,
      resetParticipante,
      acessoEquipe,
      liberarAcessoEquipe,
      encerrarAcessoEquipe,
    }),
    [
      participanteId,
      carregandoParticipante,
      erroParticipante,
      recarregarParticipanteId,
      prontoParaCadastro,
      nickname,
      cidade,
      idade,
      arenaId,
      station,
      queueNumber,
      checkinAtualId,
      checkin,
      joinQueue,
      retomarFila,
      resetParticipante,
      acessoEquipe,
      liberarAcessoEquipe,
      encerrarAcessoEquipe,
    ]
  );

  return <ParticipanteContext.Provider value={value}>{children}</ParticipanteContext.Provider>;
}

export function useParticipante() {
  const context = useContext(ParticipanteContext);
  if (!context) {
    throw new Error('useParticipante deve ser usado dentro de ParticipanteProvider');
  }
  return context;
}
