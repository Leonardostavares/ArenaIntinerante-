import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { obterCheckin } from '../services/checkins';
import {
  COMENTARIO_MAXIMO,
  ErroFeedback,
  NOTA_MAXIMA,
  obterFeedbackDoCheckin,
  salvarFeedback,
} from '../services/feedback';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';
const ESTRELAS = Array.from({ length: NOTA_MAXIMA }, (_, i) => i + 1);
const ROTULOS_NOTA: Record<number, string> = {
  1: 'Ruim',
  2: 'Regular',
  3: 'Boa',
  4: 'Muito boa',
  5: 'Excelente',
};

type Situacao = 'carregando' | 'pronta' | 'nao_concluida' | 'sem_checkin' | 'erro';

function mensagemDeErro(falha: unknown): string {
  if (falha instanceof ErroFeedback && falha.codigo !== 'banco') {
    return falha.message;
  }
  return 'Não foi possível salvar sua avaliação. Tente novamente.';
}

export default function FeedbackScreen() {
  const { checkinAtualId, station } = useParticipante();

  const [situacao, setSituacao] = useState<Situacao>(
    checkinAtualId ? 'carregando' : 'sem_checkin'
  );
  const [tentativa, setTentativa] = useState(0);
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [jaAvaliada, setJaAvaliada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<string | null>(null);
  // Trava imediata contra toques repetidos no botão de enviar.
  const salvandoRef = useRef(false);

  // Carrega o status da atividade e a avaliação existente (se houver).
  // O estado só muda nos retornos assíncronos.
  useEffect(() => {
    if (!checkinAtualId) return;
    let ativo = true;

    Promise.all([obterCheckin(checkinAtualId), obterFeedbackDoCheckin(checkinAtualId)])
      .then(([checkin, feedback]) => {
        if (!ativo) return;
        if (!checkin) {
          setSituacao('sem_checkin');
          return;
        }
        if (checkin.status !== 'concluido') {
          setSituacao('nao_concluida');
          return;
        }
        if (feedback) {
          setNota(feedback.nota);
          setComentario(feedback.comentario ?? '');
          setJaAvaliada(true);
        }
        setSituacao('pronta');
      })
      .catch((falha: unknown) => {
        console.error('[feedback] Falha ao carregar a avaliação:', falha);
        if (ativo) setSituacao('erro');
      });

    return () => {
      ativo = false;
    };
  }, [checkinAtualId, tentativa]);

  const tentarCarregarDeNovo = useCallback(() => {
    setSituacao('carregando');
    setTentativa((valor) => valor + 1);
  }, []);

  function escolherNota(valor: number) {
    if (salvando) return;
    setNota(valor);
    setErro(null);
    setConfirmacao(null);
  }

  function alterarComentario(texto: string) {
    setComentario(texto);
    setErro(null);
    setConfirmacao(null);
  }

  async function enviar() {
    if (!checkinAtualId || nota < 1 || salvandoRef.current) return;

    salvandoRef.current = true;
    setSalvando(true);
    setErro(null);
    setConfirmacao(null);

    try {
      const { novo } = await salvarFeedback({ checkinId: checkinAtualId, nota, comentario });
      setJaAvaliada(true);
      setConfirmacao(novo ? 'Avaliação enviada! Obrigado.' : 'Avaliação atualizada!');
    } catch (falha) {
      if (!(falha instanceof ErroFeedback) || falha.codigo === 'banco') {
        console.error('[feedback] Falha ao salvar a avaliação:', falha);
      }
      // Nota e comentário digitados são mantidos para tentar de novo.
      setErro(mensagemDeErro(falha));
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  const caracteres = [...comentario].length;
  const podeEnviar = situacao === 'pronta' && nota >= 1 && !salvando;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        eyebrow="ARENA ITINERANTE"
        title="Avalie sua experiência"
        subtitle={station ? `Atividade: ${station}` : undefined}
        onBack={() => router.back()}
      />

      {situacao === 'carregando' ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : null}

      {situacao === 'sem_checkin' ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Atividade não encontrada. Volte e escolha a estação novamente.
          </Text>
        </View>
      ) : null}

      {situacao === 'nao_concluida' ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Conclua a atividade antes de avaliá-la. Toque em &quot;Concluí a atividade&quot; na
            tela da fila.
          </Text>
        </View>
      ) : null}

      {situacao === 'erro' ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>Não foi possível carregar a avaliação.</Text>
          <Pressable
            onPress={tentarCarregarDeNovo}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {situacao === 'pronta' ? (
        <>
          <Text style={styles.label}>Sua nota</Text>
          <View style={styles.starsRow} accessibilityRole="radiogroup">
            {ESTRELAS.map((valor) => {
              const ativa = valor <= nota;
              return (
                <Pressable
                  key={valor}
                  onPress={() => escolherNota(valor)}
                  disabled={salvando}
                  hitSlop={6}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: valor === nota, disabled: salvando }}
                  accessibilityLabel={`${valor} ${valor === 1 ? 'estrela' : 'estrelas'}`}
                  style={({ pressed }) => [styles.star, pressed && styles.pressed]}
                >
                  <Text style={[styles.starText, ativa && styles.starTextActive]}>
                    {ativa ? '★' : '☆'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.notaHint}>
            {nota >= 1 ? ROTULOS_NOTA[nota] : 'Toque nas estrelas para dar sua nota'}
          </Text>

          <Text style={styles.label}>Comentário (opcional)</Text>
          <TextInput
            value={comentario}
            onChangeText={alterarComentario}
            placeholder="Conte como foi a sua experiência"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            multiline
            maxLength={COMENTARIO_MAXIMO}
            editable={!salvando}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>
            {caracteres}/{COMENTARIO_MAXIMO}
          </Text>

          {erro ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{erro}</Text>
            </View>
          ) : null}

          {confirmacao ? (
            <View style={styles.successBox} accessibilityRole="summary">
              <Text style={styles.successTitle}>✓ {confirmacao}</Text>
              <Text style={styles.successText}>Você pode editar e enviar novamente.</Text>
            </View>
          ) : null}

          <Pressable
            onPress={enviar}
            disabled={!podeEnviar}
            accessibilityState={{ disabled: !podeEnviar, busy: salvando }}
            style={({ pressed }) => [
              styles.primaryButton,
              !podeEnviar && styles.disabled,
              pressed && podeEnviar && styles.pressed,
            ]}
          >
            {salvando ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator color={colors.primaryText} />
                <Text style={styles.primaryButtonText}>Enviando...</Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>
                {jaAvaliada ? 'Atualizar avaliação' : 'Enviar avaliação'}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}
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
    marginTop: 24,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  star: {
    padding: 4,
  },
  starText: {
    color: colors.borderLight,
    fontSize: 40,
  },
  starTextActive: {
    color: colors.primary,
  },
  notaHint: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 120,
    padding: 16,
  },
  counter: {
    alignSelf: 'flex-end',
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 18,
    marginTop: 6,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
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
  pressed: {
    opacity: 0.75,
  },
  infoBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  successBox: {
    borderColor: colors.success,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  successTitle: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '800',
  },
  successText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  errorBox: {
    borderColor: COR_ERRO,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
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
});
