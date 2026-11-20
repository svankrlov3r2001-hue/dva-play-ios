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
  spec: DvaProxySpec,
  urls: [String],
  index: Int,
  completion: @escaping @Sendable (String) -> Void
) {
  if index >= urls.count {
    completion(dvaEncodeProxyTestResult(
      success: false,
      latencyMs: 0,
      exitIp: nil,
      error: "Không thể kết nối qua proxy."
    ))
    return
  }

  guard let url = URL(string: urls[index]) else {
    dvaRunProxyProbe(spec: spec, urls: urls, index: index + 1, completion: completion)
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
    guard let proxyConfig = dvaMakeProxyConfiguration(spec) else {
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
    completion(dvaEncodeProxyTestResult(
      success: false,
      latencyMs: 0,
      exitIp: nil,
      error: "Kết nối Proxy trực tiếp yêu cầu iOS 17.0 trở lên."
    ))
    return
  }
#else
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

    if let error {
      if index + 1 < urls.count {
        dvaRunProxyProbe(spec: spec, urls: urls, index: index + 1, completion: completion)
      } else {
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
      completion(dvaEncodeProxyTestResult(
        success: true,
        latencyMs: elapsedMs,
        exitIp: exitIp,
        error: nil
      ))
      return
    }

    if index + 1 < urls.count {
      dvaRunProxyProbe(spec: spec, urls: urls, index: index + 1, completion: completion)
    } else {
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
  private var dvaSessionInitialized = false
  private lazy var urlSession = createURLSession()`
  );

  updated = updated.replace(
    onDestroyTarget,
    `    OnDestroy {
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
        let spec = DvaProxySpec(host: cleanHost, port: portU16, username: username, password: password)
        guard dvaMakeProxyConfiguration(spec) != nil else {
          promise.reject("E_PROXY_CONFIG", "Không thể khởi tạo cấu hình Proxy.")
          return
        }
        self.dvaProxySpec = spec
        self.dvaRebuildUrlSession()
        dvaApplyWebKitProxy(spec) {
          promise.resolve(true)
        }
        return
      }
#endif
      promise.reject("E_PROXY_UNSUPPORTED", "Thiết bị cần iOS 17.0 trở lên để dùng Proxy trực tiếp.")
    }.runOnQueue(fetchRequestQueue)

    AsyncFunction("dvaClearProxy") { (promise: Promise) in
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
      let spec = DvaProxySpec(host: cleanHost, port: portU16, username: username, password: password)
      var probeUrls = ["https://api.ipify.org?format=json"]
      let trimmedFallback = fallbackUrl.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmedFallback.isEmpty {
        probeUrls.append(trimmedFallback)
      }
      dvaRunProxyProbe(spec: spec, urls: probeUrls, index: 0) { resultJson in
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
 * so HTTP CONNECT proxies route traffic directly from iPhone on iOS 17+.
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
