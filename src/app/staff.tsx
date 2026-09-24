import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors } from '../styles/colors';

export default function StaffScreen() {
  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="AREA DA EQUIPE"
        title="Login da equipe"
        onBack={() => router.back()}
      />
      <Text style={styles.helperText}>
        Aqui vai entrar o login por senha da estacao e o painel de gerenciamento da fila
        (chamar proximo, marcar presenca, mover ausentes para o fim da fila).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 36,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
});
