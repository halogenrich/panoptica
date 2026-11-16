// PANOPTICA's tray icon (0.51) on the computer that runs PANOPTICA, Windows. Started when someone signs in there (the
// installer adds it to Windows' Run list). PANOPTICA itself runs as a task with no window; this shows that it runs and offers:
// Open PANOPTICA, Copy the lab's address, Check for updates, Make a backup, Restart PANOPTICA (asks for an administrator).
//
// It reads server.json and token in its own folder, both written by PANOPTICA when it starts: the port, HTTPS, the version
// and the addresses; the token lets it ask PANOPTICA for a backup or an update check without anyone signing in (only from this
// computer). C# 5 on purpose: Windows' own .NET Framework compiler builds it (tools/installer-build.mjs), nothing to install.
//
//   PANOPTICA-tray.exe            the icon
//   PANOPTICA-tray.exe --status   prints the state ("running 0.51.0 http://localhost") and exits: 0 running, 1 not (tests)
//   PANOPTICA-tray.exe --backup   makes a backup as the menu does, prints its name (tests)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("PANOPTICA tray icon")]
[assembly: AssemblyProduct("PANOPTICA")]
[assembly: AssemblyCompany("PANOPTICA")]
[assembly: AssemblyDescription("PANOPTICA tray icon")]

namespace Panoptica
{
    enum State { Running, Starting, Stopped }

    /** What server.json says, and whether PANOPTICA answers. */
    class Server
    {
        public static readonly string Dir = Path.GetDirectoryName(Application.ExecutablePath);
        public int Port = 80;
        public bool Https;
        public string Version = "";
        public string Local = "";
        public string Url = "";

        static string Field(string json, string name)
        {
            Match m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|[^,}\\s]+)");
            if (!m.Success) return "";
            return m.Groups[2].Success && m.Groups[1].Value.StartsWith("\"") ? Regex.Unescape(m.Groups[2].Value) : m.Groups[1].Value;
        }

        public static Server Read()
        {
            Server s = new Server();
            try
            {
                string j = File.ReadAllText(Path.Combine(Dir, "server.json"));
                int p;
                if (int.TryParse(Field(j, "port"), out p)) s.Port = p;
                s.Https = Field(j, "https") == "true";
                s.Version = Field(j, "version");
                s.Local = Field(j, "local");
                s.Url = Field(j, "url");
            }
            catch (Exception) { /* PANOPTICA has not started yet */ }
            if (s.Local == "") s.Local = (s.Https ? "https" : "http") + "://localhost" + (s.Port == (s.Https ? 443 : 80) ? "" : ":" + s.Port);
            return s;
        }

        /** PANOPTICA on this computer: 127.0.0.1, whatever name its certificate is for. */
        public string Api(string path)
        {
            return (Https ? "https" : "http") + "://127.0.0.1:" + Port + path;
        }

        public string Call(string method, string path, int timeoutMs)
        {
            HttpWebRequest q = (HttpWebRequest)WebRequest.Create(Api(path));
            q.Method = method;
            q.Timeout = timeoutMs;
            q.ReadWriteTimeout = timeoutMs;
            q.UserAgent = "panoptica-tray";
            if (method == "POST")
            {
                string token = "";
                try { token = File.ReadAllText(Path.Combine(Dir, "token")).Trim(); } catch (Exception) { }
                q.Headers.Add("x-tray-token", token);
                q.ContentType = "application/json";
                byte[] b = Encoding.UTF8.GetBytes("{}");
                q.ContentLength = b.Length;
                using (Stream w = q.GetRequestStream()) w.Write(b, 0, b.Length);
            }
            try
            {
                using (WebResponse r = q.GetResponse())
                using (StreamReader rd = new StreamReader(r.GetResponseStream(), Encoding.UTF8))
                    return rd.ReadToEnd();
            }
            catch (WebException e)
            {
                HttpWebResponse r = e.Response as HttpWebResponse;
                if (r == null) throw;
                string body;
                using (StreamReader rd = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) body = rd.ReadToEnd();
                string err = Field(body, "error");
                throw new Exception(err != "" ? err : "PANOPTICA answered " + (int)r.StatusCode);
            }
        }

        public static string Get(string json, string name) { return Field(json, name); }

        public State Check()
        {
            try
            {
                string v = Field(Call("GET", "/api/version", 3000), "version");
                if (v != "") { Version = v; return State.Running; }
            }
            catch (Exception) { }
            // not answering: starting while its runtime is there, else stopped
            return Process.GetProcessesByName("PANOPTICA").Length > 0 ? State.Starting : State.Stopped;
        }
    }

    class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Icon on, off;
        readonly ToolStripMenuItem status = new ToolStripMenuItem("PANOPTICA");
        readonly ToolStripMenuItem copy = new ToolStripMenuItem("Copy the lab's address");
        readonly ToolStripMenuItem update = new ToolStripMenuItem("Check for updates");
        readonly ToolStripMenuItem backup = new ToolStripMenuItem("Make a backup");
        readonly Control ui = new Control();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        Server server = Server.Read();
        State state = State.Starting;
        int busy;

        static Icon Embedded(string name)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) return new Icon(s, SystemInformation.SmallIconSize);
        }

        public TrayApp()
        {
            ui.CreateControl();
            on = Embedded("panoptica.ico");
            off = Embedded("panoptica-stopped.ico");
            ContextMenuStrip m = new ContextMenuStrip();
            status.Enabled = false;
            m.Items.Add(status);
            m.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem open = new ToolStripMenuItem("Open PANOPTICA", null, delegate { Open(""); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            m.Items.Add(open);
            copy.Click += delegate { CopyAddress(); };
            m.Items.Add(copy);
            m.Items.Add(new ToolStripSeparator());
            update.Click += delegate { CheckUpdates(); };
            m.Items.Add(update);
            backup.Click += delegate { MakeBackup(); };
            m.Items.Add(backup);
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem("Restart PANOPTICA…", null, delegate { Restart(); }));
            m.Opening += delegate { Refresh(); };
            icon.ContextMenuStrip = m;
            icon.DoubleClick += delegate { Open(""); };
            icon.Icon = off;
            icon.Text = "PANOPTICA";
            icon.Visible = true;
            timer.Interval = 5000;
            timer.Tick += delegate { Refresh(); };
            timer.Start();
            Refresh();
        }

        /** Asks PANOPTICA in the background and shows the answer. */
        void Refresh()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Server s = Server.Read();
                State st = s.Check();
                ui.BeginInvoke((MethodInvoker)delegate { Show(s, st); busy = 0; });
            });
        }

        void Show(Server s, State st)
        {
            server = s;
            state = st;
            string v = s.Version != "" ? " " + s.Version : "";
            string text = st == State.Running ? "PANOPTICA" + v + " is running" : st == State.Starting ? "PANOPTICA is starting…" : "PANOPTICA is stopped";
            status.Text = text;
            icon.Text = text.Length > 63 ? text.Substring(0, 63) : text;
            icon.Icon = st == State.Running ? on : off;
            update.Enabled = backup.Enabled = st == State.Running;
        }

        void Open(string hash)
        {
            try { Process.Start(server.Local + "/" + hash); }
            catch (Exception e) { Say("PANOPTICA could not be opened: " + e.Message, MessageBoxIcon.Error); }
        }

        /** The lab's address (Admin settings › Network), else this computer's name with the port. */
        void CopyAddress()
        {
            string a = server.Url;
            if (a == "")
                a = (server.Https ? "https" : "http") + "://" + Environment.MachineName.ToLowerInvariant() + (server.Port == (server.Https ? 443 : 80) ? "" : ":" + server.Port);
            try { Clipboard.SetText(a); } catch (Exception) { }
            icon.ShowBalloonTip(3000, "Copied", a, ToolTipIcon.None);
        }

        void Work(string what, Func<string> job, Action<string> done)
        {
            update.Enabled = backup.Enabled = false;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string r = null, err = null;
                try { r = job(); } catch (Exception e) { err = e.Message; }
                ui.BeginInvoke((MethodInvoker)delegate
                {
                    update.Enabled = backup.Enabled = state == State.Running;
                    if (err != null) Say(what + " failed: " + err.TrimEnd('.') + ".", MessageBoxIcon.Error);
                    else done(r);
                });
            });
        }

        /** Asks GitHub through PANOPTICA; a newer version opens Admin settings › Updates, where an admin installs it. */
        void CheckUpdates()
        {
            Work("Checking for updates", delegate { return server.Call("POST", "/api/tray/updates", 60000); }, delegate(string r)
            {
                string err = Server.Get(r, "error");
                if (Server.Get(r, "available") == "true") Open("#/updates");
                else if (err != "") Say("Could not check for updates: " + err.TrimEnd('.') + ".", MessageBoxIcon.Warning);
                else Say("PANOPTICA " + Server.Get(r, "current") + " is the newest version.", MessageBoxIcon.Information);
            });
        }

        void MakeBackup()
        {
            Work("The backup", delegate { return server.Call("POST", "/api/tray/backup", 300000); }, delegate(string r)
            {
                Say("Backup made and checked: " + Server.Get(r, "name") + ".", MessageBoxIcon.Information);
            });
        }

        /** Stops PANOPTICA's task and its runtime, then starts the task: as an administrator, so Windows asks first. */
        void Restart()
        {
            string node = Path.Combine(Path.GetDirectoryName(Server.Dir), "node", "PANOPTICA.exe").Replace("'", "''");
            string ps = "Stop-ScheduledTask -TaskName PANOPTICA -ErrorAction SilentlyContinue; " +
                "Get-Process -Name PANOPTICA -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '" + node + "' } | Stop-Process -Force; " +
                "Start-Sleep -Seconds 1; Start-ScheduledTask -TaskName PANOPTICA";
            ProcessStartInfo p = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"" + ps + "\"");
            p.Verb = "runas";
            p.UseShellExecute = true;
            p.WindowStyle = ProcessWindowStyle.Hidden;
            try
            {
                Process.Start(p);
                Show(server, State.Starting);
            }
            catch (System.ComponentModel.Win32Exception) { /* the administrator's prompt was declined */ }
        }

        static void Say(string text, MessageBoxIcon kind)
        {
            MessageBox.Show(text, "PANOPTICA", MessageBoxButtons.OK, kind);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { icon.Visible = false; icon.Dispose(); timer.Dispose(); }
            base.Dispose(disposing);
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; // TLS 1.2 and 1.3
            // PANOPTICA on this computer is asked at 127.0.0.1, and its certificate is for the lab's name: accepted for that alone
            ServicePointManager.ServerCertificateValidationCallback = delegate(object o, System.Security.Cryptography.X509Certificates.X509Certificate c, System.Security.Cryptography.X509Certificates.X509Chain ch, System.Net.Security.SslPolicyErrors e)
            {
                HttpWebRequest q = o as HttpWebRequest;
                return e == System.Net.Security.SslPolicyErrors.None || (q != null && q.RequestUri.Host == "127.0.0.1");
            };
            if (args.Length > 0 && args[0] == "--status")
            {
                Server s = Server.Read();
                State st = s.Check();
                Console.WriteLine(st.ToString().ToLowerInvariant() + " " + s.Version + " " + s.Local);
                return st == State.Running ? 0 : 1;
            }
            if (args.Length > 0 && args[0] == "--backup")
            {
                try
                {
                    Console.WriteLine(Server.Get(Server.Read().Call("POST", "/api/tray/backup", 300000), "name"));
                    return 0;
                }
                catch (Exception e)
                {
                    Console.WriteLine("failed: " + e.Message);
                    return 1;
                }
            }
            bool first;
            using (Mutex one = new Mutex(true, "Local\\PANOPTICA-tray", out first))
            {
                if (!first) return 0; // already in this person's tray
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApp());
            }
            return 0;
        }
    }
}
