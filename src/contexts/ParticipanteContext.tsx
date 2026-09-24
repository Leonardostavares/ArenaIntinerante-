import { createContext, ReactNode, useContext, useState } from 'react';

type CheckinData = {
  nickname: string;
  cidade: string;
  idade: string;
};

type ParticipanteContextValue = {
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
  const [nickname, setNickname] = useState('');
  const [cidade, setCidade] = useState('');
  const [idade, setIdade] = useState('');
  const [arenaId, setArenaId] = useState<string | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [queueNumber, setQueueNumber] = useState<string | null>(null);

  function checkin(id: string, dados: CheckinData) {
    setArenaId(id);
    setNickname(dados.nickname);
    setCidade(dados.cidade);
    setIdade(dados.idade);
  }

  function joinQueue(stationName: string) {
    setStation(stationName);
    setQueueNumber(`A-${Math.floor(Math.random() * 80) + 20}`);
  }

  function resetParticipante() {
    setNickname('');
    setCidade('');
    setIdade('');
    setArenaId(null);
    setStation(null);
    setQueueNumber(null);
  }

  return (
    <ParticipanteContext.Provider
      value={{
        nickname,
        cidade,
        idade,
        arenaId,
        station,
        queueNumber,
        checkin,
        joinQueue,
        resetParticipante,
      }}
    >
      {children}
    </ParticipanteContext.Provider>
  );
}

export function useParticipante() {
  const context = useContext(ParticipanteContext);
  if (!context) {
    throw new Error('useParticipante deve ser usado dentro de ParticipanteProvider');
  }
  return context;
}
