import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton, TextField } from '../components/UI';
import { ApiError, getApiBaseUrl, setApiBaseUrl } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { fontFamily, spacing } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

export default function LoginScreen() {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  useEffect(() => {
    getApiBaseUrl().then(setServerUrl);
  }, []);

  const onSubmit = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter both a username and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check the server address below.');
    } finally {
      setSubmitting(false);
    }
  };

  const onSaveServerUrl = async () => {
    if (!serverUrl.trim()) return;
    await setApiBaseUrl(serverUrl);
    setShowServerConfig(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.content}>
          <View style={styles.brandBlock}>
            <View style={[styles.logoDot, { backgroundColor: colors.brand }]} />
            <Text style={[styles.title, { color: colors.ink, fontFamily: fontFamily.serif }]}>Lapanza Admin</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Sign in to the admin centre</Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="admin"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              onSubmitEditing={onSubmit}
            />
            {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
            <PrimaryButton title="Sign in" onPress={onSubmit} loading={submitting} />
          </View>

          <View style={styles.serverBlock}>
            {!showServerConfig ? (
              <SecondaryButton title="Server settings" onPress={() => setShowServerConfig(true)} />
            ) : (
              <View style={{ gap: spacing.sm }}>
                <TextField
                  label="Server URL"
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://admin.procomsolutions.co.za"
                  keyboardType="url"
                />
                <SecondaryButton title="Save server URL" onPress={onSaveServerUrl} />
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.xxl },
  brandBlock: { alignItems: 'center', gap: spacing.xs },
  logoDot: { width: 40, height: 40, borderRadius: 12, marginBottom: spacing.sm },
  title: { fontSize: 28 },
  subtitle: { fontSize: 14 },
  form: { gap: spacing.md },
  error: { fontSize: 13 },
  serverBlock: { alignItems: 'center' },
});
