using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Prometheus;
using Serilog;
using Spectr.Bff.Auth;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using StackExchange.Redis;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// ── Logging (Serilog → console) ────────────────────────────────────────────────
builder.Host.UseSerilog((ctx, services, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

// Story 10.3 — Sentry, DSN-gated (empty/missing = fully disabled; dev default).
if (!string.IsNullOrWhiteSpace(builder.Configuration["Sentry:Dsn"]))
{
    builder.WebHost.UseSentry(o =>
    {
        o.Dsn = builder.Configuration["Sentry:Dsn"]!;
        o.Environment = builder.Environment.EnvironmentName;
        o.TracesSampleRate = 0.0; // errors only — tracing out of 10.3 scope
    });
}

// ── Configuration ──────────────────────────────────────────────────────────────
var conn = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Postgres");

// Story 4.1 (NFR6) — secrets fail-fast. appsettings.json carries NO signing
// keys; dev values live in appsettings.Development.json only. Any other
// environment must supply them via env/user-secrets or the BFF refuses to
// boot. Length is enforced here (not at first sign) because HmacSha256
// requires >= 32 bytes and a short key would otherwise explode mid-request.
// Review-hardened: placeholder values are rejected EVERYWHERE, and the
// publicly-committed dev keys are rejected outside Development — setting
// ASPNETCORE_ENVIRONMENT=Development on a prod host must not silently sign
// tokens with keys anyone can read on GitHub.
static string RequireSigningKey(IConfiguration cfg, string key, string envForm, bool isDevelopment)
{
    var value = cfg[key];
    if (string.IsNullOrWhiteSpace(value))
        throw new InvalidOperationException(
            $"Missing {key}. Set the {envForm} environment variable "
            + "(32+ random bytes) or a dotnet user-secret. The BFF refuses to "
            + "boot without it outside Development (NFR6).");
    if (value.StartsWith("REPLACE_", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException(
            $"{key} is still the .env.example placeholder. Generate a real key "
            + $"(openssl rand -base64 48) and set it via {envForm}.");
    if (!isDevelopment && (
            value.StartsWith("spectr-dev-only-", StringComparison.OrdinalIgnoreCase)
            || value.Contains("dev-anon-signing-key", StringComparison.OrdinalIgnoreCase)
            || value.Contains("change-me", StringComparison.OrdinalIgnoreCase)))
        throw new InvalidOperationException(
            $"{key} is a PUBLICLY-COMMITTED development key — refusing to boot "
            + $"outside Development. Provide a real secret via {envForm}.");
    if (Encoding.UTF8.GetBytes(value).Length < 32)
        throw new InvalidOperationException(
            $"{key} is too short: HmacSha256 requires at least 32 bytes. "
            + $"Provide 32+ random bytes via {envForm}.");
    return value;
}

var isDevEnv = builder.Environment.IsDevelopment();
var jwtKey = RequireSigningKey(builder.Configuration, "Jwt:Key", "Jwt__Key", isDevEnv);
var anonSigningKey = RequireSigningKey(builder.Configuration, "Anon:SigningKey", "Anon__SigningKey", isDevEnv);
if (jwtKey == anonSigningKey)
    throw new InvalidOperationException(
        "Anon:SigningKey must DIFFER from Jwt:Key — one HMAC key serving two "
        + "token formats invites cross-protocol confusion.");

// Story 10.5 — the admin key is optional (absent = surface 404s) but a
// CONFIGURED key must be strong: a guessable admin key is worse than none.
var adminKey = builder.Configuration["Admin:ApiKey"];
if (!string.IsNullOrWhiteSpace(adminKey) && !isDevEnv && adminKey.Length < 32)
    throw new InvalidOperationException(
        "Admin:ApiKey is set but shorter than 32 chars. Generate one with "
        + "`openssl rand -base64 48` or unset it to disable the admin surface.");

// Story 10.1 (4.3/4.4 deferral paid): outside Development, a missing
// App:FrontendOrigin means every verification/reset/report email ships
// localhost links — that's a boot failure, not a warning.
if (!isDevEnv && string.IsNullOrWhiteSpace(builder.Configuration["App:FrontendOrigin"]))
    throw new InvalidOperationException(
        "Missing App:FrontendOrigin. Outside Development this MUST be the "
        + "public site origin (email deep links are built from it). Set "
        + "App__FrontendOrigin, e.g. https://spectr.example.com.");

// Allow 250 MB uploads for long FLACs.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 250L * 1024 * 1024);

// ── Services ───────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(conn));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        };
        // <audio>/<video>/EventSource can't attach Authorization headers, so we
        // also accept the access JWT via ?t=… on whitelisted media routes. The
        // token still has to validate against the same signing key + lifetime.
        o.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                if (!string.IsNullOrEmpty((string?)ctx.Token)) return Task.CompletedTask;
                var path = ctx.HttpContext.Request.Path.Value ?? string.Empty;
                // Story 2.2 review-fix P24 — tighten the carve-out to the
                // exact route we mean (`/api/versions/{id}/audio`). The
                // prior `Contains("/audio")` would have also matched any
                // future path containing "audio" as a substring (e.g.
                // `/api/audio-analysis/...`), silently granting them the
                // query-param JWT path. The token still flows through
                // the same JwtBearer pipeline; we just limit WHERE it's
                // accepted in lieu of an Authorization header.
                if (path.StartsWith("/api/versions/", StringComparison.OrdinalIgnoreCase)
                    && path.EndsWith("/audio", StringComparison.OrdinalIgnoreCase))
                {
                    var t = ctx.Request.Query["t"].ToString();
                    if (!string.IsNullOrEmpty(t)) ctx.Token = t;
                }
                // Server-rendered result images (spectrogram/waveform) are loaded
                // by an <img> tag, which likewise can't set an Authorization
                // header — accept the JWT via ?t= on /api/jobs/{id}/images/{kind}.
                else if (path.StartsWith("/api/jobs/", StringComparison.OrdinalIgnoreCase)
                    && path.Contains("/images/", StringComparison.OrdinalIgnoreCase))
                {
                    var t = ctx.Request.Query["t"].ToString();
                    if (!string.IsNullOrEmpty(t)) ctx.Token = t;
                }
                return Task.CompletedTask;
            },
            // Story 4.6 — token-versioning: reject access tokens whose tver
            // claim is stale (password reset / account deletion bumped
            // users.token_version). DB value cached 60 s per user
            // (EntitlementService precedent); same-process bumps evict the
            // cache entry, so revocation is instant locally and ≤60 s
            // cross-replica — vs the token's 15-minute natural TTL.
            OnTokenValidated = async ctx =>
            {
                var tverClaim = ctx.Principal?.FindFirst("tver")?.Value;
                var sub = ctx.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                    ?? ctx.Principal?.FindFirst("sub")?.Value;
                if (tverClaim is null || sub is null || !Guid.TryParse(sub, out var uid))
                    return; // pre-4.6 token without tver: honored until natural expiry (≤15 min, one-time rollout window)

                (int Version, bool Banned)? current;
                try
                {
                    var cache = ctx.HttpContext.RequestServices
                        .GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>();
                    // 10.5: same cached lookup now also carries the ban flag —
                    // one query, one cache key, one eviction path.
                    current = await cache.GetOrCreateAsync($"tver:{uid:N}", async e =>
                    {
                        e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
                        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                        var row = await db.Users.AsNoTracking()
                            .Where(u => u.Id == uid)
                            .Select(u => new { u.TokenVersion, u.BannedAt })
                            .FirstOrDefaultAsync();
                        return row is null
                            ? ((int, bool)?)null
                            : (row.TokenVersion, row.BannedAt != null);
                    });
                }
                catch (Exception ex)
                {
                    // FAIL-OPEN (review decision): an unhandled exception here
                    // 500s EVERY bearer-carrying request during a DB blip.
                    // Failing open degrades exactly to the pre-4.6 status quo
                    // (revocation bounded by the 15-min token TTL) — and a
                    // fail-closed 401 would trigger mass refresh attempts that
                    // ALSO need the down DB. Same direction as the rate
                    // limiter's fail-open (4.3).
                    ctx.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                        .CreateLogger("Auth").LogWarning(ex,
                            "Token-version check unavailable — failing OPEN.");
                    return;
                }
                if (current is null || tverClaim != current.Value.Version.ToString())
                    ctx.Fail("stale token version");
                else if (current.Value.Banned)
                    ctx.Fail("account banned"); // 10.5 — bans kill live tokens too
            },
        };
    });
builder.Services.AddAuthorization();

// Auth helpers.
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddScoped<RefreshTokenService>();
builder.Services.AddScoped<AuthTokenService>();  // story 4.3 — verify/reset tokens
builder.Services.AddScoped<DeviceService>();     // story 4.5 — anon devices + claim
builder.Services.AddScoped<DemoSeeder>();  // story 12.8 — first-run demo report

// File storage — swap LocalDiskFileStorage for R2FileStorage via config when public.
builder.Services.AddSingleton<IFileStorage, LocalDiskFileStorage>();

// Story 3.1 — S3-compatible presigned multipart store (R2 prod / MinIO dev, AR17).
// Always registered; IsConfigured=false (no Storage:S3:ServiceUrl) makes the
// /uploads endpoints answer 501 and the frontend falls back to legacy upload.
builder.Services.Configure<S3StorageOptions>(builder.Configuration.GetSection(S3StorageOptions.SectionName));
builder.Services.AddSingleton<IMultipartObjectStore, S3ObjectStore>();

// Job queue — dramatiq-compatible Redis client.
builder.Services.AddSingleton<IJobQueue, DramatiqJobQueue>();

// Story 1.6: shared StackExchange.Redis connection for the coach SSE relay
// (pub/sub + cancel-key writes). The existing DramatiqJobQueue keeps its own
// multiplexer — leaving that wiring untouched is an additive choice; a
// follow-up could consolidate. ConnectionMultiplexer is documented as
// thread-safe and designed to be shared across the whole process.
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(
        builder.Configuration["Redis:ConnectionString"]
            ?? throw new InvalidOperationException("Redis:ConnectionString not set")));

// Coach chat — invokes claude CLI as a subprocess and streams stdout. Same
// binary the Python worker uses for verdict pipeline.
builder.Services.AddSingleton<CoachChatService>();

// Story 2.1 — Stripe checkout client + subscription mirror service.
// IStripeCheckoutClient is a thin abstraction so tests can substitute a
// fake without hitting api.stripe.com. SubscriptionMirrorService is the
// ONLY writer to the `subscriptions` table (architecture money-boundary).
builder.Services.AddSingleton<IStripeCheckoutClient, StripeCheckoutClient>();
builder.Services.AddSingleton<IStripeSubscriptionClient, StripeSubscriptionClient>();
builder.Services.AddSingleton<IStripeRefundClient, StripeRefundClient>(); // 10.5 admin refunds
builder.Services.AddSingleton<DisposableEmailService>(); // 10.6 abuse containment
builder.Services.AddScoped<SubscriptionMirrorService>();

// Story 2.3 — append-only credit ledger. The ONLY writer to credit_ledger
// (architecture D2 money-boundary). Used by the webhook handler (purchase
// on checkout.session.completed mode=payment), the job dispatch hook
// (spend; story 2.4 DispatchAnalysisAsync), and the GET /jobs/{id} read
// path (lazy reversal on invalid_file).
builder.Services.AddScoped<CreditLedgerService>();

// Story 2.4 — entitlement resolver + in-process cache.
// IMemoryCache is process-local; EntitlementService caches per-user
// snapshots for 60 s and feature flags globally for 60 s.
builder.Services.AddMemoryCache();
builder.Services.AddScoped<EntitlementService>();

// Story 2.6 — tier-aware coach cap resolver (COUNT guard half of the two-guard
// model). Depends on EntitlementService + AppDbContext, so scoped.
builder.Services.AddScoped<CoachCapService>();

// ── Listen V3 · PRP-0 spine primitives ──────────────────────────────────────
// Redis rate limiter. No DB — Redis + interface only.
builder.Services.AddSingleton<IRateLimiter, RedisRateLimiter>();

// Listen V3 (PRP-1) — no-op generator seam for source=coach/analysis presets
// (real impl is PRP-8; mirrors the PRP-0 sink convention).
builder.Services.AddScoped<IPresetGenerator, NoOpPresetGenerator>();

// Story 2.8 — usage-page honest-math (90-day credit spend vs Pro-equivalent).
builder.Services.AddScoped<HonestMathService>();

// Reference profiles — lazy fingerprint-cached aggregate over a set's analyzed members.
builder.Services.AddScoped<ReferenceProfileAggregator>();

// Story 2.10 — nightly billing reconciliation (read-only drift check).
builder.Services.AddHostedService<BillingReconciliationService>();

// Worker supervision — fail jobs orphaned by a dead/restarted dramatiq worker so
// the UI shows a re-runnable error instead of an infinite spinner. Runtime
// backstop to scripts/recover-jobs.ps1 (which handles dev restarts at launch).
builder.Services.AddHostedService<StaleJobReaper>();
// Story 12.2 — shared dramatiq heartbeat read (health endpoint + reaper).
builder.Services.AddSingleton<IWorkerHeartbeat, WorkerHeartbeat>();
builder.Services.AddOptions<WorkerOptions>()
    .Bind(builder.Configuration.GetSection(WorkerOptions.SectionName))
    // 12.2 review fix: the fast tier is unclamped by design, so a zero/negative
    // grace would insta-fail every pending job whenever the heartbeat lapses.
    .Validate(o => o.PendingNoWorkerGraceMinutes > 0,
        "Worker:PendingNoWorkerGraceMinutes must be > 0")
    .ValidateOnStart();

// Story 3.4 seam → story 4.2 implementation: the ONE email pathway.
// QueueEmailSender renders (registry), checks suppression, enqueues the
// send_email actor on `maintenance` (retry semantics there). Key-less dev is
// safe: the actor stubs (logs) without RESEND_API_KEY.
builder.Services.AddScoped<IEmailSender, QueueEmailSender>();
var requireEmail = string.Equals(
    Environment.GetEnvironmentVariable("SPECTR_REQUIRE_EMAIL"), "1", StringComparison.Ordinal);
builder.Services.AddOptions<ResendOptions>()
    .Bind(builder.Configuration.GetSection(ResendOptions.SectionName))
    .Validate(
        o => !requireEmail || (o.IsConfigured && !string.IsNullOrWhiteSpace(o.WebhookSecret)),
        "Resend:ApiKey and Resend:WebhookSecret must be set when SPECTR_REQUIRE_EMAIL=1.")
    .ValidateOnStart();
builder.Services.Configure<RetentionOptions>(builder.Configuration.GetSection(RetentionOptions.SectionName));
builder.Services.AddHostedService<RetentionSweepScheduler>();
// Story 4.4 — analysis-complete email poller (worker can't render; BFF owns
// the registry). Digest-keyed notifications rows are the send ledger.
builder.Services.Configure<LifecycleOptions>(builder.Configuration.GetSection(LifecycleOptions.SectionName));
builder.Services.AddHostedService<LifecycleEmailScheduler>();

// Story 1.9: per-analysis free-tier coach follow-up cap. Fail-fast at startup
// on a non-positive value — a zero cap would make the product unusable and we
// don't want a config typo to ship silently.
builder.Services.AddOptions<CoachCapsOptions>()
    .Bind(builder.Configuration.GetSection(CoachCapsOptions.SectionName))
    .Validate(o => o.FreeFollowups > 0, "CoachCaps:FreeFollowups must be > 0")
    .ValidateOnStart();

// Story 2.1: Stripe SDK + pricing display options.
// Stripe creds are env-aware: prod fail-fast requires SecretKey + WebhookSecret;
// dev runs without keys but the checkout endpoint returns `stripe_not_configured`
// at request time so the rest of the BFF still boots for non-billing flows.
//
// review-fix P11 — gate the fail-fast on an explicit env var
// `SPECTR_REQUIRE_STRIPE=1` rather than `IHostEnvironment.IsProduction()`.
// `dotnet run` without an explicit ASPNETCORE_ENVIRONMENT defaults the
// environment to "Production" on some platforms, which made the prior
// `IsProduction()` predicate fire during plain local dev and prevented
// the BFF from starting. The new env var is set explicitly in prod
// deployments (Docker Compose runbook) and never in dev.
var requireStripe = string.Equals(
    Environment.GetEnvironmentVariable("SPECTR_REQUIRE_STRIPE"), "1",
    StringComparison.Ordinal);
builder.Services.AddOptions<StripeOptions>()
    .Bind(builder.Configuration.GetSection(StripeOptions.SectionName))
    .Validate(
        o => !requireStripe
            || (!string.IsNullOrWhiteSpace(o.SecretKey)
                && !string.IsNullOrWhiteSpace(o.WebhookSecret)
                && !string.IsNullOrWhiteSpace(o.PriceProMonthly)
                && !string.IsNullOrWhiteSpace(o.PriceProAnnual)),
        "Stripe configuration (SecretKey, WebhookSecret, PriceProMonthly, PriceProAnnual) must be set when SPECTR_REQUIRE_STRIPE=1")
    .ValidateOnStart();

builder.Services.AddOptions<PricingDisplayOptions>()
    .Bind(builder.Configuration.GetSection(PricingDisplayOptions.SectionName))
    .Validate(o => o.ProMonthlyCents > 0 && o.ProAnnualCents > 0,
        "PricingDisplay cents values must be positive")
    .ValidateOnStart();

// Initialize Stripe SDK if a key is present. Read straight from
// IConfiguration to avoid BuildServiceProvider() at config-time (ASP0000).
// StripeConfiguration.ApiKey is process-static; setting it once is enough.
{
    var stripeKeyAtBoot = builder.Configuration[$"{StripeOptions.SectionName}:SecretKey"];
    if (!string.IsNullOrWhiteSpace(stripeKeyAtBoot))
    {
        Stripe.StripeConfiguration.ApiKey = stripeKeyAtBoot;
    }
}

// CORS for the frontend.
// Story 2.2 review-fix P8 — origin is config-driven so prod doesn't ship
// with the dev origin baked in. `App:FrontendOrigin` defaults to the
// Vite dev server; prod deploys set it via env to the deployed frontend
// host. AllowCredentials forbids `*` so the explicit single origin is
// the only safe shape.
var frontendOrigin = builder.Configuration["App:FrontendOrigin"]
    ?? "http://localhost:5174";
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(frontendOrigin)
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials()));

builder.Services.AddOpenApi();

// Allow large multipart bodies for bulk stem staging (up to ~100 stems per request).
// Per-endpoint RequestSizeLimitAttribute still applies; this lifts the form reader's
// own cap so ReadFormAsync doesn't reject the batch.
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = 250L * 1024 * 1024 * 20; // 5 GB
    o.ValueLengthLimit = int.MaxValue;
    o.MultipartHeadersLengthLimit = int.MaxValue;
});

var app = builder.Build();

// Story 12.2 (AC5) — one Information-level summary of the silent-degradation
// knobs: which integrations are configured and what the worker-supervision
// thresholds resolved to. Booleans and paths ONLY — key material is guarded
// by the RequireSigningKey boot checks above, never logged.
{
    var s3Opts = app.Services.GetRequiredService<IOptions<S3StorageOptions>>().Value;
    var resendOpts = app.Services.GetRequiredService<IOptions<ResendOptions>>().Value;
    var stripeOpts = app.Services.GetRequiredService<IOptions<StripeOptions>>().Value;
    var workerKnobs = app.Services.GetRequiredService<IOptions<WorkerOptions>>().Value;
    var rateLimitsEnabled = !string.Equals(
        app.Configuration["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
    var devAutoVerify = string.Equals(
        app.Configuration["Auth:DevAutoVerify"], "true", StringComparison.OrdinalIgnoreCase);
    var localRoot = app.Configuration["Storage:LocalRoot"];
    string resolvedLocalRoot;
    try
    {
        resolvedLocalRoot = string.IsNullOrWhiteSpace(localRoot)
            ? "(unset)"
            : Path.GetFullPath(localRoot);
    }
    catch (Exception ex)
    {
        // A malformed path must not turn a log line into a boot failure —
        // LocalDiskFileStorage surfaces the real error on first use.
        resolvedLocalRoot = $"(unresolvable: {ex.GetType().Name})";
    }
    app.Logger.LogInformation(
        "Boot config: env={Environment} | S3 configured: {S3Configured} | Resend configured: {ResendConfigured} | "
        + "Stripe configured: {StripeConfigured} | RateLimits enabled: {RateLimitsEnabled} | "
        + "Auth:DevAutoVerify: {DevAutoVerify} | Worker: stale={StaleJobMinutes}m pendingGrace={PendingGraceMinutes}m "
        + "pendingNoWorker={PendingNoWorkerGraceMinutes}m heartbeatStale={HeartbeatStaleSeconds}s | "
        + "Storage:LocalRoot resolved: {StorageLocalRoot}",
        app.Environment.EnvironmentName, s3Opts.IsConfigured, resendOpts.IsConfigured,
        stripeOpts.IsConfigured, rateLimitsEnabled, devAutoVerify,
        workerKnobs.StaleJobMinutes, workerKnobs.PendingGraceMinutes,
        workerKnobs.PendingNoWorkerGraceMinutes, workerKnobs.HeartbeatStaleSeconds,
        resolvedLocalRoot);
}

// ── Pipeline ───────────────────────────────────────────────────────────────────
// Story 10.1 — proxy header trust, config-gated (prod compose only). FIRST
// in the pipeline so rate-limit per-IP arms and logs see the client, not
// caddy. Clearing KnownNetworks/Proxies + ForwardLimit 1 is safe ONLY
// because the prod compose publishes NO BFF port — caddy is the sole
// ingress; a direct spoof path does not exist. Never enable this on a
// directly-exposed BFF.
if (string.Equals(app.Configuration["ForwardedHeaders:Enabled"], "true", StringComparison.OrdinalIgnoreCase))
{
    var fwd = new ForwardedHeadersOptions
    {
        ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
            | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto,
        ForwardLimit = 1,
    };
    fwd.KnownIPNetworks.Clear();
    fwd.KnownProxies.Clear();
    app.UseForwardedHeaders(fwd);
}

// Story 10.8 (NFR9) — unhandled exceptions become the shared envelope in
// EVERY environment (registered unconditionally so the test exercises the
// exact prod path): 500 internal_error, generic message, trace id for
// support correlation — never a stack frame, never an exception message.
app.UseExceptionHandler(new ExceptionHandlerOptions
{
    // BadHttpRequestException (aborted/oversized body reads) keeps its
    // client-error semantics instead of masquerading as our 500 (review L2).
    StatusCodeSelector = ex => ex is Microsoft.AspNetCore.Http.BadHttpRequestException bad
        ? bad.StatusCode : 500,
    ExceptionHandler = async ctx =>
    {
        ctx.Response.ContentType = "application/json";
        // The shared envelope shape ({error:{code,message,details}}) — the
        // exact ErrorEnvelope.Build contract; traceId rides in details.
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = new
            {
                code = "internal_error",
                message = "Something went wrong on our side. If this persists, contact support with the trace id.",
                details = new { traceId = ctx.TraceIdentifier },
            },
        });
    },
});

// OpenAPI doc is Development-only — orval codegen fetches it from a dev/CI
// run; a solo-fork prod deploy has no public API consumer to serve it to.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Story 10.3 — correlation enrichment (NFR30): any request that names a job
// or analysis id carries that id on every log line + Sentry event, so one id
// traces upload → job → actors → LLM calls → report render. Registered
// BEFORE UseSerilogRequestLogging so the request-summary line carries it too
// (review: order matters — LogContext pops before the summary otherwise).
// Cross-request tag safety relies on Sentry.AspNetCore's per-request scope
// (UseSentry); with DSN unset ConfigureScope is a documented no-op.
app.Use(async (ctx, next) =>
{
    var routeVals = ctx.Request.RouteValues;
    var cid = (routeVals.TryGetValue("jobId", out var j) ? j?.ToString() : null)
        ?? (routeVals.TryGetValue("analysisId", out var a) ? a?.ToString() : null)
        ?? (routeVals.TryGetValue("id", out var i) && ctx.Request.Path.StartsWithSegments("/api/jobs") ? i?.ToString() : null);
    if (cid is not null)
    {
        SentrySdk.ConfigureScope(s => s.SetTag("correlation_id", cid));
        using (Serilog.Context.LogContext.PushProperty("CorrelationId", cid))
        {
            await next();
        }
    }
    else
    {
        await next();
    }
});

app.UseSerilogRequestLogging();

// Story 10.3 — prometheus HTTP metrics + /metrics (internal scrape only —
// caddy never routes /metrics; prometheus reaches bff:5000 on the compose net).
app.UseHttpMetrics();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// ── Routes ─────────────────────────────────────────────────────────────────────
// Story 6.1 — crawler meta shells for / and /pricing (Caddy @site_bots split).
app.MapPublicSiteEndpoints();

var api = app.MapGroup("/api");

api.MapAuthEndpoints();
api.MapMeEndpoints();
api.MapAnonAnalysisEndpoints();  // story 6.3 — /api/anon/* device-identity vertical
api.MapSongEndpoints();
api.MapVersionEndpoints();
api.MapUploadEndpoints();
api.MapReportsEndpoints();
api.MapJobEndpoints();
api.MapVerdictEndpoints();
api.MapFixRackEndpoints();
api.MapReportPhaseEndpoints();
api.MapReferenceEndpoints();
api.MapFileEndpoints();
api.MapCoachEndpoints();
api.MapCoachConversationEndpoints();
api.MapCompareEndpoints();
api.MapRackPresetEndpoints();
api.MapBillingEndpoints();
api.MapHealthEndpoints();
api.MapAccountEndpoints();       // story 4.6 — /api/me/export + /api/me/delete
api.MapAdminEndpoints();         // story 10.5 — /api/admin/* (X-Admin-Key elevated auth)
app.MapEmailWebhookEndpoints();  // story 4.2 — POST /api/email/webhook (svix-verified)

// Story 6.1: the legacy root status JSON (v1 FastAPI habit) is replaced by the
// crawler landing shell in PublicSiteEndpoints — health probes use /healthz.

// Story 10.8 (NFR9) — Development-only detonator (dev-login precedent):
// exercises the UNCONDITIONAL exception handler above, which is byte-for-
// byte the prod path. 404s outside Development.
if (app.Environment.IsDevelopment())
{
    app.MapGet("/api/dev/throw", string () =>
        throw new InvalidOperationException(
            "SECRET-INTERNAL-DETAIL: connection string = Host=postgres;Password=hunter2"))
       .AllowAnonymous();
}

// Story 10.1 (AC3) — the deploy smoke + external-probe endpoint: verifies
// the two hard dependencies. 200 {"status":"ok"} or 503 naming the failure.
app.MapGet("/healthz", async (AppDbContext db, IConnectionMultiplexer redis) =>
{
    // Short hard timeouts: a WEDGED (not refused) dependency must yield a
    // fast 503, not a driver-default multi-second hang per probe.
    string? failing = null;
    try
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        await db.Database.ExecuteSqlRawAsync("SELECT 1", cts.Token);
    }
    catch { failing = "postgres"; }
    if (failing is null)
    {
        try
        {
            await redis.GetDatabase().PingAsync().WaitAsync(TimeSpan.FromSeconds(3));
        }
        catch { failing = "redis"; }
    }
    return failing is null
        ? Results.Json(new { status = "ok" })
        : Results.Json(new { status = "degraded", failing }, statusCode: 503);
}).AllowAnonymous();

// Story 10.3 (AC2) — /metrics + the queue-depth gauge. The worker's dramatiq
// middleware can't see Redis LIST depth; the BFF already owns a Redis
// connection, so depth is collected here at scrape time for all four lanes.
var queueDepthGauge = Metrics.CreateGauge(
    "spectr_queue_depth", "Dramatiq queue depth (pending + delayed messages).", "queue");
var queueScrapeErrors = Metrics.CreateCounter(
    "spectr_queue_depth_scrape_errors_total",
    "Queue-depth collection failures — a rising rate means the gauge is STALE.");
Metrics.DefaultRegistry.AddBeforeCollectCallback(async ct =>
{
    try
    {
        var redisConn = app.Services.GetRequiredService<IConnectionMultiplexer>();
        var rdb = redisConn.GetDatabase();
        foreach (var q in new[] { "coach", "analysis-paid", "analysis-free", "maintenance" })
        {
            // .DQ carries retried/delayed messages — a retry storm must not
            // read as an empty queue (review).
            var len = await rdb.ListLengthAsync($"dramatiq:{q}")
                + await rdb.ListLengthAsync($"dramatiq:{q}.DQ");
            queueDepthGauge.WithLabels(q).Set(len);
        }
    }
    catch
    {
        // Scrapes must not fail on a Redis blip — gauge goes stale, and the
        // error counter is the staleness signal.
        queueScrapeErrors.Inc();
    }
});
app.MapMetrics().AllowAnonymous();

// Story 10.1 (AC2) — migrations at boot under advisory lock (prod compose
// sets Migrations:ApplyAtBoot; dev keeps the CLI/launcher flow). A failure
// here must CRASH the container — serving requests against a half-migrated
// schema is worse than a restart loop.
if (string.Equals(app.Configuration["Migrations:ApplyAtBoot"], "true", StringComparison.OrdinalIgnoreCase))
{
    await BootMigrator.ApplyAsync(app.Services,
        app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("BootMigrator"));
}

app.Run();

// Expose Program for WebApplicationFactory<Program> in test project.
public partial class Program { }
