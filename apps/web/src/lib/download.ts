export function downloadData(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'text/plain' })
  const url = window.URL.createObjectURL(blob)
  downloadLink(url, filename)
  window.URL.revokeObjectURL(url)
}

export function downloadLink(url: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
}
