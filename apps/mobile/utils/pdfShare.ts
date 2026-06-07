// Writes a base64 PDF (produced by the pdfmake WebView harness) to a real file
// in the cache dir, then opens the OS share sheet. Uses the LEGACY expo-file-system
// API (expo-file-system/legacy) on purpose: writeAsStringAsync with Base64 encoding
// is the confirmed-reliable way to decode base64 → binary on SDK 54 (the new
// File.write(string,{encoding}) surface was reported in flux). expo-sharing opens
// the native sheet (WhatsApp / email / Files / etc.).

import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

export async function saveAndSharePdf(base64: string, filename: string): Promise<string> {
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  const uri = (FileSystem.cacheDirectory ?? '') + safeName
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share PDF',
      UTI: 'com.adobe.pdf',
    })
  }
  return uri
}
