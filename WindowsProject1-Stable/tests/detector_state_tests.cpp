#include "modules/inference/detector_state.hpp"

#include <iostream>

static_assert(albion::DetectorIsLoading(false, false, false));
static_assert(!albion::DetectorIsLoading(true, false, false));
static_assert(!albion::DetectorIsLoading(false, true, false));
static_assert(!albion::DetectorIsLoading(false, false, true));
static_assert(!albion::DetectorIsLoading(false, true, true));

int main()
{
    std::cout << "DETECTOR_STATE_PASS\n";
}
