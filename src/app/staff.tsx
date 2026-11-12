import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { entrarComoEquipe, ErroEquipe } from '../services/equipeSupabase';
import { colors } from '../styles/colors';

export default function StaffScreen() {
  const { liberarAcessoEquipe } = useParticipante();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeEntrar = Boolean(email.trim() && senha.trim()) && !entrando;

  async function handleLogin() {
    if (!podeEntrar) return;
    setErro(null);
    setEntrando(true);
    try {
      await entrarComoEquipe(email.trim(), senha);
      liberarAcessoEquipe();
      router.replace('/painel');
    } catch (e) {
      setErro(e instanceof ErroEquipe ? e.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setEntrando(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        eyebrow="AREA DA EQUIPE"
        title="Login da equipe"
        onBack={() => router.back()}
      />
      <Text style={styles.helperText}>
        Entre com seu e-mail e senha para acessar o painel de gerenciamento da fila.
      </Text>

      <Text style={styles.label}>E-mail</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="equipe@levelup.com"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!entrando}
      />

      <Text style={styles.label}>Senha</Text>
      <TextInput
        value={senha}
        onChangeText={setSenha}
        placeholder="Digite sua senha"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        secureTextEntry
        editable={!entrando}
      />

      {erro ? <Text style={styles.errorText}>{erro}</Text> : null}

      <Pressable
        onPress={handleLogin}
        disabled={!podeEntrar}
        style={({ pressed }) => [
          styles.primaryButton,
          !podeEntrar && styles.disabled,
          pressed && podeEntrar && styles.pressed,
        ]}
      >
        {entrando ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.primaryButtonText}>Entrar</Text>
        )}
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
  errorText: {
    color: '#ff8080',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 16,
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
