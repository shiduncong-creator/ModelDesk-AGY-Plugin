import AppKit
import ApplicationServices

private let hostID = "com.google.antigravity"

private final class FramePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class PixelTrim: NSView {
    var night = false { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        guard bounds.width > 220, bounds.height > 100 else { return }
        NSGraphicsContext.current?.shouldAntialias = false
        func pigment(_ hex: Int) -> NSColor {
            NSColor(srgbRed: CGFloat(hex >> 16) / 255, green: CGFloat((hex >> 8) & 255) / 255,
                    blue: CGFloat(hex & 255) / 255, alpha: 1)
        }
        let wood = pigment(night ? 0x6F5474 : 0x936842)
        let gleam = pigment(night ? 0xDDB570 : 0xF5DDA1)
        let shade = pigment(night ? 0x392F48 : 0xBE996A)
        let w = bounds.width, h = bounds.height
        func bar(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ color: NSColor) {
            color.setFill()
            NSBezierPath(rect: NSRect(x: x, y: y, width: width, height: height)).fill()
        }
        // Follow the native rounded corners. Every mark is in the outermost six points.
        for y in [CGFloat(1), h - 3] {
            bar(14, y, w - 28, 2, wood)
            for x in [CGFloat(19), w - 43] {
                bar(x, y, 24, 1, gleam)
                bar(x + 3, y - 1, 3, 3, gleam)
                bar(x + 16, y - 1, 3, 3, gleam)
            }
        }
        for x in [CGFloat(1), w - 3] {
            bar(x, 14, 2, h - 28, shade)
            for y in [CGFloat(14), h - 27] { bar(x, y, 2, 13, wood) }
        }
        for flipX in [false, true] {
            for flipY in [false, true] {
                for (x, y) in [(CGFloat(6), CGFloat(6)), (8, 4), (10, 3), (4, 8), (3, 10)] {
                    bar(flipX ? w - x - 2 : x, flipY ? h - y - 2 : y, 2, 2, wood)
                }
            }
        }
    }
}

private let onHostGeometry: AXObserverCallback = { _, _, _, pointer in
    guard let pointer else { return }
    Unmanaged<HostPixelFrame>.fromOpaque(pointer).takeUnretainedValue().schedule()
}

final class HostPixelFrame {
    private let panel = FramePanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                                  backing: .buffered, defer: true)
    private let trim = PixelTrim()
    private let config = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".gemini/config/config.json")
    private var observedPID: pid_t = 0
    private var observer: AXObserver?
    private var observedWindow: AXUIElement?
    private var pending: DispatchWorkItem?
    private var fileSource: DispatchSourceFileSystemObject?
    private var directorySource: DispatchSourceFileSystemObject?
    private var fileInode: NSNumber?
    private let geometry = [kAXMovedNotification, kAXResizedNotification, kAXWindowMiniaturizedNotification,
                            kAXWindowDeminiaturizedNotification, kAXUIElementDestroyedNotification]

    func start() {
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .transient]
        panel.isExcludedFromWindowsMenu = true
        panel.contentView = trim
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didHideApplicationNotification,
                     NSWorkspace.didTerminateApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification] {
            workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.refresh() }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in self?.schedule() }
        DistributedNotificationCenter.default().addObserver(forName: .init("AppleInterfaceThemeChangedNotification"),
                                                              object: nil, queue: .main) { [weak self] _ in self?.schedule() }
        directorySource = watch(config.deletingLastPathComponent())
        refresh()
    }

    private func watch(_ url: URL) -> DispatchSourceFileSystemObject? {
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { return nil }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete],
                                                               queue: .main)
        source.setEventHandler { [weak self] in self?.schedule() }
        source.setCancelHandler { close(fd) }
        source.resume()
        return source
    }

    fileprivate func schedule() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.refresh() }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.035, execute: work)
    }

    private func observe(_ pid: pid_t) {
        if pid != observedPID || observer == nil {
            if let observer {
                CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
            }
            observedPID = pid
            observer = nil
            observedWindow = nil
            guard AXObserverCreate(pid, onHostGeometry, &observer) == .success, let observer else { return }
            let app = AXUIElementCreateApplication(pid)
            for event in [kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification, kAXWindowCreatedNotification] {
                AXObserverAddNotification(observer, app, event as CFString, Unmanaged.passUnretained(self).toOpaque())
            }
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
        var value: CFTypeRef?
        guard let observer, AXUIElementCopyAttributeValue(AXUIElementCreateApplication(pid),
              kAXFocusedWindowAttribute as CFString, &value) == .success, let value,
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return }
        let window = value as! AXUIElement
        if let old = observedWindow {
            if CFEqual(old, window) { return }
            for event in geometry { AXObserverRemoveNotification(observer, old, event as CFString) }
        }
        observedWindow = window
        for event in geometry {
            AXObserverAddNotification(observer, window, event as CFString, Unmanaged.passUnretained(self).toOpaque())
        }
    }

    private func refresh() {
        let inode = (try? FileManager.default.attributesOfItem(atPath: config.path)[.systemFileNumber]) as? NSNumber
        if fileInode != inode {
            fileSource?.cancel()
            fileSource = watch(config)
            fileInode = inode
        }
        guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == hostID,
              AXIsProcessTrusted(), let data = try? Data(contentsOf: config),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let settings = object["userSettings"] as? [String: Any] else { panel.orderOut(nil); return }
        let mode = settings["themeMode"] as? String ?? ""
        let systemDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let night = mode.contains("DARK") || (!mode.contains("LIGHT") && systemDark)
        let seeds = settings[night ? "customThemeSeedsDark" : "customThemeSeedsLight"] as? [String: Any]
        guard (seeds?["background"] as? String)?.uppercased() == (night ? "#191623" : "#F2E5C9") else {
            panel.orderOut(nil); return
        }
        observe(app.processIdentifier)
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0) as? [[String: Any]]
        guard let window = windows?.first(where: {
            $0[kCGWindowOwnerPID as String] as? pid_t == app.processIdentifier && $0[kCGWindowLayer as String] as? Int == 0
        }), let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
              let x = bounds["X"], let y = bounds["Y"], let w = bounds["Width"], let h = bounds["Height"],
              w > 350, h > 220, let screen = NSScreen.screens.first,
              let number = window[kCGWindowNumber as String] as? Int else { panel.orderOut(nil); return }
        trim.night = night
        panel.setFrame(NSRect(x: x, y: screen.frame.maxY - y - h, width: w, height: h), display: true)
        panel.order(.above, relativeTo: number)
    }
}
