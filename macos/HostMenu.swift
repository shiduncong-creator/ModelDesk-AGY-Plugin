import AppKit
import ApplicationServices
import Carbon.HIToolbox

private let hostID = "com.google.antigravity"
private let replayMarker: Int64 = 0x4d446d656e75
private var helperURL: URL? { Bundle.main.url(forResource: "host-action", withExtension: nil) }

private func accessStatus() -> [String: Any] {
    ["accessibility": AXIsProcessTrusted(), "inputMonitoring": CGPreflightListenEventAccess(),
     "bundleID": Bundle.main.bundleIdentifier ?? "", "hostBundleID": hostID,
     "actionHelper": helperURL.map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false]
}

private func printJSON(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys) else { return }
    print(String(decoding: data, as: UTF8.self))
}

private func requestPermissions(tapFailed: Bool = false) {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    if !AXIsProcessTrusted() { _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary) }
    else if tapFailed && !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
}

private func axValue(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

private func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = axValue(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

private func axText(_ element: AXUIElement, _ name: String) -> String? {
    axValue(element, name) as? String
}

private func same(_ a: AXUIElement?, _ b: AXUIElement?) -> Bool {
    guard let a, let b else { return false }
    return CFEqual(a, b)
}

private func explicitPath(_ raw: String) -> String? {
    let text = raw
    guard !text.isEmpty, text.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
    if text.hasPrefix("/") && !text.hasPrefix("//") { return text }
    guard let parts = URLComponents(string: text),
          parts.scheme?.lowercased() == "file", [nil, "", "localhost"].contains(parts.host?.lowercased()),
          parts.user == nil, parts.password == nil, parts.port == nil, parts.query == nil,
          parts.fragment == nil, !parts.percentEncodedPath.lowercased().contains("%2f"),
          let path = parts.percentEncodedPath.removingPercentEncoding,
          path.hasPrefix("/"), !path.hasPrefix("//"), path.rangeOfCharacter(from: .controlCharacters) == nil
    else { return nil }
    return path
}

private func editable(_ element: AXUIElement) -> Bool {
    let role = axText(element, kAXRoleAttribute)
    guard [kAXTextAreaRole, kAXTextFieldRole].contains(role),
          axText(element, kAXSubroleAttribute) != kAXSecureTextFieldSubrole else { return false }
    return axValue(element, kAXEnabledAttribute) as? Bool != false
}

private struct Context {
    let app: NSRunningApplication
    let window: AXUIElement
    let hit: AXUIElement
    let point: CGPoint
    var path: String?
    var preview: AXUIElement?
    var selection: String?
    var input: AXUIElement?
    var pointedAtInput = false
}

private func normalWindow(_ element: AXUIElement) -> AXUIElement? {
    let isWindow = axText(element, kAXRoleAttribute) == kAXWindowRole
    guard let window = isWindow ? element : axElement(element, kAXWindowAttribute),
          axText(window, kAXRoleAttribute) == kAXWindowRole else { return nil }
    let subrole = axText(window, kAXSubroleAttribute)
    return subrole == nil || subrole == kAXStandardWindowSubrole ? window : nil
}

private func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    AXUIElementCopyActionNames(element, &names)
    return names as? [String] ?? []
}

private func menuContext(_ app: NSRunningApplication, point: CGPoint, keyboard: Bool) -> Context? {
    let host = AXUIElementCreateApplication(app.processIdentifier)
    let focused = axElement(host, kAXFocusedUIElementAttribute)
    let hit: AXUIElement
    if keyboard {
        guard let focused else { return nil }
        hit = focused
    } else {
        var value: AXUIElement?
        let desktop = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(desktop, 0.12)
        guard AXUIElementCopyElementAtPosition(desktop, Float(point.x), Float(point.y), &value) == .success,
              let value else { return nil }
        hit = value
    }
    var pid: pid_t = 0
    guard AXUIElementGetPid(hit, &pid) == .success, pid == app.processIdentifier,
          let window = normalWindow(hit),
          same(window, axElement(host, kAXFocusedWindowAttribute)) else { return nil }
    return Context(app: app, window: window, hit: hit, point: point)
}

private func readTarget(_ original: Context) -> Context? {
    var context = original
    let hit = context.hit
    let host = AXUIElementCreateApplication(context.app.processIdentifier)
    let focused = axElement(host, kAXFocusedUIElementAttribute)
    // Only consult the selected control and its immediate semantic owners. A web area's
    // AXURL is the document itself, unrelated to a file the user has clicked.
    var item: AXUIElement? = hit
    var pressable: AXUIElement?
    for _ in 0..<7 {
        guard let node = item else { break }
        let role = axText(node, kAXRoleAttribute) ?? ""
        if [kAXMenuRole, kAXMenuBarRole, kAXMenuItemRole, kAXSheetRole].contains(role) ||
            axText(node, kAXSubroleAttribute) == kAXSecureTextFieldSubrole { return nil }
        if [kAXWindowRole, kAXApplicationRole].contains(role) { break }
        if context.input == nil, editable(node) {
            context.input = node
            context.pointedAtInput = true
        }
        if context.selection == nil, let text = axText(node, kAXSelectedTextAttribute), !text.isEmpty {
            context.selection = text
        }
        if role == "AXWebArea" { break }
        if context.path == nil {
            let actionable = ["AXLink", kAXButtonRole, kAXRowRole, kAXCellRole].contains(role)
            if actionable && actions(node).contains(kAXPressAction) { pressable = node }
            let url = axValue(node, kAXURLAttribute)
            var candidates = [(url as? URL)?.absoluteString ?? url as? String]
            if !editable(node) {
                candidates += [axText(node, kAXTitleAttribute), axText(node, kAXDescriptionAttribute),
                               axText(node, kAXHelpAttribute)]
                if role == kAXStaticTextRole { candidates.append(axText(node, kAXValueAttribute)) }
            }
            if let path = candidates.compactMap({ $0.flatMap(explicitPath) }).first {
                context.path = path
                context.preview = pressable
            }
        } else if context.preview == nil, ["AXLink", kAXButtonRole].contains(role),
                  actions(node).contains(kAXPressAction) {
            context.preview = node
        }
        item = axElement(node, kAXParentAttribute)
    }
    if context.path == nil, let text = context.selection {
        context.path = explicitPath(text)
    }
    if context.input == nil, let focused, same(context.window, normalWindow(focused)), editable(focused) {
        context.input = focused
    }
    return context
}

private struct Response: Decodable {
    let ok: Bool
    let text: String?
    let path: String?
    let relative: String?
    let uri: String?
    let error: String?
}

private enum FileCommand: String, CaseIterable {
    case hostPreview = "在 Antigravity 中打开此文件"
    case quickLook = "系统快速查看"
    case reveal = "在访达中显示"
    case absolute = "复制绝对路径"
    case relative = "复制工作区相对路径"
    case attach = "将文件粘贴到对话输入框…"
    case insertPath = "将路径文字插入对话输入框…"
    case translate = "使用已配置的 API 翻译…"
    case diff = "查看 Git Diff"
    case rename = "改名…"
    case trash = "移到废纸篓…"
}

private final class Handler: NSObject {
    let run: () -> Void
    init(_ run: @escaping () -> Void) { self.run = run }
    @objc(modelDeskInvoke:) func invokeMenuItem(_ sender: Any?) { run() }
}

private func add(_ title: String, _ menu: NSMenu, enabled: Bool = true, _ body: @escaping () -> Void) {
    let item = NSMenuItem(title: title, action: #selector(Handler.invokeMenuItem(_:)), keyEquivalent: "")
    let callback = Handler(body)
    item.representedObject = callback
    item.target = callback
    item.isEnabled = enabled
    menu.addItem(item)
}

private func header(_ title: String, _ menu: NSMenu) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.isEnabled = false
    menu.addItem(item)
}

private func copyText(_ text: String) {
    let board = NSPasteboard.general
    board.clearContents()
    board.setString(text, forType: .string)
}

private func alert(_ title: String, _ message: String, buttons: [String] = ["好"],
                   accessory: NSView? = nil) -> NSApplication.ModalResponse {
    let dialog = NSAlert()
    dialog.messageText = title
    dialog.informativeText = message
    for name in buttons { dialog.addButton(withTitle: name) }
    if let accessory { dialog.accessoryView = accessory }
    NSApp.activate(ignoringOtherApps: true)
    return dialog.runModal()
}

private func displayText(_ title: String, _ content: String) {
    let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 300))
    scroll.hasVerticalScroller = true
    let view = NSTextView(frame: scroll.contentView.bounds)
    view.isEditable = false
    view.isSelectable = true
    view.isVerticallyResizable = true
    view.autoresizingMask = [.width]
    view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    view.string = content
    scroll.documentView = view
    if alert(title, "", buttons: ["好", "复制全文"], accessory: scroll) == .alertSecondButtonReturn { copyText(content) }
}

private func backend(_ action: String, _ path: String, extra: [String: Any] = [:],
                     then: @escaping (Response) -> Void) {
    let payload = extra.merging(["action": action, "path": path]) { _, new in new }
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            guard let executable = helperURL else {
                throw NSError(domain: "ModelDesk", code: 1, userInfo: [NSLocalizedDescriptionKey: "安装包缺少 host-action"])
            }
            let input = try JSONSerialization.data(withJSONObject: payload)
            let process = Process(), reader = Pipe(), writer = Pipe()
            process.executableURL = executable
            process.standardInput = writer
            process.standardOutput = reader
            process.standardError = FileHandle.nullDevice
            try process.run()
            try writer.fileHandleForWriting.write(contentsOf: input)
            try writer.fileHandleForWriting.close()
            let data = try reader.fileHandleForReading.readToEnd() ?? Data()
            process.waitUntilExit()
            let result = try JSONDecoder().decode(Response.self, from: data)
            DispatchQueue.main.async {
                if result.ok { then(result) }
                else { _ = alert("文件操作未完成", result.error ?? "文件服务返回错误") }
            }
        } catch {
            DispatchQueue.main.async { _ = alert("文件服务未响应", error.localizedDescription) }
        }
    }
}

private func stillInWindow(_ context: Context) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == context.app.processIdentifier else { return false }
    let host = AXUIElementCreateApplication(context.app.processIdentifier)
    return same(context.window, axElement(host, kAXFocusedWindowAttribute))
}

private func nativeMenu(_ context: Context) {
    guard stillInWindow(context) else { return }
    if AXUIElementPerformAction(context.hit, kAXShowMenuAction as CFString) == .success { return }
    // Only replay the user's original click in the same host window and at the same element.
    var current: AXUIElement?
    let point = context.point
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x),
          Float(point.y), &current) == .success, same(current, context.hit) else { return }
    for type: CGEventType in [.rightMouseDown, .rightMouseUp] {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .right)
        event?.setIntegerValueField(.eventSourceUserData, value: replayMarker)
        event?.post(tap: .cghidEventTap)
    }
}

private func suitableInput(_ input: AXUIElement, context: Context) -> Bool {
    guard editable(input) else { return false }
    let role = axText(input, kAXRoleAttribute)
    let labels = [kAXPlaceholderValueAttribute, kAXDescriptionAttribute, kAXTitleAttribute, kAXIdentifierAttribute]
        .compactMap { axText(input, $0) }.joined(separator: " ").lowercased()
    if ["search", "filter", "搜索", "筛选"].contains(where: labels.contains) { return false }
    if ["message", "chat", "ask ", "composer", "prompt", "对话", "消息", "提问"].contains(where: labels.contains) { return true }
    // For an unlabelled browser editor, use only the multiline input explicitly
    // indicated by this right click or its focused keyboard invocation.
    return context.pointedAtInput && role == kAXTextAreaRole
}

private func pasteFile(_ path: String, asText: Bool, into input: AXUIElement, context: Context) -> Bool {
    guard stillInWindow(context), suitableInput(input, context: context), same(normalWindow(input), context.window) else { return false }
    let host = AXUIElementCreateApplication(context.app.processIdentifier)
    if !same(input, axElement(host, kAXFocusedUIElementAttribute)) {
        guard AXUIElementSetAttributeValue(input, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { return false }
    }
    guard same(input, axElement(host, kAXFocusedUIElementAttribute)), stillInWindow(context) else { return false }
    if asText, AXUIElementSetAttributeValue(input, kAXSelectedTextAttribute as CFString, path as CFString) == .success { return true }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false) else { return false }
    if asText { copyText(path) }
    else {
        let board = NSPasteboard.general
        board.clearContents()
        guard board.writeObjects([URL(fileURLWithPath: path) as NSURL]) else { return false }
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.postToPid(context.app.processIdentifier)
    up.postToPid(context.app.processIdentifier)
    return true
}

private final class Agent: NSObject, NSApplicationDelegate {
    var tap: CFMachPort?
    var lastTapAttemptFailed = false
    var runSource: CFRunLoopSource?
    var hotKey: EventHotKeyRef?
    var eventHandler: EventHandlerRef?
    var pendingClick: Context?
    var visibleMenu: NSMenu?
    var statusItem: NSStatusItem?
    var statusMenu: NSMenu?
    var pendingPath: (path: String, asText: Bool, context: Context, since: Date)?
    var lastStatus: Data?
    var retry: Timer?
    let pixelFrame = HostPixelFrame()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        pixelFrame.start()
        buildStatusMenu()
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, pointer in
            guard let pointer else { return OSStatus(eventNotHandledErr) }
            let agent = Unmanaged<Agent>.fromOpaque(pointer).takeUnretainedValue()
            DispatchQueue.main.async { agent.keyboardMenu() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(changeFront),
                            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        refresh()
        retry = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func buildStatusMenu() {
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "cursorarrow.click.2", accessibilityDescription: "ModelDesk 右键菜单")
        status.button?.toolTip = "ModelDesk · Antigravity 右键菜单"
        let menu = NSMenu()
        menu.autoenablesItems = false
        header("ModelDesk · 宿主菜单", menu)
        add("检查权限与连接", menu) { [weak self] in
            let ax = AXIsProcessTrusted() ? "已授权" : "待授权"
            let tap = self?.tap != nil ? "已接入" : "待接入"
            let listen = CGPreflightListenEventAccess() ? "已授权" : "待授权"
            _ = alert("宿主菜单", "辅助功能：\(ax)\n输入监控：\(listen)\n右键事件：\(tap)\n授权后会自动重试。按住 Option 右击可直接打开原生菜单。")
        }
        add("申请系统权限…", menu) { [weak self] in
            requestPermissions(tapFailed: self?.lastTapAttemptFailed == true)
        }
        for (title, key) in [("辅助功能设置…", "Accessibility"), ("输入监控设置…", "ListenEvent")] {
            add(title, menu) {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_\(key)") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
        add("退出菜单助手", menu) { NSApp.terminate(nil) }
        status.menu = menu
        statusItem = status
        statusMenu = menu
    }

    @objc func changeFront() {
        pendingClick = nil
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier != hostID { visibleMenu?.cancelTracking() }
        refresh()
    }

    func recordStatus() {
        var state = accessStatus()
        state["pid"] = ProcessInfo.processInfo.processIdentifier
        state["tapEnabled"] = tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false
        state["hotKey"] = hotKey != nil
        state["tapCreationFailed"] = lastTapAttemptFailed
        state["hostFront"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == hostID
        guard let data = try? JSONSerialization.data(withJSONObject: state, options: .sortedKeys),
              data != lastStatus,
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        let folder = support.appendingPathComponent("ModelDesk Host Menu", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            try data.write(to: folder.appendingPathComponent("status.json"), options: .atomic)
            lastStatus = data
        } catch { NSLog("ModelDesk could not record menu availability") }
    }

    func refresh() {
        defer { recordStatus() }
        let ready = AXIsProcessTrusted()
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == hostID
        if ready && front && hotKey == nil && eventHandler != nil {
            RegisterEventHotKey(UInt32(kVK_F10), UInt32(shiftKey),
                                EventHotKeyID(signature: 0x4d44484d, id: 1), GetApplicationEventTarget(), 0, &hotKey)
        } else if (!ready || !front), let current = hotKey {
            UnregisterEventHotKey(current)
            hotKey = nil
        }
        if !ready || !front {
            if let current = tap { CGEvent.tapEnable(tap: current, enable: false) }
            return
        }
        if let current = tap {
            if !CGEvent.tapIsEnabled(tap: current) { CGEvent.tapEnable(tap: current, enable: true) }
            return
        }
        let mask = (CGEventMask(1) << CGEventType.rightMouseDown.rawValue) | (CGEventMask(1) << CGEventType.rightMouseUp.rawValue)
        guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, pointer in
            guard let pointer else { return Unmanaged.passUnretained(event) }
            return Unmanaged<Agent>.fromOpaque(pointer).takeUnretainedValue().mouse(type, event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
            lastTapAttemptFailed = true
            return
        }
        lastTapAttemptFailed = false
        let source = CFMachPortCreateRunLoopSource(nil, port, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        runSource = source
        tap = port
    }

    func mouse(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        let original = Unmanaged.passUnretained(event)
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            pendingClick = nil
            DispatchQueue.main.async { self.refresh() }
            return original
        }
        guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == hostID,
              event.getIntegerValueField(.eventSourceUserData) != replayMarker else { return original }
        if type == .rightMouseUp, let context = pendingClick {
            pendingClick = nil
            DispatchQueue.main.async {
                if let target = readTarget(context) { self.show(target) } else { nativeMenu(context) }
            }
            return nil
        }
        if type == .rightMouseDown && visibleMenu == nil && !event.flags.contains(.maskAlternate) {
            pendingClick = menuContext(app, point: event.location, keyboard: false)
            if pendingClick != nil { return nil }
        }
        return original
    }

    func keyboardMenu() {
        guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == hostID,
              var context = menuContext(app, point: CGEvent(source: nil)?.location ?? .zero, keyboard: true) else { return }
        if let pos = axValue(context.hit, kAXPositionAttribute), CFGetTypeID(pos) == AXValueGetTypeID() {
            var point = CGPoint.zero
            if AXValueGetValue((pos as! AXValue), .cgPoint, &point) {
                context = Context(app: context.app, window: context.window, hit: context.hit,
                      point: CGPoint(x: point.x + 8, y: point.y + 8), path: context.path,
                      preview: context.preview, selection: context.selection, input: context.input)
            }
        }
        if let target = readTarget(context) { show(target) } else { nativeMenu(context) }
    }

    func show(_ context: Context) {
        guard visibleMenu == nil, stillInWindow(context) else { return }
        let menu = NSMenu()
        menu.autoenablesItems = false
        header("ModelDesk", menu)
        if let path = context.path {
            header(URL(fileURLWithPath: path).lastPathComponent, menu)
            menu.items.last?.toolTip = path
            addFileCommands(context, menu, path)
        }
        add("选择项目文件…", menu) { [weak self] in self?.pick(context) }
        if let text = context.selection {
            add("复制所选文本", menu) { copyText(text) }
        }
        if let (path, asText, previous, since) = pendingPath, let input = context.input, suitableInput(input, context: context),
           previous.app.processIdentifier == context.app.processIdentifier,
           same(previous.window, context.window), since.timeIntervalSinceNow > -300 {
            let action = asText ? "插入待附加路径" : "粘贴待附加文件"
            add("\(action) · \(URL(fileURLWithPath: path).lastPathComponent)", menu) { [weak self] in
                if pasteFile(path, asText: asText, into: input, context: context) { self?.pendingPath = nil }
                else { _ = alert("插入路径", "请聚焦此窗口的消息输入框后再次打开右键菜单。") }
            }
        }
        menu.addItem(.separator())
        add("Antigravity 原生菜单", menu) { nativeMenu(context) }
        visibleMenu = menu
        defer { visibleMenu = nil }
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        menu.popUp(positioning: nil, at: NSPoint(x: context.point.x, y: top - context.point.y), in: nil)
    }

    func pick(_ context: Context) {
        let panel = NSOpenPanel()
        panel.title = "选择当前项目或会话的文件"
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let path = panel.url?.path else { return }
        backend("info", path) { [weak self] result in
            guard let self, result.path != nil else { return }
            var selected = context
            selected.path = path
            selected.preview = nil
            context.app.activate(options: [])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.show(selected) }
        }
    }

    func addFileCommands(_ context: Context, _ menu: NSMenu, _ path: String) {
        for command in FileCommand.allCases {
            if [.absolute, .translate, .rename].contains(command) { menu.addItem(.separator()) }
            add(command.rawValue, menu, enabled: command != .hostPreview || context.preview != nil) { [weak self] in
                backend("info", path) { result in
                    guard let resolved = result.path else { return }
                    let target = [.rename, .trash].contains(command) ? path : resolved
                    self?.perform(command, target, context)
                }
            }
        }
    }

    func perform(_ command: FileCommand, _ path: String, _ context: Context) {
        let url = URL(fileURLWithPath: path)
        switch command {
        case .absolute: copyText(path)
        case .relative:
            backend("copy_relative", path) { if let text = $0.text { copyText(text) } }
        case .reveal:
            NSWorkspace.shared.activateFileViewerSelecting([url])
        case .quickLook:
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/qlmanage")
            process.arguments = ["-p", path]
            process.standardError = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            do { try process.run() } catch { _ = alert("快速查看", error.localizedDescription) }
        case .hostPreview:
            guard let control = context.preview, stillInWindow(context),
                  AXUIElementPerformAction(control, kAXPressAction as CFString) == .success else {
                _ = alert("原生文件预览", "原文件控件已变化，请重新点选文件，或使用系统快速查看。")
                return
            }
        case .attach, .insertPath:
            let asText = command == .insertPath
            if let input = context.input, pasteFile(path, asText: asText, into: input, context: context) { return }
            pendingPath = (path, asText, context, Date())
            let next = asText ? "插入待附加路径" : "粘贴待附加文件"
            if alert(next, "请在原会话点入消息输入框，然后右键选择「\(next)」。",
                     buttons: ["好", "复制路径"]) == .alertSecondButtonReturn { copyText(path) }
            context.app.activate(options: [])
        case .diff, .translate:
            backend(command == .diff ? "git_diff" : "translate", path) {
                displayText((command == .diff ? "Git Diff · " : "译文 · ") + url.lastPathComponent,
                            $0.text?.isEmpty == false ? $0.text! : (command == .diff ? "暂无差异" : "译文为空"))
            }
        case .rename:
            let field = NSTextField(string: url.lastPathComponent)
            field.frame.size = NSSize(width: 370, height: 24)
            guard alert("改名", path, buttons: ["取消", "确认改名"], accessory: field) == .alertSecondButtonReturn else { return }
            backend("rename", path, extra: ["destination": field.stringValue, "confirmed": true]) { _ in }
        case .trash:
            guard alert("移到废纸篓？", path, buttons: ["取消", "确认移到废纸篓"]) == .alertSecondButtonReturn else { return }
            backend("trash", path, extra: ["confirmed": true]) { _ in }
        }
    }
}

@main
private enum HostMenuMain {
    static func main() {
        let arguments = Set(CommandLine.arguments.dropFirst())
        if arguments.contains("--status") {
            printJSON(accessStatus())
        } else if arguments.contains("--request-permissions") {
            requestPermissions()
            printJSON(accessStatus())
        } else if arguments.contains("--self-test") {
            _ = NSApplication.shared
            let menu = NSMenu()
            menu.autoenablesItems = false
            var ran = false
            add("菜单动作", menu) { ran = true }
            menu.performActionForItem(at: 0)
            let cases: [(String, String?)] = [("README.md", nil), ("../file", nil), ("/tmp/Test A", "/tmp/Test A"),
                ("https://example.com/a", nil), ("file://host/private/x", nil), ("file:///tmp/abc%20d", "/tmp/abc d"),
                ("file:///tmp/x?other", nil), ("file:///tmp/%00", nil), ("/x\n/y", nil)]
            let paths = cases.allSatisfy { explicitPath($0.0) == $0.1 }
            let ok = ran && paths && Set(FileCommand.allCases.map(\.rawValue)).count == 11
            printJSON(["ok": ok, "pathCases": cases.count, "fileCommands": FileCommand.allCases.count, "menuAction": ran])
            exit(ok ? 0 : 1)
        } else {
            let app = NSApplication.shared
            let delegate = Agent()
            app.delegate = delegate
            withExtendedLifetime(delegate) { app.run() }
        }
    }
}
