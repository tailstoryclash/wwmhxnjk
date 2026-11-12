#include "modules/inference/detector_state.hpp"

#include <cassert>
#include <iostream>

int main()
{
    assert(albion::DetectorIsLoading(false, false, false));
    assert(!albion::DetectorIsLoading(true, false, false));
    assert(!albion::DetectorIsLoading(false, true, false));
    assert(!albion::DetectorIsLoading(false, false, true));
    assert(!albion::DetectorIsLoading(false, true, true));
    std::cout << "DETECTOR_STATE_PASS\n";
}
