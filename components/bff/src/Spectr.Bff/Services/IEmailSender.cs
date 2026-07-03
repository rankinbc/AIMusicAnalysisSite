using Microsoft.Extensions.Logging;

namespace Spectr.Bff.Services;

// Story 3.4 (AR27 seam) — transactional email boundary. Epic 4 (story 4.2)
// replaces the logging implementation with Resend + a template registry +
// suppression handling; every producer (retention warnings today, lifecycle
// emails later) goes through THIS interface so that swap is one DI line.
public interface IEmailSender
{
    Task SendAsync(
        string toEmail,
        string template,
        IReadOnlyDictionary<string, string> data,
        CancellationToken ct = default);
}

// Logs instead of sending — the pre-Epic-4 stand-in. Structured fields keep
// the log greppable (`EmailStub:` prefix mirrors ReconciliationDrift:).
internal sealed class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    private readonly ILogger<LoggingEmailSender> _logger = logger;

    public Task SendAsync(
        string toEmail,
        string template,
        IReadOnlyDictionary<string, string> data,
        CancellationToken ct = default)
    {
        _logger.LogInformation(
            "EmailStub: template={Template} to={To} data={Data}",
            template, toEmail, string.Join(";", data.Select(kv => $"{kv.Key}={kv.Value}")));
        return Task.CompletedTask;
    }
}
