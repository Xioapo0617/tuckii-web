/**
 * Load an image File/Blob into a drawable source with natural dimensions.
 */
async function loadDrawableImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Failed to load image'))
      el.src = objectUrl
    })
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

/**
 * Convert a Blob to a raw base64 string (without data URL prefix).
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      const commaIdx = result.indexOf(',')
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = () => reject(new Error('Failed to read compressed image'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Compress an image File/Blob to WebP with a max width of 1280px.
 * Returns { blob, base64, mimeType, previewUrl, width, height }.
 */
export async function compressImageToWebP(file, maxWidth = 1280, quality = 0.82) {
  const { source, width: origW, height: origH, cleanup } = await loadDrawableImage(file)

  try {
    let targetW = origW
    let targetH = origH
    if (origW > maxWidth) {
      targetW = maxWidth
      targetH = Math.round((origH * maxWidth) / origW)
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    ctx.drawImage(source, 0, 0, targetW, targetH)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('WebP encoding failed'))),
        'image/webp',
        quality
      )
    })

    const base64 = await blobToBase64(blob)
    const previewUrl = URL.createObjectURL(blob)

    return {
      blob,
      base64,
      mimeType: 'image/webp',
      previewUrl,
      width: targetW,
      height: targetH,
    }
  } finally {
    cleanup()
  }
}
