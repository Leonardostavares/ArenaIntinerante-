import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles/colors';

export default function PortalScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ARENA ITINERANTE</Text>
        <Text style={styles.title}>Bem-vindo!</Text>
        <Text style={styles.subtitle}>Quem esta acessando agora?</Text>
      </View>

      <Pressable
        onPress={() => router.push('/arenas')}
        style={({ pressed }) => [styles.participanteButton, pressed && styles.pressed]}
      >
        <Text style={styles.participanteEmoji}>🎮</Text>
        <Text style={styles.participanteText}>Sou participante</Text>
        <Text style={styles.participanteHint}>Fazer check-in e entrar na fila</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/staff')}
        style={({ pressed }) => [styles.staffButton, pressed && styles.pressed]}
      >
        <Text style={styles.staffText}>🔑 Sou da equipe</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  header: {
    marginBottom: 48,
    alignItems: 'center',
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    marginTop: 8,
  },
  participanteButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 28,
    marginBottom: 16,
  },
  participanteEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  participanteText: {
    color: colors.primaryText,
    fontSize: 20,
    fontWeight: '800',
  },
  participanteHint: {
    color: colors.primaryText,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  staffButton: {
    alignItems: 'center',
    borderColor: colors.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  staffText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
