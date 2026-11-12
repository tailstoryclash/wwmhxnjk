#pragma once
#include "detection.hpp"
#include <memory>
#include <vector>

class DetectionSnapshot {
public:
    DetectionSnapshot() = default;
    explicit DetectionSnapshot(const std::vector<Detection>& values)
        : values_(std::make_shared<const std::vector<Detection>>(values)) {}

    const std::vector<Detection>& Values() const noexcept {
        static const std::vector<Detection> empty;
        return values_ ? *values_ : empty;
    }
    size_t size() const noexcept { return Values().size(); }
    const Detection& operator[](size_t index) const noexcept { return Values()[index]; }
    auto begin() const noexcept { return Values().begin(); }
    auto end() const noexcept { return Values().end(); }
    void clear() noexcept { values_.reset(); }

private:
    // Published storage is immutable; UI copies only its lifetime-owning handle.
    std::shared_ptr<const std::vector<Detection>> values_;
};
