using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;

namespace RemoteAgent;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static async Task<int> Main(string[] args)
    {
        var relay = GetArg(args, "--relay") ?? Environment.GetEnvironmentVariable("RELAY_URL") ?? "ws://127.0.0.1:8080/ws";
        var token = GetArg(args, "--token") ?? Environment.GetEnvironmentVariable("AUTH_TOKEN") ?? "dev-token-change-me";
        var room = GetArg(args, "--room") ?? Environment.GetEnvironmentVariable("ROOM") ?? "default";
        var fps = int.TryParse(GetArg(args, "--fps") ?? "12", out var f) ? f : 12;

        Console.WriteLine($"Agent → {relay} room={room}");
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        while (!cts.IsCancellationRequested)
        {
            try
            {
                await RunSessionAsync(relay, token, room, fps, cts.Token);
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"session error: {ex.Message}");
                await Task.Delay(2000, cts.Token);
            }
        }

        return 0;
    }

    private static async Task RunSessionAsync(string relay, string token, string room, int fps, CancellationToken ct)
    {
        using var ws = new ClientWebSocket();
        await ws.ConnectAsync(new Uri(relay), ct);

        await SendAsync(ws, new
        {
            v = 1,
            type = "join",
            role = "agent",
            room,
            token,
        }, ct);

        RTCPeerConnection? pc = null;
        VpxVideoEncoder? encoder = null;
        ScreenCapturer? capturer = null;
        CancellationTokenSource? captureCts = null;
        var iceServers = new List<RTCIceServer>
        {
            new() { urls = "stun:stun.l.google.com:19302" },
        };

        async Task TearDownPc()
        {
            captureCts?.Cancel();
            captureCts?.Dispose();
            captureCts = null;
            capturer?.Dispose();
            capturer = null;
            encoder?.Dispose();
            encoder = null;
            if (pc != null)
            {
                pc.Close("reset");
                pc.Dispose();
                pc = null;
            }
        }

        async Task EnsureOfferAsync()
        {
            if (pc != null) return;
            encoder = new VpxVideoEncoder();
            capturer = new ScreenCapturer();
            pc = CreatePeerConnection(iceServers, async candidateJson =>
            {
                await SendAsync(ws, new
                {
                    v = 1,
                    type = "signal",
                    payload = new { kind = "candidate", candidate = candidateJson },
                }, ct);
            });

            var videoTrack = new MediaStreamTrack(SDPMediaFormatsEnum.VP8, MediaStreamStatusEnum.SendOnly);
            pc.addTrack(videoTrack);

            var offer = pc.createOffer();
            var localResult = pc.setLocalDescription(offer);
            Console.WriteLine($"set local offer: {localResult}");
            await SendAsync(ws, new
            {
                v = 1,
                type = "signal",
                payload = new
                {
                    kind = "offer",
                    sdp = new { type = "offer", sdp = offer.sdp },
                },
            }, ct);

            captureCts = new CancellationTokenSource();
            _ = CaptureLoopAsync(pc, encoder, capturer, fps, captureCts.Token);
            Console.WriteLine("offer sent, capture started");
        }

        var buf = new byte[1 << 20];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var msg = await ReceiveAsync(ws, buf, ct);
            if (msg is null) break;

            using var doc = JsonDocument.Parse(msg);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
            switch (type)
            {
                case "joined":
                    ApplyIce(root, iceServers);
                    Console.WriteLine("joined as agent");
                    if (root.TryGetProperty("peers", out var peers) &&
                        peers.EnumerateArray().Any(p => p.GetString() == "client"))
                    {
                        await EnsureOfferAsync();
                    }
                    break;
                case "peer-joined":
                    if (root.TryGetProperty("role", out var role) && role.GetString() == "client")
                    {
                        await TearDownPc();
                        await EnsureOfferAsync();
                    }
                    break;
                case "peer-left":
                    Console.WriteLine("client left");
                    await TearDownPc();
                    break;
                case "signal":
                    HandleSignal(pc, root.GetProperty("payload"));
                    break;
                case "input":
                    if (root.TryGetProperty("payload", out var payload))
                    {
                        InputInjector.Handle(payload);
                    }
                    break;
                case "error":
                    Console.WriteLine("relay error: " + root.GetProperty("message").GetString());
                    break;
                case "ice-servers":
                    ApplyIce(root, iceServers);
                    break;
            }
        }

        await TearDownPc();
    }

    private static void ApplyIce(JsonElement root, List<RTCIceServer> iceServers)
    {
        if (!root.TryGetProperty("iceServers", out var arr)) return;
        iceServers.Clear();
        foreach (var s in arr.EnumerateArray())
        {
            var urlsEl = s.GetProperty("urls");
            string[] urls = urlsEl.ValueKind == JsonValueKind.Array
                ? urlsEl.EnumerateArray().Select(u => u.GetString()!).Where(u => u != null).ToArray()!
                : new[] { urlsEl.GetString()! };

            var server = new RTCIceServer { urls = string.Join(",", urls) };
            if (s.TryGetProperty("username", out var u)) server.username = u.GetString();
            if (s.TryGetProperty("credential", out var c)) server.credential = c.GetString();
            iceServers.Add(server);
        }
    }

    private static RTCPeerConnection CreatePeerConnection(List<RTCIceServer> iceServers, Func<object, Task> onLocalCandidate)
    {
        var config = new RTCConfiguration
        {
            iceServers = iceServers,
        };
        var pc = new RTCPeerConnection(config);
        pc.onicecandidate += async (candidate) =>
        {
            if (candidate == null) return;
            var dto = new
            {
                candidate = candidate.candidate,
                sdpMid = candidate.sdpMid,
                sdpMLineIndex = candidate.sdpMLineIndex,
            };
            await onLocalCandidate(dto);
        };
        pc.onconnectionstatechange += state =>
        {
            Console.WriteLine($"webrtc state: {state}");
        };
        return pc;
    }

    private static void HandleSignal(RTCPeerConnection? pc, JsonElement payload)
    {
        if (pc == null) return;
        var kind = payload.GetProperty("kind").GetString();

        if (kind == "answer")
        {
            var sdp = payload.GetProperty("sdp");
            var answer = new RTCSessionDescriptionInit
            {
                type = RTCSdpType.answer,
                sdp = sdp.GetProperty("sdp").GetString(),
            };
            var result = pc.setRemoteDescription(answer);
            Console.WriteLine($"set remote answer: {result}");
        }
        else if (kind == "candidate")
        {
            var c = payload.GetProperty("candidate");
            var ice = new RTCIceCandidateInit
            {
                candidate = c.GetProperty("candidate").GetString(),
                sdpMid = c.TryGetProperty("sdpMid", out var mid) ? mid.GetString() : null,
                sdpMLineIndex = c.TryGetProperty("sdpMLineIndex", out var idx) ? (ushort?)idx.GetUInt16() : null,
            };
            pc.addIceCandidate(ice);
        }
    }

    private static async Task CaptureLoopAsync(
        RTCPeerConnection pc,
        VpxVideoEncoder encoder,
        ScreenCapturer capturer,
        int fps,
        CancellationToken ct)
    {
        var delay = Math.Max(15, 1000 / Math.Max(1, fps));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        long frame = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var bgr = capturer.CaptureBgr24(out var w, out var h);
                var encoded = encoder.EncodeVideo(w, h, bgr, VideoPixelFormatsEnum.Bgr, VideoCodecsEnum.VP8);
                if (encoded is { Length: > 0 })
                {
                    pc.SendVideo((uint)sw.ElapsedMilliseconds, encoded);
                }
                frame++;
                if (frame % 30 == 0)
                {
                    Console.WriteLine($"frames={frame} size={w}x{h}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"capture: {ex.Message}");
            }

            try
            {
                await Task.Delay(delay, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private static async Task SendAsync(ClientWebSocket ws, object msg, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(msg, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    private static async Task<string?> ReceiveAsync(ClientWebSocket ws, byte[] buf, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        while (true)
        {
            var result = await ws.ReceiveAsync(buf, ct);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buf, 0, result.Count);
            if (result.EndOfMessage) break;
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static string? GetArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name) return args[i + 1];
        }
        return null;
    }
}
