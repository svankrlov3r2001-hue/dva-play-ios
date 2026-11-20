const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SWIFT_PATCH_MARKER = 'DVA_NATIVE_PROXY_PATCHED';
const OBJC_PATCH_MARKER = 'DVA_NATIVE_PROXY_WEBVIEW_PATCHED';
const VIDEO_MODULE_PATCH_MARKER = 'DVA_IOS_VIDEO_CONTRAST_MODULE_V1';
const VIDEO_VIEW_PATCH_MARKER = 'DVA_IOS_VIDEO_CONTRAST_VIEW_V1';

function applyExpoFetchModulePatch(sourceText) {
  const normalized = String(sourceText || '').replace(/\r\n/g, '\n');
  if (normalized.includes(SWIFT_PATCH_MARKER)) {
    return normalized;
  }

  const importTarget = '@preconcurrency import ExpoModulesCore';
  if (!normalized.includes(importTarget)) {
    throw new Error('Could not find @preconcurrency import ExpoModulesCore in ExpoFetchModule.swift');
  }

  const providerTarget =
    'nonisolated(unsafe) internal var urlSessionConfigurationProvider: URLSessionConfigurationProvider?';
  if (!normalized.includes(providerTarget)) {
    throw new Error('Could not find urlSessionConfigurationProvider anchor in ExpoFetchModule.swift');
  }

  const classTarget = 'public final class ExpoFetchModule: Module {\n  private lazy var urlSession = createURLSession()';
  if (!normalized.includes(classTarget)) {
    throw new Error('Could not find ExpoFetchModule class properties anchor in ExpoFetchModule.swift');
  }

  const onDestroyTarget = `    OnDestroy {\n      urlSession.invalidateAndCancel()\n    }`;
  if (!normalized.includes(onDestroyTarget)) {
    throw new Error('Could not find OnDestroy anchor in ExpoFetchModule.swift');
  }

  const createSessionTarget = `  private func createURLSession() -> URLSession {\n    let config: URLSessionConfiguration`;
  if (!normalized.includes(createSessionTarget)) {
    throw new Error('Could not find createURLSession anchor in ExpoFetchModule.swift');
  }

  const createReturnTarget = `    return URLSession(configuration: config, delegate: urlSessionDelegate, delegateQueue: nil)\n  }`;
  if (!normalized.includes(createReturnTarget)) {
    throw new Error('Could not find createURLSession return anchor in ExpoFetchModule.swift');
  }

  let updated = normalized.replace(
    importTarget,
    `// ${SWIFT_PATCH_MARKER}
@preconcurrency import ExpoModulesCore
import Foundation
import Darwin
#if canImport(Network)
import Network
#endif
#if os(iOS) && canImport(WebKit)
import WebKit
#endif`
  );

  updated = updated.replace(
    providerTarget,
    `${providerTarget}

private struct DvaProxySpec: Sendable {
  let host: String
  let port: UInt16
  let username: String
  let password: String
}

private let dvaProxyStateLock = NSLock()
nonisolated(unsafe) private var dvaSharedProxySpec: DvaProxySpec? = nil

private func dvaSetSharedProxySpec(_ spec: DvaProxySpec?) {
  dvaProxyStateLock.lock()
  dvaSharedProxySpec = spec
  dvaProxyStateLock.unlock()
}

private func dvaGetSharedProxySpec() -> DvaProxySpec? {
  dvaProxyStateLock.lock()
  let spec = dvaSharedProxySpec
  dvaProxyStateLock.unlock()
  return spec
}

private func dvaConfigureSocketNoSigPipe(_ fd: Int32) {
  var one: Int32 = 1
  _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
}

private func dvaSetSocketTimeouts(_ fd: Int32, seconds: Int) {
  var tv = timeval(tv_sec: seconds, tv_usec: 0)
  _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
  _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
}

private func dvaWriteAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
  if bytes.isEmpty {
    return true
  }
  return bytes.withUnsafeBytes { rawBuf in
    guard let base = rawBuf.baseAddress else {
      return false
    }
    var sent = 0
    let total = rawBuf.count
    while sent < total {
      let n = Darwin.send(fd, base.advanced(by: sent), total - sent, 0)
      if n < 0 {
        if errno == EINTR {
          continue
        }
        return false
      }
      if n == 0 {
        return false
      }
      sent += n
    }
    return true
  }
}

private func dvaConnectUpstream(host: String, port: UInt16, timeoutMs: Int32) -> Int32 {
  var hints = addrinfo()
  hints.ai_family = AF_UNSPEC
  hints.ai_socktype = SOCK_STREAM
  hints.ai_protocol = IPPROTO_TCP

  var res: UnsafeMutablePointer<addrinfo>? = nil
  let portStr = String(port)
  let status = host.withCString { hostCStr in
    portStr.withCString { portCStr in
      getaddrinfo(hostCStr, portCStr, &hints, &res)
    }
  }
  if status != 0 || res == nil {
    return -1
  }
  defer {
    freeaddrinfo(res)
  }

  var ptr = res
  while let info = ptr {
    let fd = Darwin.socket(info.pointee.ai_family, info.pointee.ai_socktype, info.pointee.ai_protocol)
    if fd >= 0 {
      dvaConfigureSocketNoSigPipe(fd)
      let flags = Darwin.fcntl(fd, F_GETFL, 0)
      _ = Darwin.fcntl(fd, F_SETFL, flags | O_NONBLOCK)

      let cRes = Darwin.connect(fd, info.pointee.ai_addr, info.pointee.ai_addrlen)
      var connected = false
      if cRes == 0 {
        connected = true
      } else if errno == EINPROGRESS {
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        let pRes = Darwin.poll(&pfd, 1, timeoutMs)
        if pRes > 0 && (pfd.revents & Int16(POLLOUT)) != 0 {
          var soErr: Int32 = 0
          var soLen = socklen_t(MemoryLayout<Int32>.size)
          if Darwin.getsockopt(fd, SOL_SOCKET, SO_ERROR, &soErr, &soLen) == 0 && soErr == 0 {
            connected = true
          }
        }
      }

      if connected {
        _ = Darwin.fcntl(fd, F_SETFL, flags)
        dvaSetSocketTimeouts(fd, seconds: 60)
        return fd
      }
      _ = Darwin.close(fd)
    }
    ptr = info.pointee.ai_next
  }
  return -1
}

private func dvaHandleRelayClient(
  clientFd: Int32,
  upstreamSpec: DvaProxySpec,
  onAuthFail: @escaping @Sendable () -> Void
) {
  dvaConfigureSocketNoSigPipe(clientFd)
  dvaSetSocketTimeouts(clientFd, seconds: 15)

  var reqBuf = [UInt8]()
  reqBuf.reserveCapacity(1024)
  var temp = [UInt8](repeating: 0, count: 2048)
  var headerEndIndex: Int? = nil

  while reqBuf.count < 16384 {
    let n = temp.withUnsafeMutableBytes { rawBuf -> Int in
      guard let base = rawBuf.baseAddress else { return -1 }
      return Darwin.recv(clientFd, base, rawBuf.count, 0)
    }
    if n < 0 {
      if errno == EINTR { continue }
      _ = Darwin.close(clientFd)
      return
    }
    if n == 0 {
      _ = Darwin.close(clientFd)
      return
    }
    reqBuf.append(contentsOf: temp[0..<n])
    if reqBuf.count >= 4 {
      for i in 0...(reqBuf.count - 4) {
        if reqBuf[i] == 13 && reqBuf[i + 1] == 10 && reqBuf[i + 2] == 13 && reqBuf[i + 3] == 10 {
          headerEndIndex = i
          break
        }
      }
    }
    if headerEndIndex != nil {
      break
    }
  }

  guard let endIdx = headerEndIndex else {
    _ = Darwin.close(clientFd)
    return
  }

  let headerBytes = Array(reqBuf[0..<endIdx])
  let bodyRemainder = Array(reqBuf[(endIdx + 4)..<reqBuf.count])
  var headerStr = String(decoding: headerBytes, as: UTF8.self)

  if !upstreamSpec.username.isEmpty || !upstreamSpec.password.isEmpty {
    let credData = Data("\\(upstreamSpec.username):\\(upstreamSpec.password)".utf8)
    let credB64 = credData.base64EncodedString()
    if headerStr.range(of: "Proxy-Authorization:", options: .caseInsensitive) == nil {
      headerStr += "\\r\\nProxy-Authorization: Basic \\(credB64)"
    }
  }
  if headerStr.range(of: "Proxy-Connection:", options: .caseInsensitive) == nil {
    headerStr += "\\r\\nProxy-Connection: Keep-Alive"
  }
  headerStr += "\\r\\n\\r\\n"
  var outboundInitial = Array(headerStr.utf8)
  if !bodyRemainder.isEmpty {
    outboundInitial.append(contentsOf: bodyRemainder)
  }

  let upstreamFd = dvaConnectUpstream(host: upstreamSpec.host, port: upstreamSpec.port, timeoutMs: 7000)
  if upstreamFd < 0 {
    let errResp = Array("HTTP/1.1 502 Bad Gateway\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n".utf8)
    _ = dvaWriteAll(clientFd, errResp)
    _ = Darwin.close(clientFd)
    return
  }

  if !dvaWriteAll(upstreamFd, outboundInitial) {
    _ = Darwin.close(upstreamFd)
    _ = Darwin.close(clientFd)
    return
  }

  var firstResp = [UInt8](repeating: 0, count: 4096)
  let firstN = firstResp.withUnsafeMutableBytes { rawBuf -> Int in
    guard let base = rawBuf.baseAddress else { return -1 }
    return Darwin.recv(upstreamFd, base, rawBuf.count, 0)
  }
  if firstN <= 0 {
    _ = Darwin.close(upstreamFd)
    _ = Darwin.close(clientFd)
    return
  }

  let firstChunk = Array(firstResp[0..<firstN])
  let prefixStr = String(decoding: firstChunk.prefix(32), as: UTF8.self)
  if prefixStr.hasPrefix("HTTP/1.0 407") || prefixStr.hasPrefix("HTTP/1.1 407") {
    onAuthFail()
    let forbiddenResp = Array("HTTP/1.1 502 Bad Gateway\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n".utf8)
    _ = dvaWriteAll(clientFd, forbiddenResp)
    _ = Darwin.close(upstreamFd)
    _ = Darwin.close(clientFd)
    return
  }

  if !dvaWriteAll(clientFd, firstChunk) {
    _ = Darwin.close(upstreamFd)
    _ = Darwin.close(clientFd)
    return
  }

  dvaSetSocketTimeouts(clientFd, seconds: 120)
  dvaSetSocketTimeouts(upstreamFd, seconds: 120)

  let group = DispatchGroup()
  group.enter()
  DispatchQueue.global(qos: .userInitiated).async {
    var buf = [UInt8](repeating: 0, count: 16384)
    while true {
      let r = buf.withUnsafeMutableBytes { rawBuf -> Int in
        guard let base = rawBuf.baseAddress else { return -1 }
        return Darwin.recv(clientFd, base, rawBuf.count, 0)
      }
      if r < 0 {
        if errno == EINTR { continue }
        break
      }
      if r == 0 { break }
      if !dvaWriteAll(upstreamFd, Array(buf[0..<r])) {
        break
      }
    }
    _ = Darwin.shutdown(upstreamFd, SHUT_WR)
    group.leave()
  }

  var uBuf = [UInt8](repeating: 0, count: 16384)
  while true {
    let r = uBuf.withUnsafeMutableBytes { rawBuf -> Int in
      guard let base = rawBuf.baseAddress else { return -1 }
      return Darwin.recv(upstreamFd, base, rawBuf.count, 0)
    }
    if r < 0 {
      if errno == EINTR { continue }
      break
    }
    if r == 0 { break }
    if !dvaWriteAll(clientFd, Array(uBuf[0..<r])) {
      break
    }
  }
  _ = Darwin.shutdown(clientFd, SHUT_RDWR)
  _ = Darwin.shutdown(upstreamFd, SHUT_RDWR)
  group.wait()
  _ = Darwin.close(clientFd)
  _ = Darwin.close(upstreamFd)
}

/**
 * In-app loopback HTTP CONNECT relay on 127.0.0.1:<localPort>.
 * Automatically injects "Proxy-Authorization: Basic ..." upfront on the first CONNECT/HTTP
 * packet sent to the upstream proxy and converts any upstream 407 into 502 so iOS
 * URLSession and WKWebView NEVER pop up a system proxy password alert dialog.
 */
private final class DvaLocalProxyRelay: @unchecked Sendable {
  let upstreamSpec: DvaProxySpec
  private(set) var localPort: UInt16 = 0
  private var listenFd: Int32 = -1
  private let lock = NSLock()
  private var stopped = false
  private var _sawAuthFailure = false

  var sawAuthFailure: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _sawAuthFailure
  }

  var localProxySpec: DvaProxySpec {
    return DvaProxySpec(host: "127.0.0.1", port: localPort, username: "", password: "")
  }

  init?(upstreamSpec: DvaProxySpec) {
    self.upstreamSpec = upstreamSpec
    let fd = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    if fd < 0 {
      return nil
    }
    dvaConfigureSocketNoSigPipe(fd)
    var reuse: Int32 = 1
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let bindRes = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    if bindRes != 0 || Darwin.listen(fd, 128) != 0 {
      _ = Darwin.close(fd)
      return nil
    }

    var boundAddr = sockaddr_in()
    var boundLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameRes = withUnsafeMutablePointer(to: &boundAddr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.getsockname(fd, $0, &boundLen)
      }
    }
    if nameRes != 0 {
      _ = Darwin.close(fd)
      return nil
    }
    self.localPort = UInt16(bigEndian: boundAddr.sin_port)
    if self.localPort == 0 {
      _ = Darwin.close(fd)
      return nil
    }
    self.listenFd = fd

    let specCopy = upstreamSpec
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      while true {
        let cFd = Darwin.accept(fd, nil, nil)
        if cFd < 0 {
          if errno == EINTR { continue }
          break
        }
        guard let strongSelf = self else {
          _ = Darwin.close(cFd)
          break
        }
        if strongSelf.isStopped {
          _ = Darwin.close(cFd)
          break
        }
        DispatchQueue.global(qos: .userInitiated).async {
          dvaHandleRelayClient(clientFd: cFd, upstreamSpec: specCopy) {
            strongSelf.markAuthFailure()
          }
        }
      }
    }
  }

  private var isStopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopped
  }

  private func markAuthFailure() {
    lock.lock()
    _sawAuthFailure = true
    lock.unlock()
  }

  func stop() {
    lock.lock()
    if stopped {
      lock.unlock()
      return
    }
    stopped = true
    let fd = listenFd
    listenFd = -1
    lock.unlock()
    if fd >= 0 {
      _ = Darwin.shutdown(fd, SHUT_RDWR)
      _ = Darwin.close(fd)
    }
  }

  deinit {
    stop()
  }
}

private func dvaMimeTypeForExtension(_ ext: String) -> String {
  switch ext.lowercased() {
  case "m3u8":
    return "application/vnd.apple.mpegurl"
  case "ts":
    return "video/mp2t"
  case "m4s":
    return "video/iso.segment"
  case "mp4":
    return "video/mp4"
  case "vtt":
    return "text/vtt; charset=utf-8"
  case "jpg", "jpeg":
    return "image/jpeg"
  case "png":
    return "image/png"
  case "webp":
    return "image/webp"
  case "key":
    return "application/octet-stream"
  default:
    return "application/octet-stream"
  }
}

private func dvaSendHttpText(
  clientFd: Int32,
  statusLine: String,
  body: String = "",
  contentType: String = "text/plain; charset=utf-8",
  extraHeaders: [String] = []
) {
  let bodyBytes = Array(body.utf8)
  var lines = [
    "HTTP/1.1 \\(statusLine)",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers: Range, Origin, Content-Type, Accept",
    "Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges",
    "Accept-Ranges: bytes",
    "Cache-Control: no-cache",
    "Content-Type: \\(contentType)",
    "Content-Length: \\(bodyBytes.count)",
    "Connection: close"
  ]
  if !extraHeaders.isEmpty {
    lines.append(contentsOf: extraHeaders)
  }
  var payload = Array((lines.joined(separator: "\\r\\n") + "\\r\\n\\r\\n").utf8)
  if !bodyBytes.isEmpty {
    payload.append(contentsOf: bodyBytes)
  }
  _ = dvaWriteAll(clientFd, payload)
}

private func dvaParseQueryParams(_ rawTarget: String) -> [String: String] {
  var result: [String: String] = [:]
  let parts = rawTarget.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
  guard parts.count == 2 else { return result }
  for pair in parts[1].split(separator: "&", omittingEmptySubsequences: true) {
    let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
    let rawKey = String(kv[0])
    let rawVal = kv.count > 1 ? String(kv[1]) : ""
    let key = rawKey.removingPercentEncoding ?? rawKey
    let val = rawVal.removingPercentEncoding ?? rawVal
    if !key.isEmpty {
      result[key] = val
    }
  }
  return result
}

private func dvaExtractFirstTsPts(_ data: Data) -> UInt64? {
  let bytes = [UInt8](data)
  let count = bytes.count
  guard count >= 24 else { return nil }
  var i = 0
  while i <= count - 188 {
    if bytes[i] == 0x47 {
      let nextOk = (i + 188 >= count) || (bytes[i + 188] == 0x47)
      if nextOk {
        let pusi = (bytes[i + 1] & 0x40) != 0
        if pusi {
          let afc = (bytes[i + 3] >> 4) & 0x03
          var off = i + 4
          if afc == 2 || afc == 3 {
            if off < i + 188 {
              let adLen = Int(bytes[off])
              off += 1 + adLen
            }
          }
          if (afc == 1 || afc == 3), off + 14 <= i + 188 {
            if bytes[off] == 0x00 && bytes[off + 1] == 0x00 && bytes[off + 2] == 0x01 {
              let streamId = bytes[off + 3]
              if streamId >= 0xC0 && streamId <= 0xEF {
                let flags2 = bytes[off + 7]
                let ptsFlag = (flags2 & 0x80) != 0
                let hdrLen = Int(bytes[off + 8])
                if ptsFlag && hdrLen >= 5 && off + 14 <= i + 188 {
                  let p0 = UInt64((bytes[off + 9] >> 1) & 0x07) << 30
                  let p1 = UInt64(bytes[off + 10]) << 22
                  let p2 = UInt64((bytes[off + 11] >> 1) & 0x7F) << 15
                  let p3 = UInt64(bytes[off + 12]) << 7
                  let p4 = UInt64((bytes[off + 13] >> 1) & 0x7F)
                  return p0 | p1 | p2 | p3 | p4
                }
              }
            }
          }
        }
        i += 188
        continue
      }
    }
    i += 1
  }
  return nil
}

private func dvaNormalizeHlsVtt(_ rawText: String, mpegtsPts: UInt64) -> String {
  var s = rawText
  if s.hasPrefix("\\u{FEFF}") {
    s.removeFirst()
  }
  s = s.replacingOccurrences(of: "\\r\\n", with: "\\n").replacingOccurrences(of: "\\r", with: "\\n")
  let rawLines = s.components(separatedBy: "\\n")
  var bodyLines: [String] = []
  var started = false
  for line in rawLines {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if !started {
      if trimmed.isEmpty || trimmed.uppercased().hasPrefix("WEBVTT") || trimmed.uppercased().hasPrefix("X-TIMESTAMP-MAP") {
        if trimmed.uppercased().hasPrefix("WEBVTT") {
          started = true
        }
        continue
      }
      started = true
    }
    if trimmed.uppercased().hasPrefix("X-TIMESTAMP-MAP") {
      continue
    }
    bodyLines.append(line)
  }
  while let first = bodyLines.first, first.trimmingCharacters(in: .whitespaces).isEmpty {
    bodyLines.removeFirst()
  }
  var out = "WEBVTT\\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:\\(mpegtsPts)\\n\\n"
  out += bodyLines.joined(separator: "\\n")
  if !out.hasSuffix("\\n") {
    out += "\\n"
  }
  return out
}

private func dvaResolveRelativeUrl(_ ref: String, base: URL) -> String {
  return URL(string: ref, relativeTo: base)?.absoluteURL.absoluteString ?? ref
}

private func dvaPercentEncodeQueryVal(_ val: String) -> String {
  var allowed = CharacterSet.alphanumerics
  allowed.insert(charactersIn: "-._~")
  return val.addingPercentEncoding(withAllowedCharacters: allowed) ?? val
}

private func dvaFetchRemoteSync(urlStr: String, rangeBytes: String? = nil, timeoutSec: TimeInterval = 5.0) -> (status: Int, finalUrl: String?, data: Data?) {
  guard let url = URL(string: urlStr) else {
    return (0, nil, nil)
  }
  let config = URLSessionConfiguration.ephemeral
  config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  config.urlCache = nil
  config.timeoutIntervalForRequest = timeoutSec
  config.timeoutIntervalForResource = timeoutSec + 1.0
#if canImport(Network)
  if #available(iOS 17.0, macOS 14.0, tvOS 17.0, *) {
    if let spec = dvaGetSharedProxySpec(), let proxyConfig = dvaMakeProxyConfiguration(spec) {
      config.proxyConfigurations = [proxyConfig]
    }
  }
#endif
  var req = URLRequest(url: url)
  req.timeoutInterval = timeoutSec
  if let rangeBytes, !rangeBytes.isEmpty {
    req.setValue(rangeBytes, forHTTPHeaderField: "Range")
  }
  let session = URLSession(configuration: config)
  let sem = DispatchSemaphore(value: 0)
  var outStatus = 0
  var outFinalUrl: String? = urlStr
  var outData: Data? = nil
  let task = session.dataTask(with: req) { data, response, _ in
    if let httpResp = response as? HTTPURLResponse {
      outStatus = httpResp.statusCode
      outFinalUrl = httpResp.url?.absoluteString ?? urlStr
    }
    outData = data
    sem.signal()
  }
  task.resume()
  _ = sem.wait(timeout: .now() + timeoutSec + 1.0)
  session.finishTasksAndInvalidate()
  return (outStatus, outFinalUrl, outData)
}

private func dvaBuildVttMediaPlaylist(vttUri: String, durationSec: Double) -> String {
  let dur = max(60.0, durationSec.isFinite && durationSec > 0 ? durationSec : 14400.0)
  let targetDur = max(60, Int(ceil(dur)))
  let durStr = String(format: "%.3f", dur)
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:\\(targetDur)",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXTINF:\\(durStr),",
    vttUri,
    "#EXT-X-ENDLIST",
    ""
  ].joined(separator: "\\n")
}

private func dvaInspectMediaPlaylistDurationAndFirstSeg(_ m3u8Text: String) -> (duration: Double, firstSeg: String?) {
  var total = 0.0
  var firstSeg: String? = nil
  let lines = m3u8Text.replacingOccurrences(of: "\\r\\n", with: "\\n").replacingOccurrences(of: "\\r", with: "\\n").components(separatedBy: "\\n")
  for line in lines {
    let t = line.trimmingCharacters(in: .whitespaces)
    if t.isEmpty { continue }
    if t.hasPrefix("#EXTINF:") {
      let rest = t.dropFirst("#EXTINF:".count)
      let numPart = rest.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
      if let d = Double(numPart.trimmingCharacters(in: .whitespaces)), d > 0 {
        total += d
      }
      continue
    }
    if t.hasPrefix("#") { continue }
    if firstSeg == nil {
      firstSeg = t
    }
  }
  return (total > 0 ? total : 14400.0, firstSeg)
}

private func dvaSubtitleLabelAndLang(forFileName fileName: String) -> (label: String, lang: String) {
  let lower = fileName.lowercased()
  if lower == "sub_vi.vtt" || lower == "sub_vn.vtt" {
    return ("Tiếng Việt", "vi")
  }
  if lower == "sub_en.vtt" {
    return ("English", "en")
  }
  var lang = lower
  if lang.hasPrefix("sub_") {
    lang = String(lang.dropFirst("sub_".count))
  }
  if lang.hasSuffix(".vtt") {
    lang = String(lang.dropLast(".vtt".count))
  }
  let cleanLang = lang.isEmpty ? "und" : lang
  return (cleanLang.uppercased(), cleanLang)
}

private func dvaServeOfflinePipMaster(clientFd: Int32, itemDirURL: URL) -> Bool {
  let indexURL = itemDirURL.appendingPathComponent("index.m3u8")
  guard let indexText = try? String(contentsOf: indexURL, encoding: .utf8),
        indexText.contains("#EXTM3U") else {
    return false
  }
  guard let dirItems = try? FileManager.default.contentsOfDirectory(atPath: itemDirURL.path) else {
    return false
  }
  let vttFiles = dirItems.filter { name in
    let low = name.lowercased()
    return low.hasPrefix("sub_") && low.hasSuffix(".vtt")
  }.sorted { a, b in
    let rank = { (s: String) -> Int in
      let low = s.lowercased()
      if low == "sub_vi.vtt" || low == "sub_vn.vtt" { return 0 }
      if low == "sub_en.vtt" { return 1 }
      return 2
    }
    let ra = rank(a)
    let rb = rank(b)
    return ra == rb ? (a < b) : (ra < rb)
  }

  if vttFiles.isEmpty {
    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: indexText,
      contentType: "application/vnd.apple.mpegurl"
    )
    return true
  }

  let inspected = dvaInspectMediaPlaylistDurationAndFirstSeg(indexText)
  var pts: UInt64 = 0
  if let segRel = inspected.firstSeg, !segRel.contains("..") {
    let segURL = itemDirURL.appendingPathComponent(segRel).standardizedFileURL
    if let fh = FileHandle(forReadingAtPath: segURL.path) {
      let headData = (try? fh.read(upToCount: 32768)) ?? Data()
      try? fh.close()
      if let foundPts = dvaExtractFirstTsPts(headData) {
        pts = foundPts
      }
    }
  }

  let durInt = Int(ceil(inspected.duration))
  var outLines = ["#EXTM3U", "#EXT-X-VERSION:3"]
  for vttName in vttFiles {
    let meta = dvaSubtitleLabelAndLang(forFileName: vttName)
    let subPlaylistUri = "pip_sub.m3u8?file=\\(dvaPercentEncodeQueryVal(vttName))&dur=\\(durInt)&pts=\\(pts)"
    outLines.append("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\\"dvasubs\\",NAME=\\"\\(meta.label)\\",LANGUAGE=\\"\\(meta.lang)\\",DEFAULT=NO,AUTOSELECT=NO,URI=\\"\\(subPlaylistUri)\\"")
  }
  outLines.append("#EXT-X-STREAM-INF:BANDWIDTH=5000000,SUBTITLES=\\"dvasubs\\"")
  outLines.append("index.m3u8")
  outLines.append("")
  dvaSendHttpText(
    clientFd: clientFd,
    statusLine: "200 OK",
    body: outLines.joined(separator: "\\n"),
    contentType: "application/vnd.apple.mpegurl"
  )
  return true
}

private func dvaRewriteHlsAttributeUri(_ line: String, baseURL: URL) -> String {
  guard let uriRange = line.range(of: "URI=\\"") else {
    return line
  }
  let afterQuote = line[uriRange.upperBound...]
  guard let endQuote = afterQuote.firstIndex(of: "\\"") else {
    return line
  }
  let rawUri = String(line[uriRange.upperBound..<endQuote])
  let absUri = dvaResolveRelativeUrl(rawUri, base: baseURL)
  return String(line[..<uriRange.upperBound]) + absUri + String(line[endQuote...])
}

private func dvaHandleOnlineHlsPip(clientFd: Int32, subPath: String, rawTarget: String, method: String) {
  let query = dvaParseQueryParams(rawTarget)

  if subPath == "/hls-pip/master.m3u8" {
    guard let srcStr = query["src"], let srcURL = URL(string: srcStr) else {
      dvaSendHttpText(clientFd: clientFd, statusLine: "400 Bad Request", body: "Missing src")
      return
    }
    let vnUrl = query["vn"] ?? ""
    let enUrl = query["en"] ?? ""

    let fetched = dvaFetchRemoteSync(urlStr: srcStr, timeoutSec: 6.0)
    guard let data = fetched.data,
          let m3u8Text = String(data: data, encoding: .utf8),
          m3u8Text.contains("#EXTM3U") else {
      dvaSendHttpText(
        clientFd: clientFd,
        statusLine: "302 Found",
        body: "",
        extraHeaders: ["Location: \\(srcStr)"]
      )
      return
    }

    let baseURL = fetched.finalUrl.flatMap { URL(string: $0) } ?? srcURL
    let normText = m3u8Text.replacingOccurrences(of: "\\r\\n", with: "\\n").replacingOccurrences(of: "\\r", with: "\\n")

    if normText.contains("#EXT-X-STREAM-INF") {
      // Master playlist: absolutize URIs and inject external WebVTT subtitle tracks
      let lines = normText.components(separatedBy: "\\n")
      var outLines: [String] = []
      var injectedSubs = false
      var expectStreamUri = false
      var firstVariantUri: String? = nil

      let makeSubHeaderLines = { (probeUrl: String?) -> [String] in
        var arr: [String] = []
        let probeParam = probeUrl.map { "&probe=" + dvaPercentEncodeQueryVal($0) } ?? ""
        if !vnUrl.isEmpty {
          let subM3u8 = "/hls-pip/sub.m3u8?vtt=" + dvaPercentEncodeQueryVal(vnUrl) + "&dur=14400" + probeParam
          arr.append("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\\"dvasubs\\",NAME=\\"Tiếng Việt\\",LANGUAGE=\\"vi\\",DEFAULT=NO,AUTOSELECT=NO,URI=\\"\\(subM3u8)\\"")
        }
        if !enUrl.isEmpty {
          let subM3u8 = "/hls-pip/sub.m3u8?vtt=" + dvaPercentEncodeQueryVal(enUrl) + "&dur=14400" + probeParam
          arr.append("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\\"dvasubs\\",NAME=\\"English\\",LANGUAGE=\\"en\\",DEFAULT=NO,AUTOSELECT=NO,URI=\\"\\(subM3u8)\\"")
        }
        return arr
      }

      // First pass to find first variant URL so probe knows where to fetch initial segment PTS if needed
      for (idx, line) in lines.enumerated() {
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("#EXT-X-STREAM-INF") {
          for j in (idx + 1)..<lines.count {
            let nxt = lines[j].trimmingCharacters(in: .whitespaces)
            if !nxt.isEmpty && !nxt.hasPrefix("#") {
              firstVariantUri = dvaResolveRelativeUrl(nxt, base: baseURL)
              break
            }
          }
          if firstVariantUri != nil { break }
        }
      }

      for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
          outLines.append("")
          continue
        }
        if expectStreamUri && !trimmed.hasPrefix("#") {
          outLines.append(dvaResolveRelativeUrl(trimmed, base: baseURL))
          expectStreamUri = false
          continue
        }
        if trimmed.hasPrefix("#EXT-X-STREAM-INF") {
          if !injectedSubs {
            outLines.append(contentsOf: makeSubHeaderLines(firstVariantUri))
            injectedSubs = true
          }
          var modLine = trimmed
          if let range = modLine.range(of: "SUBTITLES=\\"[^\\"]*\\"", options: .regularExpression) {
            modLine.replaceSubrange(range, with: "SUBTITLES=\\"dvasubs\\"")
          } else {
            modLine += ",SUBTITLES=\\"dvasubs\\""
          }
          outLines.append(modLine)
          expectStreamUri = true
          continue
        }
        if trimmed.hasPrefix("#EXT-X-MEDIA") || trimmed.hasPrefix("#EXT-X-I-FRAME-STREAM-INF") {
          outLines.append(dvaRewriteHlsAttributeUri(trimmed, baseURL: baseURL))
          continue
        }
        outLines.append(trimmed)
      }

      if !injectedSubs {
        outLines.append(contentsOf: makeSubHeaderLines(firstVariantUri))
      }

      dvaSendHttpText(
        clientFd: clientFd,
        statusLine: "200 OK",
        body: method == "HEAD" ? "" : outLines.joined(separator: "\\n"),
        contentType: "application/vnd.apple.mpegurl"
      )
      return
    }

    // Media playlist: synthesize Master Playlist pointing SUBTITLES to /hls-pip/sub.m3u8 and video directly to CDN src
    let inspected = dvaInspectMediaPlaylistDurationAndFirstSeg(normText)
    let durInt = Int(ceil(inspected.duration))
    let probeSegAbs = inspected.firstSeg.map { dvaResolveRelativeUrl($0, base: baseURL) } ?? ""
    let probeParam = !probeSegAbs.isEmpty ? ("&probe=" + dvaPercentEncodeQueryVal(probeSegAbs)) : ""

    var outLines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    var hasSub = false
    if !vnUrl.isEmpty {
      let subM3u8 = "/hls-pip/sub.m3u8?vtt=" + dvaPercentEncodeQueryVal(vnUrl) + "&dur=\\(durInt)" + probeParam
      outLines.append("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\\"dvasubs\\",NAME=\\"Tiếng Việt\\",LANGUAGE=\\"vi\\",DEFAULT=NO,AUTOSELECT=NO,URI=\\"\\(subM3u8)\\"")
      hasSub = true
    }
    if !enUrl.isEmpty {
      let subM3u8 = "/hls-pip/sub.m3u8?vtt=" + dvaPercentEncodeQueryVal(enUrl) + "&dur=\\(durInt)" + probeParam
      outLines.append("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\\"dvasubs\\",NAME=\\"English\\",LANGUAGE=\\"en\\",DEFAULT=NO,AUTOSELECT=NO,URI=\\"\\(subM3u8)\\"")
      hasSub = true
    }
    if hasSub {
      outLines.append("#EXT-X-STREAM-INF:BANDWIDTH=5000000,SUBTITLES=\\"dvasubs\\"")
    } else {
      outLines.append("#EXT-X-STREAM-INF:BANDWIDTH=5000000")
    }
    outLines.append(srcStr)
    outLines.append("")

    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: method == "HEAD" ? "" : outLines.joined(separator: "\\n"),
      contentType: "application/vnd.apple.mpegurl"
    )
    return
  }

  if subPath == "/hls-pip/sub.m3u8" {
    guard let vttStr = query["vtt"], !vttStr.isEmpty else {
      dvaSendHttpText(clientFd: clientFd, statusLine: "400 Bad Request", body: "Missing vtt")
      return
    }
    let dur = Double(query["dur"] ?? "") ?? 14400.0
    let probe = query["probe"] ?? ""
    var vttUri = "/hls-pip/sub.vtt?vtt=" + dvaPercentEncodeQueryVal(vttStr)
    if !probe.isEmpty {
      vttUri += "&probe=" + dvaPercentEncodeQueryVal(probe)
    }
    let body = dvaBuildVttMediaPlaylist(vttUri: vttUri, durationSec: dur)
    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: method == "HEAD" ? "" : body,
      contentType: "application/vnd.apple.mpegurl"
    )
    return
  }

  if subPath == "/hls-pip/sub.vtt" {
    let vttStr = query["vtt"] ?? ""
    var pts: UInt64 = 0
    let probeUrl = query["probe"] ?? ""
    if !probeUrl.isEmpty {
      var segToProbe = probeUrl
      if segToProbe.lowercased().contains(".m3u8") {
        let subPl = dvaFetchRemoteSync(urlStr: segToProbe, timeoutSec: 2.0)
        if let pData = subPl.data, let pTxt = String(data: pData, encoding: .utf8), pTxt.contains("#EXTM3U") {
          let subBase = subPl.finalUrl.flatMap { URL(string: $0) } ?? URL(string: segToProbe)
          let insp = dvaInspectMediaPlaylistDurationAndFirstSeg(pTxt)
          if let s = insp.firstSeg, let b = subBase {
            segToProbe = dvaResolveRelativeUrl(s, base: b)
          }
        }
      }
      if segToProbe.lowercased().contains(".ts") || segToProbe.lowercased().contains(".seg") || !segToProbe.lowercased().contains(".m3u8") {
        let segRes = dvaFetchRemoteSync(urlStr: segToProbe, rangeBytes: "bytes=0-16383", timeoutSec: 1.8)
        if let segData = segRes.data, let foundPts = dvaExtractFirstTsPts(segData) {
          pts = foundPts
        }
      }
    }

    var vttText = ""
    if !vttStr.isEmpty {
      let vRes = dvaFetchRemoteSync(urlStr: vttStr, timeoutSec: 5.0)
      if vRes.status >= 200 && vRes.status < 400, let vData = vRes.data, let txt = String(data: vData, encoding: .utf8) {
        if txt.contains("-->") || txt.uppercased().contains("WEBVTT") {
          vttText = txt
        }
      }
    }
    let normalizedVtt = dvaNormalizeHlsVtt(vttText, mpegtsPts: pts)
    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: method == "HEAD" ? "" : normalizedVtt,
      contentType: "text/vtt; charset=utf-8"
    )
    return
  }

  dvaSendHttpText(clientFd: clientFd, statusLine: "404 Not Found", body: "Not Found")
}

private func dvaParseByteRange(_ rangeHeader: String, fileSize: Int64) -> (start: Int64, end: Int64)? {
  guard fileSize > 0 else { return nil }
  let trimmed = rangeHeader.trimmingCharacters(in: .whitespacesAndNewlines)
  guard trimmed.lowercased().hasPrefix("bytes=") else { return nil }
  let rawSpec = String(trimmed.dropFirst(6)).split(separator: ",").first.map(String.init) ?? ""
  let parts = rawSpec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
  guard parts.count == 2 else { return nil }
  let startStr = String(parts[0]).trimmingCharacters(in: .whitespaces)
  let endStr = String(parts[1]).trimmingCharacters(in: .whitespaces)

  if startStr.isEmpty {
    guard let suffixLen = Int64(endStr), suffixLen > 0 else { return nil }
    let start = max(Int64(0), fileSize - suffixLen)
    return (start, fileSize - 1)
  }

  guard let start = Int64(startStr), start >= 0, start < fileSize else {
    return nil
  }
  if endStr.isEmpty {
    return (start, fileSize - 1)
  }
  guard let reqEnd = Int64(endStr) else { return nil }
  let end = min(reqEnd, fileSize - 1)
  guard end >= start else { return nil }
  return (start, end)
}

private func dvaHandleMediaClient(clientFd: Int32, rootDirURL: URL) {
  dvaConfigureSocketNoSigPipe(clientFd)
  dvaSetSocketTimeouts(clientFd, seconds: 15)
  defer {
    _ = Darwin.shutdown(clientFd, SHUT_RDWR)
    _ = Darwin.close(clientFd)
  }

  var reqBuf = [UInt8]()
  reqBuf.reserveCapacity(1024)
  var temp = [UInt8](repeating: 0, count: 2048)
  var headerEndIndex: Int? = nil

  while reqBuf.count < 16384 {
    let n = temp.withUnsafeMutableBytes { rawBuf -> Int in
      guard let base = rawBuf.baseAddress else { return -1 }
      return Darwin.recv(clientFd, base, rawBuf.count, 0)
    }
    if n < 0 {
      if errno == EINTR { continue }
      return
    }
    if n == 0 {
      return
    }
    reqBuf.append(contentsOf: temp[0..<n])
    if reqBuf.count >= 4 {
      for i in 0...(reqBuf.count - 4) {
        if reqBuf[i] == 13 && reqBuf[i + 1] == 10 && reqBuf[i + 2] == 13 && reqBuf[i + 3] == 10 {
          headerEndIndex = i
          break
        }
      }
    }
    if headerEndIndex != nil {
      break
    }
  }

  guard let endIdx = headerEndIndex else { return }
  let headerStr = String(decoding: reqBuf[0..<endIdx], as: UTF8.self)
  let headerLines = headerStr.components(separatedBy: "\\r\\n")
  guard let requestLine = headerLines.first else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "400 Bad Request", body: "Bad Request")
    return
  }

  let reqTokens = requestLine.split(separator: " ", omittingEmptySubsequences: true)
  guard reqTokens.count >= 2 else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "400 Bad Request", body: "Bad Request")
    return
  }

  let method = String(reqTokens[0]).uppercased()
  let rawTarget = String(reqTokens[1])

  if method == "OPTIONS" {
    dvaSendHttpText(clientFd: clientFd, statusLine: "204 No Content")
    return
  }

  guard method == "GET" || method == "HEAD" else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "405 Method Not Allowed", body: "Method Not Allowed")
    return
  }

  let pathOnly = rawTarget.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? rawTarget
  if pathOnly.hasPrefix("/hls-pip/") {
    dvaHandleOnlineHlsPip(clientFd: clientFd, subPath: pathOnly, rawTarget: rawTarget, method: method)
    return
  }

  guard pathOnly.hasPrefix("/offline/") else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "404 Not Found", body: "Not Found")
    return
  }

  let rawRelPath = String(pathOnly.dropFirst("/offline/".count))
  guard let decodedRelPath = rawRelPath.removingPercentEncoding,
        !decodedRelPath.isEmpty,
        !decodedRelPath.hasPrefix("/"),
        !decodedRelPath.contains("..") else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "403 Forbidden", body: "Forbidden")
    return
  }

  let candidateURL = rootDirURL.appendingPathComponent(decodedRelPath).standardizedFileURL
  let basePrefix = rootDirURL.path.hasSuffix("/") ? rootDirURL.path : (rootDirURL.path + "/")
  guard candidateURL.path.hasPrefix(basePrefix) else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "403 Forbidden", body: "Forbidden")
    return
  }

  let fileNameLower = candidateURL.lastPathComponent.lowercased()
  let itemDirURL = candidateURL.deletingLastPathComponent().standardizedFileURL
  if fileNameLower == "pip_master.m3u8" {
    if dvaServeOfflinePipMaster(clientFd: clientFd, itemDirURL: itemDirURL) {
      return
    }
  } else if fileNameLower == "pip_sub.m3u8" {
    let query = dvaParseQueryParams(rawTarget)
    let subFile = query["file"] ?? "sub_vi.vtt"
    guard !subFile.isEmpty, !subFile.contains("/"), !subFile.contains("..") else {
      dvaSendHttpText(clientFd: clientFd, statusLine: "403 Forbidden", body: "Forbidden")
      return
    }
    let dur = Double(query["dur"] ?? "") ?? 14400.0
    let ptsStr = query["pts"] ?? "0"
    let vttUri = "pip_sub.vtt?file=\\(dvaPercentEncodeQueryVal(subFile))&pts=\\(dvaPercentEncodeQueryVal(ptsStr))"
    let m3u8Body = dvaBuildVttMediaPlaylist(vttUri: vttUri, durationSec: dur)
    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: method == "HEAD" ? "" : m3u8Body,
      contentType: "application/vnd.apple.mpegurl"
    )
    return
  } else if fileNameLower == "pip_sub.vtt" {
    let query = dvaParseQueryParams(rawTarget)
    let subFile = query["file"] ?? "sub_vi.vtt"
    guard !subFile.isEmpty, !subFile.contains("/"), !subFile.contains("..") else {
      dvaSendHttpText(clientFd: clientFd, statusLine: "403 Forbidden", body: "Forbidden")
      return
    }
    let subURL = itemDirURL.appendingPathComponent(subFile).standardizedFileURL
    guard subURL.path.hasPrefix(basePrefix),
          let rawVtt = try? String(contentsOf: subURL, encoding: .utf8) else {
      dvaSendHttpText(clientFd: clientFd, statusLine: "404 Not Found", body: "Not Found")
      return
    }
    let pts = UInt64(query["pts"] ?? "") ?? 0
    let normalizedVtt = dvaNormalizeHlsVtt(rawVtt, mpegtsPts: pts)
    dvaSendHttpText(
      clientFd: clientFd,
      statusLine: "200 OK",
      body: method == "HEAD" ? "" : normalizedVtt,
      contentType: "text/vtt; charset=utf-8"
    )
    return
  }

  var isDir: ObjCBool = false
  guard FileManager.default.fileExists(atPath: candidateURL.path, isDirectory: &isDir),
        !isDir.boolValue else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "404 Not Found", body: "Not Found")
    return
  }

  guard let attrs = try? FileManager.default.attributesOfItem(atPath: candidateURL.path),
        let sizeNumber = attrs[.size] as? NSNumber else {
    dvaSendHttpText(clientFd: clientFd, statusLine: "404 Not Found", body: "Not Found")
    return
  }
  let fileSize = sizeNumber.int64Value

  var rangeHeaderValue: String? = nil
  for line in headerLines.dropFirst() {
    if let colonIdx = line.firstIndex(of: ":") {
      let key = line[..<colonIdx].trimmingCharacters(in: .whitespaces).lowercased()
      if key == "range" {
        rangeHeaderValue = line[line.index(after: colonIdx)...].trimmingCharacters(in: .whitespaces)
        break
      }
    }
  }

  let mimeType = dvaMimeTypeForExtension(candidateURL.pathExtension)
  var startOffset: Int64 = 0
  var endOffset: Int64 = fileSize > 0 ? (fileSize - 1) : -1
  var isPartial = false

  if let rangeHeaderValue {
    if let parsed = dvaParseByteRange(rangeHeaderValue, fileSize: fileSize) {
      startOffset = parsed.start
      endOffset = parsed.end
      isPartial = true
    } else {
      dvaSendHttpText(
        clientFd: clientFd,
        statusLine: "416 Range Not Satisfiable",
        extraHeaders: ["Content-Range: bytes */\\(fileSize)"]
      )
      return
    }
  }

  let contentLength: Int64 = (fileSize > 0 && endOffset >= startOffset) ? (endOffset - startOffset + 1) : 0
  var respHeaders = [
    isPartial ? "HTTP/1.1 206 Partial Content" : "HTTP/1.1 200 OK",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers: Range, Origin, Content-Type, Accept",
    "Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges",
    "Accept-Ranges: bytes",
    "Cache-Control: no-cache",
    "Content-Type: \\(mimeType)",
    "Content-Length: \\(contentLength)",
    "Connection: close"
  ]
  if isPartial {
    respHeaders.append("Content-Range: bytes \\(startOffset)-\\(endOffset)/\\(fileSize)")
  }
  let headerBytes = Array((respHeaders.joined(separator: "\\r\\n") + "\\r\\n\\r\\n").utf8)
  guard dvaWriteAll(clientFd, headerBytes) else { return }

  if method == "HEAD" || contentLength <= 0 {
    return
  }

  guard let fh = FileHandle(forReadingAtPath: candidateURL.path) else {
    return
  }
  defer {
    try? fh.close()
  }

  do {
    try fh.seek(toOffset: UInt64(startOffset))
    dvaSetSocketTimeouts(clientFd, seconds: 120)
    var remaining = contentLength
    while remaining > 0 {
      let chunkSize = Int(min(Int64(65536), remaining))
      guard let data = try fh.read(upToCount: chunkSize), !data.isEmpty else {
        break
      }
      let sentOk = dvaWriteAll(clientFd, Array(data))
      if !sentOk {
        break
      }
      remaining -= Int64(data.count)
    }
  } catch {}
}

/**
 * In-app loopback HTTP/1.1 range & CORS media server on 127.0.0.1:<localPort>
 * serving downloaded HLS (.m3u8/.ts), MP4, VTT subtitles, and posters directly from disk.
 */
private final class DvaLocalMediaServer: @unchecked Sendable {
  let rootDirURL: URL
  var rootDirPath: String { rootDirURL.path }
  private(set) var localPort: UInt16 = 0
  private var listenFd: Int32 = -1
  private let lock = NSLock()
  private var stopped = false

  init?(rootPath: String) {
    let cleanRoot = rootPath.hasSuffix("/") && rootPath.count > 1 ? String(rootPath.dropLast()) : rootPath
    let rootURL = URL(fileURLWithPath: cleanRoot).standardizedFileURL
    self.rootDirURL = rootURL

    let fd = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    if fd < 0 {
      return nil
    }
    dvaConfigureSocketNoSigPipe(fd)
    var reuse: Int32 = 1
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let bindRes = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    if bindRes != 0 || Darwin.listen(fd, 128) != 0 {
      _ = Darwin.close(fd)
      return nil
    }

    var boundAddr = sockaddr_in()
    var boundLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameRes = withUnsafeMutablePointer(to: &boundAddr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.getsockname(fd, $0, &boundLen)
      }
    }
    if nameRes != 0 {
      _ = Darwin.close(fd)
      return nil
    }
    self.localPort = UInt16(bigEndian: boundAddr.sin_port)
    if self.localPort == 0 {
      _ = Darwin.close(fd)
      return nil
    }
    self.listenFd = fd

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      while true {
        let cFd = Darwin.accept(fd, nil, nil)
        if cFd < 0 {
          if errno == EINTR { continue }
          break
        }
        guard let strongSelf = self else {
          _ = Darwin.close(cFd)
          break
        }
        if strongSelf.isStopped {
          _ = Darwin.close(cFd)
          break
        }
        let targetRoot = strongSelf.rootDirURL
        DispatchQueue.global(qos: .userInitiated).async {
          dvaHandleMediaClient(clientFd: cFd, rootDirURL: targetRoot)
        }
      }
    }
  }

  private var isStopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopped
  }

  func stop() {
    lock.lock()
    if stopped {
      lock.unlock()
      return
    }
    stopped = true
    let fd = listenFd
    listenFd = -1
    lock.unlock()
    if fd >= 0 {
      _ = Darwin.shutdown(fd, SHUT_RDWR)
      _ = Darwin.close(fd)
    }
  }

  deinit {
    stop()
  }
}

#if canImport(Network)
@available(iOS 17.0, macOS 14.0, tvOS 17.0, *)
private func dvaMakeProxyConfiguration(_ spec: DvaProxySpec) -> ProxyConfiguration? {
  guard let nwPort = NWEndpoint.Port(rawValue: spec.port) else {
    return nil
  }
  let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(spec.host), port: nwPort)
  var proxyConfig = ProxyConfiguration(httpCONNECTProxy: endpoint, tlsOptions: nil)
  proxyConfig.excludedDomains = ["127.0.0.1", "localhost"]
  if !spec.username.isEmpty || !spec.password.isEmpty {
    proxyConfig.applyCredential(username: spec.username, password: spec.password)
  }
  return proxyConfig
}
#endif

private func dvaApplyWebKitProxy(_ spec: DvaProxySpec?, completion: @escaping @Sendable () -> Void) {
  DispatchQueue.main.async {
    MainActor.assumeIsolated {
#if os(iOS) && canImport(WebKit) && canImport(Network)
      if #available(iOS 17.0, *) {
        if let spec, let proxyConfig = dvaMakeProxyConfiguration(spec) {
          WKWebsiteDataStore.default().proxyConfigurations = [proxyConfig]
        } else {
          WKWebsiteDataStore.default().proxyConfigurations = []
        }
      }
#endif
    }
    completion()
  }
}

private func dvaEncodeProxyTestResult(
  success: Bool,
  latencyMs: Int,
  exitIp: String?,
  error: String?
) -> String {
  var dict: [String: Any] = [
    "success": success,
    "latency_ms": latencyMs
  ]
  if let exitIp {
    dict["exit_ip"] = exitIp
  }
  if let error {
    dict["error"] = error
  }
  if let data = try? JSONSerialization.data(withJSONObject: dict),
     let json = String(data: data, encoding: .utf8) {
    return json
  }
  return "{\\"success\\":false,\\"latency_ms\\":0,\\"error\\":\\"Lỗi xử lý kết quả kiểm tra proxy.\\"}"
}

private func dvaRunProxyProbe(
  relay: DvaLocalProxyRelay,
  urls: [String],
  index: Int,
  completion: @escaping @Sendable (String) -> Void
) {
  if index >= urls.count {
    relay.stop()
    completion(dvaEncodeProxyTestResult(
      success: false,
      latencyMs: 0,
      exitIp: nil,
      error: "Không thể kết nối qua proxy."
    ))
    return
  }

  guard let url = URL(string: urls[index]) else {
    dvaRunProxyProbe(relay: relay, urls: urls, index: index + 1, completion: completion)
    return
  }

  let config = URLSessionConfiguration.ephemeral
  config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  config.urlCache = nil
  config.httpShouldSetCookies = false
  config.httpCookieStorage = nil
  config.timeoutIntervalForRequest = 3
  config.timeoutIntervalForResource = 3.5

#if canImport(Network)
  if #available(iOS 17.0, macOS 14.0, tvOS 17.0, *) {
    guard let proxyConfig = dvaMakeProxyConfiguration(relay.localProxySpec) else {
      relay.stop()
      completion(dvaEncodeProxyTestResult(
        success: false,
        latencyMs: 0,
        exitIp: nil,
        error: "Địa chỉ hoặc cổng proxy không hợp lệ."
      ))
      return
    }
    config.proxyConfigurations = [proxyConfig]
  } else {
    relay.stop()
    completion(dvaEncodeProxyTestResult(
      success: false,
      latencyMs: 0,
      exitIp: nil,
      error: "Kết nối Proxy trực tiếp yêu cầu iOS 17.0 trở lên."
    ))
    return
  }
#else
  relay.stop()
  completion(dvaEncodeProxyTestResult(
    success: false,
    latencyMs: 0,
    exitIp: nil,
    error: "Thiết bị không hỗ trợ Network Proxy."
  ))
  return
#endif

  var req = URLRequest(url: url)
  req.timeoutInterval = 3
  req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

  let startNs = DispatchTime.now().uptimeNanoseconds
  let session = URLSession(configuration: config)
  let task = session.dataTask(with: req) { data, response, error in
    defer {
      session.finishTasksAndInvalidate()
    }
    let nowNs = DispatchTime.now().uptimeNanoseconds
    let diffNs = nowNs >= startNs ? nowNs - startNs : 0
    let elapsedMs = max(1, Int(diffNs / 1_000_000))

    if relay.sawAuthFailure {
      relay.stop()
      completion(dvaEncodeProxyTestResult(
        success: false,
        latencyMs: elapsedMs,
        exitIp: nil,
        error: "Sai tài khoản (TK) hoặc mật khẩu (MK) của máy chủ Proxy."
      ))
      return
    }

    if let error {
      if index + 1 < urls.count {
        dvaRunProxyProbe(relay: relay, urls: urls, index: index + 1, completion: completion)
      } else {
        relay.stop()
        completion(dvaEncodeProxyTestResult(
          success: false,
          latencyMs: elapsedMs,
          exitIp: nil,
          error: "Không thể kết nối qua proxy (\\(error.localizedDescription))."
        ))
      }
      return
    }

    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
    if statusCode >= 200 && statusCode < 400 {
      var exitIp: String? = nil
      if let data,
         let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let ip = parsed["ip"] as? String,
         !ip.isEmpty {
        exitIp = ip
      }
      relay.stop()
      completion(dvaEncodeProxyTestResult(
        success: true,
        latencyMs: elapsedMs,
        exitIp: exitIp,
        error: nil
      ))
      return
    }

    if index + 1 < urls.count {
      dvaRunProxyProbe(relay: relay, urls: urls, index: index + 1, completion: completion)
    } else {
      relay.stop()
      completion(dvaEncodeProxyTestResult(
        success: false,
        latencyMs: elapsedMs,
        exitIp: nil,
        error: "Không thể kết nối qua proxy (HTTP \\(statusCode))."
      ))
    }
  }
  task.resume()
}`
  );

  updated = updated.replace(
    classTarget,
    `public final class ExpoFetchModule: Module {
  private var dvaProxySpec: DvaProxySpec?
  private var dvaActiveRelay: DvaLocalProxyRelay?
  private var dvaMediaServer: DvaLocalMediaServer?
  private var dvaSessionInitialized = false
  private lazy var urlSession = createURLSession()`
  );

  updated = updated.replace(
    onDestroyTarget,
    `    OnDestroy {
      dvaActiveRelay?.stop()
      dvaActiveRelay = nil
      dvaMediaServer?.stop()
      dvaMediaServer = nil
      dvaProxySpec = nil
      dvaSetSharedProxySpec(nil)
      if dvaSessionInitialized {
        urlSession.invalidateAndCancel()
      }
      dvaApplyWebKitProxy(nil) {}
    }

    AsyncFunction("dvaStartOfflineMediaServer") { (rootDirPath: String) -> Int in
      var cleanPath = rootDirPath.trimmingCharacters(in: .whitespacesAndNewlines)
      if cleanPath.hasPrefix("file://"), let fileUrl = URL(string: cleanPath) {
        cleanPath = fileUrl.path
      }
      if cleanPath.hasSuffix("/") && cleanPath.count > 1 {
        cleanPath = String(cleanPath.dropLast())
      }
      guard !cleanPath.isEmpty else {
        return 0
      }
      let stdPath = URL(fileURLWithPath: cleanPath).standardizedFileURL.path
      if let existing = self.dvaMediaServer, existing.rootDirPath == stdPath, existing.localPort > 0 {
        return Int(existing.localPort)
      }
      self.dvaMediaServer?.stop()
      self.dvaMediaServer = nil
      guard let server = DvaLocalMediaServer(rootPath: stdPath) else {
        return 0
      }
      self.dvaMediaServer = server
      return Int(server.localPort)
    }.runOnQueue(fetchRequestQueue)

    AsyncFunction("dvaGetOfflineMediaServerPort") { () -> Int in
      return Int(self.dvaMediaServer?.localPort ?? 0)
    }.runOnQueue(fetchRequestQueue)

    AsyncFunction("dvaStopOfflineMediaServer") { () -> Bool in
      self.dvaMediaServer?.stop()
      self.dvaMediaServer = nil
      return true
    }.runOnQueue(fetchRequestQueue)

    Function("dvaIsProxySupported") { () -> Bool in
#if canImport(Network)
      if #available(iOS 17.0, macOS 14.0, tvOS 17.0, *) {
        return true
      }
#endif
      return false
    }

    AsyncFunction("dvaSetProxy") { (host: String, port: Int, username: String, password: String, promise: Promise) in
      let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !cleanHost.isEmpty, port >= 1, port <= 65535, let portU16 = UInt16(exactly: port) else {
        promise.reject("E_PROXY_INVALID", "Địa chỉ IP / Host hoặc Cổng proxy không hợp lệ.")
        return
      }
#if canImport(Network)
      if #available(iOS 17.0, macOS 14.0, tvOS 17.0, *) {
        let upstreamSpec = DvaProxySpec(host: cleanHost, port: portU16, username: username, password: password)
        self.dvaActiveRelay?.stop()
        self.dvaActiveRelay = nil
        guard let relay = DvaLocalProxyRelay(upstreamSpec: upstreamSpec) else {
          promise.reject("E_PROXY_RELAY", "Không thể khởi tạo cổng chuyển tiếp Proxy nội bộ trên iPhone.")
          return
        }
        let localSpec = relay.localProxySpec
        guard dvaMakeProxyConfiguration(localSpec) != nil else {
          relay.stop()
          promise.reject("E_PROXY_CONFIG", "Không thể khởi tạo cấu hình Proxy.")
          return
        }
        self.dvaActiveRelay = relay
        self.dvaProxySpec = localSpec
        dvaSetSharedProxySpec(localSpec)
        self.dvaRebuildUrlSession()
        dvaApplyWebKitProxy(localSpec) {
          promise.resolve(true)
        }
        return
      }
#endif
      promise.reject("E_PROXY_UNSUPPORTED", "Thiết bị cần iOS 17.0 trở lên để dùng Proxy trực tiếp.")
    }.runOnQueue(fetchRequestQueue)

    AsyncFunction("dvaClearProxy") { (promise: Promise) in
      self.dvaActiveRelay?.stop()
      self.dvaActiveRelay = nil
      self.dvaProxySpec = nil
      dvaSetSharedProxySpec(nil)
      self.dvaRebuildUrlSession()
      dvaApplyWebKitProxy(nil) {
        promise.resolve(true)
      }
    }.runOnQueue(fetchRequestQueue)

    AsyncFunction("dvaTestProxy") { (host: String, port: Int, username: String, password: String, fallbackUrl: String, promise: Promise) in
      let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !cleanHost.isEmpty, port >= 1, port <= 65535, let portU16 = UInt16(exactly: port) else {
        promise.resolve(dvaEncodeProxyTestResult(
          success: false,
          latencyMs: 0,
          exitIp: nil,
          error: "Địa chỉ IP / Host hoặc Cổng proxy không hợp lệ."
        ))
        return
      }
      let upstreamSpec = DvaProxySpec(host: cleanHost, port: portU16, username: username, password: password)
      guard let testRelay = DvaLocalProxyRelay(upstreamSpec: upstreamSpec) else {
        promise.resolve(dvaEncodeProxyTestResult(
          success: false,
          latencyMs: 0,
          exitIp: nil,
          error: "Không thể khởi tạo kênh kiểm tra Proxy nội bộ."
        ))
        return
      }
      var probeUrls = ["https://api.ipify.org?format=json"]
      let trimmedFallback = fallbackUrl.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmedFallback.isEmpty {
        probeUrls.append(trimmedFallback)
      }
      dvaRunProxyProbe(relay: testRelay, urls: probeUrls, index: 0) { resultJson in
        promise.resolve(resultJson)
      }
    }.runOnQueue(fetchRequestQueue)`
  );

  updated = updated.replace(
    createSessionTarget,
    `  private func createURLSession() -> URLSession {
    dvaSessionInitialized = true
    let config: URLSessionConfiguration`
  );

  updated = updated.replace(
    createReturnTarget,
    `#if canImport(Network)
    if #available(iOS 17.0, macOS 14.0, tvOS 17.0, *) {
      if let spec = dvaProxySpec, let proxyConfig = dvaMakeProxyConfiguration(spec) {
        config.proxyConfigurations = [proxyConfig]
      } else {
        config.proxyConfigurations = []
      }
    }
#endif
    return URLSession(configuration: config, delegate: urlSessionDelegate, delegateQueue: nil)
  }

  private func dvaRebuildUrlSession() {
    if dvaSessionInitialized {
      let oldSession = urlSession
      oldSession.finishTasksAndInvalidate()
    }
    urlSession = createURLSession()
  }`
  );

  return updated;
}

function applyRncWebViewPatch(sourceText) {
  const normalized = String(sourceText || '').replace(/\r\n/g, '\n');
  if (normalized.includes(OBJC_PATCH_MARKER)) {
    return normalized;
  }

  const dataStoreTarget = `  if (_incognito) {
    wkWebViewConfig.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  } else if (_cacheEnabled) {
    wkWebViewConfig.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
  }`;
  if (!normalized.includes(dataStoreTarget)) {
    throw new Error('Could not find websiteDataStore anchor in RNCWebViewImpl.m');
  }

  return normalized.replace(
    dataStoreTarget,
    `${dataStoreTarget}
  // ${OBJC_PATCH_MARKER}
#if TARGET_OS_IOS && defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 170000
  if (@available(iOS 17.0, *)) {
    WKWebsiteDataStore *dvaDefaultStore = [WKWebsiteDataStore defaultDataStore];
    if (dvaDefaultStore.proxyConfigurations.count > 0 &&
        wkWebViewConfig.websiteDataStore != nil &&
        wkWebViewConfig.websiteDataStore != dvaDefaultStore) {
      wkWebViewConfig.websiteDataStore.proxyConfigurations = dvaDefaultStore.proxyConfigurations;
    }
  }
#endif`
  );
}

function applyExpoVideoModulePatch(sourceText) {
  const normalized = String(sourceText || '').replace(/\r\n/g, '\n');
  if (normalized.includes(VIDEO_MODULE_PATCH_MARKER)) {
    return normalized;
  }

  const pipPropTarget = `      Prop("startsPictureInPictureAutomatically") { (view, startsPictureInPictureAutomatically: Bool?) in
        #if !os(tvOS)
        view.startPictureInPictureAutomatically = startsPictureInPictureAutomatically ?? false
        #endif
      }`;
  if (!normalized.includes(pipPropTarget)) {
    throw new Error('Could not find startsPictureInPictureAutomatically Prop anchor in VideoModule.swift');
  }

  return normalized.replace(
    pipPropTarget,
    `${pipPropTarget}

      // ${VIDEO_MODULE_PATCH_MARKER}
      Prop("contrastEnhance") { (view, enabled: Bool?) in
        #if !os(tvOS)
        view.contrastEnhance = enabled ?? false
        #endif
      }`
  );
}

function applyExpoVideoViewPatch(sourceText) {
  const normalized = String(sourceText || '').replace(/\r\n/g, '\n');
  if (normalized.includes(VIDEO_VIEW_PATCH_MARKER)) {
    return normalized;
  }

  const importTarget = 'import AVKit\nimport ExpoModulesCore';
  if (!normalized.includes(importTarget)) {
    throw new Error('Could not find import anchor in VideoView.swift');
  }

  const playerPropTarget = `  weak var player: VideoPlayer? {
    didSet {
      if playerViewControllerWrapper.setPlayer(player) {
        removeFirstFrameObserver()
        addFirstFrameObserver()
      }
    }
  }`;
  if (!normalized.includes(playerPropTarget)) {
    throw new Error('Could not find player didSet anchor in VideoView.swift');
  }

  const boundsTarget = `  public override var bounds: CGRect {
    didSet {
      playerViewControllerWrapper.view.frame = bounds
      playerViewControllerWrapper.layoutControllerView()
    }
  }`;
  if (!normalized.includes(boundsTarget)) {
    throw new Error('Could not find bounds anchor in VideoView.swift');
  }

  const initAddSubviewTarget = `    addFirstFrameObserver()
    addSubview(playerViewControllerWrapper.view)`;
  if (!normalized.includes(initAddSubviewTarget)) {
    throw new Error('Could not find addSubview anchor in VideoView.swift');
  }

  const deinitTarget = `  deinit {
    VideoManager.shared.unregister(videoView: self)
    removeFirstFrameObserver()
  }`;
  if (!normalized.includes(deinitTarget)) {
    throw new Error('Could not find deinit anchor in VideoView.swift');
  }

  const pipDelegateTarget = `  public func playerViewControllerDidStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
    onPictureInPictureStart()
  }

  public func playerViewControllerDidStopPictureInPicture(_ playerViewController: AVPlayerViewController) {
    onPictureInPictureStop()
  }`;
  if (!normalized.includes(pipDelegateTarget)) {
    throw new Error('Could not find PiP delegate anchor in VideoView.swift');
  }

  let updated = normalized.replace(
    importTarget,
    `// ${VIDEO_VIEW_PATCH_MARKER}
import AVFoundation
import AVKit
import CoreImage
import ExpoModulesCore
#if canImport(MetalKit)
import MetalKit
#endif`
  );

  updated = updated.replace(
    'public final class VideoView: ExpoView, AVPlayerViewControllerDelegate {',
    `#if !os(tvOS) && canImport(MetalKit)
private final class DvaDisplayLinkProxy: NSObject {
  weak var target: DvaVideoContrastOverlayView?
  init(target: DvaVideoContrastOverlayView) {
    self.target = target
  }
  @objc func onTick() {
    target?.stepFrame()
  }
}

private final class DvaVideoContrastOverlayView: MTKView {
  private let mtlCommandQueue: MTLCommandQueue
  private let ciContext: CIContext
  private var displayLink: CADisplayLink?
  private var displayLinkProxy: DvaDisplayLinkProxy?
  private var videoOutput: AVPlayerItemVideoOutput?
  private weak var observedPlayer: AVPlayer?
  private weak var attachedItem: AVPlayerItem?
  private var currentItemObserver: NSKeyValueObservation?
  weak var ownerPlayerViewController: AVPlayerViewController?

  var isEnabled: Bool = false {
    didSet {
      if oldValue != isEnabled {
        updateActiveState()
      }
    }
  }

  var isInPictureInPicture: Bool = false {
    didSet {
      if oldValue != isInPictureInPicture {
        updateActiveState()
      }
    }
  }

  init?() {
    guard let mtlDevice = MTLCreateSystemDefaultDevice(),
          let queue = mtlDevice.makeCommandQueue() else {
      return nil
    }
    self.mtlCommandQueue = queue
    self.ciContext = CIContext(mtlDevice: mtlDevice, options: [
      .cacheIntermediates: false,
      .priorityRequestLow: false
    ])
    super.init(frame: .zero, device: mtlDevice)
    self.framebufferOnly = false
    self.isPaused = true
    self.enableSetNeedsDisplay = false
    self.autoResizeDrawable = true
    self.isOpaque = false
    self.backgroundColor = .clear
    self.isUserInteractionEnabled = false
    self.isHidden = true
    self.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
  }

  @available(*, unavailable)
  required init(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func setAVPlayer(_ player: AVPlayer?) {
    if observedPlayer === player {
      attachToItem(player?.currentItem)
      return
    }
    currentItemObserver?.invalidate()
    currentItemObserver = nil
    detachOutput()
    observedPlayer = player
    guard let player else {
      updateActiveState()
      return
    }
    attachToItem(player.currentItem)
    currentItemObserver = player.observe(\\.currentItem, options: [.new]) { [weak self] avPlayer, _ in
      DispatchQueue.main.async {
        self?.attachToItem(avPlayer.currentItem)
      }
    }
    updateActiveState()
  }

  private func attachToItem(_ item: AVPlayerItem?) {
    if attachedItem === item {
      return
    }
    detachOutput()
    attachedItem = item
    updateActiveState()
  }

  private func ensureOutputAttached() {
    guard videoOutput == nil, let item = attachedItem else { return }
    let attrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferMetalCompatibilityKey as String: true
    ]
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: attrs)
    output.suppressesPlayerRendering = false
    item.add(output)
    videoOutput = output
  }

  private func detachOutput() {
    if let output = videoOutput, let item = attachedItem {
      item.remove(output)
    }
    videoOutput = nil
  }

  private func updateActiveState() {
    let shouldRun = isEnabled && !isInPictureInPicture && attachedItem != nil
    if shouldRun {
      ensureOutputAttached()
      if displayLink == nil {
        let proxy = DvaDisplayLinkProxy(target: self)
        let dl = CADisplayLink(target: proxy, selector: #selector(DvaDisplayLinkProxy.onTick))
        dl.add(to: .main, forMode: .common)
        displayLinkProxy = proxy
        displayLink = dl
      }
      stepFrame()
    } else {
      displayLink?.invalidate()
      displayLink = nil
      displayLinkProxy = nil
      self.isHidden = true
      detachOutput()
    }
  }

  private func applyContrastFilters(to input: CIImage) -> CIImage {
    let extent = input.extent
    var working = input.clampedToExtent()

    if let tone = CIFilter(name: "CIToneCurve") {
      tone.setValue(working, forKey: kCIInputImageKey)
      tone.setValue(CIVector(x: 0.0, y: 0.0), forKey: "inputPoint0")
      tone.setValue(CIVector(x: 0.25, y: 0.22), forKey: "inputPoint1")
      tone.setValue(CIVector(x: 0.5, y: 0.51), forKey: "inputPoint2")
      tone.setValue(CIVector(x: 0.75, y: 0.78), forKey: "inputPoint3")
      tone.setValue(CIVector(x: 1.0, y: 1.0), forKey: "inputPoint4")
      if let out = tone.outputImage { working = out }
    }

    if let color = CIFilter(name: "CIColorControls") {
      color.setValue(working, forKey: kCIInputImageKey)
      color.setValue(1.09, forKey: kCIInputContrastKey)
      color.setValue(1.07, forKey: kCIInputSaturationKey)
      color.setValue(0.012, forKey: kCIInputBrightnessKey)
      if let out = color.outputImage { working = out }
    }

    if let sharpen = CIFilter(name: "CISharpenLuminance") {
      sharpen.setValue(working, forKey: kCIInputImageKey)
      sharpen.setValue(0.45, forKey: kCIInputSharpnessKey)
      sharpen.setValue(1.4, forKey: kCIInputRadiusKey)
      if let out = sharpen.outputImage { working = out }
    }

    return working.cropped(to: extent)
  }

  func stepFrame() {
    guard isEnabled && !isInPictureInPicture else {
      self.isHidden = true
      return
    }
    ensureOutputAttached()
    guard let output = videoOutput else { return }
    let itemTime = output.itemTime(forHostTime: CACurrentMediaTime())
    guard itemTime.isValid else { return }
    guard output.hasNewPixelBuffer(forItemTime: itemTime) || self.isHidden else {
      return
    }
    guard let pixelBuffer = output.copyPixelBuffer(forItemTime: itemTime, itemTimeOut: nil) else {
      return
    }
    let dSize = self.drawableSize
    guard dSize.width > 0, dSize.height > 0,
          let drawable = self.currentDrawable,
          let commandBuffer = mtlCommandQueue.makeCommandBuffer() else {
      return
    }

    let rawImage = CIImage(cvPixelBuffer: pixelBuffer)
    let filtered = applyContrastFilters(to: rawImage)
    let srcExtent = filtered.extent
    guard srcExtent.width > 0, srcExtent.height > 0 else { return }

    let gravity = ownerPlayerViewController?.videoGravity ?? .resizeAspect
    let scaleX: CGFloat
    let scaleY: CGFloat
    if gravity == .resize {
      scaleX = dSize.width / srcExtent.width
      scaleY = dSize.height / srcExtent.height
    } else if gravity == .resizeAspectFill {
      let s = max(dSize.width / srcExtent.width, dSize.height / srcExtent.height)
      scaleX = s
      scaleY = s
    } else {
      let s = min(dSize.width / srcExtent.width, dSize.height / srcExtent.height)
      scaleX = s
      scaleY = s
    }

    let shiftedToZero = (srcExtent.origin.x != 0 || srcExtent.origin.y != 0)
      ? filtered.transformed(by: CGAffineTransform(translationX: -srcExtent.origin.x, y: -srcExtent.origin.y))
      : filtered
    let scaledImg = shiftedToZero.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
    let scaledW = srcExtent.width * scaleX
    let scaledH = srcExtent.height * scaleY
    let centeredImg = scaledImg.transformed(by: CGAffineTransform(
      translationX: (dSize.width - scaledW) * 0.5,
      y: (dSize.height - scaledH) * 0.5
    ))

    let destRect = CGRect(origin: .zero, size: dSize)
    let bg = CIImage(color: .black).cropped(to: destRect)
    let composited = centeredImg.composited(over: bg).cropped(to: destRect)

    let destination = CIRenderDestination(
      width: Int(dSize.width),
      height: Int(dSize.height),
      pixelFormat: self.colorPixelFormat,
      commandBuffer: commandBuffer
    ) {
      return drawable.texture
    }
    destination.isFlipped = true

    do {
      _ = try ciContext.startTask(toRender: composited, to: destination)
      commandBuffer.present(drawable)
      commandBuffer.commit()
      if self.isHidden {
        self.isHidden = false
      }
    } catch {}
  }

  func cleanup() {
    currentItemObserver?.invalidate()
    currentItemObserver = nil
    displayLink?.invalidate()
    displayLink = nil
    displayLinkProxy = nil
    detachOutput()
    observedPlayer = nil
    attachedItem = nil
  }

  deinit {
    cleanup()
  }
}
#endif

public final class VideoView: ExpoView, AVPlayerViewControllerDelegate {`
  );

  updated = updated.replace(
    playerPropTarget,
    `${playerPropTarget}

  #if !os(tvOS) && canImport(MetalKit)
  private lazy var contrastOverlayView: DvaVideoContrastOverlayView? = {
    let overlay = DvaVideoContrastOverlayView()
    overlay?.ownerPlayerViewController = self.playerViewController
    return overlay
  }()

  var contrastEnhance: Bool = false {
    didSet {
      contrastOverlayView?.setAVPlayer(self.player?.ref)
      contrastOverlayView?.isEnabled = contrastEnhance
    }
  }
  #elseif !os(tvOS)
  var contrastEnhance: Bool = false
  #endif`
  );

  updated = updated.replace(
    '      if playerViewControllerWrapper.setPlayer(player) {',
    `      if playerViewControllerWrapper.setPlayer(player) {
        #if !os(tvOS) && canImport(MetalKit)
        contrastOverlayView?.setAVPlayer(player?.ref)
        #endif`
  );

  updated = updated.replace(
    boundsTarget,
    `${boundsTarget}
      #if !os(tvOS) && canImport(MetalKit)
      contrastOverlayView?.frame = bounds
      #endif`
  );

  updated = updated.replace(
    initAddSubviewTarget,
    `${initAddSubviewTarget}
    #if !os(tvOS) && canImport(MetalKit)
    if let overlay = contrastOverlayView {
      overlay.frame = bounds
      addSubview(overlay)
    }
    #endif`
  );

  updated = updated.replace(
    deinitTarget,
    `  deinit {
    VideoManager.shared.unregister(videoView: self)
    removeFirstFrameObserver()
    #if !os(tvOS) && canImport(MetalKit)
    contrastOverlayView?.cleanup()
    #endif
  }`
  );

  updated = updated.replace(
    pipDelegateTarget,
    `  #if !os(tvOS)
  public func playerViewControllerWillStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
    #if canImport(MetalKit)
    contrastOverlayView?.isInPictureInPicture = true
    #endif
  }

  public func playerViewController(_ playerViewController: AVPlayerViewController, failedToStartPictureInPictureWithError error: Error) {
    #if canImport(MetalKit)
    contrastOverlayView?.isInPictureInPicture = false
    #endif
  }
  #endif

  public func playerViewControllerDidStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
    #if !os(tvOS) && canImport(MetalKit)
    contrastOverlayView?.isInPictureInPicture = true
    #endif
    onPictureInPictureStart()
  }

  public func playerViewControllerDidStopPictureInPicture(_ playerViewController: AVPlayerViewController) {
    #if !os(tvOS) && canImport(MetalKit)
    contrastOverlayView?.isInPictureInPicture = false
    #endif
    onPictureInPictureStop()
  }`
  );

  return updated;
}

function patchNodeModules(projectRoot) {
  const fetchModulePath = path.join(
    projectRoot,
    'node_modules',
    'expo',
    'ios',
    'Expo',
    'Fetch',
    'ExpoFetchModule.swift'
  );
  let fetchModuleChanged = false;
  if (fs.existsSync(fetchModulePath)) {
    const raw = fs.readFileSync(fetchModulePath, 'utf8');
    const patched = applyExpoFetchModulePatch(raw);
    if (patched !== raw.replace(/\r\n/g, '\n')) {
      fs.writeFileSync(fetchModulePath, patched, 'utf8');
      fetchModuleChanged = true;
    }
  }

  const rncWebViewPath = path.join(
    projectRoot,
    'node_modules',
    'react-native-webview',
    'apple',
    'RNCWebViewImpl.m'
  );
  let webViewChanged = false;
  if (fs.existsSync(rncWebViewPath)) {
    const raw = fs.readFileSync(rncWebViewPath, 'utf8');
    const patched = applyRncWebViewPatch(raw);
    if (patched !== raw.replace(/\r\n/g, '\n')) {
      fs.writeFileSync(rncWebViewPath, patched, 'utf8');
      webViewChanged = true;
    }
  }

  const videoModulePath = path.join(
    projectRoot,
    'node_modules',
    'expo-video',
    'ios',
    'VideoModule.swift'
  );
  let videoModuleChanged = false;
  if (fs.existsSync(videoModulePath)) {
    const raw = fs.readFileSync(videoModulePath, 'utf8');
    const patched = applyExpoVideoModulePatch(raw);
    if (patched !== raw.replace(/\r\n/g, '\n')) {
      fs.writeFileSync(videoModulePath, patched, 'utf8');
      videoModuleChanged = true;
    }
  }

  const videoViewPath = path.join(
    projectRoot,
    'node_modules',
    'expo-video',
    'ios',
    'VideoView.swift'
  );
  let videoViewChanged = false;
  if (fs.existsSync(videoViewPath)) {
    const raw = fs.readFileSync(videoViewPath, 'utf8');
    const patched = applyExpoVideoViewPatch(raw);
    if (patched !== raw.replace(/\r\n/g, '\n')) {
      fs.writeFileSync(videoViewPath, patched, 'utf8');
      videoViewChanged = true;
    }
  }

  return { fetchModuleChanged, webViewChanged, videoModuleChanged, videoViewChanged };
}

/**
 * Configures ExpoFetchModule URLSession and WKWebsiteDataStore proxyConfigurations
 * with an in-app localhost auth-injecting relay (DvaLocalProxyRelay) so HTTP CONNECT
 * proxies with Basic Auth never trigger iOS system password prompt dialogs.
 */
function withIosNativeProxy(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      patchNodeModules(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);
}

withIosNativeProxy.applyExpoFetchModulePatch = applyExpoFetchModulePatch;
withIosNativeProxy.applyRncWebViewPatch = applyRncWebViewPatch;
withIosNativeProxy.applyExpoVideoModulePatch = applyExpoVideoModulePatch;
withIosNativeProxy.applyExpoVideoViewPatch = applyExpoVideoViewPatch;
withIosNativeProxy.patchNodeModules = patchNodeModules;
module.exports = withIosNativeProxy;
