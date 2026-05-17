using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;

namespace Spectr.Bff.Services;

/// <summary>
/// Wraps the `claude` CLI for the AI Coach chat endpoint. Mirrors the
/// pattern in <c>components/worker/app/verdict_lib/llm_client_sync.py</c>:
/// system prompt written to a tempfile and passed via
/// <c>--system-prompt-file</c>; user message piped via stdin (Windows
/// command-line length cap means we can't pass analysis JSON as an argv arg).
///
/// Unlike the Python sync wrapper, this one streams stdout — each line/chunk
/// is yielded as it arrives so the BFF can forward to the client over SSE.
/// </summary>
public sealed class CoachChatService
{
    private const string ClaudeBinary = "claude";

    public IAsyncEnumerable<string> StreamAsync(
        string systemPrompt,
        string userMessage,
        TimeSpan timeout,
        CancellationToken ct)
        => StreamInternal(systemPrompt, userMessage, timeout, ct);

    private static async IAsyncEnumerable<string> StreamInternal(
        string systemPrompt,
        string userMessage,
        TimeSpan timeout,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Tempfile for the system prompt. CLI requires a path (Windows arg
        // length cap on the equivalent inline flag).
        var systemPath = Path.Combine(
            Path.GetTempPath(),
            $"coach-system-{Guid.NewGuid():N}.md");
        await File.WriteAllTextAsync(systemPath, systemPrompt, ct);

        var psi = new ProcessStartInfo
        {
            FileName = ClaudeBinary,
            // `-p` (print mode) + system prompt file + plaintext output.
            // We don't ask for JSON streaming here; the chat UI just renders
            // the prose verbatim.
            ArgumentList =
            {
                "-p",
                "--system-prompt-file", systemPath,
                "--output-format", "text",
            },
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardInputEncoding = Encoding.UTF8,
        };

        Process? proc = null;
        string? startError = null;
        try { proc = Process.Start(psi); }
        catch (Exception ex) { startError = ex.Message; }

        if (startError is not null)
        {
            yield return $"[error] claude CLI not available: {startError}";
            try { File.Delete(systemPath); } catch { }
            yield break;
        }
        if (proc is null)
        {
            yield return "[error] failed to start claude CLI";
            try { File.Delete(systemPath); } catch { }
            yield break;
        }

        try
        {

            // Write the user message to stdin and close it so the model knows
            // it's the end of input. We don't await both side-tasks in
            // parallel because `await foreach` reads stdout sequentially.
            await proc.StandardInput.WriteAsync(userMessage.AsMemory(), ct);
            await proc.StandardInput.FlushAsync(ct);
            proc.StandardInput.Close();

            // Read stdout in fixed-size chunks rather than line-by-line so
            // newline-free streaming (which claude does in plaintext mode)
            // still emits incrementally. 256 chars is small enough to feel
            // realtime but large enough to avoid one-byte-per-chunk overhead.
            var buf = new char[256];
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linked.CancelAfter(timeout);
            var timedOut = false;
            while (!linked.Token.IsCancellationRequested)
            {
                int read = 0;
                var cancelled = false;
                try
                {
                    read = await proc.StandardOutput.ReadAsync(buf.AsMemory(), linked.Token);
                }
                catch (OperationCanceledException)
                {
                    cancelled = true;
                    if (!ct.IsCancellationRequested)
                    {
                        // Linked-token cancellation = our timeout. Kill the
                        // child so we don't leave a zombie.
                        try { proc.Kill(entireProcessTree: true); } catch { }
                        timedOut = true;
                    }
                }
                if (cancelled) break;
                if (read <= 0) break;
                yield return new string(buf, 0, read);
            }
            if (timedOut)
            {
                yield return "[error] timeout";
                yield break;
            }

            // Capture stderr if exit was non-zero so the client gets a useful
            // error trail instead of just "[done]".
            try { await proc.WaitForExitAsync(ct); } catch { }
            if (proc.ExitCode != 0)
            {
                var stderr = await proc.StandardError.ReadToEndAsync(ct);
                yield return $"\n\n[error] claude CLI exited {proc.ExitCode}: {stderr.Trim()}";
            }
        }
        finally
        {
            try { proc?.Dispose(); } catch { }
            try { File.Delete(systemPath); } catch { }
        }
    }
}
