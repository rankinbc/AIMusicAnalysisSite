using System.Net;
using System.Text;

namespace Spectr.Bff.Services;

// Story 4.2 (AR27/UX-DR37) — the template registry. HTML email cannot carry
// the app's fonts/effects, so this is the reduced "SPECTR mono-light" kit:
// dark header band, system-font stack, mono accents — consistent in spirit,
// not in tokens (ux spec L183). Rendering happens BFF-side; the worker's
// send_email actor receives finished subject+html and never duplicates this.
public static class EmailTemplates
{
    public const string Verification = "verification";
    public const string Reset = "reset";
    public const string AnalysisComplete = "analysis-complete";
    public const string Dunning = "dunning";
    public const string RetentionWarning = "retention-warning";

    public static readonly IReadOnlyList<string> All =
        [Verification, Reset, AnalysisComplete, Dunning, RetentionWarning];

    /// <summary>
    /// Render a registered template. Every data value is HTML-encoded —
    /// producers pass raw strings and cannot inject markup. Unknown template
    /// names throw: that's a producer bug and must fail loud, not send a
    /// blank email.
    /// </summary>
    public static (string Subject, string Html) Render(
        string template, IReadOnlyDictionary<string, string> data)
    {
        string D(string key) => data.TryGetValue(key, out var v)
            ? WebUtility.HtmlEncode(v)
            : "";

        return template switch
        {
            Verification => (
                "Verify your SPECTR email",
                Shell("Verify your email",
                    $"""
                    <p>One click and your account is provably yours.</p>
                    <p style="margin:28px 0;"><a href="{D("verifyUrl")}" style="{ButtonCss}">VERIFY EMAIL</a></p>
                    <p style="{MutedCss}">Link expires in {D("expiresHours")} hours. If you didn't create a SPECTR account, ignore this.</p>
                    """)),
            Reset => (
                "Reset your SPECTR password",
                Shell("Password reset",
                    $"""
                    <p>Someone (hopefully you) asked to reset this account's password.</p>
                    <p style="margin:28px 0;"><a href="{D("resetUrl")}" style="{ButtonCss}">RESET PASSWORD</a></p>
                    <p style="{MutedCss}">Link is single-use and expires in {D("expiresMinutes")} minutes. If this wasn't you, your password is unchanged.</p>
                    """)),
            AnalysisComplete => (
                $"Your analysis is ready — {Decode(data, "songName")}",
                Shell("Analysis complete",
                    $"""
                    <p><span style="{MonoCss}">{D("songName")}</span> finished its 7-phase analysis.</p>
                    <p>Grade: <span style="{MonoCss}">{D("grade")}</span></p>
                    <p style="margin:28px 0;"><a href="{D("reportUrl")}" style="{ButtonCss}">OPEN REPORT</a></p>
                    <p style="{MutedCss}">You can turn these emails off in your profile.</p>
                    """)),
            Dunning => (
                "Payment issue on your SPECTR subscription",
                Shell("Payment needs attention",
                    $"""
                    <p>Your last payment didn't go through. Your Pro features keep working while we retry.</p>
                    <p>Next attempt: <span style="{MonoCss}">{D("nextAttempt")}</span></p>
                    <p style="margin:28px 0;"><a href="{D("billingUrl")}" style="{ButtonCss}">UPDATE PAYMENT METHOD</a></p>
                    <p style="{MutedCss}">Reports you've already generated are yours forever, whatever happens.</p>
                    """)),
            RetentionWarning => (
                "Your SPECTR audio files are scheduled for cleanup",
                Shell("Storage cleanup notice",
                    $"""
                    <p>Your subscription lapsed, and per our retention policy your <b>raw audio files</b> will be removed on <span style="{MonoCss}">{D("purgeDate")}</span> ({D("daysLeft")} days from this notice).</p>
                    <p>Your <b>reports, verdicts, and coach chats are never deleted</b> — only the audio.</p>
                    <p style="margin:28px 0;"><a href="{D("billingUrl")}" style="{ButtonCss}">KEEP MY FILES</a></p>
                    <p style="{MutedCss}">Re-subscribing (or buying credits) before the date cancels the cleanup automatically.</p>
                    """)),
            _ => throw new InvalidOperationException(
                $"Unknown email template '{template}'. Registered: {string.Join(", ", All)}."),
        };

        static string Decode(IReadOnlyDictionary<string, string> data, string key)
            => data.TryGetValue(key, out var v) ? v : "";
    }

    // System-font stack + dark header band + mono accents (UX-DR37).
    private const string MonoCss =
        "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#22d3ee;";
    private const string MutedCss = "color:#8b949e;font-size:13px;";
    private const string ButtonCss =
        "display:inline-block;padding:12px 28px;background:#22d3ee;color:#0b0e14;"
        + "text-decoration:none;font-weight:700;letter-spacing:0.08em;"
        + "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border-radius:4px;";

    private static string Shell(string heading, string bodyHtml)
    {
        var sb = new StringBuilder();
        sb.Append(
            $"""
            <!doctype html>
            <html><body style="margin:0;padding:0;background:#f4f5f7;">
            <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2328;">
              <div style="background:#0b0e14;padding:22px 32px;">
                <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#22d3ee;font-size:18px;letter-spacing:0.28em;">SPECTR</span>
              </div>
              <div style="background:#ffffff;padding:32px;">
                <h1 style="font-size:20px;margin:0 0 16px 0;">{WebUtility.HtmlEncode(heading)}</h1>
                {bodyHtml}
              </div>
              <div style="padding:18px 32px;color:#8b949e;font-size:12px;">
                SPECTR — AI music analysis. This is a transactional email about your account.
              </div>
            </div>
            </body></html>
            """);
        return sb.ToString();
    }
}
