import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { arenas } from '../data/arenas';
import { ErroCheckin } from '../services/checkins';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

export default function EstacoesScreen() {
  const { arenaId, joinQueue } = useParticipante();
  const arena = arenas.find((item) => item.id === arenaId);
  // Estação sendo registrada no momento (null quando nada está em andamento).
  const [registrando, setRegistrando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Trava imediata contra toques repetidos (o estado só muda na próxima renderização).
  const registrandoRef = useRef(false);

  async function pickStation(station: string) {
    if (registrandoRef.current) return;

    registrandoRef.current = true;
    setRegistrando(station);
    setErro(null);

    try {
      // Só navega depois que o check-in foi gravado no SQLite.
      await joinQueue(station);
    } catch (falha) {
      if (falha instanceof ErroCheckin && falha.codigo === 'validacao') {
        setErro(falha.message);
      } else {
        console.error('[estacoes] Falha ao registrar o check-in:', falha);
        setErro('Não foi possível entrar na fila. Tente novamente.');
      }
      return; // Não avança para /fila se o registro falhar.
    } finally {
      registrandoRef.current = false;
      setRegistrando(null);
    }

    router.push('/fila');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="ARENA ITINERANTE"
        title="O que voce quer jogar?"
        onBack={() => router.back()}
      />
      <Text style={styles.helperText}>Escolha uma estacao para entrar na fila.</Text>

      {erro ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{erro}</Text>
        </View>
      ) : null}

      {arena?.stations.map((station) => (
        <View
          key={station}
          style={[
            registrando ? styles.bloqueado : null,
            registrando && registrando !== station ? styles.disabled : null,
          ]}
        >
          <Card
            title={station}
            linkLabel={registrando === station ? 'Entrando na fila...' : 'Fila aberta'}
            onPress={() => pickStation(station)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 36,
    backgroundColor: colors.background,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  errorBox: {
    borderColor: COR_ERRO,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  errorText: {
    color: COR_ERRO,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  bloqueado: {
    pointerEvents: 'none',
  },
  disabled: {
    opacity: 0.4,
  },
});
