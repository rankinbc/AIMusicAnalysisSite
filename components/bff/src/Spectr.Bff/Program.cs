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
                if (path.Contains("/audio", StringComparison.OrdinalIgnoreCase))
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
builder.Services.AddScoped<SubscriptionMirrorService>();

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

// CORS for the frontend dev server.
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5174")
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials()));

builder.Services.AddOpenApi();

var app = builder.Build();

// ── Pipeline ───────────────────────────────────────────────────────────────────
// OpenAPI doc is mapped unconditionally — orval codegen needs to fetch it from
// whatever environment is running (dev + CI). Lock down before public exposure.
app.MapOpenApi();

app.UseSerilogRequestLogging();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// ── Routes ─────────────────────────────────────────────────────────────────────
var api = app.MapGroup("/api");

api.MapAuthEndpoints();
api.MapMeEndpoints();
api.MapSongEndpoints();
api.MapVersionEndpoints();
api.MapJobEndpoints();
api.MapVerdictEndpoints();
api.MapReferenceEndpoints();
api.MapShareEndpoints();
api.MapBookmarkEndpoints();
api.MapFileEndpoints();
api.MapCoachEndpoints();
api.MapCoachConversationEndpoints();
api.MapCompareEndpoints();
api.MapBillingEndpoints();

app.MapGet("/", () => Results.Json(new { status = "ok", version = "2.0.0" }))
   .AllowAnonymous();

app.Run();

// Expose Program for WebApplicationFactory<Program> in test project.
public partial class Program { }
