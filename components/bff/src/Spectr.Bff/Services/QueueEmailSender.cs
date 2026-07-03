using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 4.2 (AR27) — the ONE email pathway. Renders BFF-side (template
// registry is here, worker never duplicates it), checks the suppression
// list, then enqueues the finished subject+html through the send_email
// actor on `maintenance` — retry semantics live on the actor, and producers
// never block on provider latency. Without RESEND_API_KEY the actor stubs
// (logs), so this path is safe to run key-less in dev.
internal sealed class QueueEmailSender(
    AppDbContext db,
    IJobQueue queue,
    IOptions<ResendOptions> options,
    ILogger<QueueEmailSender> logger) : IEmailSender
{
    private readonly AppDbContext _db = db;
    private readonly IJobQueue _queue = queue;
    private readonly IOptions<ResendOptions> _options = options;
    private readonly ILogger<QueueEmailSender> _logger = logger;

    public async Task SendAsync(
        string toEmail,
        string template,
        IReadOnlyDictionary<string, string> data,
        CancellationToken ct = default)
    {
        // Render FIRST — an unknown template is a producer bug and must fail
        // loud before any queue/DB work.
        var (subject, html) = EmailTemplates.Render(template, data);

        var normalized = toEmail.Trim().ToLowerInvariant();
        var suppressed = await _db.EmailSuppressions.AsNoTracking()
            .AnyAsync(s => s.Email == normalized, ct);
        if (suppressed)
        {
            // AC3: suppressed addresses are SKIPPED, silently for the caller
            // (the producer's flow must not fail because a user's inbox
            // bounced last month). Masked log for ops visibility.
            _logger.LogInformation(
                "Email suppressed — skipping send. template={Template} to={To}",
                template, Mask(toEmail));
            return;
        }

        await _queue.EnqueueAsync(
            DramatiqTasks.SendEmail,
            [toEmail, subject, html, template, _options.Value.FromAddress],
            DramatiqQueues.Maintenance,
            ct);
        _logger.LogInformation(
            "Email enqueued. template={Template} to={To}", template, Mask(toEmail));
    }

    private static string Mask(string email)
    {
        var at = email.IndexOf('@');
        return at > 1 ? $"{email[..2]}***{email[at..]}" : "***";
    }
}
