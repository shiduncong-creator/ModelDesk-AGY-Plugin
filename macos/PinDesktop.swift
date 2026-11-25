import Foundation
import CoreFoundation

let dock = "com.apple.dock" as CFString
let key = "persistent-apps" as CFString
let identifier = "org.modeldesk.antigravity.desktop"
let path = CommandLine.arguments[1]
let app = URL(fileURLWithPath: path, isDirectory: true)
guard let bundle = Bundle(url: app), bundle.bundleIdentifier == identifier,
      let title = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String else {
    throw NSError(domain: "无法识别独立桌面", code: 1)
}
guard var pins = CFPreferencesCopyAppValue(key, dock) as? [[String: Any]] else {
    throw NSError(domain: "无法读取 Dock 固定项目", code: 1)
}
let legacy = app.deletingLastPathComponent().appendingPathComponent("ModelDesk.app").path
let matches = pins.indices.filter {
    let data = pins[$0]["tile-data"] as? [String: Any]
    let file = data?["file-data"] as? [String: Any]
    let saved = (file?["_CFURLString"] as? String).flatMap(URL.init(string:))?.path
    return data?["bundle-identifier"] as? String == identifier || saved == legacy || saved == app.path
}
guard matches.count < 2 else { throw NSError(domain: "Dock 中有多个工作台入口", code: 1) }
let index = matches.first ?? pins.count
var tile = matches.isEmpty ? ["tile-type": "file-tile"] : pins[index]
var data = tile["tile-data"] as? [String: Any] ?? [:]
let oldFile = data["file-data"] as? [String: Any]
if data["file-label"] as? String == title,
   oldFile?["_CFURLString"] as? String == app.absoluteString { exit(0) }
data["file-label"] = title
data["bundle-identifier"] = identifier
data["file-data"] = ["_CFURLString": app.absoluteString, "_CFURLStringType": 15]
data["book"] = try app.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
tile["tile-data"] = data
if index == pins.count { pins.append(tile) } else { pins[index] = tile }
CFPreferencesSetAppValue(key, pins as CFArray, dock)
guard CFPreferencesAppSynchronize(dock) else { throw NSError(domain: "Dock 写入失败", code: 1) }
let refresh = Process()
refresh.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
refresh.arguments = ["Dock"]
try refresh.run()
refresh.waitUntilExit()
print("Dock 位置", index + 1, title)
