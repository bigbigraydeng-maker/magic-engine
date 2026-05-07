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
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Upload Brief Materials</h2>
        <p className="text-slate-600 text-sm">
          Upload existing brand documents (PDF, DOCX, TXT) and reference URLs.
          We&apos;ll use these in Step 5 to generate the Master Brief.
        </p>
      </div>

      {/* File upload */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Brand Documents <span className="text-slate-400">(optional, max 10 files)</span>
        </label>

        <label
          className={`block w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            uploading
              ? 'border-blue-300 bg-blue-50 cursor-wait'
              : 'border-slate-300 hover:border-blue-400 bg-slate-50'
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
          <p className="text-sm text-slate-600">
            {uploading ? 'Uploading…' : '📎 Click to add a file'}
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF · DOCX · TXT</p>
        </label>

        {uploadError && (
          <p className="mt-2 text-sm text-red-600">{uploadError}</p>
        )}

        {uploadedFiles.length > 0 && (
          <ul className="mt-3 space-y-2">
            {uploadedFiles.map((f) => (
              <li
                key={f.path}
                className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm"
              >
                <span className="text-emerald-800 truncate">📄 {f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.path)}
                  className="text-emerald-600 hover:text-red-600 text-xs ml-3"
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
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Reference URLs <span className="text-slate-400">(optional, max 5)</span>
        </label>
        <div className="space-y-2">
          {websiteUrls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => updateUrl(i, e.target.value)}
                placeholder="https://example.com/about"
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
              {websiteUrls.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeUrl(i)}
                  className="px-3 text-slate-400 hover:text-red-600"
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
            className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + Add another URL
          </button>
        )}
      </div>

      {/* Skip notice */}
      {!hasInputs && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          ⚠️ You can skip this step, but the Master Brief will rely solely on Site Audit
          and SEMrush. We strongly recommend uploading at least one document or URL.
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="px-6 py-3 text-slate-600 hover:text-slate-900 font-medium"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={loading}
            className="px-6 py-3 text-slate-600 hover:text-slate-900 font-medium border border-slate-300 rounded-lg"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || uploading}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
          >
            Continue to Step 3 →
          </button>
        </div>
      </div>
    </div>
  )
}
