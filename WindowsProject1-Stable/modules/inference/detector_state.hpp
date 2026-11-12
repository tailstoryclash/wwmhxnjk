#pragma once

namespace albion
{
    constexpr bool DetectorIsLoading(bool exited, bool ready, bool failed) noexcept
    {
        return !exited && !ready && !failed;
    }
}
