// Reads only Teams accessibility metadata. It never captures images or emits names/text.
import AppKit
import ApplicationServices

func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func rect(_ element: AXUIElement) -> CGRect? {
    guard let p = attr(element, kAXPositionAttribute), let s = attr(element, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size),
          size.width > 100, size.height > 100 else { return nil }
    return CGRect(origin: point, size: size)
}
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text) }
}
func run() {
    guard AXIsProcessTrusted() else { emit(["state": "access-required"]); return }
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.teams2")
    let cgWindows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    var matches: [[String: Any]] = []
    for app in apps {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 0.3)
        let windows = attr(axApp, kAXWindowsAttribute) as? [AXUIElement] ?? []
        for window in windows {
            guard (attr(window, kAXMinimizedAttribute) as? Bool) != true, let wr = rect(window) else { continue }
            // Match the OS-owned window by PID and geometry, never by meeting title.
            let owned = cgWindows.filter { row in
                guard row[kCGWindowOwnerPID as String] as? Int == Int(app.processIdentifier),
                      row[kCGWindowLayer as String] as? Int == 0,
                      let bounds = row[kCGWindowBounds as String] as? [String: CGFloat],
                      let x = bounds["X"], let y = bounds["Y"], let w = bounds["Width"], let h = bounds["Height"] else { return false }
                return abs(x-wr.minX) < 3 && abs(y-wr.minY) < 3 && abs(w-wr.width) < 3 && abs(h-wr.height) < 3
            }
            guard owned.count == 1, let id = owned[0][kCGWindowNumber as String] as? Int else { continue }
            var stack = [window], scanned = 0, regions: [CGRect] = []
            while let node = stack.popLast(), scanned < 1800 {
                scanned += 1
                let labels = [kAXDescriptionAttribute, kAXTitleAttribute, kAXHelpAttribute].compactMap { attr(node, $0) as? String }
                // Observed in the desktop receiving view; Shared content view alone is also present while idle.
                if labels.contains(where: { $0.hasPrefix("Content shared by ") && $0.count > "Content shared by ".count }), let r = rect(node), wr.contains(r) {
                    regions.append(r)
                    continue
                }
                stack.append(contentsOf: attr(node, kAXChildrenAttribute) as? [AXUIElement] ?? [])
            }
            guard stack.isEmpty, regions.count == 1 else { continue }
            let r = regions[0]
            matches.append(["windowId": id, "region": ["x": (r.minX-wr.minX)/wr.width, "y": (r.minY-wr.minY)/wr.height, "width": r.width/wr.width, "height": r.height/wr.height]])
        }
    }
    guard matches.count == 1 else { emit(["state": matches.isEmpty ? "waiting" : "ambiguous"]); return }
    emit(["state": "sharing", "target": matches[0]])
}
run()
