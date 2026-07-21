// Writes a base64 PDF (produced by the pdfmake WebView harness) to a real file
// in the cache dir, then opens the OS share sheet. Uses the LEGACY expo-file-system
// API (expo-file-system/legacy) on purpose: writeAsStringAsync with Base64 encoding
// is the confirmed-reliable way to decode base64 → binary on SDK 54 (the new
// File.write(string,{encoding}) surface was reported in flux). expo-sharing opens
// the native sheet (WhatsApp / email / Files / etc.).
//
// Viewing is NOT here anymore: the in-app preview screen (app/pdfPreview.tsx)
// replaced the old save-then-open-external-viewer flow.

import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'

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

// Folder the user picked to save PDFs into (Android SAF), remembered for the
// session so we only prompt once per app launch.
let savedDirUri: string | null = null

/** Save a copy into a user-chosen folder (Downloads, etc.). Android uses the
 *  Storage Access Framework; iOS falls back to the share sheet, whose own
 *  "Save to Files" covers the same need. Returns true when a copy was saved
 *  (false = user cancelled the folder pick). */
export async function savePdfToFolder(base64: string, filename: string): Promise<boolean> {
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`

  if (Platform.OS !== 'android') {
    await saveAndSharePdf(base64, safeName)
    return true
  }

  const SAF = FileSystem.StorageAccessFramework
  if (!savedDirUri) {
    const perm = await SAF.requestDirectoryPermissionsAsync()
    if (!perm.granted) return false
    savedDirUri = perm.directoryUri
  }
  const target = await SAF.createFileAsync(
    savedDirUri,
    safeName.replace(/\.pdf$/i, ''),
    'application/pdf',
  )
  await FileSystem.writeAsStringAsync(target, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return true
}
