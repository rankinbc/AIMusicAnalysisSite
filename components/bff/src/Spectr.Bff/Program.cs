using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using Spectr.Bff.Auth;
using Spectr.Bff.Endpoints;
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

app.MapGet("/", () => Results.Json(new { status = "ok", version = "2.0.0" }))
   .AllowAnonymous();

app.Run();

// Expose Program for WebApplicationFactory<Program> in test project.
public partial class Program { }
