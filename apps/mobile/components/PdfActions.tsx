import { useRef, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { router, type Href } from 'expo-router'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import { Button } from '@/components/ui/Button'
import { Spacing } from '@/constants/tokens'
import { setPdfPreviewPayload } from '@/utils/pdfPreviewStore'
import { saveAndSharePdf } from '@/utils/pdfShare'

// Shared PDF action bar: a "Share PDF" button + a "Preview" button, plus the
// off-screen pdfmake WebView host for the share path. One place owns the glue
// so the 10 document screens don't each duplicate it — a screen just passes a
// `buildPayload` thunk that loads its data on demand.
//
// Preview opens the in-app pdf.js viewer (app/pdfPreview.tsx) — no folder
// prompt, no external viewer app; share & download live on that screen too.

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
  const [busy, setBusy] = useState<'share' | 'preview' | null>(null)

  async function share() {
    if (busy) return
    setBusy('share')
    try {
      const payload = await buildPayload()
      if (!payload) {
        Alert.alert('Error', 'Could not load this document.')
        return
      }
      const base64 = await pdfRef.current!.generate(payload.builder, payload.data)
      await saveAndSharePdf(base64, payload.filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate PDF'
      Alert.alert('PDF failed', `${msg}\n\n${REBUILD_HINT}`)
    } finally {
      setBusy(null)
    }
  }

  async function preview() {
    if (busy) return
    setBusy('preview')
    try {
      const payload = await buildPayload()
      if (!payload) {
        Alert.alert('Error', 'Could not load this document.')
        return
      }
      setPdfPreviewPayload(payload)
      // Cast: expo-router's generated route union is stale until the next
      // `expo start` regenerates .expo/types — the route file exists.
      router.push('/pdfPreview' as Href)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open the preview')
    } finally {
      setBusy(null)
    }
  }

  const blocked = disabled || busy !== null

  return (
    <View>
      <View style={styles.row}>
        <Button
          title="Share PDF"
          variant="secondary"
          onPress={share}
          loading={busy === 'share'}
          disabled={blocked}
          style={styles.btn}
        />
        <Button
          title="Preview"
          variant="primary"
          onPress={preview}
          loading={busy === 'preview'}
          disabled={blocked}
          style={styles.btn}
        />
      </View>
      <HiddenPdfWebView ref={pdfRef} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  btn: { flex: 1 },
})
