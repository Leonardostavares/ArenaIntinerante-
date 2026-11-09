import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { colors } from '../styles/colors';

/**
 * Painel de acompanhamento da equipe.
 *
 * - Só é exibido quando `acessoEquipe` é true (liberado após o login da equipe).
 * - Os indicadores gerais do evento virão de resumo_painel() no Supabase
 *   (etapa S3 / M6). Até lá, o painel NÃO consulta indicadores: pelo RLS,
 *   qualquer consulta devolveria só os dados do próprio usuário, e não os
 *   totais do evento.
 */

export default function PainelScreen() {
  const { acessoEquipe, encerrarAcessoEquipe } = useParticipante();

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

  // ---- Sem acesso: não mostra dado algum. ----
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

  // ---- Com acesso: indicadores gerais ainda indisponíveis (etapa S3). ----
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Acompanhamento" onBack={voltar} />
      <View style={styles.infoBox} accessibilityRole="alert">
        <Text style={styles.infoText}>
          Os indicadores gerais do evento estarão disponíveis após a configuração do servidor
          (etapa S3).
        </Text>
      </View>
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
