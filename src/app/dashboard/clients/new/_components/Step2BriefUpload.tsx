'use client'

import { useState } from 'react'

export interface Step2Data {
  storagePaths: string[]
  websiteUrls: string[]
  uploadedFiles: { name: string; path: string }[]
}

interface Props {
  clientId: string
  initial: Step2Data
  onSubmit: (data: Step2Data) => void
  onSkip: () => void
  onBack: () => void
  loading: boolean
}

export default function Step2BriefUpload({
  clientId,
  initial,
  onSubmit,
  onSkip,
  onBack,
  loading,
}: Props) {
  const [uploadedFiles, setUploadedFiles] = useState(initial.uploadedFiles)
  const [storagePaths, setStoragePaths] = useState<string[]>(initial.storagePaths)
  const [websiteUrls, setWebsiteUrls] = useState<string[]>(
    initial.websiteUrls.length > 0 ? initial.websiteUrls : ['']
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    if (uploadedFiles.length >= 10) {
      setUploadError('Maximum 10 files. Remove some to add more.')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/clients/${clientId}/brief/upload`, {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      const path: string = json.file?.storage_path ?? ''
      if (!path) throw new Error('Upload succeeded but no storage path returned')
      setUploadedFiles((prev) => [...prev, { name: file.name, path }])
      setStoragePaths((prev) => [...prev, path])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const removeFile = (path: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.path !== path))
    setStoragePaths((prev) => prev.filter((p) => p !== path))
  }

  const updateUrl = (i: number, value: string) => {
    setWebsiteUrls((prev) => prev.map((u, idx) => (idx === i ? value : u)))
  }

  const addUrl = () => {
    if (websiteUrls.length < 5) setWebsiteUrls((prev) => [...prev, ''])
  }

  const removeUrl = (i: number) => {
    setWebsiteUrls((prev) => prev.filter((_, idx) => idx !== i))
  }

  const submit = () => {
    onSubmit({
      storagePaths,
      websiteUrls: websiteUrls.map((u) => u.trim()).filter(Boolean),
      uploadedFiles,
    })
  }

  const hasInputs = storagePaths.length > 0 || websiteUrls.some((u) => u.trim())

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-me-charcoal/90 mb-1">Upload Brief Materials</h2>
        <p className="text-me-charcoal/60 text-sm">
          Upload existing brand documents (PDF, DOCX, TXT) and reference URLs.
          We&apos;ll use these in Step 5 to generate the Master Brief.
        </p>
      </div>

      {/* File upload */}
      <div>
        <label className="block text-sm font-medium text-me-charcoal/75 mb-2">
          Brand Documents <span className="text-me-charcoal/45">(optional, max 10 files)</span>
        </label>

        <label
          className={`block w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            uploading
              ? 'border-me-ochre/50 bg-me-ochre/10 cursor-wait'
              : 'border-black/15 hover:border-me-ochre/50 bg-me-ivory'
          }`}
        >
          <input
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt"
            disabled={uploading || loading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
          <p className="text-sm text-me-charcoal/60">
            {uploading ? 'Uploading…' : '📎 Click to add a file'}
          </p>
          <p className="text-xs text-me-charcoal/45 mt-1">PDF · DOCX · TXT</p>
        </label>

        {uploadError && (
          <p className="mt-2 text-sm text-[#C2453A]">{uploadError}</p>
        )}

        {uploadedFiles.length > 0 && (
          <ul className="mt-3 space-y-2">
            {uploadedFiles.map((f) => (
              <li
                key={f.path}
                className="flex items-center justify-between px-3 py-2 bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded-lg text-sm"
              >
                <span className="text-[#5C8A4A] truncate">📄 {f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.path)}
                  className="text-[#5C8A4A] hover:text-[#C2453A] text-xs ml-3"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reference URLs */}
      <div>
        <label className="block text-sm font-medium text-me-charcoal/75 mb-2">
          Reference URLs <span className="text-me-charcoal/45">(optional, max 5)</span>
        </label>
        <div className="space-y-2">
          {websiteUrls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => updateUrl(i, e.target.value)}
                placeholder="https://example.com/about"
                className="flex-1 px-4 py-2 rounded-lg border border-black/15 bg-white text-me-charcoal/90 hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-me-ochre"
                disabled={loading}
              />
              {websiteUrls.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeUrl(i)}
                  className="px-3 text-me-charcoal/45 hover:text-[#C2453A]"
                  aria-label="Remove URL"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {websiteUrls.length < 5 && (
          <button
            type="button"
            onClick={addUrl}
            className="mt-2 text-sm text-me-ochre hover:text-me-ochre font-medium"
          >
            + Add another URL
          </button>
        )}
      </div>

      {/* Skip notice */}
      {!hasInputs && (
        <div className="p-3 bg-me-ochre/10 border border-me-ochre/30 rounded-lg text-xs text-me-ochre">
          ⚠️ You can skip this step, but the Master Brief will rely solely on Site Audit
          and Keyword Intelligence. We strongly recommend uploading at least one document or URL.
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 font-medium"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={loading}
            className="px-6 py-3 text-me-charcoal/60 hover:text-me-charcoal/90 font-medium border border-black/15 rounded-lg"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || uploading}
            className="px-6 py-3 bg-me-ochre hover:bg-me-ochre disabled:bg-me-charcoal/25 text-white font-semibold rounded-lg transition-colors"
          >
            Continue to Step 3 →
          </button>
        </div>
      </div>
    </div>
  )
}
