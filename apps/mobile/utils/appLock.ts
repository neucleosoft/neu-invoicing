// App-lock PIN storage. The PIN itself is never stored — only a salted
// SHA-256 hash in SecureStore (Android Keystore-backed). Pure JS + expo-crypto,
// so no new native module or rebuild. Biometrics would need
// expo-local-authentication (a native add) — deliberate v2.

import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const HASH_KEY = 'neu.lock.pinHash'
const SALT_KEY = 'neu.lock.pinSalt'

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`)
}

export async function isPinSet(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HASH_KEY)) != null
}

export async function setPin(pin: string): Promise<void> {
  const saltBytes = await Crypto.getRandomBytesAsync(16)
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const hash = await hashPin(pin, salt)
  await SecureStore.setItemAsync(SALT_KEY, salt)
  await SecureStore.setItemAsync(HASH_KEY, hash)
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(HASH_KEY)
  await SecureStore.deleteItemAsync(SALT_KEY)
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [hash, salt] = await Promise.all([
    SecureStore.getItemAsync(HASH_KEY),
    SecureStore.getItemAsync(SALT_KEY),
  ])
  if (!hash || !salt) return true // no PIN configured = nothing to verify
  return (await hashPin(pin, salt)) === hash
}
