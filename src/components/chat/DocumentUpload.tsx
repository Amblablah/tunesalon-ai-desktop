import { useState, useEffect, useRef } from 'react'
import { uploadDocument, getDocuments, removeDocument, getDoclingStatus, installDocling, type UploadedDocument } from '../../api/chat'
import Spinner from '../shared/Spinner'

export default function DocumentUpload() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [doclingNeeded, setDoclingNeeded] = useState(false)
  const [doclingInstalling, setDoclingInstalling] = useState(false)
  const [doclingProgress, setDoclingProgress] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadDocuments = async () => {
    try {
      const docs = await getDocuments()
      setDocuments(docs)
    } catch { /* ignore if endpoint not available */ }
  }

  useEffect(() => {
    loadDocuments()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleInstallDocling = async () => {
    setDoclingInstalling(true)
    setDoclingProgress('Starting install...')
    setError(null)
    try {
      await installDocling()
      // Poll for status until done
      pollRef.current = setInterval(async () => {
        try {
          const status = await getDoclingStatus()
          setDoclingProgress(status.progress)
          if (!status.installing) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setDoclingInstalling(false)
            if (status.installed) {
              setDoclingNeeded(false)
              setDoclingProgress(null)
            } else {
              setError(status.progress || 'Install failed. Please try again.')
            }
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setDoclingInstalling(false)
          setError('Lost connection while installing. Please try again.')
        }
      }, 2000)
    } catch (err) {
      setDoclingInstalling(false)
      setError(err instanceof Error ? err.message : 'Failed to start install')
    }
  }

  const handleUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.docx,.txt'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setUploading(true)
      setError(null)
      setDoclingNeeded(false)

      setUploadStatus('Uploading...')

      try {
        await uploadDocument(file)
        setUploadStatus(null)
        await loadDocuments()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        if (msg === 'DOCLING_NOT_INSTALLED') {
          setDoclingNeeded(true)
          setError(null)
        } else {
          setError(msg)
        }
        setUploadStatus(null)
      } finally {
        setUploading(false)
      }
    }
    input.click()
  }

  const handleRemove = async (filename: string) => {
    try {
      await removeDocument(filename)
      await loadDocuments()
    } catch {
      setError(`Could not remove "${filename}". Try unloading the model first.`)
    }
  }

  const formatSize = (chars: number) => {
    if (chars < 1000) return `${chars} chars`
    if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}K chars`
    return `${(chars / 1_000_000).toFixed(1)}M chars`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Documents
        </h3>
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Hardware requirements"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Upload documents for context-aware answers with citations.
      </p>

      {/* Hardware info panel */}
      {showInfo && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 space-y-1.5">
          <p className="text-[11px] font-medium text-blue-800 dark:text-blue-300">
            About document processing
          </p>
          <ul className="text-[10px] text-blue-700 dark:text-blue-400 space-y-0.5">
            <li>Upload PDF, Word, or text files for context-aware answers</li>
            <li>PDFs are analysed for tables and layout (may take a few seconds)</li>
            <li>Your documents stay on your machine — nothing is uploaded to the cloud</li>
          </ul>
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="w-full rounded-md border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Spinner className="h-3.5 w-3.5" />
            <span className="text-center">{uploadStatus || 'Uploading...'}</span>
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload PDF, DOCX, or TXT
          </>
        )}
      </button>

      {/* Document list */}
      {documents.map((doc) => (
        <div
          key={doc.filename}
          className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
              {doc.filename}
            </span>
            <button
              onClick={() => handleRemove(doc.filename)}
              className="text-xs text-red-500 hover:text-red-600 shrink-0"
            >
              Remove
            </button>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {doc.pages} {doc.pages === 1 ? 'page' : 'pages'} · {doc.chunks} chunks · {formatSize(doc.characters)}
          </div>
        </div>
      ))}

      {/* Docling install prompt */}
      {doclingNeeded && !doclingInstalling && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 space-y-2">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            PDF processing needs a one-time setup to enable accurate table and layout extraction.
          </p>
          <button
            onClick={handleInstallDocling}
            className="w-full rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
          >
            Install PDF Processing (one-time)
          </button>
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            This downloads about 100 MB and takes 1-3 minutes. DOCX and TXT files work without this.
          </p>
        </div>
      )}

      {/* Docling installing progress */}
      {doclingInstalling && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            {doclingProgress || 'Installing...'}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
        PDFs up to 50 pages use AI extraction for accurate tables and layout.
        Larger PDFs use fast text extraction.
      </p>
    </div>
  )
}
