import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useParticipante } from '../contexts/ParticipanteContext';
import { listarMeusCheckins } from '../services/checkins';
import { obterMeuApelido } from '../services/identidadeSupabase';
import { colors } from '../styles/colors';

type FilaAtiva = { checkinId: string; arenaId: string; estacao: string };

export default function PortalScreen() {
  const { retomarFila, participanteId } = useParticipante();
  const [filasAtivas, setFilasAtivas] = useState<FilaAtiva[]>([]);
  const [apelido, setApelido] = useState('');

  // Sempre que a tela inicial aparece, procura check-ins que continuam na
  // fila no Supabase, para o participante poder voltar a ver a posição.
  // Sem sessão, ou em caso de falha, simplesmente não mostra o atalho.
  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      if (!participanteId) {
        setFilasAtivas([]);
        return;
      }
      Promise.all([listarMeusCheckins(), obterMeuApelido()])
        .then(([checkins, nome]) => {
          if (!ativo) return;
          setApelido(nome ?? '');
          setFilasAtivas(
            checkins
              .filter((c) => c.status === 'na_fila')
              .map((c) => ({ checkinId: c.id, arenaId: c.arenaId, estacao: c.estacao }))
          );
        })
        .catch((falha: unknown) => {
          console.warn('[inicio] Não foi possível buscar suas filas ativas:', falha);
          if (ativo) setFilasAtivas([]);
        });
      return () => {
        ativo = false;
      };
    }, [participanteId])
  );

  function abrirFila(fila: FilaAtiva) {
    retomarFila({ ...fila, apelido: apelido || 'Participante' });
    router.push('/fila');
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ARENA</Text>
        <Text style={styles.title}>Bem-vindo!</Text>
        <Text style={styles.subtitle}>Quem esta acessando agora?</Text>
      </View>

      {filasAtivas.map((fila) => (
        <Pressable
          key={fila.checkinId}
          onPress={() => abrirFila(fila)}
          style={({ pressed }) => [styles.filaAtivaButton, pressed && styles.pressed]}
        >
          <Text style={styles.filaAtivaText}>⏳ Ver minha fila</Text>
          <Text style={styles.filaAtivaHint}>{fila.estacao}</Text>
        </Pressable>
      ))}

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

      <Pressable
        onPress={() => router.push('/monitor')}
        style={({ pressed }) => [styles.monitorLink, pressed && styles.pressed]}
      >
        <Text style={styles.monitorLinkText}>Configurar monitor da arena</Text>
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
  filaAtivaButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 16,
    borderWidth: 2,
    padding: 18,
    marginBottom: 16,
  },
  filaAtivaText: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '800',
  },
  filaAtivaHint: {
    color: colors.textMuted,
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
  monitorLink: {
    alignItems: 'center',
    marginTop: 20,
    padding: 8,
  },
  monitorLinkText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
});
