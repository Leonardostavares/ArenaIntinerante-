import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { SafeAreaView, StyleSheet } from 'react-native';
import { ParticipanteProvider } from '../contexts/ParticipanteContext';
import { colors } from '../styles/colors';

export default function RootLayout() {
  return (
    <ParticipanteProvider>
      <SafeAreaView style={styles.safeArea}>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="light" />
      </SafeAreaView>
    </ParticipanteProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
