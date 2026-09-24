import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { arenas } from '../data/arenas';
import { colors } from '../styles/colors';

export default function EstacoesScreen() {
  const { arenaId, joinQueue } = useParticipante();
  const arena = arenas.find((item) => item.id === arenaId);

  function pickStation(station: string) {
    joinQueue(station);
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
      {arena?.stations.map((station) => (
        <Card
          key={station}
          title={station}
          linkLabel="Fila aberta"
          onPress={() => pickStation(station)}
        />
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
});
