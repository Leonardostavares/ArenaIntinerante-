import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { arenas } from '../data/arenas';
import {
  contarParticipantesUnicos,
  totaisPorAtividade,
  type TotalPorAtividade,
} from '../services/checkins';
import { NOTA_MAXIMA, resumoFeedbacks, type ResumoFeedbacks } from '../services/feedback';
import { colors } from '../styles/colors';

/**
 * Painel de acompanhamento da equipe.
 *
 * - Só carrega dados quando `acessoEquipe` é true (liberado após o login da equipe).
 * - Os números vêm do SQLite DESTE aparelho: não representam o total do evento
 *   enquanto os dados não forem sincronizados com um servidor.
 */

const COR_ERRO = '#ff9b9b';
// Notas da maior para a menor, para o gráfico de barras.
const NOTAS = Array.from({ length: NOTA_MAXIMA }, (_, i) => (NOTA_MAXIMA - i) as 1 | 2 | 3 | 4 | 5);

type DadosPainel = {
  participantesUnicos: number;
  atividades: TotalPorAtividade[];
  avaliacoes: ResumoFeedbacks;
};

type LinhaAtividade = {
  estacao: string;
  totalCheckins: number;
  emFila: number;
  concluidos: number;
};

type SecaoArena = {
  chave: string;
  nome: string;
  linhas: LinhaAtividade[];
};

/** Busca todos os indicadores reaproveitando os serviços existentes. */
async function buscarDadosPainel(): Promise<DadosPainel> {
  const [participantesUnicos, atividades, avaliacoes] = await Promise.all([
    contarParticipantesUnicos(),
    totaisPorAtividade(),
    resumoFeedbacks(),
  ]);
  return { participantesUnicos, atividades, avaliacoes };
}

function paraLinha(estacao: string, total?: TotalPorAtividade): LinhaAtividade {
  const totalCheckins = total?.totalCheckins ?? 0;
  const concluidos = total?.concluidos ?? 0;
  return { estacao, totalCheckins, concluidos, emFila: totalCheckins - concluidos };
}

/**
 * Organiza os totais por arena, na ordem de data/arenas.js.
 * Estações sem check-in aparecem zeradas; atividades fora do cadastro
 * (ex.: estação renomeada) vão para "Outras atividades" para nada sumir.
 */
function montarSecoes(atividades: TotalPorAtividade[]): SecaoArena[] {
  const usados = new Set<TotalPorAtividade>();

  const secoes: SecaoArena[] = arenas.map((arena) => ({
    chave: arena.id,
    nome: arena.name,
    linhas: arena.stations.map((estacao) => {
      const total = atividades.find(
        (item) => item.arenaId === arena.id && item.estacao === estacao
      );
      if (total) usados.add(total);
      return paraLinha(estacao, total);
    }),
  }));

  const restantes = atividades.filter((item) => !usados.has(item));
  if (restantes.length > 0) {
    secoes.push({
      chave: '__outras',
      nome: 'Outras atividades',
      linhas: restantes.map((item) => paraLinha(`${item.estacao} (${item.arenaId})`, item)),
    });
  }
  return secoes;
}

function formatarMedia(media: number | null): string {
  return media === null ? '—' : media.toFixed(1).replace('.', ',');
}

function CartaoIndicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={styles.indicador} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Text style={styles.indicadorValor}>{valor}</Text>
      <Text style={styles.indicadorRotulo}>{rotulo}</Text>
    </View>
  );
}

function BarraNota({ nota, quantidade, total }: { nota: number; quantidade: number; total: number }) {
  const percentual = total > 0 ? Math.round((quantidade / total) * 100) : 0;
  return (
    <View
      style={styles.barraLinha}
      accessible
      accessibilityLabel={`${nota} ${nota === 1 ? 'estrela' : 'estrelas'}: ${quantidade}`}
    >
      <Text style={styles.barraRotulo}>{nota} ★</Text>
      <View style={styles.barraTrilho}>
        <View style={[styles.barraPreenchida, { width: `${percentual}%` }]} />
      </View>
      <Text style={styles.barraValor}>{quantidade}</Text>
    </View>
  );
}

export default function PainelScreen() {
  const { acessoEquipe, encerrarAcessoEquipe } = useParticipante();

  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  // Evita duas atualizações ao mesmo tempo.
  const atualizandoRef = useRef(false);

  // Carrega ao abrir a tela e sempre que ela volta a ficar visível.
  // Sem acesso da equipe, NENHUMA consulta é feita.
  // O estado só muda nos retornos assíncronos.
  useFocusEffect(
    useCallback(() => {
      if (!acessoEquipe) return;
      let ativo = true;
      buscarDadosPainel()
        .then((resultado) => {
          if (!ativo) return;
          setDados(resultado);
          setErro(false);
        })
        .catch((falha: unknown) => {
          console.error('[painel] Falha ao carregar os dados:', falha);
          if (ativo) setErro(true);
        });
      return () => {
        ativo = false;
      };
    }, [acessoEquipe])
  );

  // Recarrega sob demanda. `comIndicador` mostra o indicador do "puxar para atualizar".
  const recarregar = useCallback(
    async (comIndicador: boolean) => {
      if (!acessoEquipe || atualizandoRef.current) return;
      atualizandoRef.current = true;
      if (comIndicador) setAtualizando(true);
      try {
        setDados(await buscarDadosPainel());
        setErro(false);
      } catch (falha) {
        console.error('[painel] Falha ao atualizar os dados:', falha);
        setErro(true);
      } finally {
        atualizandoRef.current = false;
        setAtualizando(false);
      }
    },
    [acessoEquipe]
  );

  // "Puxar para atualizar".
  const atualizar = useCallback(() => recarregar(true), [recarregar]);

  // Após erro sem dados: volta ao indicador de carregamento e tenta de novo.
  const tentarNovamente = useCallback(() => {
    setErro(false);
    setDados(null);
    void recarregar(false);
  }, [recarregar]);

  function voltar() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  function sairDoPainel() {
    setDados(null);
    encerrarAcessoEquipe();
    voltar();
  }

  // ---- Sem acesso: não mostra nem consulta dado algum. ----
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

  const secoes = dados ? montarSecoes(dados.atividades) : [];
  const totalCheckins = dados?.atividades.reduce((soma, item) => soma + item.totalCheckins, 0) ?? 0;
  const totalConcluidos = dados?.atividades.reduce((soma, item) => soma + item.concluidos, 0) ?? 0;
  const totalEmFila = totalCheckins - totalConcluidos;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={atualizando}
          onRefresh={atualizar}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Acompanhamento" onBack={voltar} />

      <View style={styles.avisoBox}>
        <Text style={styles.avisoTitulo}>Dados registrados neste aparelho</Text>
        <Text style={styles.avisoTexto}>
          Os números abaixo não incluem check-ins e avaliações feitos em outros celulares.
        </Text>
      </View>

      {!dados && !erro ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : null}

      {erro ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            {dados
              ? 'Não foi possível atualizar. Os dados exibidos podem estar desatualizados.'
              : 'Não foi possível carregar os dados do painel.'}
          </Text>
          <Pressable
            onPress={dados ? atualizar : tentarNovamente}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {dados ? (
        <>
          <Text style={styles.secaoTitulo}>Resumo geral</Text>
          <View style={styles.grade}>
            <CartaoIndicador rotulo="Participantes únicos" valor={String(dados.participantesUnicos)} />
            <CartaoIndicador rotulo="Check-ins" valor={String(totalCheckins)} />
            <CartaoIndicador rotulo="Em fila" valor={String(totalEmFila)} />
            <CartaoIndicador rotulo="Concluídas" valor={String(totalConcluidos)} />
            <CartaoIndicador rotulo="Avaliações" valor={String(dados.avaliacoes.total)} />
            <CartaoIndicador
              rotulo="Média das notas"
              valor={dados.avaliacoes.media === null ? '—' : `${formatarMedia(dados.avaliacoes.media)} ★`}
            />
          </View>

          <Text style={styles.secaoTitulo}>Por arena e estação</Text>
          {totalCheckins === 0 ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>Nenhum check-in registrado neste aparelho ainda.</Text>
            </View>
          ) : (
            secoes.map((secao) => (
              <View key={secao.chave} style={styles.arenaBox}>
                <Text style={styles.arenaNome}>{secao.nome}</Text>
                {secao.linhas.map((linha) => (
                  <View key={linha.estacao} style={styles.estacaoLinha}>
                    <Text style={styles.estacaoNome}>{linha.estacao}</Text>
                    <Text style={styles.estacaoNumeros}>
                      {linha.totalCheckins} check-in{linha.totalCheckins === 1 ? '' : 's'} ·{' '}
                      {linha.emFila} em fila · {linha.concluidos} concluída
                      {linha.concluidos === 1 ? '' : 's'}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}

          <Text style={styles.secaoTitulo}>Distribuição das notas</Text>
          {dados.avaliacoes.total === 0 ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>Nenhuma avaliação registrada neste aparelho ainda.</Text>
            </View>
          ) : (
            <View style={styles.arenaBox}>
              {NOTAS.map((nota) => (
                <BarraNota
                  key={nota}
                  nota={nota}
                  quantidade={dados.avaliacoes.porNota[nota]}
                  total={dados.avaliacoes.total}
                />
              ))}
            </View>
          )}

          <Text style={styles.dica}>Puxe a tela para baixo para atualizar.</Text>
        </>
      ) : null}

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
    marginVertical: 24,
  },
  avisoBox: {
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    padding: 14,
  },
  avisoTitulo: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  avisoTexto: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  secaoTitulo: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 8,
  },
  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  indicador: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 96,
    padding: 14,
  },
  indicadorValor: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '900',
  },
  indicadorRotulo: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  arenaBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 14,
    padding: 16,
  },
  arenaNome: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  estacaoLinha: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  estacaoNome: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  estacaoNumeros: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  barraLinha: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  barraRotulo: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    width: 36,
  },
  barraTrilho: {
    backgroundColor: colors.background,
    borderRadius: 6,
    flex: 1,
    height: 12,
    overflow: 'hidden',
  },
  barraPreenchida: {
    backgroundColor: colors.primary,
    height: '100%',
  },
  barraValor: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    width: 28,
  },
  dica: {
    color: colors.placeholder,
    fontSize: 12,
    marginBottom: 16,
    textAlign: 'center',
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
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  retryButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
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
