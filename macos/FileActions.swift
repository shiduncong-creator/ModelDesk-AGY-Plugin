import AppKit

private enum Action: String, CaseIterable {
    case diff, translate, rename, trash
    case relative = "copy_relative"

    var title: String {
        switch self {
        case .relative: return "复制工作区相对路径"
        case .diff: return "查看 Git 差异"
        case .translate: return "翻译此文件"
        case .rename: return "重命名文件"
        case .trash: return "移到废纸篓"
        }
    }

    var backend: String { self == .diff ? "git_diff" : rawValue }
}

private func readable(_ value: String) -> Bool {
    !value.unicodeScalars.contains {
        CharacterSet.controlCharacters.contains($0) ||
        (0x202A...0x202E).contains($0.value) || (0x2066...0x2069).contains($0.value)
    }
}

private struct Request: Equatable {
    let action: Action
    let path: String

    init?(_ url: URL) {
        guard url.absoluteString.utf8.count <= 16384,
              url.absoluteString.hasPrefix("modeldesk-document://file/"),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "modeldesk-document", parts.percentEncodedHost == "file",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              let action = Action.allCases.first(where: { parts.percentEncodedPath == "/" + $0.rawValue }),
              let query = parts.percentEncodedQuery, query.hasPrefix("path="), !query.contains("&"),
              let path = String(query.dropFirst(5)).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
              path.utf8.count < 4096, path.hasPrefix("/"), readable(path) else { return nil }
        let components = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        self.action = action
        self.path = path
    }

    func hasDirectFile() -> Bool {
        let url = URL(fileURLWithPath: path)
        return url.resolvingSymlinksInPath().path == path &&
            (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }

    func destination(for name: String) -> String? {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), readable(name),
              name.utf8.count <= 255 else { return nil }
        let url = URL(fileURLWithPath: path)
        let to = url.deletingLastPathComponent().appendingPathComponent(name).path
        return to == path ? nil : to
    }
}

private func backend(_ request: Request, name: String) throws -> String {
    guard let helper = Bundle.main.url(forResource: "host-action", withExtension: nil) else {
        throw Notice.message("安装包中找不到文件操作程序。")
    }
    guard request.hasDirectFile() else { throw Notice.message("请选择仍在原位置的普通文件，路径中不能包含符号链接。") }
    var args: [String: Any] = ["action": request.action.backend, "path": request.path, "confirmed": true]
    if request.action == .rename {
        guard request.destination(for: name) != nil else { throw Notice.message("请输入同目录下的新文件名。") }
        args["destination"] = name
    }
    let data = try JSONSerialization.data(withJSONObject: args)
    let process = Process(), stdin = Pipe(), stdout = Pipe()
    process.executableURL = helper
    process.standardInput = stdin
    process.standardOutput = stdout
    process.standardError = FileHandle.nullDevice
    try process.run()
    try stdin.fileHandleForWriting.write(contentsOf: data)
    try stdin.fileHandleForWriting.close()
    let answer = stdout.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0,
          let result = try? JSONSerialization.jsonObject(with: answer) as? [String: Any] else {
        throw Notice.message("本机文件操作程序未返回有效结果。")
    }
    guard result["ok"] as? Bool == true else {
        throw Notice.message(result["error"] as? String ?? "文件操作失败。")
    }
    if let text = result["text"] as? String { return text.isEmpty ? "当前文件没有可显示的差异。" : text }
    if let path = result["path"] as? String { return "已重命名为\n" + path }
    return "已移到废纸篓\n" + request.path
}

private enum Notice: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let value): return value }
    }
}

private final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, NSTextFieldDelegate {
    let heading = NSTextField(labelWithString: "")
    let input = NSTextField()
    let text = NSTextView()
    let confirm = NSButton()
    let cancel = NSButton()
    var window: NSWindow?
    private var request: Request?
    private var running = false
    private var finished = false
    private var receivedURL = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出文件操作", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSResponder.selectAll(_:)), keyEquivalent: "a")
        let appItem = NSMenuItem(), editItem = NSMenuItem()
        menu.addItem(appItem)
        menu.addItem(editItem)
        appItem.submenu = appMenu
        editItem.submenu = edit
        NSApp.mainMenu = menu
        // LaunchServices can deliver the initial URL just after finish-launching.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, !self.receivedURL, self.window == nil else { return }
            self.show(nil)
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        receivedURL = true
        let incoming = urls.lazy.compactMap(Request.init).first
        if let window = window, running || (!finished && request != nil) || (finished && request == incoming) {
            window.orderFront(nil)
            return
        }
        show(incoming)
    }

    private func show(_ item: Request?) {
        request = item
        finished = item == nil
        if window == nil { buildWindow() }
        heading.stringValue = item?.action.title ?? "ModelDesk 文件操作"
        input.isHidden = item?.action != .rename
        input.stringValue = item.map { URL(fileURLWithPath: $0.path).lastPathComponent } ?? ""
        confirm.isHidden = item == nil
        cancel.title = item == nil ? "关闭" : "取消"
        refresh()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if item?.action == .rename { window?.makeFirstResponder(input) }
        else { window?.makeFirstResponder(cancel) }
    }

    private func buildWindow() {
        let w = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 610,height: 365),
                         styleMask: [.titled,.closable,.resizable], backing: .buffered, defer: false)
        w.title = "ModelDesk 文件操作"
        w.isReleasedWhenClosed = false
        w.delegate = self
        w.minSize = NSSize(width: 420, height: 285)
        guard let content = w.contentView else { return }
        heading.font = .boldSystemFont(ofSize: 19)
        input.placeholderString = "新文件名"
        input.delegate = self
        input.setAccessibilityLabel("新文件名")
        text.isEditable = false
        text.isRichText = false
        text.isVerticallyResizable = true
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.textContainerInset = NSSize(width: 8, height: 9)
        text.font = .systemFont(ofSize: 14)
        let scroll = NSScrollView()
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        scroll.documentView = text
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)
        confirm.bezelStyle = .rounded
        confirm.target = self
        confirm.action = #selector(execute)
        cancel.bezelStyle = .rounded
        cancel.keyEquivalent = "\u{1b}"
        cancel.target = self
        cancel.action = #selector(close)
        let controls = NSStackView(views: [cancel, confirm])
        let stack = NSStackView(views: [heading, input, scroll, controls])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
                                    stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -18),
                                    stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 18),
                                    stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -16),
                                    scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
                                    input.widthAnchor.constraint(equalTo: stack.widthAnchor),
                                    scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 110)])
        window = w
        w.center()
    }

    private func refresh() {
        guard let req = request else {
            text.string = "在 Antigravity 的文件菜单中选择差异、翻译、重命名或移到废纸篓，即可在这里核对目标。"
            return
        }
        let target = req.destination(for: input.stringValue)
        let detail: String
        switch req.action {
        case .relative: detail = "确认后按已登记的工作区计算相对路径并复制到剪贴板。"
        case .diff: detail = "确认后读取此文件的 Git 差异，在此窗口显示。"
        case .translate: detail = "确认后将此文件的文本发送给 ModelDesk 中已配置的翻译 API，结果在此窗口显示。"
        case .rename: detail = target.map { "新路径\n" + $0 } ?? "请在上方输入新的文件名。"
        case .trash: detail = "确认后将在访达中把上面的文件移到废纸篓。"
        }
        text.string = "文件\n" + req.path + "\n\n" + detail
        confirm.title = req.action == .translate ? "确认发送并翻译" : "确认" + req.action.title
        confirm.isEnabled = req.action != .rename || target != nil
    }

    func controlTextDidChange(_ notification: Notification) { if !running && !finished { refresh() } }

    @objc private func execute() {
        guard let req = request, !running, !finished,
              req.action != .rename || req.destination(for: input.stringValue) != nil else { return }
        let name = input.stringValue
        running = true
        input.isEnabled = false
        confirm.isEnabled = false
        cancel.isEnabled = false
        text.string = "正在执行" + req.action.title + "…\n\n" + req.path
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try backend(req, name: name) }
            DispatchQueue.main.async {
                self.running = false
                self.finished = true
                self.heading.stringValue = req.action.title + " · 结果"
                self.input.isEnabled = true
                self.input.isHidden = true
                self.confirm.isHidden = true
                self.cancel.isEnabled = true
                self.cancel.title = "关闭"
                switch result {
                case .success(let value):
                    if req.action == .relative {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(value, forType: .string)
                    }
                    self.text.string = value
                case .failure(let error): self.text.string = error.localizedDescription
                }
                self.text.scrollToBeginningOfDocument(nil)
            }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { !running }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        running ? .terminateCancel : .terminateNow
    }
    @objc private func close() { if !running { window?.performClose(nil) } }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

private func selfTest() -> Bool {
    let valid = "modeldesk-document://file/"
    let tests: [(String, String?)] = [
        (valid + "diff?path=%2Ffoo%2Fa+b%2Bc", "/foo/a b+c"),
        (valid + "trash?path=%2Ffoo%2F%252F", "/foo/%2F"),
        (valid + "translate?path=%2Ffoo%2F%E6%96%87%E4%BB%B6", "/foo/文件"),
        (valid + "rename?path=%2Fa%26b", "/a&b"),
        (valid + "trash?path=%2Fa&path=%2Fb", nil),
        (valid + "trash?path=relative", nil), (valid + "diff?path=%2Fx%2F..%2Fy", nil),
        (valid + "diff?path=%2Fx%2F.%2Fy", nil), (valid + "diff?path=%2F%2Ffile", nil),
        (valid + "diff?path=%2Fx%00x", nil), (valid + "diff?path=%2Fa%E2%80%AEb", nil),
        (valid + "diff?path=%2Fa%0Ab", nil), (valid + "diff?path=%2Fa&confirmed=true", nil),
        (valid + "diff?path=%2Fa#", nil), (valid + "unknown?path=%2Fa", nil),
        ("modeldesk-document://user@file/diff?path=%2Fa",nil),
        ("modeldesk-document://file:123/diff?path=%2Fa",nil),
        ("modeldesk-document://other/diff?path=%2Fa",nil),
        ("https://file/diff?path=%2Fa",nil),
    ]
    return tests.allSatisfy { raw, expected in
        let parsed = URL(string: raw).flatMap(Request.init)
        return parsed?.path == expected
    }
}

if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
    guard selfTest() else { fputs("URL validation failed\n", stderr); exit(1) }
    print("File Actions URL checks passed.")
} else {
    let application = NSApplication.shared
    let delegate = App()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
}
