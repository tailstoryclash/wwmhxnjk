#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace albion::tracking {

inline bool IsFreshAimTimestamp(double now, double detectedAt, double graceSeconds) noexcept
{
    return std::isfinite(now) && std::isfinite(detectedAt) &&
        std::isfinite(graceSeconds) && now >= detectedAt &&
        now - detectedAt <= std::max(0.05, graceSeconds);
}

inline bool IsCurrentDispatch(std::uint64_t ticket, std::uint64_t generation,
    bool active) noexcept
{
    return active && ticket == generation;
}

inline bool ShouldDeactivateOnMissingTarget(bool asyncMover, bool hardMode) noexcept
{
    return asyncMover && !hardMode;
}

}
