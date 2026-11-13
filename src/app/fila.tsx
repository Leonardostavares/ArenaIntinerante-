import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useParticipante } from '../contexts/ParticipanteContext';
import { concluirCheckin, ErroCheckin, obterCheckin, obterPosicaoNaFila } from '../services/checkins';
import { obterFeedbackDoCheckin } from '../services/feedback';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

function mensagemDeErro(falha: unknown): string {
  if (falha instanceof ErroCheckin && falha.codigo !== 'banco') {
    return falha.message;
  }
  return 'Não foi possível registrar a conclusão. Tente novamente.';
}

export default function FilaScreen() {
  const { nickname, station, queueNumber, checkinAtualId, resetParticipante } = useParticipante();
  // Check-in atual já concluído? (pode já estar, se a pessoa voltou a uma estação concluída)
  const [concluida, setConcluida] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // true enquanto a tela está sendo fechada por "Voltar ao início".
  const [saindo, setSaindo] = useState(false);
  // Trava imediata contra toques repetidos.
  const concluindoRef = useRef(false);
  // A atividade já tem avaliação? (null enquanto não se sabe)
  const [temAvaliacao, setTemAvaliacao] = useState<boolean | null>(null);
  // Evita abrir a tela de avaliação duas vezes com toques rápidos.
  const navegandoRef = useRef(false);
  // Posição na fila (null enquanto não se sabe); 0 quando já concluído.
  const [posicao, setPosicao] = useState<number | null>(null);

  // Sempre que a tela volta a ficar visível (ex.: ao retornar da avaliação),
  // libera a navegação e relê se já existe avaliação para esta atividade.
  useFocusEffect(
    useCallback(() => {
      navegandoRef.current = false;
      if (!checkinAtualId || !concluida) return;
      let ativo = true;
      obterFeedbackDoCheckin(checkinAtualId)
        .then((feedback) => {
          if (ativo) setTemAvaliacao(Boolean(feedback));
        })
        .catch((falha: unknown) => {
          // Sem a informação, o botão continua funcionando como "Avaliar atividade".
          console.error('[fila] Falha ao consultar a avaliação:', falha);
          if (ativo) setTemAvaliacao(false);
        });
      return () => {
        ativo = false;
      };
    }, [checkinAtualId, concluida])
  );

  function abrirAvaliacao() {
    // Só abre para atividade concluída e uma vez por toque.
    if (!checkinAtualId || !concluida || navegandoRef.current) return;
    navegandoRef.current = true;
    router.push('/feedback');
  }

  // Só LÊ o status salvo; nunca conclui nada automaticamente.
  useEffect(() => {
    if (!checkinAtualId) return;
    let ativo = true;
    obterCheckin(checkinAtualId)
      .then((registro) => {
        if (ativo) setConcluida(registro?.status === 'concluido');
      })
      .catch((falha: unknown) => {
        console.error('[fila] Falha ao consultar o check-in:', falha);
      });
    return () => {
      ativo = false;
    };
  }, [checkinAtualId]);

  // Posição na fila: lê ao entrar e atualiza a cada poucos segundos
  // enquanto a atividade não for concluída (outros participantes podem
  // ser atendidos e a posição muda sem nenhuma ação deste aparelho).
  useEffect(() => {
    if (!checkinAtualId || concluida) return;
    let ativo = true;

    function atualizar() {
      obterPosicaoNaFila(checkinAtualId!)
        .then((valor) => {
          if (ativo) setPosicao(valor);
        })
        .catch((falha: unknown) => {
          console.error('[fila] Falha ao consultar a posição:', falha);
        });
    }

    atualizar();
    const intervalo = setInterval(atualizar, 8000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [checkinAtualId, concluida]);

  async function concluirAtividade() {
    if (!checkinAtualId || concluida || concluindoRef.current) return;

    concluindoRef.current = true;
    setConcluindo(true);
    setErro(null);

    try {
      // Só confirma na tela depois que o SQLite foi atualizado.
      const registro = await concluirCheckin(checkinAtualId);
      setConcluida(registro.status === 'concluido');
    } catch (falha) {
      if (!(falha instanceof ErroCheckin) || falha.codigo === 'banco') {
        console.error('[fila] Falha ao concluir a atividade:', falha);
      }
      setErro(mensagemDeErro(falha));
    } finally {
      concluindoRef.current = false;
      setConcluindo(false);
    }
  }

  function voltarAoInicio() {
    // Esconde o aviso "Check-in não encontrado" durante a troca de tela:
    // resetParticipante() limpa o check-in um instante antes da navegação.
    setSaindo(true);
    resetParticipante();
    router.replace('/');
  }

  const podeConcluir = Boolean(checkinAtualId) && !concluida && !concluindo;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.queuePanel}>
        <Text style={styles.queueLabel}>CHECK-IN CONFIRMADO</Text>
        <Text style={styles.queueNumber}>{queueNumber}</Text>
        <Text style={styles.queueTitle}>{nickname}, voce entrou na fila!</Text>
        <Text style={styles.helperText}>{station}</Text>
        {!concluida ? (
          <View style={styles.positionBox}>
            <Text style={styles.positionLabel}>SUA POSICAO</Text>
            {posicao === null ? (
              <ActivityIndicator color={colors.text} style={styles.positionLoading} />
            ) : (
              <Text style={styles.positionValue}>{posicao}o</Text>
            )}
            <Text style={styles.positionHint}>Acompanhe o chamado no monitor da Arena.</Text>
          </View>
        ) : null}

        {concluida ? (
          <>
            <View style={styles.successBox} accessibilityRole="summary">
              <Text style={styles.successTitle}>✓ Atividade concluída!</Text>
              <Text style={styles.successText}>Obrigado por participar de {station}.</Text>
            </View>
            <Pressable
              onPress={abrirAvaliacao}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>
                {temAvaliacao ? 'Ver/editar avaliação' : 'Avaliar atividade'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {erro ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{erro}</Text>
              </View>
            ) : null}
            {!checkinAtualId && !saindo ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>
                  Check-in não encontrado. Volte e escolha a estação novamente.
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={concluirAtividade}
              disabled={!podeConcluir}
              accessibilityState={{ disabled: !podeConcluir, busy: concluindo }}
              style={({ pressed }) => [
                styles.primaryButton,
                !podeConcluir && styles.disabled,
                pressed && podeConcluir && styles.pressed,
              ]}
            >
              {concluindo ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator color={colors.primaryText} />
                  <Text style={styles.primaryButtonText}>Registrando...</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>Concluí a atividade</Text>
              )}
            </Pressable>
          </>
        )}

        <Pressable
          onPress={voltarAoInicio}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Voltar ao inicio</Text>
        </Pressable>
      </View>
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
  queuePanel: {
    alignItems: 'center',
  },
  queueLabel: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  queueNumber: {
    color: colors.primary,
    fontSize: 68,
    fontWeight: '900',
    marginVertical: 14,
  },
  queueTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  positionBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 20,
    marginTop: 20,
    padding: 22,
    width: '100%',
  },
  positionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  positionValue: {
    color: colors.text,
    fontSize: 42,
    fontWeight: '900',
    marginVertical: 6,
  },
  positionLoading: {
    marginVertical: 20,
  },
  positionHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
    width: '100%',
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontSize: 16,
    fontWeight: '800',
  },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  disabled: {
    opacity: 0.4,
  },
  successBox: {
    alignItems: 'center',
    borderColor: colors.success,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
    width: '100%',
  },
  successTitle: {
    color: colors.success,
    fontSize: 18,
    fontWeight: '800',
  },
  successText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  errorBox: {
    borderColor: COR_ERRO,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
    width: '100%',
  },
  errorText: {
    color: COR_ERRO,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  secondaryButton: {
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    padding: 15,
    width: '100%',
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
