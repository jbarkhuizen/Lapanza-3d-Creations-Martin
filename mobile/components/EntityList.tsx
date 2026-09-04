import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { FlatList, View } from 'react-native';

import { spacing } from '../lib/theme';
import { EmptyState, ErrorState, LoadingState } from './UI';

type EntityListProps<T> = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T[]>;
  renderItem: (item: T) => React.ReactElement;
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
  header?: React.ReactElement;
};

// Shared list-fetch-render pattern used by every "list of records" admin
// section screen (Orders, Clients, Products, ...) so each screen file only
// has to declare its endpoint, row rendering, and key — not re-implement
// loading/empty/error/pull-to-refresh handling.
export function EntityList<T>({
  queryKey,
  queryFn,
  renderItem,
  keyExtractor,
  emptyMessage = 'Nothing here yet.',
  header,
}: EntityListProps<T>) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={(error as Error)?.message || 'Failed to load.'} onRetry={() => refetch()} />;

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState message={emptyMessage} />}
      onRefresh={refetch}
      refreshing={isRefetching}
    />
  );
}
