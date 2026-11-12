#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace albion::tracking {

inline bool IsFreshAimTimestamp(double now, double detectedAt, double graceSeconds) noexcept
{
    if (!std::isfinite(now) || !std::isfinite(detectedAt) ||
        !std::isfinite(graceSeconds) || now < detectedAt) {
        return false;
    }

    const double elapsed = now - detectedAt;
    const double allowed = std::max(0.05, graceSeconds);
    const double roundoff = 4.0 * std::numeric_limits<double>::epsilon() *
        std::max({1.0, std::abs(now), std::abs(detectedAt), allowed});
    return elapsed <= allowed || elapsed - allowed <= roundoff;
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
