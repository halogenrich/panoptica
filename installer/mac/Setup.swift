// PANOPTICA Setup for macOS (0.48; licence file 0.49): the wizard. It asks for the lab's licence file, shows what it covers (the
// helper reads it, with the Node this app carries, and finds the package for its modules among those the app carries), asks
// whether the lab network may open PANOPTICA, then runs setup.sh as an administrator (macOS asks for the password) and shows its
// steps until PANOPTICA is running. No internet is needed.
// Built by tools/installer-build.mjs --mac on a Mac: swiftc for Apple silicon and Intel, joined with lipo.
import AppKit
import SwiftUI

@main
struct SetupApp: App {
  @NSApplicationDelegateAdaptor(Delegate.self) var delegate
  @StateObject private var model = Model()

  var body: some Scene {
    WindowGroup("PANOPTICA Setup") {
      Wizard().environmentObject(model).frame(width: Delegate.size.width, height: Delegate.size.height).fixedSize()
    }
    .commands { CommandGroup(replacing: .newItem) {} }
  }
}

final class Delegate: NSObject, NSApplicationDelegate {
  static let size = NSSize(width: 660, height: 450)
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.async {
      for w in NSApp.windows {
        w.styleMask.remove(.resizable)
        w.setContentSize(Delegate.size)
        w.collectionBehavior.insert(.fullScreenNone)
        w.center()
      }
    }
  }
}

enum Step: Int, CaseIterable {
  case intro, licence, review, install, done
  var title: String { ["Introduction", "Licence file", "Review", "Installation", "Summary"][rawValue] }
}

final class Model: ObservableObject {
  @Published var step: Step = .intro
  /// the licence file the person chose, and the copy Setup reads (in this user's temporary folder, which the administrator's
  /// script can read: the original may sit in a folder macOS keeps from it)
  @Published var licence: URL?
  private var copy: URL?
  @Published var lan = true
  @Published var busy = false
  @Published var error = ""
  @Published var info: [String: String] = [:]
  @Published var lines: [String] = []
  @Published var ok = false

  let dir = "/Library/PANOPTICA"
  private let res = Bundle.main.resourceURL!

  /// `--licence <file>` when the app is opened with it (IT, and the tests' screenshots): the file is already chosen
  init() {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--licence"), i + 1 < a.count { licence = URL(fileURLWithPath: a[i + 1]) }
  }
  private var timer: Timer?
  private var progress: URL?

  private var node: URL {
    #if arch(arm64)
      return res.appendingPathComponent("node-arm64/bin/node")
    #else
      return res.appendingPathComponent("node-x64/bin/node")
    #endif
  }

  /// One argument for the shell, in single quotes.
  private static func q(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

  private static func ini(_ url: URL) -> [String: String] {
    var r: [String: String] = [:]
    for line in ((try? String(contentsOf: url, encoding: .utf8)) ?? "").components(separatedBy: .newlines) {
      guard let eq = line.firstIndex(of: "="), !line.hasPrefix("[") else { continue }
      r[String(line[..<eq])] = String(line[line.index(after: eq)...])
    }
    return r
  }

  func back() {
    error = ""
    if let s = Step(rawValue: step.rawValue - 1) { step = s }
  }

  /// The licence file, from the open panel.
  func choose() {
    let panel = NSOpenPanel()
    panel.title = "Choose the licence file"
    panel.prompt = "Choose"
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.allowedFileTypes = ["json"]
    if panel.runModal() == .OK, let u = panel.url {
      licence = u
      error = ""
    }
  }

  /// What the licence covers and whether this Setup carries its package; nothing is installed yet.
  func check() {
    guard let lic = licence else { error = "Choose the licence file."; return }
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("panoptica-licence-\(UUID().uuidString).json")
    do {
      try FileManager.default.copyItem(at: lic, to: tmp)
    } catch {
      self.error = "Setup could not read this file: \(error.localizedDescription)."
      return
    }
    if let old = copy { try? FileManager.default.removeItem(at: old) }
    copy = tmp
    error = ""
    busy = true
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("panoptica-check-\(UUID().uuidString).ini")
    let helper = res.appendingPathComponent("helper.cjs").path, node = self.node, dir = self.dir
    let packages = res.appendingPathComponent("packages").path
    DispatchQueue.global(qos: .userInitiated).async {
      var r: [String: String]
      let p = Process()
      p.executableURL = node
      p.arguments = [helper, "check", "--licence", tmp.path, "--packages", packages, "--dir", dir, "--out", out.path]
      p.standardOutput = FileHandle.nullDevice
      p.standardError = FileHandle.nullDevice
      do {
        try p.run()
        p.waitUntilExit()
        r = Model.ini(out)
      } catch {
        r = ["ok": "0", "error": "Setup could not run its helper: \(error.localizedDescription)"]
      }
      try? FileManager.default.removeItem(at: out)
      DispatchQueue.main.async {
        self.busy = false
        if r["ok"] == "1" {
          self.info = r
          self.step = .review
        } else {
          self.error = r["error"] ?? "The licence file could not be read."
        }
      }
    }
  }

  /// setup.sh as an administrator, in the background; its steps arrive in a file this window reads.
  func install() {
    let prog = FileManager.default.temporaryDirectory.appendingPathComponent("panoptica-setup-\(UUID().uuidString).log")
    FileManager.default.createFile(atPath: prog.path, contents: nil)
    guard let lic = copy else { step = .licence; return }
    let args = [
      res.appendingPathComponent("setup.sh").path, "--licence", lic.path, "--lan", lan ? "1" : "0",
      "--progress", prog.path,
    ]
    let line = "nohup /bin/bash " + args.map(Model.q).joined(separator: " ") + " >/dev/null 2>&1 &"
    let script =
      "do shell script \""
      + line.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
      + "\" with prompt \"PANOPTICA Setup installs PANOPTICA as a service that starts with this Mac.\" with administrator privileges"
    var err: NSDictionary?
    NSAppleScript(source: script)?.executeAndReturnError(&err)
    if let e = err {
      // -128: the password dialog was cancelled
      if (e[NSAppleScript.errorNumber] as? Int) != -128 {
        error = "macOS did not run the installation: \(e[NSAppleScript.errorMessage] as? String ?? "unknown error")."
      }
      return
    }
    error = ""
    lines = []
    progress = prog
    busy = true
    step = .install
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.poll() }
  }

  private func poll() {
    guard let p = progress else { return }
    if let t = try? String(contentsOf: p, encoding: .utf8) {
      lines = t.components(separatedBy: .newlines).filter { !$0.isEmpty }
    }
    guard
      let code = try? String(contentsOf: p.appendingPathExtension("done"), encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    else { return }
    timer?.invalidate()
    timer = nil
    busy = false
    ok = code == "0"
    if !ok {
      let failed = lines.last { $0.hasPrefix("Failed: ") }.map { String($0.dropFirst(8)) }
      error = failed.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? "The installation stopped before the end."
    }
    step = .done
  }

  func open() { NSWorkspace.shared.open(URL(string: "http://localhost:3000")!) }
}

// MARK: - Views

struct Wizard: View {
  @EnvironmentObject var m: Model

  var body: some View {
    HStack(spacing: 0) {
      Sidebar().frame(width: 188)
      Divider()
      VStack(spacing: 0) {
        Group {
          switch m.step {
          case .intro: Intro()
          case .licence: LicencePage()
          case .review: Review()
          case .install: Installing()
          case .done: Summary()
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 32)
        .padding(.top, 30)
        Divider()
        Footer().padding(.horizontal, 20).padding(.vertical, 14)
      }
    }
  }
}

struct Sidebar: View {
  @EnvironmentObject var m: Model

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("PANOPTICA")
        .font(.system(size: 13, weight: .semibold))
        .tracking(2.4)
        .padding(.bottom, 2)
      Text("Setup").font(.system(size: 12)).foregroundColor(.secondary)
        .padding(.bottom, 28)
      ForEach(Step.allCases, id: \.self) { s in
        HStack(spacing: 10) {
          Group {
            if s.rawValue < m.step.rawValue {
              Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundColor(.accentColor)
            } else {
              Circle()
                .fill(s == m.step ? Color.accentColor : Color.secondary.opacity(0.3))
                .frame(width: 8, height: 8)
            }
          }
          .frame(width: 12)
          Text(s.title)
            .font(.system(size: 13, weight: s == m.step ? .semibold : .regular))
            .foregroundColor(s.rawValue > m.step.rawValue ? .secondary : .primary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(s == m.step ? .isSelected : [])
      }
      Spacer()
    }
    .padding(.horizontal, 22)
    .padding(.top, 30)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(SidebarMaterial())
  }
}

/// The translucent sidebar of macOS windows.
struct SidebarMaterial: NSViewRepresentable {
  func makeNSView(context: Context) -> NSVisualEffectView {
    let v = NSVisualEffectView()
    v.material = .sidebar
    v.blendingMode = .behindWindow
    v.state = .followsWindowActiveState
    return v
  }
  func updateNSView(_ v: NSVisualEffectView, context: Context) {}
}

struct Heading: View {
  let title: String
  let sub: String
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.system(size: 20, weight: .semibold))
      Text(sub).font(.system(size: 13)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
    }
    .padding(.bottom, 22)
  }
}

struct ErrorLine: View {
  let text: String
  var body: some View {
    if !text.isEmpty {
      Label(text, systemImage: "exclamationmark.triangle.fill")
        .font(.system(size: 12))
        .foregroundColor(.red)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 14)
    }
  }
}

struct Intro: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Heading(title: "Install PANOPTICA", sub: "The lab’s server, on this Mac")
      Text("PANOPTICA runs in the background and starts with this Mac. People open it in their browser, on this Mac or from the lab network.")
      Text("Have the lab’s licence file (licence.json) ready. The internet is not needed.")
      Text("macOS asks for an administrator’s password before anything is installed.").foregroundColor(.secondary)
    }
    .font(.system(size: 13))
    .fixedSize(horizontal: false, vertical: true)
  }
}

struct LicencePage: View {
  @EnvironmentObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Heading(title: "Licence file", sub: "The licence.json PANOPTICA gave the lab. It decides which modules are installed.")
      HStack(spacing: 12) {
        Button(m.licence == nil ? "Choose the licence file…" : "Choose another file…") { m.choose() }
        if let u = m.licence {
          Label(u.lastPathComponent, systemImage: "doc.text")
            .font(.system(size: 13))
            .lineLimit(1)
            .truncationMode(.middle)
            .help(u.path)
        }
      }
      Text("Lost it? Contact PANOPTICA for a copy.")
        .font(.system(size: 11)).foregroundColor(.secondary).padding(.top, 10)
      ErrorLine(text: m.error)
    }
    .disabled(m.busy)
  }
}

struct Review: View {
  @EnvironmentObject var m: Model
  private func row(_ k: String, _ v: String?) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text(k).foregroundColor(.secondary).frame(width: 130, alignment: .leading)
      Text(v ?? "—").textSelection(.enabled)
    }
    .font(.system(size: 13))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Heading(title: "What this licence covers", sub: "Check that this is the right lab.")
      VStack(alignment: .leading, spacing: 8) {
        row("Lab", m.info["lab"].map { l in (m.info["acronym"] ?? "").isEmpty ? l : "\(l) (\(m.info["acronym"]!))" })
        row("Modules", m.info["modules"])
        row("People", m.info["tier"])
        row("Version", m.info["version"].map { v in "\(v) (\(m.info["size"] ?? ""))" })
      }
      if m.info["upgrade"] == "1" {
        Label("PANOPTICA is already installed here: its data stays, and the database is backed up first.", systemImage: "info.circle")
          .font(.system(size: 12)).foregroundColor(.secondary).padding(.top, 14)
          .fixedSize(horizontal: false, vertical: true)
      }
      Divider().padding(.vertical, 18)
      Toggle(isOn: $m.lan) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Let other computers on the lab network open it").font(.system(size: 13))
          Text("Port 3000. Otherwise only this Mac can open PANOPTICA.").font(.system(size: 11)).foregroundColor(.secondary)
        }
      }
      .toggleStyle(.checkbox)
      ErrorLine(text: m.error)
    }
  }
}

struct Installing: View {
  @EnvironmentObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Heading(title: "Installing", sub: "Checking PANOPTICA, installing it and starting it. This takes a minute or two.")
      ProgressView().progressViewStyle(.linear).padding(.bottom, 16)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(m.lines.enumerated()), id: \.offset) { i, l in
              Text(l).font(.system(size: 11, design: .monospaced))
                .foregroundColor(i == m.lines.count - 1 ? .primary : .secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(i)
            }
          }
        }
        .onChange(of: m.lines.count) { n in withAnimation { proxy.scrollTo(n - 1, anchor: .bottom) } }
      }
    }
  }
}

struct Summary: View {
  @EnvironmentObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if m.ok {
        Heading(title: "PANOPTICA is installed", sub: "It is running, and starts again whenever this Mac starts.")
        Text("Open it to create the first admin and set up the lab.")
        VStack(alignment: .leading, spacing: 4) {
          Text("On this Mac: http://localhost:3000").textSelection(.enabled)
          if m.lan {
            Text("From the lab network: http://\(ProcessInfo.processInfo.hostName):3000").textSelection(.enabled)
          }
        }
        .foregroundColor(.secondary)
        Text("To uninstall it later, open “Uninstall PANOPTICA” in \(m.dir). The lab’s data stays.")
          .font(.system(size: 11)).foregroundColor(.secondary).padding(.top, 8)
      } else {
        Heading(title: "The installation stopped", sub: "Nothing of the lab’s data was changed.")
        Label(m.error, systemImage: "exclamationmark.triangle.fill").foregroundColor(.red)
        Text("The steps it took are in \(m.dir)/panoptica/updates/install.log.")
          .font(.system(size: 11)).foregroundColor(.secondary)
      }
    }
    .font(.system(size: 13))
    .fixedSize(horizontal: false, vertical: true)
  }
}

struct Footer: View {
  @EnvironmentObject var m: Model
  var body: some View {
    HStack(spacing: 10) {
      if m.busy { ProgressView().controlSize(.small) }
      Spacer()
      switch m.step {
      case .intro:
        Button("Continue") { m.step = .licence }.keyboardShortcut(.defaultAction)
      case .licence:
        Button("Back") { m.back() }.disabled(m.busy)
        Button("Continue") { m.check() }.keyboardShortcut(.defaultAction).disabled(m.busy || m.licence == nil)
      case .review:
        Button("Back") { m.back() }
        Button("Install") { m.install() }.keyboardShortcut(.defaultAction)
      case .install:
        Button("Continue") {}.disabled(true)
      case .done:
        if m.ok {
          Button("Quit") { NSApp.terminate(nil) }
          Button("Open PANOPTICA") {
            m.open()
            NSApp.terminate(nil)
          }
          .keyboardShortcut(.defaultAction)
        } else {
          Button("Quit") { NSApp.terminate(nil) }
          Button("Try again") {
            m.error = ""
            m.step = .review
          }
          .keyboardShortcut(.defaultAction)
        }
      }
    }
    .controlSize(.large)
  }
}
