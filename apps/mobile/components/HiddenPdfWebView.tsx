import { type ComponentType, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import type { WebView as RNWebView, WebViewMessageEvent } from 'react-native-webview'

import harnessHtml from '@/utils/pdfHarnessHtml'

// A zero-size, invisible WebView that hosts pdfmake's browser build (the harness
// HTML). pdfmake runs in a real browser engine here — so the Hermes "freeze on
// >=0.2" bug does not apply — and we bridge a docDefinition in / base64 PDF out.
//
// react-native-webview is loaded LAZILY (require inside an effect), NOT a static
// import: a static import runs TurboModuleRegistry.getEnforcing('RNCWebViewModule')
// at module-load, which THROWS when the app hasn't been rebuilt after adding the
// dep. Because expo-router eagerly imports every route, that throw would crash the
// WHOLE app. Lazy + try/catch degrades to a clear "rebuild needed" message instead.
//
// Usage: render <HiddenPdfWebView ref={pdfRef} /> in the screen, then
//   const base64 = await pdfRef.current!.generate(docDefinition)

export type HiddenPdfWebViewHandle = {
  // Sends plain JSON `data` to the WebView, which runs the named builder there
  // (e.g. 'invoice') and returns the PDF as base64. The builder runs in the
  // WebView — not here — so its pdfmake layout FUNCTIONS aren't lost to JSON.
  generate: (builder: string, data: object) => Promise<string>
}

type Pending = { resolve: (b64: string) => void; reject: (e: Error) => void }

const REBUILD_MESSAGE =
  'PDF engine unavailable — rebuild the app with `npx expo run:android` after adding react-native-webview (Metro alone cannot add native modules).'

let counter = 0
const nextId = () => `pdf_${counter++}`

export const HiddenPdfWebView = forwardRef<HiddenPdfWebViewHandle>(function HiddenPdfWebView(_props, ref) {
  const [WebViewComp, setWebViewComp] = useState<ComponentType<any> | null>(null)
  const [nativeMissing, setNativeMissing] = useState(false)

  const webRef = useRef<RNWebView>(null)
  const readyRef = useRef(false)
  const readyWaiters = useRef<(() => void)[]>([])
  const pending = useRef<Map<string, Pending>>(new Map())

  useEffect(() => {
    try {
      // require (not import) so a missing native module is catchable here rather
      // than throwing at module-load and taking the whole route tree down.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-webview')
      setWebViewComp(() => mod.WebView as ComponentType<any>)
    } catch {
      setNativeMissing(true)
    }
  }, [])

  const waitReady = useCallback(() => {
    if (readyRef.current) return Promise.resolve()
    return new Promise<void>((res) => readyWaiters.current.push(res))
  }, [])

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; id?: string; base64?: string; error?: string }
    try {
      msg = JSON.parse(e.nativeEvent.data)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      readyRef.current = true
      readyWaiters.current.splice(0).forEach((r) => r())
      return
    }
    const p = msg.id ? pending.current.get(msg.id) : undefined
    if (!p || !msg.id) return
    pending.current.delete(msg.id)
    if (msg.type === 'result' && typeof msg.base64 === 'string') p.resolve(msg.base64)
    else p.reject(new Error(msg.error || 'PDF generation failed'))
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      generate: async (builder: string, data: object) => {
        if (nativeMissing) throw new Error(REBUILD_MESSAGE)
        await waitReady()
        const id = nextId()
        const payload = JSON.stringify({ type: 'generate', id, builder, data })
        const promise = new Promise<string>((resolve, reject) => {
          pending.current.set(id, { resolve, reject })
          setTimeout(() => {
            if (pending.current.delete(id)) reject(new Error('PDF generation timed out'))
          }, 30000)
        })
        // Double-encode so the injected source is a single safe string literal —
        // protects against quotes/newlines/backslashes inside the docDefinition.
        webRef.current?.injectJavaScript(`window.__generatePdf(${JSON.stringify(payload)}); true;`)
        return promise
      },
    }),
    [waitReady, nativeMissing],
  )

  if (!WebViewComp) return null

  return (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebViewComp
        ref={webRef}
        source={{ html: harnessHtml }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        androidLayerType="software"
        setSupportMultipleWindows={false}
      />
    </View>
  )
})
