// In-app PDF preview (issue #74). Two WebViews cooperate here:
//   1. the existing hidden pdfmake harness GENERATES the PDF (base64),
//   2. a visible pdf.js harness (assets/pdf/pdfViewer.html) DRAWS it onto
//      fit-width canvases — Android's WebView can't display PDFs natively.
// Preview → share → save all happen without leaving the app, like desktop.
//
// The document payload arrives via utils/pdfPreviewStore (module slot), set by
// PdfActions right before router.push — it's a full document object, not
// route-param material.

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import type { WebView as RNWebView, WebViewMessageEvent } from 'react-native-webview'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { Button } from '@/components/ui/Button'
import { Spacing } from '@/constants/tokens'
import { consumePdfPreviewPayload, type PdfPreviewPayload } from '@/utils/pdfPreviewStore'
import { saveAndSharePdf, savePdfToFolder } from '@/utils/pdfShare'
import viewerHtml from '@/utils/pdfViewerHtml'

export default function PdfPreviewScreen() {
  // Consume exactly once; hold in state so re-renders keep it.
  const [payload] = useState<PdfPreviewPayload | null>(() => consumePdfPreviewPayload())
  const [WebViewComp, setWebViewComp] = useState<ComponentType<any> | null>(null)
  const [base64, setBase64] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'share' | 'save' | null>(null)

  const pdfRef = useRef<HiddenPdfWebViewHandle>(null)
  const viewerRef = useRef<RNWebView>(null)
  const viewerReady = useRef(false)
  const injected = useRef(false)

  // Same lazy-require dance as HiddenPdfWebView: a static import would crash
  // the whole route tree on a build that predates react-native-webview.
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-webview')
      setWebViewComp(() => mod.WebView as ComponentType<any>)
    } catch {
      setGenError('PDF engine unavailable — rebuild the app (expo run:android / EAS).')
    }
  }, [])

  // No payload = opened without a document (stale deep link, reload) — back out.
  useEffect(() => {
    if (!payload) router.back()
  }, [payload])

  // Generate the PDF as soon as the hidden harness is mounted.
  useEffect(() => {
    if (!payload || !WebViewComp) return
    let cancelled = false
    pdfRef.current!
      .generate(payload.builder, payload.data)
      .then((b64) => {
        if (!cancelled) setBase64(b64)
      })
      .catch((e) => {
        if (!cancelled) setGenError(e instanceof Error ? e.message : 'Failed to generate PDF')
      })
    return () => {
      cancelled = true
    }
  }, [payload, WebViewComp])

  // Hand the PDF to the viewer once BOTH the bytes and the viewer are ready.
  const tryInject = () => {
    if (injected.current || !viewerReady.current || !base64) return
    injected.current = true
    viewerRef.current?.injectJavaScript(`window.__renderPdf(${JSON.stringify(base64)}); true;`)
  }
  useEffect(tryInject, [base64])

  const onViewerMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; error?: string }
    try {
      msg = JSON.parse(e.nativeEvent.data)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      viewerReady.current = true
      tryInject()
    } else if (msg.type === 'rendered') {
      setRendered(true)
    } else if (msg.type === 'error') {
      setGenError(msg.error || 'Could not display this PDF')
    }
  }

  async function share() {
    if (!base64 || !payload || busy) return
    setBusy('share')
    try {
      await saveAndSharePdf(base64, payload.filename)
    } catch (e) {
      Alert.alert('Share failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!base64 || !payload || busy) return
    setBusy('save')
    try {
      const saved = await savePdfToFolder(base64, payload.filename)
      if (saved) Alert.alert('Saved', `${payload.filename} was saved to your folder.`)
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!payload) return null

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ThemedText style={styles.headerBack}>‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.headerTitle}>
          {payload.filename}
        </ThemedText>
      </View>

      <View style={styles.viewerBox}>
        {WebViewComp && (
          <WebViewComp
            ref={viewerRef}
            source={{ html: viewerHtml }}
            originWhitelist={['*']}
            javaScriptEnabled
            onMessage={onViewerMessage}
            setSupportMultipleWindows={false}
            // Pinch-zoom into the rendered pages (canvases carry extra
            // resolution for exactly this).
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            style={styles.viewer}
          />
        )}
        {!rendered && !genError && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" />
            <ThemedText style={styles.loadingText}>
              {base64 ? 'Rendering…' : 'Building PDF…'}
            </ThemedText>
          </View>
        )}
        {genError && (
          <View style={styles.loading}>
            <ThemedText style={styles.errorText}>{genError}</ThemedText>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          title="Share PDF"
          variant="secondary"
          onPress={share}
          loading={busy === 'share'}
          disabled={!base64 || busy !== null}
          style={styles.actionBtn}
        />
        <Button
          title="Download"
          variant="primary"
          onPress={save}
          loading={busy === 'save'}
          disabled={!base64 || busy !== null}
          style={styles.actionBtn}
        />
      </View>

      <HiddenPdfWebView ref={pdfRef} />
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  headerBack: { fontSize: 16, color: '#007AFF' },
  headerTitle: { flex: 1 },
  viewerBox: { flex: 1 },
  viewer: { flex: 1, backgroundColor: '#3c4043' },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  loadingText: { opacity: 0.7 },
  errorText: { textAlign: 'center', paddingHorizontal: Spacing.xl, color: '#dc2626' },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  actionBtn: { flex: 1 },
})
