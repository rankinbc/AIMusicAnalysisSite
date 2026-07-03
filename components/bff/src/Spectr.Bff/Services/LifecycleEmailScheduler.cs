using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Story 4.4 (FR44/AC1) — the analysis-complete email trigger. The worker
// flips jobs complete but cannot render (template registry is BFF-only) and
// no worker→BFF push exists, so the BFF polls: every minute, recently-
// completed jobs whose owner has notifications enabled get ONE email with a
// deep link to the report. Send-ledger = a digest-keyed notifications row
// (partial-unique digest_key ⇒ cross-replica dedupe + an in-app notice for
// free — the 3.4 retention-warning ledger precedent).
public sealed class LifecycleOptions
{
    public const string SectionName = "Lifecycle";

    public bool Enabled { get; set; } = true;
    // Catch-up window: a BFF restart must not orphan completions that
    // happened while it was down, but ancient completions must not suddenly
    // email users either. 24 h (review-raised from 2 h) covers any realistic
    // outage; completions older than this are ACCEPTED LOSS, by design —
    // there is no high-water mark.
    public int LookbackMinutes { get; set; } = 1440;
    // 3.4 lesson: an immediate startup pass fires into every
    // WebApplicationFactory test host — delay the first tick.
    public int InitialDelaySeconds { get; set; } = 90;
}

internal sealed class LifecycleEmailScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<LifecycleOptions> options,
    IConfiguration config,
    ILogger<LifecycleEmailScheduler> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<LifecycleOptions> _options = options;
    private readonly IConfiguration _config = config;
    private readonly ILogger<LifecycleEmailScheduler> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(
                TimeSpan.FromSeconds(Math.Max(0, _options.Value.InitialDelaySeconds)),
                stoppingToken);
        }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Lifecycle email sweep failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    // internal test seam (InternalsVisibleTo).
    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var opts = _options.Value;
        if (!opts.Enabled) return 0;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var email = scope.ServiceProvider.GetRequiredService<IEmailSender>();

        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-Math.Max(1, opts.LookbackMinutes));

        // Recently-completed jobs with a LIVE saved song (song-less or
        // deleted-song analyses have no working deep link). NOTE: the opt-out
        // flag is NOT in this filter — the ledger row doubles as the in-app
        // notification, and "email me" must not silently disable the bell.
        // Oldest first so a post-outage backlog drains before aging past the
        // lookback window.
        var candidates = await (
            from job in db.AnalysisJobs.AsNoTracking()
            join a in db.Analyses.AsNoTracking() on job.Id equals a.JobId
            join song in db.Songs.AsNoTracking() on a.SongId equals song.Id
            join u in db.Users.AsNoTracking() on job.UserId equals u.Id
            where job.Status == "complete"
                && job.CompletedAt != null && job.CompletedAt > cutoff
                && u.IsActive
                && !db.Notifications.Any(n => n.DigestKey == "analysis_complete:" + job.Id.ToString())
            orderby job.CompletedAt
            select new
            {
                JobId = job.Id,
                UserId = u.Id,
                u.Email,
                u.NotifyAnalysisComplete,
                a.SongId,
                a.SongName,
            })
            .Take(200) // bounded per tick; the next minute picks up the rest
            .ToListAsync(ct);

        var origin = AppUrls.FrontendOrigin(_config, _logger);
        var sent = 0;
        foreach (var c in candidates)
        {
            // Ledger FIRST (unique digest_key = the send decision): if another
            // replica won the insert, skip. Email only after the ledger row
            // committed — a crash between the two loses one email, never spams.
            db.Notifications.Add(new Notification
            {
                RecipientUserId = c.UserId,
                EventType = "analysis_complete",
                DigestKey = $"analysis_complete:{c.JobId}",
                PayloadJson = System.Text.Json.JsonSerializer.Serialize(new
                {
                    jobId = c.JobId,
                    songId = c.SongId,
                    songName = c.SongName,
                }),
            });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                db.ChangeTracker.Clear();
                if (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
                    continue; // another replica already claimed this job
                // Anything else is a REAL failure, not a duplicate — log it;
                // the job stays unclaimed and self-heals next tick.
                _logger.LogError(ex,
                    "Analysis-complete ledger insert failed for job {JobId}.", c.JobId);
                continue;
            }

            if (!c.NotifyAnalysisComplete)
                continue; // in-app notice recorded; email declined by the user

            try
            {
                await email.SendAsync(c.Email, EmailTemplates.AnalysisComplete,
                    new Dictionary<string, string>
                    {
                        ["songName"] = c.SongName ?? "Your track",
                        ["reportUrl"] = $"{origin}/songs/{c.SongId}/results/{c.JobId}",
                    }, ct);
                sent++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Ledger already claimed — this completion won't re-email.
                // Deliberate direction: one lost email beats duplicate spam;
                // the in-app notification row still exists.
                _logger.LogError(ex,
                    "Analysis-complete email failed for job {JobId} (ledger already claimed).",
                    c.JobId);
            }
        }

        if (sent > 0)
            _logger.LogInformation(
                "Lifecycle sweep queued {Count} analysis-complete email(s) (suppressed addresses skip inside the pathway).",
                sent);
        return sent;
    }
}
