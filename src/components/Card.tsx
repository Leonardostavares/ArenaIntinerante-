import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../styles/colors';

type CardProps = {
  title: string;
  subtitle?: string;
  linkLabel?: string;
  onPress: () => void;
};

export function Card({ title, subtitle, linkLabel, onPress }: CardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {linkLabel ? <Text style={styles.link}>{linkLabel}  {'>'}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 20,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 18,
  },
  pressed: {
    opacity: 0.75,
  },
});
