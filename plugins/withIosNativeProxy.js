const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SWIFT_PATCH_MARKER = 'DVA_NATIVE_PROXY_PATCHED';
const OBJC_PATCH_MARKER = 'DVA_NATIVE_PROXY_WEBVIEW_PATCHED';

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
        guard let self else {
          _ = Darwin.close(cFd)
          break
        }
        if self.isStopped {
          _ = Darwin.close(cFd)
          break
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
          dvaHandleRelayClient(clientFd: cFd, upstreamSpec: specCopy) {
            self?.markAuthFailure()
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

#if canImport(Network)
@available(iOS 17.0, macOS 14.0, tvOS 17.0, *)
private func dvaMakeProxyConfiguration(_ spec: DvaProxySpec) -> ProxyConfiguration? {
  guard let nwPort = NWEndpoint.Port(rawValue: spec.port) else {
    return nil
  }
  let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(spec.host), port: nwPort)
  var proxyConfig = ProxyConfiguration(httpCONNECTProxy: endpoint, tlsOptions: nil)
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
  config.timeoutIntervalForRequest = 8
  config.timeoutIntervalForResource = 10

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
  req.timeoutInterval = 8
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
  private var dvaSessionInitialized = false
  private lazy var urlSession = createURLSession()`
  );

  updated = updated.replace(
    onDestroyTarget,
    `    OnDestroy {
      dvaActiveRelay?.stop()
      dvaActiveRelay = nil
      dvaProxySpec = nil
      if dvaSessionInitialized {
        urlSession.invalidateAndCancel()
      }
      dvaApplyWebKitProxy(nil) {}
    }

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

  return { fetchModuleChanged, webViewChanged };
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
withIosNativeProxy.patchNodeModules = patchNodeModules;
module.exports = withIosNativeProxy;
