import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { Arena, listarArenas } from '../services/arenasSupabase';
import { garantirSessaoAnonima } from '../services/identidadeSupabase';
import { ItemFilaPublica, obterFilaPublica } from '../services/monitorSupabase';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';
const INTERVALO_ATUALIZACAO_MS = 6000;

/**
 * Monitor público da fila (pensado para um tablet/TV fixo na arena).
 * Sem navegação própria: quem configura escolhe a arena e a estação uma
 * vez, e a tela fica nesse modo enquanto estiver ligada.
 *
 * Usa uma sessão anônima própria do aparelho (igual a de um participante)
 * porque o banco exige "authenticated" até para consultar a fila pública.
 */
export default function MonitorScreen() {
  const [sessaoPronta, setSessaoPronta] = useState(false);
  const [erroSessao, setErroSessao] = useState<string | null>(null);

  const [arenas, setArenas] = useState<Arena[]>([]);
  const [carregandoArenas, setCarregandoArenas] = useState(true);
  const [arenaSelecionada, setArenaSelecionada] = useState<Arena | null>(null);
  const [estacaoSelecionada, setEstacaoSelecionada] = useState<string | null>(null);

  const [fila, setFila] = useState<ItemFilaPublica[]>([]);
  const [erroFila, setErroFila] = useState<string | null>(null);
  const primeiraCargaRef = useRef(true);

  useEffect(() => {
    garantirSessaoAnonima()
      .then(() => setSessaoPronta(true))
      .catch((falha: unknown) => {
        console.error('[monitor] Falha ao preparar sessão:', falha);
        setErroSessao('Não foi possível conectar este aparelho. Verifique a internet e recarregue.');
      });
  }, []);

  useEffect(() => {
    if (!sessaoPronta) return;
    listarArenas()
      .then(setArenas)
      .catch((falha: unknown) => {
        console.error('[monitor] Falha ao carregar arenas:', falha);
      })
      .finally(() => setCarregandoArenas(false));
  }, [sessaoPronta]);

  useEffect(() => {
    if (!arenaSelecionada || !estacaoSelecionada) return;

    function atualizar() {
      obterFilaPublica(arenaSelecionada!.id, estacaoSelecionada!)
        .then((valor) => {
          setFila(valor);
          setErroFila(null);
        })
        .catch((falha: unknown) => {
          console.error('[monitor] Falha ao atualizar a fila:', falha);
          if (primeiraCargaRef.current) setErroFila('Não foi possível carregar a fila.');
        })
        .finally(() => {
          primeiraCargaRef.current = false;
        });
    }

    atualizar();
    const intervalo = setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(intervalo);
  }, [arenaSelecionada, estacaoSelecionada]);

  if (erroSessao) {
    return (
      <View style={styles.container}>
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{erroSessao}</Text>
        </View>
      </View>
    );
  }

  if (!sessaoPronta || carregandoArenas) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.text} size="large" />
      </View>
    );
  }

  // Passo 1: escolher arena.
  if (!arenaSelecionada) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader eyebrow="MONITOR" title="Escolha a arena" />
        {arenas.map((arena) => (
          <Card key={arena.id} title={arena.nome} subtitle={arena.local ?? undefined} onPress={() => setArenaSelecionada(arena)} />
        ))}
      </ScrollView>
    );
  }

  // Passo 2: escolher estação.
  if (!estacaoSelecionada) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader eyebrow="MONITOR" title={arenaSelecionada.nome} />
        {arenaSelecionada.estacoes.map((estacao) => (
          <Card key={estacao} title={estacao} onPress={() => setEstacaoSelecionada(estacao)} />
        ))}
      </ScrollView>
    );
  }

  // Passo 3: modo quiosque — exibição contínua da fila.
  const [primeiro, ...resto] = fila;

  return (
    <View style={styles.kioskContainer}>
      <Text style={styles.kioskEyebrow}>{arenaSelecionada.nome.toUpperCase()}</Text>
      <Text style={styles.kioskTitle}>{estacaoSelecionada}</Text>

      {erroFila ? <Text style={styles.errorTextKiosk}>{erroFila}</Text> : null}

      {primeiro ? (
        <View style={styles.nowPlayingBox}>
          <Text style={styles.nowPlayingLabel}>PRÓXIMO A JOGAR</Text>
          <Text style={styles.nowPlayingName}>{primeiro.apelido}</Text>
        </View>
      ) : (
        <View style={styles.nowPlayingBox}>
          <Text style={styles.nowPlayingLabel}>FILA VAZIA</Text>
        </View>
      )}

      {resto.length > 0 ? (
        <View style={styles.queueList}>
          <Text style={styles.queueListTitle}>AGUARDANDO</Text>
          {resto.map((item) => (
            <View key={item.posicao} style={styles.queueRow}>
              <Text style={styles.queuePosition}>{item.posicao}º</Text>
              <Text style={styles.queueName}>{item.apelido}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 48,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  errorBox: {
    borderColor: COR_ERRO,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  errorText: {
    color: COR_ERRO,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  kioskContainer: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 32,
    paddingTop: 56,
  },
  kioskEyebrow: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  kioskTitle: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 32,
    textAlign: 'center',
  },
  errorTextKiosk: {
    color: COR_ERRO,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  nowPlayingBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 24,
    borderWidth: 2,
    marginBottom: 40,
    paddingVertical: 48,
  },
  nowPlayingLabel: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  nowPlayingName: {
    color: colors.text,
    fontSize: 56,
    fontWeight: '900',
  },
  queueList: {
    flex: 1,
  },
  queueListTitle: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  queueRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  queuePosition: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
    width: 64,
  },
  queueName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
});
