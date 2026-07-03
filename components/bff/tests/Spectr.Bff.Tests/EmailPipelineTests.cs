using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.2 — the ONE email pathway: registry render, suppression skip,
// enqueue-through-actor, svix-verified webhook appends suppressions.
public sealed class EmailPipelineTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // ── Template registry (AC2) ──────────────────────────────────────────────

    [Theory]
    [InlineData(EmailTemplates.Verification)]
    [InlineData(EmailTemplates.Reset)]
    [InlineData(EmailTemplates.AnalysisComplete)]
    [InlineData(EmailTemplates.Dunning)]
    [InlineData(EmailTemplates.RetentionWarning)]
    public void All_Registered_Templates_Render_With_The_Shell(string template)
    {
        var (subject, html) = EmailTemplates.Render(template, new Dictionary<string, string>
        {
            ["verifyUrl"] = "https://x/verify",
            ["resetUrl"] = "https://x/reset",
            ["reportUrl"] = "https://x/report",
            ["billingUrl"] = "https://x/billing",
            ["songName"] = "My Track",
            ["grade"] = "B+",
            ["purgeDate"] = "2026-08-01",
            ["daysLeft"] = "7",
            ["nextAttempt"] = "2026-07-10",
            ["expiresHours"] = "24",
            ["expiresMinutes"] = "30",
        });

        Assert.False(string.IsNullOrWhiteSpace(subject));
        // EmailShell markers (UX-DR37): dark header band + mono brand + system fonts.
        Assert.Contains("background:#0b0e14", html);
        Assert.Contains("SPECTR", html);
        Assert.Contains("ui-monospace", html);
        Assert.Contains("-apple-system", html);
    }

    [Fact]
    public void Template_Data_Is_Html_Encoded()
    {
        var (_, html) = EmailTemplates.Render(EmailTemplates.RetentionWarning,
            new Dictionary<string, string>
            {
                ["purgeDate"] = "<script>alert(1)</script>",
                ["daysLeft"] = "7",
                ["billingUrl"] = "https://x",
            });
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
    }

    [Fact]
    public void Unknown_Template_Throws()
    {
        Assert.Throws<InvalidOperationException>(
            () => EmailTemplates.Render("no-such-template", new Dictionary<string, string>()));
    }

    [Fact]
    public void Subject_Strips_Control_Characters_And_Falls_Back_When_Missing()
    {
        var (subject, _) = EmailTemplates.Render(EmailTemplates.AnalysisComplete,
            new Dictionary<string, string>
            {
                ["songName"] = "My\r\nTrack\x1b",
                ["grade"] = "A",
                ["reportUrl"] = "https://x/r",
            });
        Assert.Equal("Your analysis is ready — MyTrack", subject); // no CR/LF/ESC

        var (fallback, _) = EmailTemplates.Render(EmailTemplates.AnalysisComplete,
            new Dictionary<string, string> { ["grade"] = "A", ["reportUrl"] = "https://x/r" });
        Assert.Equal("Your analysis is ready", fallback); // no dangling em-dash
    }

    [Fact]
    public void Url_Slots_Reject_Non_Http_Schemes()
    {
        var (_, html) = EmailTemplates.Render(EmailTemplates.Verification,
            new Dictionary<string, string>
            {
                ["verifyUrl"] = "javascript:alert(1)",
                ["expiresHours"] = "24",
            });
        Assert.DoesNotContain("javascript:", html); // empty href, never a DKIM-signed phish
    }

    // ── QueueEmailSender (AC1 + AC3 skip) ────────────────────────────────────

    private sealed class RecordingQueue : IJobQueue
    {
        public ConcurrentQueue<(string Task, object[] Args, string Queue)> Calls { get; } = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, DramatiqQueues.Default)); return Task.CompletedTask; }

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }
    }

    private (QueueEmailSender Sender, RecordingQueue Queue, IServiceScope Scope) NewSender()
    {
        var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var queue = new RecordingQueue();
        var sender = new QueueEmailSender(
            db, queue,
            Microsoft.Extensions.Options.Options.Create(new ResendOptions()),
            NullLogger<QueueEmailSender>.Instance);
        return (sender, queue, scope);
    }

    [Fact]
    public async Task Send_Enqueues_Rendered_Email_On_Maintenance()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (sender, queue, scope) = NewSender();
        using (scope)
        {
            await sender.SendAsync("someone@spectr.test", EmailTemplates.RetentionWarning,
                new Dictionary<string, string>
                {
                    ["purgeDate"] = "2026-08-01",
                    ["daysLeft"] = "7",
                    ["billingUrl"] = "https://x",
                });

            var call = Assert.Single(queue.Calls);
            Assert.Equal(DramatiqTasks.SendEmail, call.Task);
            Assert.Equal(DramatiqQueues.Maintenance, call.Queue);
            Assert.Equal("someone@spectr.test", (string)call.Args[0]);
            Assert.Contains("cleanup", ((string)call.Args[1]), StringComparison.OrdinalIgnoreCase); // subject
            Assert.Contains("2026-08-01", (string)call.Args[2]);                                    // html
            Assert.Equal(EmailTemplates.RetentionWarning, (string)call.Args[3]);                    // template
        }
    }

    [Fact]
    public async Task Suppressed_Address_Is_Skipped()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var email = $"bounce+{Guid.NewGuid():N}@spectr.test";
        using (var seedScope = _factory.Services.CreateScope())
        {
            var db = seedScope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.EmailSuppressions.Add(new EmailSuppression { Email = email, Reason = "bounced" });
            await db.SaveChangesAsync();
        }

        try
        {
            var (sender, queue, scope) = NewSender();
            using (scope)
            {
                // Case-insensitive: suppression stores lowercase, send uses mixed.
                await sender.SendAsync(email.ToUpperInvariant(), EmailTemplates.RetentionWarning,
                    new Dictionary<string, string>
                    {
                        ["purgeDate"] = "2026-08-01",
                        ["daysLeft"] = "7",
                        ["billingUrl"] = "https://x",
                    });
                Assert.Empty(queue.Calls); // AC3 — skipped, not sent
            }
        }
        finally
        {
            using var cleanupScope = _factory.Services.CreateScope();
            var db = cleanupScope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.EmailSuppressions.Where(s => s.Email == email).ExecuteDeleteAsync();
        }
    }

    // ── Webhook (AC3) ────────────────────────────────────────────────────────

    private const string WebhookSecret = "whsec_dGVzdC1zZWNyZXQtZm9yLXVuaXQtdGVzdHM=";

    private WebApplicationFactory<Program> WebhookFactory() =>
        _factory.WithWebHostBuilder(b =>
            b.UseSetting("Resend:WebhookSecret", WebhookSecret));

    private static HttpRequestMessage SignedWebhook(string id, string body)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var key = Convert.FromBase64String(WebhookSecret[6..]);
        var sig = Convert.ToBase64String(HMACSHA256.HashData(
            key, Encoding.UTF8.GetBytes($"{id}.{timestamp}.{body}")));
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/email/webhook")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("svix-id", id);
        req.Headers.Add("svix-timestamp", timestamp);
        req.Headers.Add("svix-signature", $"v1,{sig}");
        return req;
    }

    [Fact]
    public async Task Webhook_Without_Secret_Configured_Returns_503()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        var resp = await _factory.CreateClient().PostAsync("/api/email/webhook",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }

    [Fact]
    public async Task Webhook_With_Bad_Signature_Is_Rejected()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var f = WebhookFactory();
        var req = SignedWebhook($"msg_{Guid.NewGuid():N}", """{"type":"email.bounced","data":{"to":["x@y.test"]}}""");
        req.Headers.Remove("svix-signature");
        req.Headers.Add("svix-signature", "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
        var resp = await f.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Webhook_Bounce_Appends_Suppression_And_Dedupes()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var email = $"hook+{Guid.NewGuid():N}@spectr.test";
        var eventId = $"msg_{Guid.NewGuid():N}";
        var body = """{"type":"email.bounced","data":{"to":["EMAIL"]}}""".Replace("EMAIL", email);

        using var f = WebhookFactory();
        var client = f.CreateClient();
        try
        {
            var first = await client.SendAsync(SignedWebhook(eventId, body));
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.EmailSuppressions.AsNoTracking()
                    .SingleAsync(s => s.Email == email.ToLowerInvariant());
                Assert.Equal("bounced", row.Reason);
                Assert.Equal(eventId, row.SourceEventId);
            }

            // Same svix-id again → duplicate short-circuit, no error.
            var second = await client.SendAsync(SignedWebhook(eventId, body));
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);
            var payload = await second.Content.ReadAsStringAsync();
            Assert.Contains("duplicate", payload);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.EmailSuppressions.Where(s => s.Email == email.ToLowerInvariant()).ExecuteDeleteAsync();
            await db.WebhookEvents.Where(w => w.Id == eventId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Webhook_Missing_Headers_Or_Stale_Timestamp_Is_Unauthorized()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var f = WebhookFactory();
        var client = f.CreateClient();

        // No svix headers at all.
        var bare = await client.PostAsync("/api/email/webhook",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Unauthorized, bare.StatusCode);

        // Correctly signed but 10-minute-old timestamp (outside the window).
        var id = $"msg_{Guid.NewGuid():N}";
        var body = """{"type":"email.bounced","data":{"to":["x@y.test"]}}""";
        var stale = DateTimeOffset.UtcNow.AddMinutes(-10).ToUnixTimeSeconds().ToString();
        var key = Convert.FromBase64String(WebhookSecret[6..]);
        var sig = Convert.ToBase64String(HMACSHA256.HashData(
            key, Encoding.UTF8.GetBytes($"{id}.{stale}.{body}")));
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/email/webhook")
        { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("svix-id", id);
        req.Headers.Add("svix-timestamp", stale);
        req.Headers.Add("svix-signature", $"v1,{sig}");
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);

        // Absurd timestamp must be 401, not a 500 (FromUnixTimeSeconds range).
        var absurd = SignedWebhook(id, body);
        absurd.Headers.Remove("svix-timestamp");
        absurd.Headers.Add("svix-timestamp", "99999999999999999");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(absurd)).StatusCode);
    }

    [Fact]
    public void Svix_Verifier_Rejects_Tampered_Body()
    {
        var id = "msg_x"; var ts = "1700000000"; var body = """{"a":1}""";
        var key = Convert.FromBase64String(WebhookSecret[6..]);
        var sig = Convert.ToBase64String(HMACSHA256.HashData(
            key, Encoding.UTF8.GetBytes($"{id}.{ts}.{body}")));

        Assert.True(EmailWebhookEndpoints.VerifySvixSignature(WebhookSecret, id, ts, body, $"v1,{sig}"));
        Assert.False(EmailWebhookEndpoints.VerifySvixSignature(WebhookSecret, id, ts, """{"a":2}""", $"v1,{sig}"));
        Assert.False(EmailWebhookEndpoints.VerifySvixSignature(WebhookSecret, "msg_y", ts, body, $"v1,{sig}"));
    }
}
