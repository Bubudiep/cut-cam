import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { readArpTable } from './arp'

const RTSP_PORTS = [554, 8554]
const CONNECT_TIMEOUT_MS = 800
const CONCURRENCY = 128
/** Mạng lớn hơn /22 thì chỉ quét /24 quanh địa chỉ của máy, để không quét hàng chục nghìn máy. */
const MAX_HOSTS = 1022
const WS_DISCOVERY_ADDRESS = '239.255.255.250'
const WS_DISCOVERY_PORT = 3702
const WS_DISCOVERY_WAIT_MS = 2500

export interface ScanHit {
  ip: string
  mac: string
  name: string
  rtspPorts: number[]
  onvif: boolean
}

const toInt = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
const toIp = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.')

function localInterfaces(): { address: string; netmask: string }[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
}

/** Mọi địa chỉ máy trong các mạng LAN mà máy này đang nối vào. */
export function lanHosts(): string[] {
  const hosts = new Set<string>()
  for (const iface of localInterfaces()) {
    const address = toInt(iface.address)
    let mask = toInt(iface.netmask)
    if (2 ** 32 - mask - 2 > MAX_HOSTS) mask = toInt('255.255.255.0')
    const network = (address & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    for (let n = network + 1; n < broadcast; n++) hosts.add(toIp(n))
  }
  return [...hosts]
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

/**
 * Thử nối TCP tới `ports` trên mọi máy trong LAN. Ngoài việc tìm cổng mở, việc thử nối
 * còn khiến hệ điều hành hỏi MAC của từng máy, nên sau đó bảng ARP có đủ IP -> MAC.
 */
export async function sweep(ports: number[]): Promise<Map<string, number[]>> {
  const jobs = lanHosts().flatMap((ip) => ports.map((port) => ({ ip, port })))
  const open = new Map<string, number[]>()
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      if (await isPortOpen(job.ip, job.port)) open.set(job.ip, [...(open.get(job.ip) ?? []), job.port])
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return open
}

function probeMessage(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"' +
    ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"' +
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"' +
    ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
    `<e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID>` +
    '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
    '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>' +
    '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>'
  )
}

/** Dò tìm ONVIF (WS-Discovery): camera tự trả lời gói multicast kèm tên của nó. Trả về IP -> tên. */
function onvifDiscover(): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const sockets = localInterfaces().map((iface) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', () => {})
    socket.on('message', (message, remote) => {
      const text = message.toString('utf8')
      if (!/ProbeMatch/i.test(text)) return
      const scope = (key: string) => {
        const value = new RegExp(`onvif://www\\.onvif\\.org/${key}/([^\\s<]+)`, 'i').exec(text)?.[1]
        try {
          return value ? decodeURIComponent(value) : ''
        } catch {
          return value ?? ''
        }
      }
      found.set(remote.address, scope('name') || scope('hardware') || found.get(remote.address) || '')
    })
    socket.bind(0, iface.address, () => {
      const payload = Buffer.from(probeMessage())
      // UDP không đảm bảo tới nơi: gửi hai lần.
      for (const delay of [0, 500]) {
        setTimeout(() => socket.send(payload, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDRESS, () => {}), delay)
      }
    })
    return socket
  })
  return new Promise((resolve) => {
    setTimeout(() => {
      for (const socket of sockets) {
        try {
          socket.close()
        } catch {
          // Socket chưa kịp bind.
        }
      }
      resolve(found)
    }, WS_DISCOVERY_WAIT_MS)
  })
}

/** Quét mạng LAN: thiết bị trả lời ONVIF hoặc đang mở cổng RTSP. */
export async function scanLan(): Promise<ScanHit[]> {
  const [onvif, rtsp] = await Promise.all([onvifDiscover(), sweep(RTSP_PORTS)])
  const arp = await readArpTable()
  const ips = new Set([...onvif.keys(), ...rtsp.keys()])
  return [...ips]
    .sort((a, b) => toInt(a) - toInt(b))
    .map((ip) => ({
      ip,
      mac: arp.get(ip) ?? '',
      name: onvif.get(ip) ?? '',
      rtspPorts: rtsp.get(ip) ?? [],
      onvif: onvif.has(ip),
    }))
}

/** Tìm IP hiện tại của một địa chỉ MAC. `allowSweep` cho phép quét cả mạng nếu bảng ARP chưa có. */
export async function findIpByMac(mac: string, allowSweep: boolean): Promise<string | null> {
  const lookup = async () => {
    for (const [ip, entry] of await readArpTable()) if (entry === mac) return ip
    return null
  }
  const cached = await lookup()
  if (cached || !allowSweep) return cached
  await sweep([RTSP_PORTS[0]])
  return lookup()
}
