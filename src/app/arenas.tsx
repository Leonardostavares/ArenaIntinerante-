import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { arenas } from '../data/arenas';
import { colors } from '../styles/colors';

export default function ArenasScreen() {
  function chooseArena(arenaId: string) {
    router.push({ pathname: '/checkin', params: { arenaId } });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="ARENA ITINERANTE"
        title="Escolha sua arena"
        subtitle="Faca seu check-in e entre na fila da sua atividade favorita."
        onBack={() => router.back()}
      />
      {arenas.map((arena) => (
        <Card
          key={arena.id}
          title={arena.name}
          subtitle={arena.location}
          linkLabel="Fazer check-in"
          onPress={() => chooseArena(arena.id)}
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
});
