import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { obterOuCriarParticipanteId } from '../services/participante';

type CheckinData = {
  nickname: string;
  cidade: string;
  idade: string;
};

type ParticipanteContextValue = {
  // Identificação persistente (fica salva no aparelho).
  participanteId: string | null;
  carregandoParticipante: boolean;
  erroParticipante: Error | null;
  recarregarParticipanteId: () => void;

  // Dados da sessão atual (somem ao voltar ao início).
  nickname: string;
  cidade: string;
  idade: string;
  arenaId: string | null;
  station: string | null;
  queueNumber: string | null;
  checkin: (arenaId: string, dados: CheckinData) => void;
  joinQueue: (station: string) => void;
  resetParticipante: () => void;
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

  // Carrega o UUID uma vez quando o app abre (e de novo só se pedirem nova tentativa).
  // Só lê/cria o identificador: nenhum dado pessoal é gravado aqui.
  // O estado só é alterado nos retornos assíncronos, nunca direto no corpo do efeito.
  useEffect(() => {
    let ativo = true;

    obterOuCriarParticipanteId()
      .then((id) => {
        if (ativo) setParticipanteId(id);
      })
      .catch((erro: unknown) => {
        console.error('[ParticipanteContext] Falha ao obter o ID do participante:', erro);
        if (ativo) {
          setErroParticipante(erro instanceof Error ? erro : new Error(String(erro)));
        }
      })
      .finally(() => {
        if (ativo) setCarregandoParticipante(false);
      });

    return () => {
      ativo = false;
    };
  }, [tentativa]);

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

  const joinQueue = useCallback((stationName: string) => {
    setStation(stationName);
    setQueueNumber(`A-${Math.floor(Math.random() * 80) + 20}`);
  }, []);

  // Limpa só os dados da sessão. O participanteId NÃO é apagado:
  // ele identifica o aparelho e precisa continuar o mesmo.
  const resetParticipante = useCallback(() => {
    setNickname('');
    setCidade('');
    setIdade('');
    setArenaId(null);
    setStation(null);
    setQueueNumber(null);
  }, []);

  const value = useMemo<ParticipanteContextValue>(
    () => ({
      participanteId,
      carregandoParticipante,
      erroParticipante,
      recarregarParticipanteId,
      nickname,
      cidade,
      idade,
      arenaId,
      station,
      queueNumber,
      checkin,
      joinQueue,
      resetParticipante,
    }),
    [
      participanteId,
      carregandoParticipante,
      erroParticipante,
      recarregarParticipanteId,
      nickname,
      cidade,
      idade,
      arenaId,
      station,
      queueNumber,
      checkin,
      joinQueue,
      resetParticipante,
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
