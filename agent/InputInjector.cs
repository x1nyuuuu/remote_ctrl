using System.Runtime.InteropServices;
using System.Text.Json;

namespace RemoteAgent;

public static class InputInjector
{
    public static void Handle(JsonElement payload)
    {
        if (!payload.TryGetProperty("kind", out var kindEl)) return;
        var kind = kindEl.GetString();
        switch (kind)
        {
            case "mouse-move":
                MoveNormalized(payload.GetProperty("x").GetDouble(), payload.GetProperty("y").GetDouble());
                break;
            case "mouse-down":
                MoveNormalized(payload.GetProperty("x").GetDouble(), payload.GetProperty("y").GetDouble());
                MouseButton(payload.GetProperty("button").GetInt32(), down: true);
                break;
            case "mouse-up":
                MoveNormalized(payload.GetProperty("x").GetDouble(), payload.GetProperty("y").GetDouble());
                MouseButton(payload.GetProperty("button").GetInt32(), down: false);
                break;
            case "wheel":
                var dy = payload.GetProperty("dy").GetDouble();
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (int)-dy, UIntPtr.Zero);
                break;
            case "key-down":
                Key(payload, down: true);
                break;
            case "key-up":
                Key(payload, down: false);
                break;
        }
    }

    private static void MoveNormalized(double x, double y)
    {
        var sx = Math.Clamp(x, 0, 1);
        var sy = Math.Clamp(y, 0, 1);
        var absX = (int)Math.Round(sx * 65535);
        var absY = (int)Math.Round(sy * 65535);
        mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, UIntPtr.Zero);
    }

    private static void MouseButton(int button, bool down)
    {
        uint flag = button switch
        {
            0 => down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
            1 => down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
            2 => down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
            _ => down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
        };
        mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    private static void Key(JsonElement payload, bool down)
    {
        var code = payload.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
        var vk = MapKey(code, payload.TryGetProperty("key", out var k) ? k.GetString() ?? "" : "");
        if (vk == 0) return;
        keybd_event((byte)vk, 0, down ? 0u : KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static byte MapKey(string code, string key)
    {
        return code switch
        {
            "Enter" => 0x0D,
            "Escape" => 0x1B,
            "Backspace" => 0x08,
            "Tab" => 0x09,
            "Space" => 0x20,
            "ArrowLeft" => 0x25,
            "ArrowUp" => 0x26,
            "ArrowRight" => 0x27,
            "ArrowDown" => 0x28,
            "Delete" => 0x2E,
            "Home" => 0x24,
            "End" => 0x23,
            "PageUp" => 0x21,
            "PageDown" => 0x22,
            "ControlLeft" or "ControlRight" => 0x11,
            "ShiftLeft" or "ShiftRight" => 0x10,
            "AltLeft" or "AltRight" => 0x12,
            "MetaLeft" or "MetaRight" => 0x5B,
            _ when code.StartsWith("Key") && code.Length == 4 => (byte)char.ToUpperInvariant(code[3]),
            _ when code.StartsWith("Digit") && code.Length == 6 => (byte)code[5],
            _ when key.Length == 1 => (byte)char.ToUpperInvariant(key[0]),
            _ => 0,
        };
    }

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
