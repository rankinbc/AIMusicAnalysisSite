using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services; using Xunit;
namespace Spectr.Bff.Tests;

// Fix-round-1 item 4: DemoSnapshotStore.GetAsync now runs INSIDE the
// registration request (DemoSeeder.SeedAsync is invoked with
// CancellationToken.None from AuthEndpoints.Register) — a stalled storage
// backend must never hang registration forever, and a runaway/oversized
// object must never be fully buffered into memory before we notice. Split
// out of DemoSnapshotSeedTests.cs to keep that file under ~500 lines.
public sealed class DemoSnapshotLoadLimitsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class ProbeFileStorage : IFileStorage
    {
        public bool Hang;
        public int OversizedBytes;
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => Task.FromResult(true);
        public Task<long?> GetFileSizeAsync(string key, CancellationToken ct = default) => Task.FromResult<long?>(null);
        public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default)
            => Task.FromResult<Stream>(new ProbeStream(Hang, OversizedBytes));
        public Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> DeleteAsync(string key, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry) => throw new NotSupportedException();

        // Deliberately minimal Stream: only ReadAsync(Memory<byte>, CancellationToken)
        // is ever exercised by DemoSnapshotStore's bounded read loop.
        private sealed class ProbeStream : Stream
        {
            private readonly bool _hang;
            private int _remaining;

            public ProbeStream(bool hang, int bytesToYield)
            {
                _hang = hang;
                _remaining = bytesToYield;
            }

            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => throw new NotSupportedException(); // never called by DemoSnapshotStore
            public override long Position { get => 0; set => throw new NotSupportedException(); }
            public override void Flush() { }
            public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

            public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
            {
                if (_hang) { await Task.Delay(Timeout.Infinite, cancellationToken); return 0; }
                if (_remaining <= 0) return 0;
                var n = Math.Min(buffer.Length, _remaining);
                buffer.Span[..n].Fill((byte)'x');
                _remaining -= n;
                return n;
            }
        }
    }

    private WebApplicationFactory<Program> BuildWithStorage(string snapshotKey, IFileStorage storage)
        => factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:SnapshotKey", snapshotKey);
            b.ConfigureTestServices(s => { s.RemoveAll(typeof(IFileStorage)); s.AddSingleton(storage); });
        });

    [SkippableFact]
    public async Task Snapshot_Read_That_Hangs_Times_Out_And_Falls_Back()
    {
        await TestDb.RequireAsync(factory);
        var f = BuildWithStorage("audio/demo/test-snapshots/hang/snapshot.json", new ProbeFileStorage { Hang = true });
        using var scope = f.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<DemoSnapshotStore>();
        var started = DateTimeOffset.UtcNow;
        var result = await store.GetAsync(CancellationToken.None);
        Assert.Null(result);
        Assert.True(DateTimeOffset.UtcNow - started < TimeSpan.FromSeconds(20),
            "the 5s load timeout should have tripped, not an external hang");
    }

    [SkippableFact]
    public async Task Snapshot_Stream_Over_The_Size_Cap_Is_Rejected()
    {
        await TestDb.RequireAsync(factory);
        var f = BuildWithStorage(
            "audio/demo/test-snapshots/huge/snapshot.json",
            new ProbeFileStorage { OversizedBytes = 5 * 1024 * 1024 }); // 5 MB > the 4 MB cap
        using var scope = f.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<DemoSnapshotStore>();
        Assert.Null(await store.GetAsync(CancellationToken.None));
    }
}
