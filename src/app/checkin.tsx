import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { arenas } from '../data/arenas';
import { colors } from '../styles/colors';

export default function CheckinScreen() {
  const { arenaId } = useLocalSearchParams<{ arenaId: string }>();
  const arena = arenas.find((item) => item.id === arenaId);
  const { checkin } = useParticipante();
  const [nickname, setNickname] = useState('');
  const [cidade, setCidade] = useState('');
  const [idade, setIdade] = useState('');

  const podeContinuar = nickname.trim() && cidade.trim() && idade.trim() && arena;

  function finishCheckin() {
    if (!podeContinuar || !arena) return;
    checkin(arena.id, { nickname: nickname.trim(), cidade: cidade.trim(), idade: idade.trim() });
    router.push('/estacoes');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="ARENA ITINERANTE"
        title="Check-in rapido"
        onBack={() => router.back()}
      />
      <Text style={styles.helperText}>
        Voce esta entrando na {arena?.name}. Preencha seus dados para participar.
      </Text>

      <Text style={styles.label}>Seu apelido</Text>
      <TextInput
        value={nickname}
        onChangeText={setNickname}
        placeholder="Ex.: Davi"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={20}
      />

      <Text style={styles.label}>Sua cidade</Text>
      <TextInput
        value={cidade}
        onChangeText={setCidade}
        placeholder="Ex.: Sao Luis"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={40}
      />

      <Text style={styles.label}>Sua idade</Text>
      <TextInput
        value={idade}
        onChangeText={setIdade}
        placeholder="Ex.: 17"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        keyboardType="number-pad"
        maxLength={3}
      />

      <Pressable
        onPress={finishCheckin}
        disabled={!podeContinuar}
        style={({ pressed }) => [
          styles.primaryButton,
          !podeContinuar && styles.disabled,
          pressed && podeContinuar && styles.pressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>Continuar</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 36,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    marginBottom: 18,
    padding: 16,
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
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.75,
  },
});
