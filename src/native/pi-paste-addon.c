#include <node_api.h>
#import <ApplicationServices/ApplicationServices.h>
#import <AppKit/AppKit.h>
#include <stdint.h>
#include <string.h>

static napi_value string_value(napi_env env, const char *value) {
    napi_value result;
    napi_create_string_utf8(env, value ? value : "", NAPI_AUTO_LENGTH, &result);
    return result;
}

static napi_value reason_result(napi_env env, const char *reason) {
    napi_value result;
    napi_value ok;
    napi_create_object(env, &result);
    napi_get_boolean(env, false, &ok);
    napi_set_named_property(env, result, "ok", ok);
    napi_set_named_property(env, result, "reason", string_value(env, reason));
    return result;
}

static int normal_window(CFDictionaryRef info) {
    CFNumberRef layer = (CFNumberRef)CFDictionaryGetValue(info, kCGWindowLayer);
    int value = -1;
    if (!layer || !CFNumberGetValue(layer, kCFNumberIntType, &value) || value != 0) return 0;
    CFDictionaryRef bounds = (CFDictionaryRef)CFDictionaryGetValue(info, kCGWindowBounds);
    CGRect rect;
    return bounds && CGRectMakeWithDictionaryRepresentation(bounds, &rect) && rect.size.width > 1.0 && rect.size.height > 1.0;
}

static int capture_native(char *bundle, size_t bundleSize, char *name, size_t nameSize, int *pid, uint32_t *windowId, char *title, size_t titleSize) {
#ifdef PI_PASTE_TEST_MODE
    snprintf(bundle, bundleSize, "%s", "com.pi.voice.smoke");
    snprintf(name, nameSize, "%s", "Pi Voice Smoke");
    *pid = 1; *windowId = 1; title[0] = '\0';
    return 1;
#else
    NSRunningApplication *app = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!app || !app.bundleIdentifier || !app.localizedName || app.processIdentifier <= 0) return 0;
    if (!CFStringGetCString((CFStringRef)app.bundleIdentifier, bundle, bundleSize, kCFStringEncodingUTF8) ||
        !CFStringGetCString((CFStringRef)app.localizedName, name, nameSize, kCFStringEncodingUTF8)) return 0;
    CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (!windows) return 0;
    int found = 0;
    for (CFIndex index = 0; index < CFArrayGetCount(windows); index++) {
        CFDictionaryRef info = (CFDictionaryRef)CFArrayGetValueAtIndex(windows, index);
        CFNumberRef owner = (CFNumberRef)CFDictionaryGetValue(info, kCGWindowOwnerPID);
        int ownerPid = 0;
        CFNumberRef number = (CFNumberRef)CFDictionaryGetValue(info, kCGWindowNumber);
        int64_t value = 0;
        if (!owner || !CFNumberGetValue(owner, kCFNumberIntType, &ownerPid) || ownerPid != app.processIdentifier || !normal_window(info) ||
            !number || !CFNumberGetValue(number, kCFNumberSInt64Type, &value) || value <= 0 || (uint64_t)value > UINT32_MAX) continue;
        *pid = app.processIdentifier;
        *windowId = (uint32_t)value;
        title[0] = '\0';
        CFStringRef candidate = (CFStringRef)CFDictionaryGetValue(info, kCGWindowName);
        if (candidate && CFGetTypeID(candidate) == CFStringGetTypeID()) CFStringGetCString(candidate, title, titleSize, kCFStringEncodingUTF8);
        found = 1;
        break;
    }
    CFRelease(windows);
    return found;
#endif
}

static napi_value capture(napi_env env, napi_callback_info info) {
    char bundle[512] = {0}, name[512] = {0}, title[1024] = {0};
    int pid = 0; uint32_t windowId = 0;
    if (!capture_native(bundle, sizeof(bundle), name, sizeof(name), &pid, &windowId, title, sizeof(title))) return reason_result(env, "target_unavailable");
    napi_value result, value;
    napi_create_object(env, &result);
    napi_get_boolean(env, true, &value); napi_set_named_property(env, result, "ok", value);
    napi_set_named_property(env, result, "bundleId", string_value(env, bundle));
    napi_set_named_property(env, result, "appName", string_value(env, name));
    napi_create_int32(env, pid, &value); napi_set_named_property(env, result, "pid", value);
    napi_create_uint32(env, windowId, &value); napi_set_named_property(env, result, "windowId", value);
    if (title[0]) napi_set_named_property(env, result, "windowTitle", string_value(env, title));
    return result;
}

static int target_matches(napi_env env, napi_value expected) {
    napi_value bundleValue, appValue, pidValue, windowValue;
    char expectedBundle[512] = {0}, expectedApp[512] = {0}; int32_t expectedPid = 0; uint32_t expectedWindow = 0;
    size_t length = 0;
    if (napi_get_named_property(env, expected, "bundleId", &bundleValue) != napi_ok || napi_get_value_string_utf8(env, bundleValue, expectedBundle, sizeof(expectedBundle), &length) != napi_ok ||
        napi_get_named_property(env, expected, "appName", &appValue) != napi_ok || napi_get_value_string_utf8(env, appValue, expectedApp, sizeof(expectedApp), &length) != napi_ok ||
        napi_get_named_property(env, expected, "pid", &pidValue) != napi_ok || napi_get_value_int32(env, pidValue, &expectedPid) != napi_ok ||
        napi_get_named_property(env, expected, "windowId", &windowValue) != napi_ok || napi_get_value_uint32(env, windowValue, &expectedWindow) != napi_ok) return 0;
    char bundle[512] = {0}, name[512] = {0}, title[1024] = {0}; int pid = 0; uint32_t windowId = 0;
    if (!capture_native(bundle, sizeof(bundle), name, sizeof(name), &pid, &windowId, title, sizeof(title))) return 0;
    return strcmp(bundle, expectedBundle) == 0 && strcmp(name, expectedApp) == 0 && pid == expectedPid && windowId == expectedWindow;
}

static napi_value authorize(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
#ifndef PI_PASTE_TEST_MODE
    if (!AXIsProcessTrusted()) return reason_result(env, "permission_blocked");
#endif
    if (argc != 1 || !target_matches(env, argv[0])) return reason_result(env, "target_mismatch");
    napi_value result; napi_create_object(env, &result); napi_value ok; napi_get_boolean(env, true, &ok); napi_set_named_property(env, result, "ok", ok); return result;
}

static napi_value inject(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc < 1 || argc > 2 || !target_matches(env, argv[0])) return reason_result(env, "target_mismatch");
    bool dryRun = false;
    napi_value dryRunValue;
    if (argc == 2 && napi_get_named_property(env, argv[1], "dryRun", &dryRunValue) == napi_ok) napi_get_value_bool(env, dryRunValue, &dryRun);
    if (dryRun) {
        napi_value result; napi_create_object(env, &result); napi_value ok; napi_get_boolean(env, true, &ok); napi_set_named_property(env, result, "ok", ok); napi_set_named_property(env, result, "reason", string_value(env, "injection_requested")); return result;
    }
    if (!AXIsProcessTrusted()) return reason_result(env, "permission_blocked");
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    if (!source) return reason_result(env, "injection_rejected");
    CGEventRef down = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, true);
    CGEventRef up = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, false);
    if (!down || !up) { if (down) CFRelease(down); if (up) CFRelease(up); CFRelease(source); return reason_result(env, "injection_rejected"); }
    CGEventSetFlags(down, kCGEventFlagMaskCommand); CGEventSetFlags(up, kCGEventFlagMaskCommand);
#ifndef PI_PASTE_TEST_MODE
    CGEventPost(kCGHIDEventTap, down); CGEventPost(kCGHIDEventTap, up);
#endif
    CFRelease(down); CFRelease(up); CFRelease(source);
    napi_value result; napi_create_object(env, &result); napi_value ok; napi_get_boolean(env, true, &ok); napi_set_named_property(env, result, "ok", ok); napi_set_named_property(env, result, "reason", string_value(env, "injection_requested")); return result;
}

static napi_value write_clipboard_buffer(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 2) { napi_value result; napi_get_boolean(env, false, &result); return result; }
    char format[1024] = {0}; size_t formatLength = 0;
    void *data = NULL; size_t dataLength = 0;
    if (napi_get_value_string_utf8(env, argv[0], format, sizeof(format), &formatLength) != napi_ok ||
        napi_get_buffer_info(env, argv[1], &data, &dataLength) != napi_ok || formatLength == 0) {
        napi_value result; napi_get_boolean(env, false, &result); return result;
    }
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    NSData *payload = [NSData dataWithBytes:data length:dataLength];
    BOOL written = [pasteboard setData:payload forType:[NSString stringWithUTF8String:format]];
    napi_value result; napi_get_boolean(env, written, &result); return result;
}

static napi_value self_check(napi_env env, napi_callback_info info) { napi_value result; napi_get_boolean(env, true, &result); return result; }

#ifdef PI_PASTE_TEST_MODE
static napi_value smoke_fixture(napi_env env, napi_callback_info info) {
    napi_value result, value;
    napi_create_object(env, &result);
    napi_get_boolean(env, true, &value); napi_set_named_property(env, result, "ok", value);
    napi_set_named_property(env, result, "bundleId", string_value(env, "com.pi.voice.smoke"));
    napi_set_named_property(env, result, "appName", string_value(env, "Pi Voice Smoke"));
    napi_create_int32(env, 1, &value); napi_set_named_property(env, result, "pid", value);
    napi_create_uint32(env, 1, &value); napi_set_named_property(env, result, "windowId", value);
    return result;
}

#endif

NAPI_MODULE_INIT() {
    napi_value captureFn, authorizeFn, injectFn, writeBufferFn, checkFn;
    napi_create_function(env, "capture", NAPI_AUTO_LENGTH, capture, NULL, &captureFn);
    napi_create_function(env, "authorize", NAPI_AUTO_LENGTH, authorize, NULL, &authorizeFn);
    napi_create_function(env, "inject", NAPI_AUTO_LENGTH, inject, NULL, &injectFn);
    napi_create_function(env, "writeClipboardBuffer", NAPI_AUTO_LENGTH, write_clipboard_buffer, NULL, &writeBufferFn);
    napi_create_function(env, "selfCheck", NAPI_AUTO_LENGTH, self_check, NULL, &checkFn);
    napi_set_named_property(env, exports, "capture", captureFn);
    napi_set_named_property(env, exports, "authorize", authorizeFn);
    napi_set_named_property(env, exports, "inject", injectFn);
    napi_set_named_property(env, exports, "writeClipboardBuffer", writeBufferFn);
    napi_set_named_property(env, exports, "selfCheck", checkFn);
#ifdef PI_PASTE_TEST_MODE
    napi_value fixtureFn;
    napi_create_function(env, "smokeFixture", NAPI_AUTO_LENGTH, smoke_fixture, NULL, &fixtureFn);
    napi_set_named_property(env, exports, "smokeFixture", fixtureFn);
#endif
    return exports;
}
