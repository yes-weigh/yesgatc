namespace Yesgatc.CertificateWorker.Models;

public sealed class RcFeeTierAmounts
{
    public int InPremise { get; init; }
    public int InSitu { get; init; }
    public int Self { get; init; }
}

public sealed class RcFeesStructure
{
    public RcFeeTierAmounts TierUpto20Kg { get; init; } = DefaultTierUpto20Kg;
    public RcFeeTierAmounts TierUpto150Kg { get; init; } = DefaultTierUpto150Kg;

    public static RcFeeTierAmounts DefaultTierUpto20Kg { get; } = new()
    {
        InPremise = 750,
        InSitu = 850,
        Self = 150,
    };

    public static RcFeeTierAmounts DefaultTierUpto150Kg { get; } = new()
    {
        InPremise = 900,
        InSitu = 1000,
        Self = 250,
    };
}
