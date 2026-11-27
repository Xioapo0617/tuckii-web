import crypto from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const ALLOWED_TYPES = new Set([
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/gif',
])

const EXT_MAP = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL,
  } = process.env

  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_NAME ||
    !R2_PUBLIC_BASE_URL
  ) {
    return res.status(500).json({ error: 'Missing R2 environment variables' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const contentType = ALLOWED_TYPES.has(body.contentType) ? body.contentType : 'image/webp'
    const safeUser = String(body.userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon'
    const ext = EXT_MAP[contentType] || 'webp'
    const key = `bookmarks/${safeUser}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })
    const baseUrl = R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
    const publicUrl = `${baseUrl}/${key}`

    return res.status(200).json({ uploadUrl, publicUrl, key })
  } catch (err) {
    console.error('r2-upload-url error:', err)
    return res.status(500).json({ error: 'Failed to generate upload URL' })
  }
}
