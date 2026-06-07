import { useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import { ThemedText } from '@/components/themed-text'
import { saveAndSharePdf, viewAndDownloadPdf } from '@/utils/pdfShare'

// Shared PDF action bar: a "Share PDF" button + a "View / Save" button, plus the
// off-screen pdfmake WebView host. One place owns all the generate/share/view
// glue so the 10 document screens don't each duplicate it — a screen just passes
// a `buildPayload` thunk that loads its data on demand.

export type PdfPayloadLike = { builder: string; data: object; filename: string }

interface PdfActionsProps {
  // Loads the document data at tap time (kept fresh). Return null if unavailable.
  buildPayload: () => Promise<PdfPayloadLike | null>
  // Disable until the screen's data is ready.
  disabled?: boolean
}

const REBUILD_HINT =
  'If this is the first run after adding PDF support, rebuild the app (expo run:android / EAS).'

export function PdfActions({ buildPayload, disabled }: PdfActionsProps) {
  const pdfRef = useRef<HiddenPdfWebViewHandle>(null)
  const [busy, setBusy] = useState<'share' | 'view' | null>(null)

  async function run(action: 'share' | 'view') {
    if (busy) return
    setBusy(action)
    try {
      const payload = await buildPayload()
      if (!payload) {
        Alert.alert('Error', 'Could not load this document.')
        return
      }
      const base64 = await pdfRef.current!.generate(payload.builder, payload.data)
      if (action === 'share') await saveAndSharePdf(base64, payload.filename)
      else await viewAndDownloadPdf(base64, payload.filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate PDF'
      Alert.alert('PDF failed', `${msg}\n\n${REBUILD_HINT}`)
    } finally {
      setBusy(null)
    }
  }

  const blocked = disabled || busy !== null

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, styles.share, blocked && styles.disabled]}
          onPress={() => run('share')}
          disabled={blocked}
        >
          {busy === 'share' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.btnText}>Share PDF</ThemedText>
          )}
        </Pressable>
        <Pressable
          style={[styles.btn, styles.view, blocked && styles.disabled]}
          onPress={() => run('view')}
          disabled={blocked}
        >
          {busy === 'view' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.btnText}>View / Save</ThemedText>
          )}
        </Pressable>
      </View>
      <HiddenPdfWebView ref={pdfRef} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  share: { backgroundColor: '#0a7ea4' },
  view: { backgroundColor: '#15803d' },
  disabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
