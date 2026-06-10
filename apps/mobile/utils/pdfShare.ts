// Writes a base64 PDF (produced by the pdfmake WebView harness) to a real file
// in the cache dir, then opens the OS share sheet. Uses the LEGACY expo-file-system
// API (expo-file-system/legacy) on purpose: writeAsStringAsync with Base64 encoding
// is the confirmed-reliable way to decode base64 → binary on SDK 54 (the new
// File.write(string,{encoding}) surface was reported in flux). expo-sharing opens
// the native sheet (WhatsApp / email / Files / etc.).

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

// "View & download": save a copy into a user-chosen folder (Downloads, etc.) AND
// open the PDF in the device's default viewer. On Android this uses the Storage
// Access Framework + an ACTION_VIEW intent. expo-intent-launcher is loaded lazily
// and any failure (e.g. the module isn't in this build yet) falls back to the OS
// share sheet — which itself offers both "open in viewer" and "save to Files".
export async function viewAndDownloadPdf(base64: string, filename: string): Promise<void> {
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  const cacheUri = (FileSystem.cacheDirectory ?? '') + safeName
  await FileSystem.writeAsStringAsync(cacheUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  if (Platform.OS === 'android') {
    // DOWNLOAD — best-effort save into a folder the user picks (remembered for
    // the session). Never block viewing if the folder pick is cancelled.
    try {
      const SAF = FileSystem.StorageAccessFramework
      if (!savedDirUri) {
        const perm = await SAF.requestDirectoryPermissionsAsync()
        if (perm.granted) savedDirUri = perm.directoryUri
      }
      if (savedDirUri) {
        const target = await SAF.createFileAsync(
          savedDirUri,
          safeName.replace(/\.pdf$/i, ''),
          'application/pdf',
        )
        await FileSystem.writeAsStringAsync(target, base64, {
          encoding: FileSystem.EncodingType.Base64,
        })
      }
    } catch {
      // saving is best-effort
    }

    // VIEW — open in the default PDF app via an intent (needs a content:// URI).
    try {
      const IntentLauncher = await import('expo-intent-launcher')
      if (typeof IntentLauncher.startActivityAsync === 'function') {
        const contentUri = await FileSystem.getContentUriAsync(cacheUri)
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: 'application/pdf',
        })
        return
      }
    } catch {
      // intent-launcher not in this build yet → fall through to the share sheet
    }
  }

  // iOS, or Android fallback: the share sheet offers open-in-viewer + save-to-Files.
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(cacheUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Open or save PDF',
      UTI: 'com.adobe.pdf',
    })
  }
}
