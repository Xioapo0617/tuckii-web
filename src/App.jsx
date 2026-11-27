import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore'
import { auth, db, googleProvider } from './firebase'
import { compressImageToWebP } from './utils/image'

const DEFAULT_CATEGORIES = ['口袋名單', '靈感', '學習筆記', '旅行計畫']
const CATEGORY_COLORS = ['#1F6FEB', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6', '#6366F1']

function normalizeUrl(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'https://' + trimmed
}

function guessTitle(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function faviconUrl(url) {
  try {
    const host = new URL(normalizeUrl(url)).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return ''
  }
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [categories, setCategories] = useState([])
  const [bookmarks, setBookmarks] = useState([])
  const [dataReady, setDataReady] = useState(false)

  const [urlInput, setUrlInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all') // 'all' | categoryId | 'uncategorized'

  const [saveModal, setSaveModal] = useState(null) // { type: 'url'|'image', url?, title, note, categoryId, imageBlob?, imageMimeType?, imagePreviewUrl?, analyzing?, titleEdited?, noteEdited? }
  const [saving, setSaving] = useState(false)
  const [categoryModal, setCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [toast, setToast] = useState('')

  const pendingUrlRef = useRef(null)
  const urlInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories

  const showToast = (msg) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2200)
  }

  // ---- 讀取 ?url=... 參數（iPhone 捷徑用）----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const incoming = params.get('url')
    if (incoming) {
      pendingUrlRef.current = incoming
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // ---- 登入狀態與 Redirect 結果處理 ----
  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      console.error('Google redirect sign-in error:', err)
      showToast('登入失敗，請再試一次')
    })

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthReady(true)
      if (!u) {
        setCategories([])
        setBookmarks([])
        setDataReady(false)
      }
    })
    return unsub
  }, [])

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      if (err?.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, googleProvider)
      } else if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        console.error('Google sign-in error:', err)
        showToast('登入失敗，請再試一次')
      }
    }
  }

  // ---- Firestore 訂閱（只讀寫自己的資料）----
  useEffect(() => {
    if (!user) return
    const catQ = query(collection(db, 'users', user.uid, 'categories'), orderBy('createdAt', 'asc'))
    const bmQ = query(collection(db, 'users', user.uid, 'bookmarks'), orderBy('createdAt', 'desc'))
    const unsubCat = onSnapshot(catQ, (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setDataReady(true)
    })
    const unsubBm = onSnapshot(bmQ, (snap) => {
      setBookmarks(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => {
      unsubCat()
      unsubBm()
    }
  }, [user])

  // ---- 首次登入：建立預設分類 ----
  useEffect(() => {
    if (!user || !dataReady) return
    ;(async () => {
      const metaRef = doc(db, 'users', user.uid)
      const metaSnap = await getDoc(metaRef)
      if (metaSnap.exists() && metaSnap.data().initialized) return
      if (categories.length === 0) {
        const batch = writeBatch(db)
        DEFAULT_CATEGORIES.forEach((name, i) => {
          const ref = doc(collection(db, 'users', user.uid, 'categories'))
          batch.set(ref, { name, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], createdAt: serverTimestamp() })
        })
        await batch.commit()
      }
      await setDoc(metaRef, { initialized: true }, { merge: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dataReady])

  // ---- 登入後處理捷徑帶入的網址：自動填入並跳出分類選擇視窗 ----
  useEffect(() => {
    if (user && dataReady && pendingUrlRef.current) {
      const url = pendingUrlRef.current
      pendingUrlRef.current = null
      openSaveModal(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dataReady, categories.length])

  const closeSaveModal = () => {
    setSaveModal((prev) => {
      if (prev?.imagePreviewUrl) {
        URL.revokeObjectURL(prev.imagePreviewUrl)
      }
      return null
    })
  }

  const openSaveModal = (url) => {
    const clean = normalizeUrl(url)
    setSaveModal({
      type: 'url',
      url: clean,
      title: guessTitle(clean),
      note: '',
      categoryId: categories[0]?.id || ''
    })
  }

  const handleImageSelected = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return
    try {
      const compressed = await compressImageToWebP(file, 1280)
      const rawName = (file.name || '').replace(/\.[^.]+$/, '').trim()
      const defaultTitle = rawName && rawName !== 'image' ? rawName : '圖片書籤'
      const currentCats = categoriesRef.current
      const previewUrl = compressed.previewUrl

      setSaveModal((prev) => {
        if (prev?.imagePreviewUrl) URL.revokeObjectURL(prev.imagePreviewUrl)
        return {
          type: 'image',
          title: defaultTitle,
          note: '',
          categoryId: currentCats[0]?.id || '',
          imageBlob: compressed.blob,
          imageMimeType: compressed.mimeType,
          imagePreviewUrl: previewUrl,
          analyzing: true,
          titleEdited: false,
          noteEdited: false
        }
      })

      try {
        const res = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: compressed.base64,
            mimeType: compressed.mimeType,
            categories: currentCats.map((c) => c.name)
          })
        })
        if (!res.ok) throw new Error('AI analyze failed')
        const ai = await res.json()

        setSaveModal((prev) => {
          if (!prev || prev.imagePreviewUrl !== previewUrl) return prev
          const matchedCat = ai.category
            ? currentCats.find((c) => c.name.trim().toLowerCase() === ai.category.trim().toLowerCase())
            : null
          return {
            ...prev,
            title: !prev.titleEdited && ai.title ? ai.title : prev.title,
            note: !prev.noteEdited && ai.note ? ai.note : prev.note,
            categoryId: matchedCat ? matchedCat.id : prev.categoryId,
            analyzing: false
          }
        })
      } catch {
        setSaveModal((prev) =>
          prev && prev.imagePreviewUrl === previewUrl ? { ...prev, analyzing: false } : prev
        )
      }
    } catch {
      showToast('圖片處理失敗，請換一張試試')
    }
  }

  // ---- 監聽剪貼簿貼上圖片（Ctrl+V / paste 事件）----
  useEffect(() => {
    if (!user) return
    const onPaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            handleImageSelected(file)
          }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handlePasteAndSave = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) {
        openSaveModal(text)
        return
      }
    } catch {
      // 剪貼簿權限被拒時，改用輸入框內容
    }
    if (urlInput.trim()) {
      openSaveModal(urlInput)
    } else {
      urlInputRef.current?.focus()
      showToast('先貼上網址，或允許讀取剪貼簿')
    }
  }

  const handleSaveBookmark = async () => {
    if (!user || !saveModal || saving) return

    if (saveModal.type === 'image') {
      if (!saveModal.imageBlob) return
      setSaving(true)
      try {
        const signRes = await fetch('/api/r2-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType: saveModal.imageMimeType || 'image/webp',
            userId: user.uid
          })
        })
        if (!signRes.ok) throw new Error('Failed to get upload URL')
        const { uploadUrl, publicUrl } = await signRes.json()

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': saveModal.imageMimeType || 'image/webp' },
          body: saveModal.imageBlob
        })
        if (!putRes.ok) throw new Error('Failed to upload image to R2')

        await addDoc(collection(db, 'users', user.uid, 'bookmarks'), {
          type: 'image',
          imageUrl: publicUrl,
          title: (saveModal.title || '').trim() || '圖片書籤',
          note: (saveModal.note || '').trim(),
          categoryId: saveModal.categoryId || '',
          createdAt: serverTimestamp()
        })
        closeSaveModal()
        showToast('已收藏圖片')
      } catch (err) {
        console.error(err)
        showToast('圖片上傳失敗，請稍後再試')
      } finally {
        setSaving(false)
      }
      return
    }

    const url = normalizeUrl(saveModal.url)
    if (!url) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'users', user.uid, 'bookmarks'), {
        url,
        title: (saveModal.title || '').trim() || guessTitle(url),
        note: (saveModal.note || '').trim(),
        categoryId: saveModal.categoryId || '',
        createdAt: serverTimestamp()
      })
      closeSaveModal()
      setUrlInput('')
      showToast('已收藏')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBookmark = async (id) => {
    if (!user) return
    if (!window.confirm('刪除這則書籤？')) return
    await deleteDoc(doc(db, 'users', user.uid, 'bookmarks', id))
  }

  const handleAddCategory = async () => {
    const name = newCategoryName.trim()
    if (!user || !name) return
    await addDoc(collection(db, 'users', user.uid, 'categories'), {
      name,
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
      createdAt: serverTimestamp()
    })
    setNewCategoryName('')
    setCategoryModal(false)
    showToast('分類已建立')
  }

  const handleDeleteCategory = async (cat) => {
    if (!user) return
    if (!window.confirm(`刪除分類「${cat.name}」？分類內的書籤會移到未分類，不會被刪除。`)) return
    const affected = bookmarks.filter((b) => b.categoryId === cat.id)
    const batch = writeBatch(db)
    affected.forEach((b) => {
      batch.update(doc(db, 'users', user.uid, 'bookmarks', b.id), { categoryId: '' })
    })
    await batch.commit()
    await deleteDoc(doc(db, 'users', user.uid, 'categories', cat.id))
    if (selectedCategory === cat.id) setSelectedCategory('all')
    showToast('分類已刪除')
  }

  const countByCategory = useMemo(() => {
    const map = {}
    bookmarks.forEach((b) => {
      const key = b.categoryId || 'uncategorized'
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [bookmarks])

  const visibleBookmarks = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return bookmarks.filter((b) => {
      if (selectedCategory === 'uncategorized' && b.categoryId) return false
      if (selectedCategory !== 'all' && selectedCategory !== 'uncategorized' && b.categoryId !== selectedCategory) return false
      if (!kw) return true
      return (
        (b.title || '').toLowerCase().includes(kw) ||
        (b.url || '').toLowerCase().includes(kw) ||
        (b.note || '').toLowerCase().includes(kw)
      )
    })
  }, [bookmarks, keyword, selectedCategory])

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || '未分類'
  const categoryColor = (id) => categories.find((c) => c.id === id)?.color || '#9CA3AF'

  // ---------- 畫面 ----------

  if (!authReady) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink/60 text-sm">載入中…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-3xl bg-brand flex items-center justify-center shadow-card mb-5">
          <svg viewBox="0 0 64 64" className="w-10 h-10"><path d="M22 10h20a2 2 0 0 1 2 2v42l-12-8-12 8V12a2 2 0 0 1 2-2z" fill="#fff" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-ink mb-2">Tuckii 書籤</h1>
        <p className="text-ink/60 text-sm mb-8 text-center">貼上網址，一鍵收藏，分類整理你的口袋名單。</p>
        <button
          onClick={handleGoogleSignIn}
          className="bg-white text-ink font-medium px-6 py-3 rounded-full shadow-card border border-black/5 active:scale-95 transition"
        >
          使用 Google 帳號登入
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="max-w-lg mx-auto px-4 pb-24">
        {/* 頂部列 */}
        <header className="flex items-center justify-between pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center">
              <svg viewBox="0 0 64 64" className="w-4 h-4"><path d="M22 10h20a2 2 0 0 1 2 2v42l-12-8-12 8V12a2 2 0 0 1 2-2z" fill="#fff" /></svg>
            </div>
            <span className="font-bold text-lg">Tuckii 書籤</span>
          </div>
          <div className="flex items-center gap-2">
            {user.photoURL && <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />}
            <button onClick={() => signOut(auth)} className="text-sm text-ink/60 px-2 py-1">登出</button>
          </div>
        </header>

        {/* 一鍵貼上並儲存 */}
        <div className="bg-white rounded-3xl shadow-card p-3 mb-3">
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) openSaveModal(urlInput) }}
              placeholder="貼上網址…"
              inputMode="url"
              className="flex-1 min-w-0 bg-paper rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-ink/40"
            />
            <button
              onClick={() => { if (urlInput.trim()) openSaveModal(urlInput) }}
              className="shrink-0 bg-ink text-white text-sm font-medium px-4 rounded-2xl active:scale-95 transition"
            >
              儲存
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={handlePasteAndSave}
              className="bg-brand text-white font-semibold py-3 rounded-2xl active:scale-[0.98] transition text-sm"
            >
              📋 一鍵貼上網址
            </button>
            <button
              onClick={() => imageInputRef.current?.click()}
              className="bg-paper text-ink font-semibold py-3 rounded-2xl active:scale-[0.98] transition text-sm border border-black/5"
            >
              🖼️ 上傳圖片 / 截圖
            </button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImageSelected(file)
              e.target.value = ''
            }}
          />
          <p className="text-[11px] text-ink/40 text-center mt-2">支援直接按 Ctrl+V 貼上剪貼簿圖片</p>
        </div>

        {/* 搜尋 */}
        <div className="bg-white rounded-full shadow-card px-4 py-2.5 mb-4 flex items-center gap-2">
          <span className="text-ink/40">🔍</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋標題、網址或備註…"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-ink/40"
          />
          {keyword && (
            <button onClick={() => setKeyword('')} className="text-ink/40 text-sm px-1">✕</button>
          )}
        </div>

        {/* 分類資料夾卡片 */}
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="font-semibold text-sm text-ink/70">我的分類</h2>
          <button onClick={() => setCategoryModal(true)} className="text-brand text-sm font-medium">＋ 新增分類</button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`text-left bg-white rounded-3xl shadow-card p-4 active:scale-[0.98] transition ${selectedCategory === 'all' ? 'ring-2 ring-brand' : ''}`}
          >
            <div className="text-2xl mb-1">🗂️</div>
            <div className="font-semibold">全部書籤</div>
            <div className="text-xs text-ink/50">{bookmarks.length} 則</div>
          </button>
          {categories.map((cat) => (
            <div
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`relative text-left bg-white rounded-3xl shadow-card p-4 cursor-pointer active:scale-[0.98] transition ${selectedCategory === cat.id ? 'ring-2 ring-brand' : ''}`}
            >
              <div className="w-8 h-8 rounded-xl mb-1 flex items-center justify-center text-lg" style={{ backgroundColor: (cat.color || '#1F6FEB') + '22' }}>📁</div>
              <div className="font-semibold pr-5">{cat.name}</div>
              <div className="text-xs text-ink/50">{countByCategory[cat.id] || 0} 則</div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat) }}
                className="absolute top-3 right-3 text-ink/30 hover:text-red-500 text-sm px-1"
                aria-label={`刪除分類 ${cat.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          {(countByCategory['uncategorized'] || 0) > 0 && (
            <button
              onClick={() => setSelectedCategory('uncategorized')}
              className={`text-left bg-white rounded-3xl shadow-card p-4 active:scale-[0.98] transition ${selectedCategory === 'uncategorized' ? 'ring-2 ring-brand' : ''}`}
            >
              <div className="text-2xl mb-1">📥</div>
              <div className="font-semibold">未分類</div>
              <div className="text-xs text-ink/50">{countByCategory['uncategorized']} 則</div>
            </button>
          )}
        </div>

        {/* 書籤清單 */}
        <h2 className="font-semibold text-sm text-ink/70 mb-2 px-1">
          {selectedCategory === 'all' ? '全部書籤' : selectedCategory === 'uncategorized' ? '未分類' : categoryName(selectedCategory)}
          <span className="text-ink/40 font-normal"> ・ {visibleBookmarks.length} 則</span>
        </h2>
        {visibleBookmarks.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-card p-8 text-center text-ink/40 text-sm">
            {keyword ? '沒有符合搜尋的書籤' : '還沒有書籤，貼上網址收藏第一則吧'}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleBookmarks.map((b) => (
              <div key={b.id} className="bg-white rounded-3xl shadow-card p-4">
                {b.type === 'image' && b.imageUrl ? (
                  <div>
                    <a href={b.imageUrl} target="_blank" rel="noreferrer" className="block mb-3">
                      <img
                        src={b.imageUrl}
                        alt={b.title || '圖片書籤'}
                        loading="lazy"
                        className="w-full max-h-64 object-cover rounded-2xl bg-paper"
                      />
                    </a>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <a href={b.imageUrl} target="_blank" rel="noreferrer" className="font-semibold leading-snug block truncate">{b.title || '圖片書籤'}</a>
                        {b.note && <p className="text-sm text-ink/60 mt-1.5 whitespace-pre-wrap">{b.note}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: categoryColor(b.categoryId) }}>
                            {categoryName(b.categoryId)}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-paper text-ink/60">🖼️ 圖片</span>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteBookmark(b.id)} className="text-ink/30 hover:text-red-500 text-sm px-1" aria-label="刪除書籤">✕</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {faviconUrl(b.url) && <img src={faviconUrl(b.url)} alt="" className="w-6 h-6 rounded-md mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <a href={b.url} target="_blank" rel="noreferrer" className="font-semibold leading-snug block truncate">{b.title}</a>
                      <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-brand block truncate mt-0.5">{b.url}</a>
                      {b.note && <p className="text-sm text-ink/60 mt-1.5 whitespace-pre-wrap">{b.note}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: categoryColor(b.categoryId) }}>
                          {categoryName(b.categoryId)}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteBookmark(b.id)} className="text-ink/30 hover:text-red-500 text-sm px-1" aria-label="刪除書籤">✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 儲存書籤視窗（同時是 ?url= 帶入與圖片上傳時的分類選擇視窗） */}
      {saveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => { if (!saving) closeSaveModal() }}>
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-7 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">{saveModal.type === 'image' ? '收藏圖片' : '收藏書籤'}</h3>
              {saveModal.analyzing && (
                <span className="text-xs text-brand bg-brand/10 px-2.5 py-1 rounded-full">✨ AI 辨識中…</span>
              )}
            </div>
            {saveModal.type === 'image' ? (
              <div className="mb-3">
                <img
                  src={saveModal.imagePreviewUrl}
                  alt="圖片預覽"
                  className="w-full max-h-48 object-contain rounded-2xl bg-paper"
                />
              </div>
            ) : (
              <>
                <label className="block text-xs text-ink/50 mb-1">網址</label>
                <input
                  value={saveModal.url}
                  onChange={(e) => setSaveModal({ ...saveModal, url: e.target.value })}
                  className="w-full bg-paper rounded-2xl px-4 py-3 text-sm outline-none mb-3"
                  inputMode="url"
                />
              </>
            )}
            <label className="block text-xs text-ink/50 mb-1">標題</label>
            <input
              value={saveModal.title}
              onChange={(e) => setSaveModal({ ...saveModal, title: e.target.value, titleEdited: true })}
              className="w-full bg-paper rounded-2xl px-4 py-3 text-sm outline-none mb-3"
              placeholder="幫這則書籤取個名字"
            />
            <label className="block text-xs text-ink/50 mb-1">備註</label>
            <textarea
              value={saveModal.note}
              onChange={(e) => setSaveModal({ ...saveModal, note: e.target.value, noteEdited: true })}
              className="w-full bg-paper rounded-2xl px-4 py-3 text-sm outline-none mb-4 resize-none"
              rows={3}
              placeholder="為什麼存這則？（可留空）"
            />
            <label className="block text-xs text-ink/50 mb-2">選擇分類</label>
            <div className="flex flex-wrap gap-2 mb-5">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSaveModal({ ...saveModal, categoryId: cat.id })}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition ${saveModal.categoryId === cat.id ? 'text-white' : 'bg-paper text-ink'}`}
                  style={saveModal.categoryId === cat.id ? { backgroundColor: cat.color || '#1F6FEB' } : {}}
                >
                  {cat.name}
                </button>
              ))}
              <button
                onClick={() => setSaveModal({ ...saveModal, categoryId: '' })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${saveModal.categoryId === '' ? 'bg-ink text-white' : 'bg-paper text-ink'}`}
              >
                未分類
              </button>
            </div>
            <div className="flex gap-2">
              <button
                disabled={saving}
                onClick={closeSaveModal}
                className="flex-1 py-3 rounded-2xl bg-paper font-medium active:scale-[0.98] transition disabled:opacity-50"
              >
                取消
              </button>
              <button
                disabled={saving}
                onClick={handleSaveBookmark}
                className="flex-1 py-3 rounded-2xl bg-brand text-white font-semibold active:scale-[0.98] transition disabled:opacity-60"
              >
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增分類視窗 */}
      {categoryModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setCategoryModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-7" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">新增分類</h3>
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory() }}
              placeholder="分類名稱，例如：投資理財"
              className="w-full bg-paper rounded-2xl px-4 py-3 text-sm outline-none mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setCategoryModal(false)} className="flex-1 py-3 rounded-2xl bg-paper font-medium active:scale-[0.98] transition">取消</button>
              <button onClick={handleAddCategory} className="flex-1 py-3 rounded-2xl bg-brand text-white font-semibold active:scale-[0.98] transition">建立</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-white text-sm px-5 py-2.5 rounded-full shadow-card z-[60]">
          {toast}
        </div>
      )}
    </div>
  )
}
