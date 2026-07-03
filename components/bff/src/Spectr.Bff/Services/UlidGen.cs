using System.Security.Cryptography;

namespace Spectr.Bff.Services;

// Story 4.5 — minimal ULID generator (devices.id). The BFF only GENERATES
// ids, never parses them, so a NuGet dependency for one field is overkill
// (no C# ULID precedent exists in the repo; python-ulid handles the worker
// side). Spec: 48-bit ms timestamp + 80-bit CSPRNG randomness, Crockford
// base32, 26 chars, lexically sortable by creation time.
public static class UlidGen
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string NewUlid()
    {
        Span<byte> bytes = stackalloc byte[16];
        var ms = (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // 48-bit big-endian timestamp in bytes 0..5.
        for (var i = 5; i >= 0; i--)
        {
            bytes[i] = (byte)(ms & 0xFF);
            ms >>= 8;
        }
        RandomNumberGenerator.Fill(bytes[6..]);

        // 16 bytes = 128 bits → 26 base32 chars (130 bits; top 2 bits zero).
        Span<char> chars = stackalloc char[26];
        var acc = 0;
        var accBits = 0;
        var pos = 25;
        for (var i = 15; i >= 0; i--)
        {
            acc |= bytes[i] << accBits;
            accBits += 8;
            while (accBits >= 5 && pos >= 0)
            {
                chars[pos--] = Alphabet[acc & 0x1F];
                acc = (int)((uint)acc >> 5);
                accBits -= 5;
            }
        }
        while (pos >= 0)
        {
            chars[pos--] = Alphabet[acc & 0x1F];
            acc = (int)((uint)acc >> 5);
        }
        return new string(chars);
    }
}
