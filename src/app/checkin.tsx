import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
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
import { arenas } from '../data/arenas';
import { salvarDadosParticipante } from '../services/participante';
import { colors } from '../styles/colors';

const COR_ERRO = '#ff9b9b';

// Erros de validação de salvarDadosParticipante() já vêm em português e podem ser
// mostrados ao participante; os demais (banco, disco) recebem uma mensagem genérica.
const ERRO_DE_VALIDACAO = /^(Informe|Idade inválida)/;

function ehErroDeValidacao(erro: unknown): erro is Error {
  return erro instanceof Error && ERRO_DE_VALIDACAO.test(erro.message);
}

// Erros do backend Supabase, identificados pelo nome para NÃO importar o
// módulo do Supabase nesta tela (no modo local ele nunca é carregado).
type ErroComCodigo = Error & { codigo?: string };

function ehErroDeIdentidade(erro: unknown): erro is ErroComCodigo {
  return erro instanceof Error && erro.name === 'ErroIdentidade';
}

function ehErroDeConfiguracao(erro: unknown): erro is Error {
  return erro instanceof Error && erro.name === 'ErroConfiguracaoSupabase';
}

/** Falhas esperadas (sem conexão, limite de tentativas) não vão para o console. */
function ehFalhaEsperada(erro: unknown): boolean {
  if (ehErroDeValidacao(erro)) return true;
  return ehErroDeIdentidade(erro) && (erro.codigo === 'rede' || erro.codigo === 'limite');
}

function mensagemDeErro(erro: unknown): string {
  if (ehErroDeValidacao(erro)) {
    return erro.message;
  }
  if (ehErroDeIdentidade(erro)) {
    // Mensagens de ErroIdentidade já são seguras para exibir (sem conexão,
    // muitas tentativas, acesso indisponível etc.).
    return erro.message;
  }
  if (ehErroDeConfiguracao(erro)) {
    return 'O cadastro está indisponível no momento. Avise a equipe do evento.';
  }
  return 'Não foi possível salvar seus dados. Tente novamente.';
}

export default function CheckinScreen() {
  const { arenaId } = useLocalSearchParams<{ arenaId: string }>();
  const arena = arenas.find((item) => item.id === arenaId);
  const {
    checkin,
    prontoParaCadastro,
    carregandoParticipante,
    erroParticipante,
    recarregarParticipanteId,
  } = useParticipante();
  const [nickname, setNickname] = useState('');
  const [cidade, setCidade] = useState('');
  const [idade, setIdade] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  // Trava imediata contra toques duplos (o estado só atualiza na próxima renderização).
  const salvandoRef = useRef(false);

  const camposPreenchidos = Boolean(nickname.trim() && cidade.trim() && idade.trim() && arena);
  // Modo local: exige o UUID do aparelho já carregado (comportamento original).
  // Modo supabase: basta a inicialização concluída; a identidade é criada ao confirmar.
  const podeContinuar = camposPreenchidos && prontoParaCadastro && !salvando;

  function alterarCampo(setter: (valor: string) => void) {
    return (valor: string) => {
      setter(valor);
      if (erroSalvar) setErroSalvar(null);
    };
  }

  async function finishCheckin() {
    if (!podeContinuar || !arena || salvandoRef.current) return;

    salvandoRef.current = true;
    setSalvando(true);
    setErroSalvar(null);

    const dados = { nickname: nickname.trim(), cidade: cidade.trim(), idade: idade.trim() };

    try {
      // Grava só depois do toque em "Continuar" (ação do participante):
      // no SQLite (modo local) ou no Supabase, com login anônimo sob demanda.
      await salvarDadosParticipante({
        apelido: dados.nickname,
        cidade: dados.cidade,
        idade: dados.idade,
      });
    } catch (erro) {
      // Erros de validação e falhas esperadas (sem conexão, limite) já aparecem
      // na tela; só falhas técnicas vão para o console.
      if (!ehFalhaEsperada(erro)) {
        console.error('[checkin] Falha ao salvar dados do participante:', erro);
      }
      setErroSalvar(mensagemDeErro(erro));
      return; // Não avança se o salvamento falhar.
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }

    checkin(arena.id, dados);
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
        onChangeText={alterarCampo(setNickname)}
        editable={!salvando}
        placeholder="Ex.: Davi"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={20}
      />

      <Text style={styles.label}>Sua cidade</Text>
      <TextInput
        value={cidade}
        onChangeText={alterarCampo(setCidade)}
        editable={!salvando}
        placeholder="Ex.: Sao Luis"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={40}
      />

      <Text style={styles.label}>Sua idade</Text>
      <TextInput
        value={idade}
        onChangeText={alterarCampo(setIdade)}
        editable={!salvando}
        placeholder="Ex.: 17"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        keyboardType="number-pad"
        maxLength={3}
      />

      {erroParticipante ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            Não foi possível preparar sua identificação neste aparelho.
          </Text>
          <Pressable
            onPress={recarregarParticipanteId}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}

      {erroSalvar ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{erroSalvar}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={finishCheckin}
        disabled={!podeContinuar}
        accessibilityState={{ disabled: !podeContinuar, busy: salvando }}
        style={({ pressed }) => [
          styles.primaryButton,
          !podeContinuar && styles.disabled,
          pressed && podeContinuar && styles.pressed,
        ]}
      >
        {salvando ? (
          <View style={styles.buttonContent}>
            <ActivityIndicator color={colors.primaryText} />
            <Text style={styles.primaryButtonText}>Salvando...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>
            {carregandoParticipante ? 'Preparando...' : 'Continuar'}
          </Text>
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
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.75,
  },
});
