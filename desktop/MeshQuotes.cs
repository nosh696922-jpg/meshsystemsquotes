// Mesh Quotes for Windows: the Mesh Quotes website in a window of its own.
//
// It uses Microsoft Edge WebView2, which is part of Windows 10 and 11, so the
// program stays small and always shows the live site: there is nothing to
// update when the website changes. Build it with build.ps1 in this folder.
//
// Written for the C# compiler that comes with Windows (.NET Framework 4.x),
// which only understands C# 5, so there's no newer syntax here.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Mesh Quotes")]
[assembly: AssemblyDescription("Mesh Quotes")]
[assembly: AssemblyProduct("Mesh Quotes")]
[assembly: AssemblyCompany("Mesh Smart Home Technology")]
[assembly: AssemblyCopyright("Mesh Smart Home Technology")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace MeshQuotes
{
    static class Program
    {
        const string LiveSite = "https://meshsystemsquotes.vercel.app/";

        // The WebView2 parts packed inside this .exe by build.ps1.
        static readonly string[] Parts = { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" };

        public static readonly Color Navy = Color.FromArgb(13, 20, 32);
        public static Uri StartUrl;
        public static string DataDir; // %LOCALAPPDATA%\Mesh Quotes
        public static bool DevTools;
        public static Icon AppIcon;
        static string partsDir;

        [STAThread]
        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += LoadPart;

            // --url=http://localhost:3000 opens another copy of the app (for testing).
            string url = LiveSite;
            foreach (string arg in args)
            {
                if (arg.StartsWith("--url=", StringComparison.OrdinalIgnoreCase)) url = arg.Substring(6);
                else if (arg.Equals("--devtools", StringComparison.OrdinalIgnoreCase)) DevTools = true;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || (parsed.Scheme != "https" && parsed.Scheme != "http"))
            {
                MessageBox.Show("That address doesn't look right: " + url, "Mesh Quotes", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            StartUrl = parsed;
            DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mesh Quotes");
            Directory.CreateDirectory(DataDir);
            using (Stream s = typeof(Program).Assembly.GetManifestResourceStream("mesh.ico")) AppIcon = new Icon(s);

            // Navy behind the page while it loads, instead of a white flash.
            Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF0D1420");
            Run();
        }

        // Kept apart from Main so the WebView2 parts are only looked for after
        // LoadPart is listening.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Run()
        {
            if (!Browser.Ready()) return;
            Application.Run(new Windows());
        }

        public static bool IsOurs(Uri uri)
        {
            return uri.Scheme == StartUrl.Scheme && uri.Host == StartUrl.Host && uri.Port == StartUrl.Port;
        }

        // Opens other websites, email and phone links outside the app.
        public static void OpenOutside(string url)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return;
            if (uri.Scheme != "https" && uri.Scheme != "http" && uri.Scheme != "mailto" && uri.Scheme != "tel") return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception) { }
        }

        // The folder the packed WebView2 parts are copied to. Each build gets its
        // own folder, so a newer .exe never has to replace files in use.
        public static string PartsDir()
        {
            if (partsDir != null) return partsDir;
            Assembly me = typeof(Program).Assembly;
            long size = 0;
            foreach (string name in Parts)
                using (Stream s = me.GetManifestResourceStream(name)) size += s.Length;
            string root = Path.Combine(DataDir, "bin");
            string dir = Path.Combine(root, "wv2-" + size);
            Directory.CreateDirectory(dir);
            foreach (string name in Parts)
            {
                string file = Path.Combine(dir, name);
                using (Stream s = me.GetManifestResourceStream(name))
                {
                    if (File.Exists(file) && new FileInfo(file).Length == s.Length) continue;
                    using (FileStream f = File.Create(file)) s.CopyTo(f);
                }
            }
            // Tidy away parts left by older builds (skipped if they're still in use).
            foreach (string old in Directory.GetDirectories(root))
            {
                if (string.Equals(old, dir, StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(old, true); } catch (Exception) { }
            }
            partsDir = dir;
            return dir;
        }

        static Assembly LoadPart(object sender, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name + ".dll";
            if (name == "WebView2Loader.dll" || Array.IndexOf(Parts, name) < 0) return null;
            return Assembly.LoadFrom(Path.Combine(PartsDir(), name));
        }

        public static void ShowAbout(IWin32Window owner)
        {
            string version = typeof(Program).Assembly.GetName().Version.ToString(3);
            MessageBox.Show(owner,
                "Mesh Quotes for Windows " + version + "\n" +
                "Opens " + StartUrl.Host + " in its own window.\n\n" +
                "Uses Microsoft Edge WebView2.\nCopyright (C) Microsoft Corporation. All rights reserved. " +
                "Used under its licence, which comes with this program's source in THIRD-PARTY-NOTICES.txt.",
                "About Mesh Quotes", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    static class Browser
    {
        static Task<CoreWebView2Environment> shared;

        // WebView2 comes with Windows 10 and 11, but can be missing on older or
        // locked-down PCs.
        public static bool Ready()
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(Program.PartsDir());
            try
            {
                if (!string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString(null))) return true;
            }
            catch (WebView2RuntimeNotFoundException) { }
            DialogResult answer = MessageBox.Show(
                "Mesh Quotes needs Microsoft Edge WebView2, which is normally part of Windows but is missing on this PC.\n\n" +
                "Click OK to download it from Microsoft (it's free), then open Mesh Quotes again.",
                "Mesh Quotes", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (answer == DialogResult.OK) Program.OpenOutside("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            return false;
        }

        // One browser profile for every window, so they all share the sign-in.
        public static Task<CoreWebView2Environment> Shared()
        {
            if (shared == null) shared = CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "WebView2"), null);
            return shared;
        }
    }

    // Keeps the program running while any of its windows is open.
    class Windows : ApplicationContext
    {
        static Windows current;
        static int open;

        public Windows()
        {
            current = this;
            Open(new AppWindow(Program.StartUrl, true));
        }

        public static void Open(AppWindow window)
        {
            open++;
            window.FormClosed += delegate { if (--open == 0) current.ExitThread(); };
            window.Show();
        }
    }

    class AppWindow : Form
    {
        const int WM_SYSCOMMAND = 0x112, MF_SEPARATOR = 0x800, ABOUT_ID = 0x1F0;
        [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu, int flags, int id, string text);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        readonly WebView2 view = new WebView2();
        readonly bool main;
        Uri lastWanted;

        // url is null for a pop-up window, which the page fills in itself.
        public AppWindow(Uri url, bool main)
        {
            this.main = main;
            Text = "Mesh Quotes";
            Icon = Program.AppIcon;
            BackColor = Program.Navy;
            AutoScaleMode = AutoScaleMode.None;
            StartPosition = FormStartPosition.Manual;
            Place();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Program.Navy;
            Controls.Add(view);
            if (url != null)
            {
                Shown += async (s, e) =>
                {
                    if (await Start()) view.CoreWebView2.Navigate(url.AbsoluteUri);
                };
            }
        }

        public async Task<bool> Start()
        {
            try
            {
                await view.EnsureCoreWebView2Async(await Browser.Shared());
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Mesh Quotes couldn't open its window.\n\n" + ex.Message, "Mesh Quotes", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return false;
            }
            CoreWebView2 web = view.CoreWebView2;
            // Lets the website know it's inside this program.
            web.Settings.UserAgent = web.Settings.UserAgent + " MeshQuotesApp/1.0";
            web.Settings.AreDevToolsEnabled = Program.DevTools;
            web.Settings.IsStatusBarEnabled = false;
            web.DocumentTitleChanged += delegate { Text = TitleFor(web); };
            web.NavigationStarting += OnNavigationStarting;
            web.NavigationCompleted += OnNavigationCompleted;
            web.NewWindowRequested += OnNewWindowRequested;
            web.WindowCloseRequested += delegate { Close(); };
            web.ProcessFailed += (s, e) =>
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) web.Reload();
            };
            return true;
        }

        static string TitleFor(CoreWebView2 web)
        {
            string title = web.DocumentTitle;
            if (string.IsNullOrEmpty(title) || title.StartsWith("about:") || title.StartsWith("data:") || title.StartsWith("http")) return "Mesh Quotes";
            return title;
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            Uri uri;
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) return;
            if (Program.IsOurs(uri))
            {
                lastWanted = uri;
                return;
            }
            if (uri.Scheme == "about" || uri.Scheme == "data" || uri.Scheme == "blob") return;
            // Other websites (store pages, email links…) open outside the app.
            e.Cancel = true;
            Program.OpenOutside(e.Uri);
        }

        async void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            Uri uri;
            bool blank = !Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || uri.Scheme == "about";
            if (!blank && !Program.IsOurs(uri))
            {
                e.Handled = true;
                Program.OpenOutside(e.Uri);
                return;
            }
            // Our own pages (proposal previews, PDFs) open in another Mesh Quotes
            // window that the page can still control, as it would in a browser.
            CoreWebView2Deferral wait = e.GetDeferral();
            try
            {
                AppWindow popup = new AppWindow(null, false);
                Windows.Open(popup);
                if (await popup.Start()) e.NewWindow = popup.view.CoreWebView2;
                e.Handled = true;
            }
            finally
            {
                wait.Complete();
            }
        }

        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess || lastWanted == null) return;
            switch (e.WebErrorStatus)
            {
                case CoreWebView2WebErrorStatus.CannotConnect:
                case CoreWebView2WebErrorStatus.HostNameNotResolved:
                case CoreWebView2WebErrorStatus.ServerUnreachable:
                case CoreWebView2WebErrorStatus.Timeout:
                case CoreWebView2WebErrorStatus.ConnectionAborted:
                case CoreWebView2WebErrorStatus.ConnectionReset:
                case CoreWebView2WebErrorStatus.Disconnected:
                    view.CoreWebView2.NavigateToString(OfflinePage(lastWanted));
                    break;
            }
        }

        static string OfflinePage(Uri retry)
        {
            string href = System.Net.WebUtility.HtmlEncode(retry.AbsoluteUri);
            return "<!doctype html><html><head><meta charset='utf-8'><title>Mesh Quotes</title><style>" +
                "html,body{height:100%;margin:0;background:#0d1420;color:#fff;font:15px/1.5 'Segoe UI',system-ui,sans-serif}" +
                "body{display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}" +
                "h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#9aa6b8;margin:0 0 22px}" +
                "a{display:inline-block;background:#2f6fb5;color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-weight:600}" +
                "</style></head><body><div><h1>Can't reach Mesh Quotes</h1>" +
                "<p>Check this computer is connected to the internet, then try again.</p>" +
                "<a href=\"" + href + "\">Try again</a></div>" +
                "<script>addEventListener('online',function(){location.href=document.querySelector('a').href});</script>" +
                "</body></html>";
        }

        // ---- Window size and place ------------------------------------------

        static string StateFile { get { return Path.Combine(Program.DataDir, "window.txt"); } }

        void Place()
        {
            Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
            float scale = DeviceDpi / 96f;
            int w = Math.Min((int)(1280 * scale), area.Width * 9 / 10);
            int h = Math.Min((int)(860 * scale), area.Height * 9 / 10);
            Rectangle r = new Rectangle(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);
            if (!main) r.Offset((int)(36 * scale), (int)(36 * scale));
            bool maximised = false;
            if (main)
            {
                // Open where it was last closed, if that's still on a screen.
                try
                {
                    string[] p = File.ReadAllText(StateFile).Split(',');
                    Rectangle saved = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                    foreach (Screen screen in Screen.AllScreens)
                    {
                        Rectangle overlap = Rectangle.Intersect(screen.WorkingArea, saved);
                        if (overlap.Width > 120 && overlap.Height > 80)
                        {
                            r = saved;
                            maximised = p[4] == "1";
                            break;
                        }
                    }
                }
                catch (Exception) { }
            }
            MinimumSize = new Size((int)(380 * scale), (int)(480 * scale));
            Bounds = r;
            if (maximised) WindowState = FormWindowState.Maximized;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            if (!main || e.Cancel) return;
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            try
            {
                File.WriteAllText(StateFile, string.Format("{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? 1 : 0));
            }
            catch (Exception) { }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // A dark title bar to match the app's navy header: navy on Windows 11,
            // the standard dark one on Windows 10 (which ignores the colours).
            int on = 1, navy = 0x0020140D /* 0x00BBGGRR */, white = 0x00FFFFFF;
            DwmSetWindowAttribute(Handle, 20, ref on, 4);    // dark mode
            DwmSetWindowAttribute(Handle, 35, ref navy, 4);  // caption colour
            DwmSetWindowAttribute(Handle, 36, ref white, 4); // caption text colour

            // "About Mesh Quotes" in the menu from the icon at the top left.
            IntPtr menu = GetSystemMenu(Handle, false);
            AppendMenu(menu, MF_SEPARATOR, 0, null);
            AppendMenu(menu, 0, ABOUT_ID, "About Mesh Quotes");
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_SYSCOMMAND && ((int)m.WParam & 0xFFF0) == ABOUT_ID)
            {
                Program.ShowAbout(this);
                return;
            }
            base.WndProc(ref m);
        }
    }
}
