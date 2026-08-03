using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace RemoteAgent;

public sealed class ScreenCapturer : IDisposable
{
    private readonly object _gate = new();
    private Bitmap? _bitmap;
    private Graphics? _graphics;
    private int _width;
    private int _height;

    public int Width => _width;
    public int Height => _height;

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    public void EnsureSize(int width, int height)
    {
        lock (_gate)
        {
            if (_bitmap != null && _width == width && _height == height) return;
            DisposeBitmap();
            _width = width;
            _height = height;
            _bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            _graphics = Graphics.FromImage(_bitmap);
        }
    }

    public byte[] CaptureBgr24(out int width, out int height)
    {
        var sw = GetSystemMetrics(SM_CXSCREEN);
        var sh = GetSystemMetrics(SM_CYSCREEN);
        var bounds = new Rectangle(0, 0, sw, sh);
        var scale = Math.Min(1.0, 1920.0 / Math.Max(bounds.Width, bounds.Height));
        width = Math.Max(2, (int)(bounds.Width * scale) & ~1);
        height = Math.Max(2, (int)(bounds.Height * scale) & ~1);

        EnsureSize(bounds.Width, bounds.Height);
        Bitmap frame;
        lock (_gate)
        {
            _graphics!.CopyFromScreen(0, 0, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
            if (width == bounds.Width && height == bounds.Height)
            {
                frame = (Bitmap)_bitmap!.Clone();
            }
            else
            {
                frame = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                using var g = Graphics.FromImage(frame);
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Low;
                g.DrawImage(_bitmap!, 0, 0, width, height);
            }
        }

        using (frame)
        {
            return BitmapToBgr24(frame, width, height);
        }
    }

    private static byte[] BitmapToBgr24(Bitmap bmp, int width, int height)
    {
        var rect = new Rectangle(0, 0, width, height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var srcStride = data.Stride;
            var row = width * 3;
            var buf = new byte[row * height];
            unsafe
            {
                var src = (byte*)data.Scan0;
                for (var y = 0; y < height; y++)
                {
                    var s = src + y * srcStride;
                    var d = y * row;
                    for (var x = 0; x < width; x++)
                    {
                        // BGRA -> BGR
                        buf[d++] = s[0];
                        buf[d++] = s[1];
                        buf[d++] = s[2];
                        s += 4;
                    }
                }
            }
            return buf;
        }
        finally
        {
            bmp.UnlockBits(data);
        }
    }

    private void DisposeBitmap()
    {
        _graphics?.Dispose();
        _bitmap?.Dispose();
        _graphics = null;
        _bitmap = null;
    }

    public void Dispose() => DisposeBitmap();
}
