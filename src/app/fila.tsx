import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useParticipante } from '../contexts/ParticipanteContext';
import { colors } from '../styles/colors';

export default function FilaScreen() {
  const { nickname, station, queueNumber, resetParticipante } = useParticipante();

  function voltarAoInicio() {
    resetParticipante();
    router.replace('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.queuePanel}>
        <Text style={styles.queueLabel}>CHECK-IN CONFIRMADO</Text>
        <Text style={styles.queueNumber}>{queueNumber}</Text>
        <Text style={styles.queueTitle}>{nickname}, voce entrou na fila!</Text>
        <Text style={styles.helperText}>{station}</Text>
        <View style={styles.positionBox}>
          <Text style={styles.positionLabel}>SUA POSICAO</Text>
          <Text style={styles.positionValue}>3o</Text>
          <Text style={styles.positionHint}>Acompanhe o chamado no monitor da Arena.</Text>
        </View>
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
  positionHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
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
