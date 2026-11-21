// Saves a Blob as a file download.
//
// The anchor must be in the DOM (Firefox ignores clicks on detached anchors)
// and the object URL must outlive the click: revoking it synchronously right
// after `a.click()` makes Safari/iPad abort the download silently — no file
// and no error. Revoke it later instead.
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
