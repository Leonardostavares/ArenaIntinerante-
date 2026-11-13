import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import {
  ErroPainel,
  FaixaEtaria,
  ResumoAtividade,
  ResumoGeral,
  resumoFaixaEtaria,
  resumoGeral,
  resumoPorAtividade,
} from '../services/painelSupabase';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

function mensagemDeErro(falha: unknown): string {
  if (falha instanceof ErroPainel) return falha.message;
  return 'Não foi possível carregar os indicadores. Tente novamente.';
}

export default function PainelScreen() {
  const { acessoEquipe, encerrarAcessoEquipe } = useParticipante();
  const [geral, setGeral] = useState<ResumoGeral | null>(null);
  const [porAtividade, setPorAtividade] = useState<ResumoAtividade[]>([]);
  const [faixas, setFaixas] = useState<FaixaEtaria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Só a busca em si (sem resetar carregando/erro): usada pelo efeito de
  // montagem, onde o estado inicial já começa como "carregando".
  const buscarIndicadores = useCallback(() => {
    if (!acessoEquipe) return;
    Promise.all([resumoGeral(), resumoPorAtividade(), resumoFaixaEtaria()])
      .then(([resGeral, resAtividade, resFaixas]) => {
        setGeral(resGeral);
        setPorAtividade(resAtividade);
        setFaixas(resFaixas);
      })
      .catch((falha: unknown) => {
        console.error('[painel] Falha ao carregar indicadores:', falha);
        setErro(mensagemDeErro(falha));
      })
      .finally(() => setCarregando(false));
  }, [acessoEquipe]);

  // Usado pelo botão "Tentar novamente": reseta o estado e busca de novo.
  function carregar() {
    setCarregando(true);
    setErro(null);
    buscarIndicadores();
  }

  useEffect(() => {
    buscarIndicadores();
  }, [buscarIndicadores]);

  function voltar() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  function sairDoPainel() {
    encerrarAcessoEquipe();
    voltar();
  }

  if (!acessoEquipe) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Acesso restrito" onBack={voltar} />
        <View style={styles.infoBox} accessibilityRole="alert">
          <Text style={styles.infoText}>
            Esta área é exclusiva da equipe da Arena Itinerante. Entre pela área da equipe para
            ver o painel.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const maiorFaixa = Math.max(1, ...faixas.map((item) => item.total));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Acompanhamento" onBack={voltar} />

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
        <>
          {/* Visão geral */}
          <View style={styles.cardsRow}>
            <View style={styles.card}>
              <Text style={styles.cardValue}>{geral?.totalParticipantes ?? 0}</Text>
              <Text style={styles.cardLabel}>Participantes</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardValue}>{geral?.checkinsNaFila ?? 0}</Text>
              <Text style={styles.cardLabel}>Na fila agora</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardValue}>{geral?.checkinsConcluidos ?? 0}</Text>
              <Text style={styles.cardLabel}>Concluídos</Text>
            </View>
          </View>

          {/* Faixa etária */}
          <Text style={styles.sectionTitle}>Faixa etária</Text>
          {faixas.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum participante com check-in ainda.</Text>
          ) : (
            <View style={styles.chartBox}>
              {faixas.map((item) => (
                <View key={item.faixa} style={styles.barRow}>
                  <Text style={styles.barLabel}>{item.faixa}</Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[styles.barFill, { width: `${(item.total / maiorFaixa) * 100}%` }]}
                    />
                  </View>
                  <Text style={styles.barValue}>{item.total}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Arenas ativas */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Arenas e estações</Text>
            <Pressable onPress={() => router.push('/arena-nova')}>
              <Text style={styles.retryText}>+ Nova arena</Text>
            </Pressable>
          </View>
          {porAtividade.length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma atividade com check-in ainda.</Text>
          ) : (
            porAtividade.map((item) => (
              <View key={`${item.arenaId}-${item.estacao}`} style={styles.activityCard}>
                <Text style={styles.activityTitle}>{item.estacao}</Text>
                <Text style={styles.activitySubtitle}>{item.arenaId}</Text>
                <View style={styles.activityStatsRow}>
                  <Text style={styles.activityStat}>{item.totalCheckins} check-ins</Text>
                  <Text style={styles.activityStat}>{item.participantesUnicos} únicos</Text>
                  <Text style={styles.activityStat}>{item.concluidos} concluídos</Text>
                </View>
              </View>
            ))
          )}
        </>
      )}

      <Pressable
        onPress={sairDoPainel}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryButtonText}>Sair do painel</Text>
      </Pressable>
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
    marginVertical: 20,
  },
  infoBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
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
    marginBottom: 10,
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    flex: 1,
    paddingVertical: 18,
  },
  cardValue: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '900',
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 20,
  },
  chartBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 24,
    padding: 16,
  },
  barRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 10,
  },
  barLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    width: 80,
  },
  barTrack: {
    backgroundColor: colors.background,
    borderRadius: 6,
    flex: 1,
    height: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  barFill: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    height: '100%',
  },
  barValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    width: 24,
    textAlign: 'right',
  },
  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    padding: 16,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  activitySubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  activityStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 10,
  },
  activityStat: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 20,
    padding: 15,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
