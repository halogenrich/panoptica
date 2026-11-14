// PANOPTICA Setup for macOS (0.48): the wizard. It asks for the lab's product key, shows what the key covers (the helper asks
// PANOPTICA's activation service, with the Node this app carries), asks whether the lab network may open PANOPTICA, then runs
// setup.sh as an administrator (macOS asks for the password) and shows its steps until PANOPTICA is running.
// Built by tools/installer-build.mjs --mac on a Mac: swiftc for Apple silicon and Intel, joined with lipo.
import AppKit
import SwiftUI

@main
struct SetupApp: App {
  @NSApplicationDelegateAdaptor(Delegate.self) var delegate
  @StateObject private var model = Model()

  var body: some Scene {
    WindowGroup("PANOPTICA Setup") {
      Wizard().environmentObject(model).frame(width: 660, height: 450)
    }
    .commands { CommandGroup(replacing: .newItem) {} }
  }
}

final class Delegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.async {
      for w in NSApp.windows {
        w.styleMask.remove(.resizable)
        w.collectionBehavior.insert(.fullScreenNone)
        w.center()
      }
    }
  }
}

enum Step: Int, CaseIterable {
  case intro, key, review, install, done
  var title: String { ["Introduction", "Product key", "Review", "Installation", "Summary"][rawValue] }
}

final class Model: ObservableObject {
  @Published var step: Step = .intro
  @Published var key = ""
  @Published var service = ""
  @Published var lan = true
  @Published var busy = false
  @Published var error = ""
  @Published var info: [String: String] = [:]
  @Published var lines: [String] = []
  @Published var ok = false

  let dir = "/Library/PANOPTICA"
  private let res = Bundle.main.resourceURL!
  private var timer: Timer?
  private var progress: URL?

  init() {
    service = ((try? String(contentsOf: res.appendingPathComponent("service.txt"), encoding: .utf8)) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

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

  /// What the key covers and whether this Mac may use it; nothing is installed yet.
  func check() {
    let k = key.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let s = service.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(
      of: "/+$", with: "", options: .regularExpression)
    if k.isEmpty { error = "Type the product key."; return }
    if k.range(of: "^[A-Z0-9-]+$", options: .regularExpression) == nil {
      error = "A product key has only letters, digits and dashes."; return
    }
    if s.range(of: "^https?://[A-Za-z0-9.:/_-]+$", options: .regularExpression) == nil {
      error = "Type the activation service’s address (https://…)."; return
    }
    error = ""
    busy = true
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("panoptica-check-\(UUID().uuidString).ini")
    let helper = res.appendingPathComponent("helper.cjs").path, node = self.node, dir = self.dir
    DispatchQueue.global(qos: .userInitiated).async {
      var r: [String: String]
      let p = Process()
      p.executableURL = node
      p.arguments = [helper, "check", "--key", k, "--service", s, "--dir", dir, "--out", out.path]
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
          self.key = k
          self.service = s
          self.step = .review
        } else {
          self.error = r["error"] ?? "The key could not be checked: try again."
        }
      }
    }
  }

  /// setup.sh as an administrator, in the background; its steps arrive in a file this window reads.
  func install() {
    let prog = FileManager.default.temporaryDirectory.appendingPathComponent("panoptica-setup-\(UUID().uuidString).log")
    FileManager.default.createFile(atPath: prog.path, contents: nil)
    let args = [
      res.appendingPathComponent("setup.sh").path, "--key", key, "--service", service, "--lan", lan ? "1" : "0",
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
          case .key: KeyPage()
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
          ZStack {
            Circle()
              .fill(s.rawValue <= m.step.rawValue ? Color.accentColor : Color.secondary.opacity(0.25))
              .frame(width: 9, height: 9)
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
    .background(Color(nsColor: .underPageBackgroundColor).opacity(0.55))
  }
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
      Text("Have the lab’s product key ready. This Mac needs the internet during the installation; afterwards PANOPTICA runs without it.")
      Text("macOS asks for an administrator’s password before anything is installed.").foregroundColor(.secondary)
    }
    .font(.system(size: 13))
    .fixedSize(horizontal: false, vertical: true)
  }
}

struct KeyPage: View {
  @EnvironmentObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Heading(title: "Product key", sub: "The key PANOPTICA gave the lab. It decides which modules are installed.")
      Text("Product key").font(.system(size: 12, weight: .medium)).padding(.bottom, 6)
      TextField("", text: $m.key, prompt: Text("XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"))
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 14, design: .monospaced))
        .disableAutocorrection(true)
        .onSubmit { m.check() }
      Text("Activation service").font(.system(size: 12, weight: .medium)).padding(.top, 18).padding(.bottom, 6)
      TextField("", text: $m.service, prompt: Text("https://…"))
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 13))
        .disableAutocorrection(true)
        .onSubmit { m.check() }
      Text("Leave it as it is unless PANOPTICA gave you another address.")
        .font(.system(size: 11)).foregroundColor(.secondary).padding(.top, 6)
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
      Heading(title: "What this key covers", sub: "Check that this is the right lab.")
      VStack(alignment: .leading, spacing: 8) {
        row("Lab", m.info["lab"])
        row("Modules", m.info["modules"])
        row("Updates until", m.info["updates"])
        row("Computers", m.info["computers"])
        row("Version", m.info["version"].map { v in "\(v) (\(m.info["size"] ?? "") to download)" })
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
      Heading(title: "Installing", sub: "Downloading PANOPTICA and starting it. This takes a minute or two.")
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
        Text("Open it and type the product key once more to create the first admin and set up the lab.")
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
        Button("Continue") { m.step = .key }.keyboardShortcut(.defaultAction)
      case .key:
        Button("Back") { m.back() }.disabled(m.busy)
        Button("Continue") { m.check() }.keyboardShortcut(.defaultAction).disabled(m.busy)
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
