/**
 * Reusable Component: CodeSnippetBox
 *
 * Displays code snippets with copy-to-clipboard functionality.
 * Used for GEO directive snippet display and other code examples.
 */

'use client';

import React, { useState } from 'react';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';

interface CodeSnippetBoxProps {
  code: string;
  language?: string;
  title?: string;
  copyable?: boolean;
  onCopy?: () => void;
}

export function CodeSnippetBox({
  code,
  language = 'html',
  title,
  copyable = true,
  onCopy,
}: CodeSnippetBoxProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: user will see error notification from parent
    }
  };

  return (
    <div className="bg-me-ivory border border-black/10 rounded-lg overflow-hidden">
      {title && (
        <div className="flex justify-between items-center px-4 py-3 border-b border-black/10 bg-me-ivory">
          <span className="text-sm font-semibold text-me-charcoal/75">{title}</span>
          {copyable && (
            <button
              onClick={handleCopy}
              className="text-xs px-3 py-1 bg-white border border-black/15 rounded hover:bg-me-ivory transition"
            >
              {copied ? DEPLOYMENT_CONFIG.LABELS.COPIED : DEPLOYMENT_CONFIG.LABELS.COPY_SNIPPET}
            </button>
          )}
        </div>
      )}
      <pre className="p-4 overflow-x-auto bg-me-charcoal/90 text-me-ivory text-sm leading-relaxed">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}
