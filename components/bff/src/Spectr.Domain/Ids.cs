namespace Spectr.Domain;

// Strongly-typed IDs avoid mixing UserId / SongId / JobId in method signatures.
// Wraps a Guid 1:1; serialization is just the Guid string.

public readonly record struct UserId(Guid Value)
{
    public override string ToString() => Value.ToString();
}

public readonly record struct SongId(Guid Value)
{
    public override string ToString() => Value.ToString();
}

public readonly record struct SongVersionId(Guid Value)
{
    public override string ToString() => Value.ToString();
}

public readonly record struct UploadJobId(Guid Value)
{
    public override string ToString() => Value.ToString();
}

public readonly record struct ReferenceId(Guid Value)
{
    public override string ToString() => Value.ToString();
}
