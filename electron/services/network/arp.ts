import { execFile } from 'node:child_process'

const IPV4_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/
const MAC_RE = /\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i

/** Chuẩn hoá về dạng `AA:BB:CC:DD:EE:FF`. Nhận cả `aa-bb-..`, `aabb.ccdd.eeff`, `aabbccddeeff`. */
export function normalizeMac(input: string): string | null {
  if (!/^[0-9a-f:.\-\s]+$/i.test(input)) return null
  const hex = input.replace(/[^0-9a-f]/gi, '').toUpperCase()
  if (hex.length !== 12) return null
  return hex.match(/.{2}/g)!.join(':')
}

/** Đọc bảng ARP của hệ điều hành: IP -> MAC của những máy vừa liên lạc gần đây. */
export function readArpTable(): Promise<Map<string, string>> {
  const args = process.platform === 'win32' ? ['-a'] : ['-an']
  return new Promise((resolve) => {
    execFile('arp', args, { windowsHide: true, timeout: 10_000 }, (_err, stdout) => {
      const table = new Map<string, string>()
      for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const ip = IPV4_RE.exec(line)?.[1]
        const rawMac = MAC_RE.exec(line)?.[1]
        if (!ip || !rawMac) continue
        // macOS bỏ số 0 đứng đầu mỗi cặp ("a:b:c..."), nên phải đệm lại.
        const mac = rawMac
          .split(/[:-]/)
          .map((part) => part.padStart(2, '0'))
          .join(':')
          .toUpperCase()
        // Bỏ địa chỉ broadcast và multicast.
        if (mac === 'FF:FF:FF:FF:FF:FF' || mac.startsWith('01:00:5E')) continue
        table.set(ip, mac)
      }
      resolve(table)
    })
  })
}
