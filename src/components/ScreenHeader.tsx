import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles/colors';

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
};

export function ScreenHeader({ eyebrow, title, subtitle, onBack }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>Voltar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 30,
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
    lineHeight: 39,
    maxWidth: 350,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12,
    maxWidth: 340,
  },
  backButton: {
    marginTop: 20,
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});
