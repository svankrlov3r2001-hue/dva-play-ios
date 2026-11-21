import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BouncyButton } from '../components/BouncyButton';
import { GLASS_SHADOW } from '../constants/config';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const verticalPad = Math.max(insets.top + 56, insets.bottom + 28);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'id' | 'pw' | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setError('');
    const idTrim = identity.trim();
    if (!idTrim || !password) {
      setError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setSubmitting(true);
    try {
      await login(idTrim, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err?.message || 'Email hoặc mật khẩu không chính xác.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/default-poster2.png')}
      style={styles.bg}
      resizeMode="cover"
    >
      {/* .dva-login-scrim radial red/rose glows & directional gradient */}
      <LinearGradient
        colors={['rgba(229, 9, 20, 0.16)', 'rgba(7, 9, 15, 0.35)', 'rgba(213, 0, 85, 0.14)']}
        start={{ x: 0.15, y: 0.25 }}
        end={{ x: 0.85, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(7, 9, 15, 0.38)', 'rgba(7, 9, 15, 0.52)', 'rgba(7, 9, 15, 0.78)']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* .dva-login-corner-logo */}
      <View style={[styles.cornerLogoWrap, { top: insets.top + 10 }]}>
        <Image
          source={require('../../assets/splash-logo.png')}
          style={styles.cornerLogo}
          resizeMode="contain"
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: verticalPad, paddingBottom: verticalPad },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* .dva-login-card (Apple Liquid Glass container border-radius: 40px) */}
          <View style={styles.cardWrap}>
            <BlurView intensity={32} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
            <View style={styles.cardTint} />
            <View style={styles.cardInner}>
              <View style={styles.cardHeader}>
                <Image
                  source={require('../../assets/splash-logo.png')}
                  style={styles.cardLogo}
                  resizeMode="contain"
                />
                <Text style={styles.cardTitle}>Đăng nhập</Text>
                <Text style={styles.cardSubtitle}>
                  {'Chào mừng trở lại!\nĐăng nhập để tiếp tục trải nghiệm'}
                </Text>
              </View>

              <View style={styles.form}>
                <View
                  style={[
                    styles.inputWrap,
                    focusedField === 'id' && styles.inputWrapFocused,
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={19}
                    color="rgba(255, 255, 255, 0.72)"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Nhập email hoặc tên đăng nhập"
                    placeholderTextColor="rgba(245, 246, 250, 0.55)"
                    value={identity}
                    onChangeText={setIdentity}
                    onFocus={() => setFocusedField('id')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                  />
                </View>

                <View
                  style={[
                    styles.inputWrap,
                    focusedField === 'pw' && styles.inputWrapFocused,
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={19}
                    color="rgba(255, 255, 255, 0.72)"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Nhập mật khẩu"
                    placeholderTextColor="rgba(245, 246, 250, 0.55)"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocusedField('pw')}
                    onBlur={() => setFocusedField(null)}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <BouncyButton
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={10}
                    style={styles.eyeBtn}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                      size={20}
                      color="rgba(255, 255, 255, 0.72)"
                    />
                  </BouncyButton>
                </View>

                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color="#FFD4D8" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <BouncyButton
                  bounciness="gentle"
                  activeOpacity={0.88}
                  disabled={submitting}
                  onPress={handleLogin}
                  style={[styles.submitWrap, submitting && { opacity: 0.65 }]}
                >
                  <LinearGradient
                    colors={['#e50914', '#d50055']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.submitGradient}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <>
                        <Text style={styles.submitText}>Đăng nhập</Text>
                        <Ionicons name="arrow-forward" size={19} color="#FFF" />
                      </>
                    )}
                  </LinearGradient>
                </BouncyButton>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#07090F',
  },
  flex: {
    flex: 1,
  },
  cornerLogoWrap: {
    position: 'absolute',
    left: 22,
    zIndex: 10,
  },
  cornerLogo: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  cardWrap: {
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: GLASS_SHADOW,
    elevation: 16,
  },
  cardTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(14, 17, 24, 0.34)',
  },
  cardInner: {
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  cardHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  cardLogo: {
    width: 68,
    height: 68,
    borderRadius: 18,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  cardSubtitle: {
    color: 'rgba(245, 246, 250, 0.68)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  form: {
    gap: 14,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 18,
    height: 56,
  },
  inputWrapFocused: {
    borderColor: 'rgba(255, 255, 255, 0.42)',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
    borderRadius: 24,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: 'rgba(229, 9, 20, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.45)',
  },
  errorText: {
    color: '#FFD4D8',
    fontSize: 13.5,
    flexShrink: 1,
    textAlign: 'center',
  },
  submitWrap: {
    marginTop: 6,
    borderRadius: 24,
    overflow: 'hidden',
  },
  submitGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
