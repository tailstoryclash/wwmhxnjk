#pragma once

#include <Windows.h>
#include <iostream>
#include <nlohmann/json.hpp>

#pragma comment (lib, "advapi32.lib")
#pragma comment(lib, "Normaliz.lib")
#pragma comment(lib, "wldap32.lib" )
#pragma comment(lib, "crypt32.lib" )
#pragma comment(lib, "Ws2_32.lib")

// FIX-V11-BUILD: this package links static curl/sodium in every configuration.
// Guard command-line definitions to avoid C4005; Debug must not import DLL APIs.
#ifndef CURL_STATICLIB
#define CURL_STATICLIB
#endif
#ifndef SODIUM_STATIC
#define SODIUM_STATIC
#endif
#include <curl/curl.h>

#include <sodium.h>

#include "utils.hpp"