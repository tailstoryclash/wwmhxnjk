#include "modules/core/detection_snapshot.hpp"
#include <cstdlib>
#include <iostream>

static void Check(bool value, const char* message) {
    if (!value) { std::cerr << message << '\n'; std::exit(1); }
}
int main() {
    DetectionSnapshot empty;
    Check(empty.size() == 0 && empty.begin() == empty.end(), "empty snapshot");
    std::vector<Detection> source{{1, 2, 3, 4, .9f, 0}};
    DetectionSnapshot published(source);
    auto reader = published;
    Check(&reader[0] == &published[0], "copies must share immutable storage");
    source[0].x = 100;
    Check(reader[0].x == 1, "source mutations must not change published data");
    published = DetectionSnapshot(source);
    Check(published[0].x == 100 && reader[0].x == 1, "old reader survives republish");
    published.clear();
    Check(published.size() == 0 && reader.size() == 1, "reset must not invalidate readers");
    auto moved = std::move(reader);
    Check(moved.size() == 1 && reader.size() == 0, "moved snapshot lifetime");
    std::cout << "detection_snapshot_tests PASS\n";
}
