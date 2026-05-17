namespace Spectr.Bff.Services;

public interface IFileStorage
{
    Task<Stream> OpenReadAsync(string key, CancellationToken ct = default);
    Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default);
    Task<bool> DeleteAsync(string key, CancellationToken ct = default);

    // For R2 returns a signed URL; for local disk returns an internal authenticated route.
    Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry);

    Task<bool> ExistsAsync(string key, CancellationToken ct = default);
}

internal sealed class LocalDiskFileStorage(IConfiguration config) : IFileStorage
{
    private readonly string _root = System.IO.Path.GetFullPath(
        config["Storage:LocalRoot"] ?? throw new InvalidOperationException("Storage:LocalRoot not set"));

    private string Resolve(string key) => System.IO.Path.Combine(_root, key);

    public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default)
        => Task.FromResult<Stream>(File.OpenRead(Resolve(key)));

    public async Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        await using var fs = File.Create(path);
        await content.CopyToAsync(fs, ct);
        return key;
    }

    public Task<bool> DeleteAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        if (!File.Exists(path)) return Task.FromResult(false);
        File.Delete(path);
        return Task.FromResult(true);
    }

    public Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry)
    {
        // Local disk has no signing; clients hit the authenticated /api/files/{key} route instead.
        return Task.FromResult(new Uri($"/api/files/{key}", UriKind.Relative));
    }

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default)
        => Task.FromResult(File.Exists(Resolve(key)));
}
