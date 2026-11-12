#include "modules/tracking/tracking_logic.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace {

int checks = 0;

void Check(bool condition, const char* message)
{
    ++checks;
    if (!condition) {
        std::fprintf(stderr, "FAIL %s\n", message);
        std::exit(2);
    }
}

}

int main()
{
    using albion::tracking::IsCurrentDispatch;
    using albion::tracking::IsFreshAimTimestamp;
    using albion::tracking::ShouldDeactivateOnMissingTarget;

    Check(IsFreshAimTimestamp(10.0, 9.95, 0.12), "fresh timestamp");
    Check(!IsFreshAimTimestamp(10.0, 9.87, 0.12), "stale timestamp");
    Check(IsFreshAimTimestamp(10.05, 10.0, 0.05), "decimal grace boundary inclusive");
    Check(!IsFreshAimTimestamp(10.051, 10.0, 0.05), "past grace boundary rejected");
    Check(IsFreshAimTimestamp(10.049, 10.0, 0.0), "minimum grace interval");
    Check(IsFreshAimTimestamp(1.125, 1.0, 0.125), "grace boundary inclusive");
    Check(!IsFreshAimTimestamp(9.0, 10.0, 1.0), "future timestamp rejected");
    Check(!IsFreshAimTimestamp(std::numeric_limits<double>::quiet_NaN(), 9.0, 0.1),
        "nonfinite clock rejected");
    Check(!IsFreshAimTimestamp(10.0, std::numeric_limits<double>::quiet_NaN(), 0.1),
        "nonfinite detection time rejected");
    Check(!IsFreshAimTimestamp(10.0, 9.0, std::numeric_limits<double>::infinity()),
        "nonfinite grace rejected");

    Check(IsCurrentDispatch(4, 4, true), "current active dispatch allowed");
    Check(!IsCurrentDispatch(4, 5, true), "superseded dispatch rejected");
    Check(!IsCurrentDispatch(4, 4, false), "inactive dispatch rejected");

    Check(ShouldDeactivateOnMissingTarget(true, false), "async miss cancels mover");
    Check(!ShouldDeactivateOnMissingTarget(false, false), "sync mode unchanged");
    Check(!ShouldDeactivateOnMissingTarget(true, true), "hard mode unchanged");

    std::printf("TRACKING_LOGIC_PASS checks=%d\n", checks);
    return 0;
}
