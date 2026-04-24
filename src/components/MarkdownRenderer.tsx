import React, { useCallback, useEffect, useRef } from 'react'

interface MarkdownRendererProps {
  content: string
}

// Only allow safe URL protocols
const isSafeUrl = (url: string): boolean => {
  const trimmed = url.trim().toLowerCase()
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('ipfs://') ||
    trimmed.startsWith('mailto:')
  )
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle link clicks: open in external browser (important for Electron)
  const handleLinkClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return

    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (!href || !isSafeUrl(href)) return

    // Use Electron shell.openExternal if available, otherwise window.open
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(href)
    } else {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('click', handleLinkClick)
    return () => container.removeEventListener('click', handleLinkClick)
  }, [handleLinkClick])

  // Simple Markdown renderer with basic syntax support
  const renderMarkdown = (text: string): string => {
    let html = text

    // Escape HTML special characters to prevent injection
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')

    // Headings
    html = html.replace(
      /^### (.*$)/gim,
      '<h3 class="text-lg font-semibold text-gray-900 dark:text-white mt-6 mb-3">$1</h3>',
    )
    html = html.replace(
      /^## (.*$)/gim,
      '<h2 class="text-xl font-bold text-gray-900 dark:text-white mt-8 mb-4">$1</h2>',
    )
    html = html.replace(
      /^# (.*$)/gim,
      '<h1 class="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-6">$1</h1>',
    )

    // Bold and italic
    html = html.replace(
      /\*\*(.*?)\*\*/g,
      '<strong class="font-semibold text-gray-900 dark:text-white">$1</strong>',
    )
    html = html.replace(
      /\*(.*?)\*/g,
      '<em class="italic text-gray-700 dark:text-gray-300">$1</em>',
    )

    // Code blocks
    html = html.replace(
      /```([\s\S]*?)```/g,
      '<pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto my-4"><code class="text-sm text-gray-800 dark:text-gray-200">$1</code></pre>',
    )

    // Inline code
    html = html.replace(
      /`(.*?)`/g,
      '<code class="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-sm text-gray-800 dark:text-gray-200">$1</code>',
    )

    // Links - sanitize href to prevent javascript: protocol injection
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, text, url) => {
        const decodedUrl = url.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
        if (!isSafeUrl(decodedUrl)) {
          // Render as plain text if URL is not safe
          return `<span class="text-gray-500">[${text}]</span>`
        }
        return `<a href="${url}" class="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    )

    // Unordered lists
    html = html.replace(
      /^\* (.*$)/gim,
      '<li class="ml-4 mb-1 text-gray-700 dark:text-gray-300">• $1</li>',
    )
    html = html.replace(
      /^- (.*$)/gim,
      '<li class="ml-4 mb-1 text-gray-700 dark:text-gray-300">• $1</li>',
    )

    // Ordered lists
    html = html.replace(
      /^\d+\. (.*$)/gim,
      '<li class="ml-4 mb-1 text-gray-700 dark:text-gray-300 list-decimal">$1</li>',
    )

    // Blockquotes
    html = html.replace(
      /^> (.*$)/gim,
      '<blockquote class="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 dark:bg-blue-900/20 text-gray-700 dark:text-gray-300 italic">$1</blockquote>',
    )

    // Horizontal rules
    html = html.replace(
      /^---$/gim,
      '<hr class="border-gray-300 dark:border-gray-600 my-6">',
    )

    // Paragraphs (line breaks)
    html = html.replace(
      /\n\n/g,
      '</p><p class="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">',
    )
    html = html.replace(/\n/g, '<br>')

    // Wrap in paragraph
    if (html && !html.startsWith('<')) {
      html =
        '<p class="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">' +
        html +
        '</p>'
    }

    return html
  }

  return (
    <div
      ref={containerRef}
      className="prose prose-lg dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )
}

export default MarkdownRenderer
