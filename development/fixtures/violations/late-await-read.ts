import { atom, computed, withAsyncData, wrap } from '@reatom/core'

export const selectedAssetId = atom('', 'gallery.selectedAssetId')
export const previewWidth = atom(320, 'gallery.previewWidth')

export const assetPreview = computed(async () => {
  const id = selectedAssetId()
  if (!id) return null

  const blob = await wrap(fetch(`/api/assets/${id}`).then((response) => response.blob()))

  const width = previewWidth()
  const bitmap = await wrap(createImageBitmap(blob, { resizeWidth: width }))

  return bitmap
}, 'gallery.assetPreview').extend(withAsyncData({ initState: null }))
