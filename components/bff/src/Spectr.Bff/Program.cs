using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
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

// ── Configuration ──────────────────────────────────────────────────────────────
var conn = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Postgres");
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Missing Jwt:Key");

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
        };
    });
builder.Services.AddAuthorization();

// Auth helpers.
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddScoped<RefreshTokenService>();
builder.Services.AddScoped<HandleSeeder>();

// File storage — swap LocalDiskFileStorage for R2FileStorage via config when public.
builder.Services.AddSingleton<IFileStorage, LocalDiskFileStorage>();

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
// Durable signed anon identity, opaque-resource-token auth, cross-slice no-op
// sinks, and a Redis rate limiter. No DB — cookie + Redis + interfaces only.
// Anon:SigningKey is separate from Jwt:Key and must be stable across restarts.
builder.Services.AddOptions<AnonOptions>()
    .Bind(builder.Configuration.GetSection(AnonOptions.SectionName))
    .Validate(o => !string.IsNullOrWhiteSpace(o.SigningKey),
        "Anon:SigningKey must be set (separate from Jwt:Key)")
    .ValidateOnStart();
builder.Services.AddScoped<AnonIdentity>();
builder.Services.AddScoped<ResourceTokenAuth>();
builder.Services.AddScoped<INotificationSink, NoOpNotificationSink>();
builder.Services.AddScoped<IGamePlanSink, NoOpGamePlanSink>();
builder.Services.AddSingleton<IRateLimiter, RedisRateLimiter>();

// Listen V3 (PRP-1) — no-op generator seam for source=coach/analysis presets
// (real impl is PRP-8; mirrors the PRP-0 sink convention).
builder.Services.AddScoped<IPresetGenerator, NoOpPresetGenerator>();

// Listen V3 (PRP-2) — version-scoped sharing: access resolver + the opaque
// share-token resolver (plugs into ResourceTokenAuth's ITokenResolver set).
builder.Services.AddScoped<AccessService>();
builder.Services.AddScoped<ITokenResolver, ShareTokenResolver>();

// Listen V3 (PRP-4) — Room sessions: the Redis WAL + pub/sub engine (stateless
// over the singleton multiplexer) + the session-invite token resolver (sibling
// of ShareTokenResolver, plugs into ResourceTokenAuth's set).
builder.Services.AddSingleton<RoomBus>();
builder.Services.AddScoped<ITokenResolver, SessionTokenResolver>();

// Story 2.8 — usage-page honest-math (90-day credit spend vs Pro-equivalent).
builder.Services.AddScoped<HonestMathService>();

// Reference profiles — lazy fingerprint-cached aggregate over a set's analyzed members.
builder.Services.AddScoped<ReferenceProfileAggregator>();

// Story 2.10 — nightly billing reconciliation (read-only drift check).
builder.Services.AddHostedService<BillingReconciliationService>();

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

// ── Pipeline ───────────────────────────────────────────────────────────────────
// OpenAPI doc is mapped unconditionally — orval codegen needs to fetch it from
// whatever environment is running (dev + CI). Lock down before public exposure.
app.MapOpenApi();

app.UseSerilogRequestLogging();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// PRP-0 — resolve/issue the durable anon identity AFTER authentication (so the
// principal is known) and BEFORE routing (so endpoints can read it).
app.UseAnonIdentity();

// ── Routes ─────────────────────────────────────────────────────────────────────
var api = app.MapGroup("/api");

api.MapAuthEndpoints();
api.MapMeEndpoints();
api.MapSongEndpoints();
api.MapVersionEndpoints();
api.MapReportsEndpoints();
api.MapJobEndpoints();
api.MapVerdictEndpoints();
api.MapFixRackEndpoints();
api.MapReportPhaseEndpoints();
api.MapReferenceEndpoints();
api.MapShareEndpoints();
api.MapBookmarkEndpoints();
api.MapFileEndpoints();
api.MapCoachEndpoints();
api.MapCoachConversationEndpoints();
api.MapCompareEndpoints();
api.MapRackPresetEndpoints();
api.MapVersionShareEndpoints();
api.MapVersionViewEndpoints();
api.MapFeedbackEndpoints();
api.MapRoomEndpoints();
api.MapBillingEndpoints();

app.MapGet("/", () => Results.Json(new { status = "ok", version = "2.0.0" }))
   .AllowAnonymous();

app.Run();

// Expose Program for WebApplicationFactory<Program> in test project.
public partial class Program { }
