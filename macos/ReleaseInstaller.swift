import AppKit

// The GUI and the installation recipe travel inside the same signed app.
final class Installer: NSObject, NSApplicationDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 450, height: 164),
                          styleMask: [.titled], backing: .buffered, defer: false)
    let status = NSTextField(wrappingLabelWithString: "正在检查本机环境…")
    let progress = NSProgressIndicator()
    let task = Process()
    var installing = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "安装吉米奈的工作台"
        window.center()
        status.frame = NSRect(x: 24, y: 70, width: 402, height: 66)
        status.font = .systemFont(ofSize: 15)
        window.contentView?.addSubview(status)
        progress.frame = NSRect(x: 24, y: 42, width: 402, height: 16)
        progress.isIndeterminate = true
        window.contentView?.addSubview(progress)
        progress.startAnimation(nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let res = Bundle.main.resourceURL!
        task.executableURL = res.appendingPathComponent("Python/bin/python3.12")
        task.arguments = ["-I", "-B", "-u", res.appendingPathComponent("install-release.py").path]
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "PYTHONPATH")
        env.removeValue(forKey: "PYTHONHOME")
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONNOUSERSITE"] = "1"
        task.environment = env
        let output = Pipe()
        task.standardOutput = output
        task.standardError = output
        do {
            try task.run()
        } catch {
            finished(false, error.localizedDescription)
            return
        }
        DispatchQueue.global().async {
            var pending = Data()
            var last = ""
            while true {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                pending.append(chunk)
                while let end = pending.firstIndex(of: 10) {
                    let line = String(decoding: pending[..<end], as: UTF8.self)
                    pending.removeSubrange(...end)
                    if line.isEmpty { continue }
                    last = line
                    if line.hasPrefix("正在") || line.hasPrefix("已找到") || line.hasPrefix("安装完成") {
                        DispatchQueue.main.async { self.status.stringValue = line }
                    }
                }
            }
            self.task.waitUntilExit()
            let success = self.task.terminationStatus == 0
            let message = last
            DispatchQueue.main.async { self.finished(success, message) }
        }
    }

    func finished(_ success: Bool, _ message: String) {
        installing = false
        progress.stopAnimation(nil)
        if success { NSApp.terminate(nil); return }
        let alert = NSAlert()
        alert.messageText = "安装未完成"
        alert.informativeText = message
        alert.addButton(withTitle: "关闭")
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        installing ? .terminateCancel : .terminateNow
    }
}
let app = NSApplication.shared
let installer = Installer()
app.setActivationPolicy(.regular)
app.delegate = installer
app.run()
