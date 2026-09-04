import { Stack, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Testimonial } from '../../../lib/types';

export default function TestimonialsScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Testimonials',
          headerRight: () => (
            <Pressable onPress={() => router.push('/testimonials/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <EntityList<Testimonial>
        queryKey={['testimonials']}
        queryFn={() => api.get<{ testimonials: Testimonial[] }>('/api/testimonials').then((r) => r.testimonials)}
        keyExtractor={(t) => t.id}
        emptyMessage="No testimonials yet."
        renderItem={(testimonial) => (
          <Pressable
            onPress={() => router.push(`/testimonials/${testimonial.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{testimonial.displayName}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={2}>
                {testimonial.quote}
              </Text>
            </View>
            <Badge tone={testimonial.status === 'published' ? 'ok' : 'warn'}>{testimonial.status}</Badge>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
});
