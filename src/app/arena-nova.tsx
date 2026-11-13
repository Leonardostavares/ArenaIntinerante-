import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useParticipante } from '../contexts/ParticipanteContext';
import { criarArena, ErroPainel } from '../services/arenasSupabase';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

function mensagemDeErro(falha: unknown): string {
  if (falha instanceof ErroPainel) return falha.message;
  return 'Não foi possível criar a arena. Tente novamente.';
}

export default function ArenaNovaScreen() {
  const { acessoEquipe } = useParticipante();
  const [nome, setNome] = useState('');
  const [local, setLocal] = useState('');
  const [estacoesTexto, setEstacoesTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const estacoes = estacoesTexto
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const podeSalvar = Boolean(nome.trim() && local.trim() && estacoes.length > 0) && !salvando;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    try {
      await criarArena({ nome: nome.trim(), local: local.trim(), estacoes });
      router.back();
    } catch (falha) {
      console.error('[arena-nova] Falha ao criar arena:', falha);
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  if (!acessoEquipe) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Acesso restrito" onBack={() => router.back()} />
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>Esta área é exclusiva da equipe.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader eyebrow="PAINEL DA EQUIPE" title="Nova arena" onBack={() => router.back()} />
      <Text style={styles.helperText}>
        Cadastre uma nova arena e as estações disponíveis nela.
      </Text>

      <Text style={styles.label}>Nome da arena</Text>
      <TextInput
        value={nome}
        onChangeText={setNome}
        placeholder="Ex.: Arena Caxias"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        editable={!salvando}
      />

      <Text style={styles.label}>Local</Text>
      <TextInput
        value={local}
        onChangeText={setLocal}
        placeholder="Ex.: Praça Central"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        editable={!salvando}
      />

      <Text style={styles.label}>Estações (separadas por vírgula)</Text>
      <TextInput
        value={estacoesTexto}
        onChangeText={setEstacoesTexto}
        placeholder="Ex.: FIFA 24, Just Dance, Mortal Kombat"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        editable={!salvando}
        multiline
      />

      {erro ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{erro}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={salvar}
        disabled={!podeSalvar}
        style={({ pressed }) => [
          styles.primaryButton,
          !podeSalvar && styles.disabled,
          pressed && podeSalvar && styles.pressed,
        ]}
      >
        {salvando ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.primaryButtonText}>Criar arena</Text>
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
