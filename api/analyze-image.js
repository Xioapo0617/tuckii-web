const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'

function stripCodeFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const rawBase64 = String(body.imageBase64 || '')
    const imageBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '')
    const mimeType = String(body.mimeType || 'image/webp')
    const categories = Array.isArray(body.categories)
      ? body.categories.map((c) => String(c).trim()).filter(Boolean)
      : []

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' })
    }

    const categoryInstruction = categories.length > 0
      ? `請從以下現有分類中挑選最適合的一個名稱填入 "category"（若都不適合請回傳空字串 ""）：${categories.join('、')}`
      : `若無法判斷分類，"category" 請回傳空字串 ""。`

    const prompt = [
      '你是一個書籤整理助手，請分析這張圖片（可能是照片、網頁截圖、筆記、商品或旅遊資訊），並以繁體中文輸出 JSON 格式結果。',
      'JSON 欄位規定如下：',
      '- "title": 簡潔明確的書籤標題（15 字以內）。',
      '- "note": 包含圖片中的重點內容摘要、關鍵文字資訊，以及方便日後搜尋的關鍵字（約 30 到 100 字）。',
      `- "category": ${categoryInstruction}`,
      '只回傳合法的 JSON 物件，不要包含任何額外說明。',
    ].join('\n')

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      const errMsg = errData.error?.message || 'Unknown error'
      console.error('Gemini API error:', response.status, errMsg)
      return res.status(502).json({ error: errMsg })
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = JSON.parse(stripCodeFences(rawText))

    return res.status(200).json({
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      note: typeof parsed.note === 'string' ? parsed.note.trim() : '',
      category: typeof parsed.category === 'string' ? parsed.category.trim() : '',
    })
  } catch (err) {
    console.error('analyze-image error:', err)
    return res.status(500).json({ error: 'Failed to analyze image' })
  }
}
