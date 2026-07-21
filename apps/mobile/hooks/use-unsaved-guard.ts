// Rage-guard: Android back / swipe-back must never silently eat a half-typed
// document. When `dirty` is true, leaving the screen (hardware back, header
// back, gesture — any pop) pauses on a "Discard?" dialog; Discard re-plays
// the blocked navigation action, Keep editing stays put.
//
// Save paths call markClean() IMMEDIATELY before their router.back():
// setState wouldn't commit in the same tick, so the guard checks a ref that
// flips synchronously — a successful save never sees the dialog.

import { useRef } from 'react'
import { Alert } from 'react-native'
import { useNavigation, usePreventRemove } from '@react-navigation/native'

export function useUnsavedGuard(dirty: boolean, what = 'this document') {
  const navigation = useNavigation()
  const cleanRef = useRef(false)

  usePreventRemove(dirty, ({ data }) => {
    if (cleanRef.current) {
      // Saved (or explicitly discarded) in this same tick — let it through.
      navigation.dispatch(data.action)
      return
    }
    Alert.alert(
      'Discard ' + what + '?',
      'You have unsaved changes. Going back will throw them away.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            cleanRef.current = true
            navigation.dispatch(data.action)
          },
        },
      ],
    )
  })

  return {
    /** Call right before the post-save router.back(). */
    markClean: () => {
      cleanRef.current = true
    },
  }
}
