import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { Arena, listarArenas } from '../services/arenasSupabase';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

export default function ArenasScreen() {
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Só a busca em si (sem resetar carregando/erro): usada pelo efeito de
  // montagem, onde o estado inicial já começa como "carregando".
  const buscarArenas = useCallback(() => {
    listarArenas()
      .then(setArenas)
      .catch((falha: unknown) => {
        console.error('[arenas] Falha ao carregar arenas:', falha);
        setErro('Não foi possível carregar as arenas. Tente novamente.');
      })
      .finally(() => setCarregando(false));
  }, []);

  // Usado pelo botão "Tentar novamente": reseta o estado e busca de novo.
  function carregar() {
    setCarregando(true);
    setErro(null);
    buscarArenas();
  }

  useEffect(() => {
    buscarArenas();
  }, [buscarArenas]);

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

      {carregando ? (
        <ActivityIndicator color={colors.text} style={styles.loading} />
      ) : erro ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{erro}</Text>
          <Pressable onPress={carregar}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        arenas.map((arena) => (
          <Card
            key={arena.id}
            title={arena.nome}
            subtitle={arena.local ?? undefined}
            linkLabel="Fazer check-in"
            onPress={() => chooseArena(arena.id)}
          />
        ))
      )}
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
  loading: {
    marginTop: 20,
  },
  errorBox: {
    borderColor: COR_ERRO,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  errorText: {
    color: COR_ERRO,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 10,
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
});
